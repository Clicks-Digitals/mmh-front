"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { ApiError, apiErrorCode, apiErrorField } from "@/lib/api/client";
import { createOrder, validateCoupon } from "@/lib/api/orders";
import { normalizePhone } from "@/lib/validation";
import { rememberOrderAccess } from "@/server/orders/access";

const checkoutSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(32).optional(),
  notes: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(200),
  couponCode: z.string().trim().max(64).optional(),
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
  code: z.string().trim().min(1).max(64),
  subtotalFils: z.number().int().min(0),
  email: z.string().trim().email().optional().or(z.literal("")),
});

export type CouponCheckResult =
  | { valid: true; code: string; subtotalFils: number; discountFils: number; totalFils: number }
  | { valid: false; reason: "invalid" | "unavailable" };

export async function validateStorefrontCoupon(input: unknown): Promise<CouponCheckResult> {
  const parsed = couponCheckSchema.safeParse(input);
  if (!parsed.success) return { valid: false, reason: "invalid" };
  try {
    const result = await validateCoupon(parsed.data.code, parsed.data.subtotalFils, parsed.data.email || undefined);
    if (!result.valid) return { valid: false, reason: "invalid" };
    const discountFils = Math.max(0, Math.round(Number(result.discount_fils ?? (result.discount_jod ?? 0) * 1000)));
    const subtotalFils = parsed.data.subtotalFils;
    return {
      valid: true,
      code: result.code || parsed.data.code.toUpperCase(),
      subtotalFils,
      discountFils,
      totalFils: Math.max(0, Math.round(Number(result.total_fils ?? subtotalFils - discountFils))),
    };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || apiErrorCode(error) === "invalid_coupon")) {
      return { valid: false, reason: "invalid" };
    }
    return { valid: false, reason: "unavailable" };
  }
}

export type CheckoutErrorCode =
  | "invalid_input"
  | "checkout_error"
  | "invalid_coupon"
  | "out_of_stock"
  | "order_not_payable"
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
    }
  | { ok: false; code: CheckoutErrorCode; message: string; field: string };

export async function createStorefrontOrder(input: unknown): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, code: "invalid_input", message: "", field: String(issue?.path?.[0] ?? "") };
  }
  const data = parsed.data;
  const phone = data.phone ? normalizePhone(data.phone) : "";
  if (data.phone && !phone) return { ok: false, code: "invalid_input", message: "", field: "phone" };
  try {
    const session = await auth();
    const customerToken = session?.user?.kind === "CUSTOMER" ? session.user.accessToken : undefined;
    const order = await createOrder(
      {
        email: data.email,
        full_name: data.fullName,
        phone,
        notes: data.notes ?? "",
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
          fields: item.fields ?? {},
        })),
      },
      customerToken,
    );
    await rememberOrderAccess({
      number: order.order_number,
      email: data.email.toLowerCase(),
      token: order.access_token || undefined,
    });
    return {
      ok: true,
      id: String(order.id),
      orderNumber: order.order_number,
      paymentStatus: order.payment_status ?? "",
      totalFils: Math.round(Number(order.total_fils ?? Number(order.total_jod) * 1000)),
      checkoutToken: order.checkout_token ?? "",
      paypalAmount: order.paypal_amount ?? "",
      paypalCurrency: order.paypal_currency ?? "",
    };
  } catch (error) {
    if (error instanceof ApiError) {
      const code = apiErrorCode(error);
      const field = apiErrorField(error);
      if (error.status === 429) return { ok: false, code: "throttled", message: "", field: "" };
      if (code === "out_of_stock") return { ok: false, code: "out_of_stock", message: error.message, field };
      if (code === "order_not_payable") return { ok: false, code: "order_not_payable", message: error.message, field };
      if (code === "invalid_coupon") return { ok: false, code: "invalid_coupon", message: "", field: "coupon_code" };
      if (error.status === 400) return { ok: false, code: "checkout_error", message: error.message, field };
    }
    return { ok: false, code: "unavailable", message: "", field: "" };
  }
}
