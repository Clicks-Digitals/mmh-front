"use server";

import { ApiError, apiErrorCode } from "@/lib/api/client";
import { cancelOrder, getOrder } from "@/lib/api/orders";
import { createPayPalOrderForExisting } from "@/lib/api/paypal";
import { isValidEmail } from "@/lib/validation";
import { mapApiOrder, type OrderView } from "@/lib/orders";
import { parseStockLines, type StockLine } from "@/lib/stock-errors";
import { loadOrder, ORDER_NUMBER_RE, orderAccessFor, revealCodes, type RevealResult } from "@/server/orders/load";

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

/** Every way this visitor can prove access: account JWT first, then the order access token. */
async function attemptsFor(orderNumber: string, urlToken?: string) {
  const access = await orderAccessFor(orderNumber, urlToken ? String(urlToken) : undefined);
  return [
    ...(access.jwt ? [{ token: access.jwt }] : []),
    ...(access.accessToken ? [{ accessToken: access.accessToken }] : []),
  ];
}

export type StartPaymentResult =
  | { ok: true; paypalOrderId: string }
  | {
      ok: false;
      error: "already_paid" | "out_of_stock" | "not_payable" | "not_found" | "throttled" | "unavailable";
      message: string;
      lines: StockLine[];
    };

/**
 * D1 "Complete payment": opens PayPal for an existing unpaid order (no new order is created).
 * The access token stays on the server (httpOnly cookie / email link).
 */
export async function startOrderPaymentAction(orderNumber: string, urlToken?: string): Promise<StartPaymentResult> {
  const number = String(orderNumber ?? "");
  if (!ORDER_NUMBER_RE.test(number)) return { ok: false, error: "not_found", message: "", lines: [] };
  const attempts = await attemptsFor(number, urlToken);
  if (!attempts.length) return { ok: false, error: "not_found", message: "", lines: [] };
  for (const attempt of attempts) {
    try {
      const result = await createPayPalOrderForExisting(number, attempt);
      if (!result.paypal_order_id) return { ok: false, error: "unavailable", message: "", lines: [] };
      return { ok: true, paypalOrderId: result.paypal_order_id };
    } catch (error) {
      if (!(error instanceof ApiError)) return { ok: false, error: "unavailable", message: "", lines: [] };
      const code = apiErrorCode(error);
      if (error.status === 401 || error.status === 403 || error.status === 404) continue;
      if (error.status === 429) return { ok: false, error: "throttled", message: "", lines: [] };
      if (code === "already_paid") return { ok: false, error: "already_paid", message: "", lines: [] };
      if (code === "out_of_stock") {
        return { ok: false, error: "out_of_stock", message: error.message, lines: parseStockLines(error.body) };
      }
      if (code === "order_not_payable" || error.status === 409) {
        return { ok: false, error: "not_payable", message: error.message, lines: [] };
      }
      return { ok: false, error: "unavailable", message: "", lines: [] };
    }
  }
  return { ok: false, error: "not_found", message: "", lines: [] };
}

export type CancelOrderResult =
  | { ok: true; order: OrderView }
  | { ok: false; error: "already_paid" | "payment_in_progress" | "not_cancellable" | "not_found" | "throttled" | "unavailable" };

/** D1/D7: the customer cancels an unpaid order. */
export async function cancelOrderAction(orderNumber: string, urlToken?: string): Promise<CancelOrderResult> {
  const number = String(orderNumber ?? "");
  if (!ORDER_NUMBER_RE.test(number)) return { ok: false, error: "not_found" };
  const attempts = await attemptsFor(number, urlToken);
  for (const attempt of attempts) {
    try {
      return { ok: true, order: mapApiOrder(await cancelOrder(number, attempt)) };
    } catch (error) {
      if (!(error instanceof ApiError)) return { ok: false, error: "unavailable" };
      const code = apiErrorCode(error);
      if (error.status === 401 || error.status === 403 || error.status === 404) continue;
      if (error.status === 429) return { ok: false, error: "throttled" };
      if (code === "already_paid" || code === "payment_in_progress" || code === "not_cancellable") return { ok: false, error: code };
      if (error.status === 409) return { ok: false, error: "not_cancellable" };
      return { ok: false, error: "unavailable" };
    }
  }
  return { ok: false, error: "not_found" };
}
