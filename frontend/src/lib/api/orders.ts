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

export function createOrder(payload: Record<string, unknown>) {
  return apiFetch<{
    id: number;
    order_number: string;
    total_jod: number;
    payment_status?: string;
    payment_provider?: string;
    checkout_token?: string;
    paypal_amount?: string;
    paypal_currency?: string;
  }>("/checkout/orders/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getOrder(orderNumber: string, email?: string) {
  const query = email ? `?email=${encodeURIComponent(email)}` : "";
  return apiFetch(`/orders/${orderNumber}/${query}`);
}

export function myOrders(token: string) {
  return apiFetch("/orders/mine/", { token });
}
