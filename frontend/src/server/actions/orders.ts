"use server";

import { ApiError } from "@/lib/api/client";
import { getOrder } from "@/lib/api/orders";
import { isValidEmail } from "@/lib/validation";
import { mapApiOrder, type OrderView } from "@/lib/orders";
import { loadOrder, ORDER_NUMBER_RE, revealCodes, type RevealResult } from "@/server/orders/load";

export async function refreshOrderAction(orderNumber: string, urlToken?: string): Promise<OrderView | null> {
  try {
    return (await loadOrder(String(orderNumber), urlToken ? String(urlToken) : undefined))?.order ?? null;
  } catch {
    return null;
  }
}

export async function revealCodesAction(orderNumber: string, urlToken?: string): Promise<RevealResult> {
  return revealCodes(String(orderNumber), urlToken ? String(urlToken) : undefined);
}

export type LookupResult = { ok: true; order: OrderView } | { ok: false; error: "invalid" | "not_found" | "unavailable" };

/** Guest order lookup by order number + checkout email. Shows status only (codes stay masked). */
export async function lookupOrderAction(input: { number: string; email: string }): Promise<LookupResult> {
  const number = String(input?.number ?? "").trim().toUpperCase();
  const email = String(input?.email ?? "").trim().toLowerCase();
  if (!ORDER_NUMBER_RE.test(number) || !isValidEmail(email)) return { ok: false, error: "invalid" };
  try {
    return { ok: true, order: mapApiOrder(await getOrder(number, { email })) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { ok: false, error: "not_found" };
    if (error instanceof ApiError && error.status === 429) return { ok: false, error: "unavailable" };
    return { ok: false, error: "unavailable" };
  }
}
