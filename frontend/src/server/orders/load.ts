import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ApiError, apiErrorCode } from "@/lib/api/client";
import { getOrder, myOrders, revealOrderCodes } from "@/lib/api/orders";
import { mapApiOrder, mapRevealedCodes, type ApiOrder, type OrderView, type RevealedCodes } from "@/lib/orders";
import { readOrderAccess } from "@/server/orders/access";

export const ORDER_NUMBER_RE = /^[A-Za-z0-9-]{3,40}$/;
export const ACCESS_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

async function customerToken(): Promise<string | undefined> {
  const session = await auth();
  return session?.user?.kind === "CUSTOMER" ? session.user.accessToken : undefined;
}

export type OrderAccess = { jwt?: string; accessToken?: string; email?: string };

/** Every credential this visitor holds for the order: account JWT, emailed/checkout token, checkout email. */
export async function orderAccessFor(orderNumber: string, urlToken?: string): Promise<OrderAccess> {
  const [jwt, cookie] = await Promise.all([customerToken(), readOrderAccess(orderNumber)]);
  const token = urlToken && ACCESS_TOKEN_RE.test(urlToken) ? urlToken : cookie?.token;
  return { jwt, accessToken: token, email: cookie?.email };
}

export type LoadedOrder = { order: OrderView; canReveal: boolean };

export async function loadOrder(orderNumber: string, urlToken?: string): Promise<LoadedOrder | null> {
  if (!ORDER_NUMBER_RE.test(orderNumber)) return null;
  const access = await orderAccessFor(orderNumber, urlToken);
  const attempts: Array<{ token?: string; accessToken?: string; email?: string; canReveal: boolean }> = [];
  if (access.jwt) attempts.push({ token: access.jwt, accessToken: access.accessToken, canReveal: true });
  if (access.accessToken) attempts.push({ accessToken: access.accessToken, canReveal: true });
  if (access.email) attempts.push({ email: access.email, canReveal: false });
  for (const attempt of attempts) {
    try {
      const row = await getOrder(orderNumber, attempt);
      return { order: mapApiOrder(row), canReveal: attempt.canReveal };
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 401 || error.status === 403)) continue;
      throw error;
    }
  }
  return null;
}

export type RevealResult =
  | { ok: true; codes: RevealedCodes }
  | { ok: false; error: "not_paid" | "not_found" | "throttled" | "unavailable" };

export async function revealCodes(orderNumber: string, urlToken?: string): Promise<RevealResult> {
  if (!ORDER_NUMBER_RE.test(orderNumber)) return { ok: false, error: "not_found" };
  const access = await orderAccessFor(orderNumber, urlToken);
  const attempts = [
    ...(access.jwt ? [{ token: access.jwt }] : []),
    ...(access.accessToken ? [{ accessToken: access.accessToken }] : []),
  ];
  if (!attempts.length) return { ok: false, error: "not_found" };
  for (const attempt of attempts) {
    try {
      return { ok: true, codes: mapRevealedCodes(await revealOrderCodes(orderNumber, attempt)) };
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409 || apiErrorCode(error) === "not_paid") return { ok: false, error: "not_paid" };
        if (error.status === 429) return { ok: false, error: "throttled" };
        if (error.status === 404 || error.status === 401 || error.status === 403) continue;
      }
      return { ok: false, error: "unavailable" };
    }
  }
  return { ok: false, error: "not_found" };
}

type Paginated<T> = { results: T[] } | T[];

/** A 401 on the customer's own API calls (token_revoked after a password change, disabled account…). */
export function isSessionEnded(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function sessionEndedRedirect(callbackUrl: string): never {
  redirect(`/login?reason=session&callbackUrl=${encodeURIComponent(callbackUrl)}`);
}

/**
 * The signed-in customer's orders. `paidOnly` (Codes page, D1) hides unpaid/cancelled orders.
 * A revoked session sends the visitor to sign in again.
 */
export async function loadCustomerOrderViews(
  token?: string,
  { paidOnly = false, callbackUrl = "/account" }: { paidOnly?: boolean; callbackUrl?: string } = {},
): Promise<OrderView[]> {
  if (!token) return [];
  let data: Paginated<ApiOrder>;
  try {
    data = (await myOrders(token, { paidOnly })) as Paginated<ApiOrder>;
  } catch (error) {
    if (isSessionEnded(error)) sessionEndedRedirect(callbackUrl);
    return [];
  }
  const rows = Array.isArray(data) ? data : data.results;
  return rows.map(mapApiOrder);
}
