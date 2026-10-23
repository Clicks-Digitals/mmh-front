import { cookies } from "next/headers";

export const ORDER_ACCESS_COOKIE = "mmh_order_access";
const MAX_AGE = 60 * 60 * 24 * 7;
const MAX_ENTRIES = 5;

export type OrderAccessEntry = { number: string; email?: string; token?: string };

function parse(raw: string | undefined): OrderAccessEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((entry): entry is OrderAccessEntry => Boolean(entry && typeof entry === "object" && typeof (entry as OrderAccessEntry).number === "string"))
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** Remember guest access for recent checkouts (httpOnly; the token never reaches client JS). */
export async function rememberOrderAccess(entry: OrderAccessEntry) {
  const store = await cookies();
  const current = parse(store.get(ORDER_ACCESS_COOKIE)?.value).filter((item) => item.number !== entry.number);
  const next = [entry, ...current].slice(0, MAX_ENTRIES);
  store.set(ORDER_ACCESS_COOKIE, JSON.stringify(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function readOrderAccess(orderNumber: string): Promise<OrderAccessEntry | undefined> {
  const raw = (await cookies()).get(ORDER_ACCESS_COOKIE)?.value;
  return parse(raw).find((entry) => entry.number === orderNumber);
}

/** Email for the most recent checkout, if it matches the requested order number. */
export async function readOrderAccessEmail(orderNumber: string): Promise<string | undefined> {
  return (await readOrderAccess(orderNumber))?.email;
}
