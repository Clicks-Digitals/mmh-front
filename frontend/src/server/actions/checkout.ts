"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { auth } from "@/auth";
import { createOrder, validateCoupon } from "@/lib/api/orders";
import { ORDER_ACCESS_COOKIE } from "@/server/orders/access";

const checkoutSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(120),
  phone: z.string().min(6).max(32),
  notes: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(200),
  couponCode: z.string().trim().max(64).optional(),
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
  const parsed = checkoutSchema.parse(input);
  const session = await auth();
  const customerToken = session?.user?.kind === "CUSTOMER" ? session.user.accessToken : undefined;
  const order = await createOrder(
    {
      email: parsed.email,
      full_name: parsed.fullName,
      phone: parsed.phone,
      notes: parsed.notes ?? "",
      coupon_code: parsed.couponCode ?? "",
      idempotency_key: parsed.idempotencyKey,
      region_confirmed: true,
      refund_confirmed: true,
      items: parsed.items.map((item) => ({
        product_id: item.productId,
        denomination_id: item.variantId != null ? String(item.variantId) : "",
        quantity: item.quantity,
        fields: item.fields ?? {},
      })),
    },
    customerToken,
  );
  (await cookies()).set(ORDER_ACCESS_COOKIE, JSON.stringify({ number: order.order_number, email: parsed.email }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return {
    id: String(order.id),
    orderNumber: order.order_number,
    paymentStatus: order.payment_status,
  };
}
