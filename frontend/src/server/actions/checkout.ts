"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, apiErrorCode, apiErrorField } from "@/lib/api/client";
import { createOrder, validateCoupon } from "@/lib/api/orders";
import { couponReason, type CouponReason } from "@/lib/coupon-storage";
import { parseStockLines, type StockLine } from "@/lib/stock-errors";
import { MAX_CUSTOMER_NOTE, normalizeFieldValue, normalizePhone } from "@/lib/validation";
import { rememberOrderAccess } from "@/server/orders/access";

const checkoutSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(32).optional(),
  notes: z.string().max(MAX_CUSTOMER_NOTE).optional(),
  locale: z.enum(["en", "ar"]).optional(),
  idempotencyKey: z.string().min(8).max(200),
  couponCode: z.string().trim().max(40).optional(),
  paymentProvider: z.literal("paypal").optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.number().int().positive().optional(),
        denominationId: z.string().max(64).optional(),
        quantity: z.number().int().min(1).max(5),
        fields: z.record(z.string().max(200)).optional(),
      }),
    )
    .min(1)
    .max(20),
});

const couponCheckSchema = z.object({
  code: z.string().trim().min(1).max(40),
  subtotalFils: z.number().int().min(0),
  email: z.string().trim().email().optional().or(z.literal("")),
});

export type CouponCheckResult =
  | { valid: true; code: string; subtotalFils: number; discountFils: number; totalFils: number; freeOrder: boolean }
  | { valid: false; reason: CouponReason };

/** OR-25: validates with the checkout email when known and returns the specific reason. */
export async function validateStorefrontCoupon(input: unknown): Promise<CouponCheckResult> {
  const parsed = couponCheckSchema.safeParse(input);
  if (!parsed.success) return { valid: false, reason: "invalid_coupon" };
  try {
    const result = await validateCoupon(parsed.data.code, parsed.data.subtotalFils, parsed.data.email || undefined);
    if (!result.valid) return { valid: false, reason: "invalid_coupon" };
    const discountFils = Math.max(0, Math.round(Number(result.discount_fils ?? (result.discount_jod ?? 0) * 1000)));
    const subtotalFils = parsed.data.subtotalFils;
    const totalFils = Math.max(0, Math.round(Number(result.total_fils ?? subtotalFils - discountFils)));
    return {
      valid: true,
      code: result.code || parsed.data.code.toUpperCase(),
      subtotalFils,
      discountFils,
      totalFils,
      freeOrder: Boolean(result.free_order) || (subtotalFils > 0 && totalFils === 0),
    };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 404 || error.status === 409)) {
      return { valid: false, reason: couponReason(apiErrorCode(error)) };
    }
    return { valid: false, reason: "unavailable" };
  }
}

export type CheckoutErrorCode =
  | "invalid_input"
  | "checkout_error"
  | "invalid_coupon"
  | "coupon_expired"
  | "coupon_not_started"
  | "coupon_limit_reached"
  | "coupon_customer_limit"
  | "out_of_stock"
  | "order_not_payable"
  | "account_disabled"
  | "throttled"
  | "unavailable";

export type CheckoutResult =
  | {
      ok: true;
      id: string;
      orderNumber: string;
      paymentStatus: string;
      totalFils: number;
      checkoutToken: string;
      paypalAmount: string;
      paypalCurrency: string;
      /** D6: the order was free and is already paid — go straight to the success page. */
      freeOrder: boolean;
    }
  | { ok: false; code: CheckoutErrorCode; message: string; field: string; lines: StockLine[] };

const COUPON_CODES = new Set(["invalid_coupon", "coupon_expired", "coupon_not_started", "coupon_limit_reached", "coupon_customer_limit"]);

function failure(code: CheckoutErrorCode, message = "", field = "", lines: StockLine[] = []): CheckoutResult {
  return { ok: false, code, message, field, lines };
}

export async function createStorefrontOrder(input: unknown): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failure("invalid_input", "", String(issue?.path?.[0] ?? ""));
  }
  const data = parsed.data;
  const phone = data.phone ? normalizePhone(data.phone) : "";
  if (data.phone && !phone) return failure("invalid_input", "", "phone");
  try {
    const session = await auth();
    const customerToken = session?.user?.kind === "CUSTOMER" ? session.user.accessToken : undefined;
    const order = await createOrder(
      {
        email: data.email,
        full_name: data.fullName,
        phone,
        notes: (data.notes ?? "").trim(),
        locale: data.locale ?? "en",
        coupon_code: data.couponCode ?? "",
        idempotency_key: data.idempotencyKey,
        region_confirmed: true,
        refund_confirmed: true,
        payment_provider: data.paymentProvider ?? "",
        delivery_method: "account",
        items: data.items.map((item) => ({
          product_id: item.productId,
          ...(item.variantId ? { variant_id: item.variantId } : { denomination_id: item.denominationId ?? "" }),
          quantity: item.quantity,
          fields: Object.fromEntries(Object.entries(item.fields ?? {}).map(([key, value]) => [key, normalizeFieldValue(value)])),
        })),
      },
      customerToken,
    );
    await rememberOrderAccess({
      number: order.order_number,
      email: data.email.toLowerCase(),
      token: order.access_token || undefined,
    });
    const totalFils = Math.round(Number(order.total_fils ?? Number(order.total_jod) * 1000));
    return {
      ok: true,
      id: String(order.id),
      orderNumber: order.order_number,
      paymentStatus: order.payment_status ?? "",
      totalFils,
      checkoutToken: order.checkout_token ?? "",
      paypalAmount: order.paypal_amount ?? "",
      paypalCurrency: order.paypal_currency ?? "",
      freeOrder: Boolean(order.free_order) || (totalFils === 0 && order.payment_status === "PAID"),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      const code = apiErrorCode(error);
      const field = apiErrorField(error);
      if (error.status === 429) return failure("throttled");
      if (code === "out_of_stock") return failure("out_of_stock", error.message, field, parseStockLines(error.body));
      if (code === "order_not_payable") return failure("order_not_payable", error.message, field);
      if (code === "account_disabled") return failure("account_disabled", error.message);
      if (COUPON_CODES.has(code)) return failure(code as CheckoutErrorCode, "", "coupon_code");
      if (error.status === 400) return failure("checkout_error", error.message, field);
    }
    return failure("unavailable");
  }
}
