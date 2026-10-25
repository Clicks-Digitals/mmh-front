import { apiFetch } from "@/lib/api/client";
import type { ApiOrder, ApiRevealedCodes } from "@/lib/orders";

export type CouponQuote = {
  valid: boolean;
  code?: string;
  percent_off?: number | null;
  amount_off_fils?: number | null;
  subtotal_fils?: number;
  discount_fils?: number;
  discount_jod?: number;
  total_fils?: number;
  total_jod?: number;
  /** D6: the coupon makes this order free (no PayPal). */
  free_order?: boolean;
};

export function validateCoupon(code: string, subtotalFils: number, email?: string) {
  return apiFetch<CouponQuote>("/coupons/validate/", {
    method: "POST",
    body: JSON.stringify({ code, subtotal_fils: subtotalFils, ...(email ? { email } : {}) }),
  });
}

export type CreatedOrder = ApiOrder & {
  access_token?: string;
  checkout_token?: string;
  paypal_amount?: string;
  paypal_currency?: string;
  /** D6: total 0 → the order is already PAID with provider "free". */
  free_order?: boolean;
};

export function createOrder(payload: Record<string, unknown>, token?: string) {
  return apiFetch<CreatedOrder>("/checkout/orders/", {
    method: "POST",
    body: JSON.stringify(payload),
    token,
  });
}

export function getOrder(
  orderNumber: string,
  { email, accessToken, token }: { email?: string; accessToken?: string; token?: string } = {},
) {
  const params = new URLSearchParams();
  if (accessToken) params.set("token", accessToken);
  else if (email) params.set("email", email);
  const query = params.toString();
  return apiFetch<ApiOrder>(`/orders/${encodeURIComponent(orderNumber)}/${query ? `?${query}` : ""}`, { token });
}

export function revealOrderCodes(orderNumber: string, { accessToken, token }: { accessToken?: string; token?: string }) {
  return apiFetch<ApiRevealedCodes>(`/orders/${encodeURIComponent(orderNumber)}/codes/`, {
    method: "POST",
    body: JSON.stringify(accessToken ? { access_token: accessToken } : {}),
    token,
  });
}

export function myOrders(token: string, { paidOnly = false }: { paidOnly?: boolean } = {}) {
  return apiFetch<ApiOrder[] | { results: ApiOrder[]; next?: string | null }>(
    `/orders/mine/?page_size=100${paidOnly ? "&paid_only=1" : ""}`,
    { token },
  );
}

/** D1/D7: cancel an unpaid order (owner JWT or the order access token). */
export function cancelOrder(orderNumber: string, { accessToken, token }: { accessToken?: string; token?: string }) {
  return apiFetch<ApiOrder>(`/orders/${encodeURIComponent(orderNumber)}/cancel/`, {
    method: "POST",
    body: JSON.stringify(accessToken ? { access_token: accessToken } : {}),
    token,
  });
}
