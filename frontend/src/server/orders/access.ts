import { cookies } from "next/headers";

export const ORDER_ACCESS_COOKIE = "mmh_order_access";

/** Email for the most recent checkout, if it matches the requested order number. */
export async function readOrderAccessEmail(orderNumber: string): Promise<string | undefined> {
  const raw = (await cookies()).get(ORDER_ACCESS_COOKIE)?.value;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { number?: string; email?: string };
    return parsed.number === orderNumber ? parsed.email : undefined;
  } catch {
    return undefined;
  }
}
