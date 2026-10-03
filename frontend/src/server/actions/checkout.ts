"use server";

import { z } from "zod";
import { ApiError } from "@/lib/api/client";
import { createOrder, validateCoupon } from "@/lib/api/orders";

const checkoutSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(120),
  phone: z.string().min(6).max(32),
  notes: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(200),
  couponCode: z.string().trim().max(64).optional(),
  paymentProvider: z.literal("paypal").optional(),
  items: z
    .array(
      z.object({
        productId: z.string(),
        variantId: z.union([z.string(), z.number()]).optional(),
        quantity: z.number().int().min(1).max(5),
        fields: z.record(z.string().max(200)).optional(),
      }),
    )
    .min(1)
    .max(20),
});

const couponCheckSchema = z.object({
  code: z.string().trim().min(1).max(64),
  subtotalJod: z.number().optional(),
});

export async function validateStorefrontCoupon(input: unknown) {
  const parsed = couponCheckSchema.safeParse(input);
  if (!parsed.success) return { valid: false as const, discountJod: 0 };
  try {
    const result = await validateCoupon(parsed.data.code, parsed.data.subtotalJod ?? 0);
    return {
      valid: Boolean(result.valid),
      discountJod: result.discount_jod ?? 0,
    };
  } catch {
    return { valid: false as const, discountJod: 0 };
  }
}

export async function createStorefrontOrder(input: unknown) {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, message: "Check the checkout details and try again." };
  }
  try {
    const order = await createOrder({
      email: parsed.data.email,
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
      notes: parsed.data.notes ?? "",
      coupon_code: parsed.data.couponCode ?? "",
      idempotency_key: parsed.data.idempotencyKey,
      region_confirmed: true,
      refund_confirmed: true,
      payment_provider: parsed.data.paymentProvider ?? "",
      items: parsed.data.items.map((item) => ({
        product_id: item.productId,
        denomination_id: item.variantId != null ? String(item.variantId) : "",
        quantity: item.quantity,
        fields: item.fields ?? {},
      })),
    });
    return {
      ok: true as const,
      id: String(order.id),
      orderNumber: order.order_number,
      paymentStatus: order.payment_status ?? "",
      checkoutToken: order.checkout_token ?? "",
      paypalAmount: order.paypal_amount ?? "",
      paypalCurrency: order.paypal_currency ?? "",
    };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false as const, message: error.message };
    return { ok: false as const, message: "We could not start checkout. Nothing was charged." };
  }
}
