import { apiFetch } from "@/lib/api/client";

export function validateCoupon(code: string, subtotalJod = 0) {
  return apiFetch<{ valid: boolean; discount_jod?: number; discount_fils?: number; code?: string }>(
    "/coupons/validate/",
    {
      method: "POST",
      body: JSON.stringify({ code, subtotal_jod: subtotalJod }),
    },
  );
}

export type CreatedOrder = {
  id: number;
  order_number: string;
  total_jod: number;
  payment_status: string;
  fulfillment_status?: string;
  payment_provider?: string;
  checkout_token?: string;
  paypal_amount?: string;
  paypal_currency?: string;
};

export function createOrder(payload: Record<string, unknown>, token?: string) {
  return apiFetch<CreatedOrder>("/checkout/orders/", {
    method: "POST",
    body: JSON.stringify(payload),
    token,
  });
}

export function getOrder(orderNumber: string, { email, token }: { email?: string; token?: string } = {}) {
  const query = email ? `?email=${encodeURIComponent(email)}` : "";
  return apiFetch(`/orders/${encodeURIComponent(orderNumber)}/${query}`, { token });
}

export function myOrders(token: string) {
  return apiFetch("/orders/mine/", { token });
}
