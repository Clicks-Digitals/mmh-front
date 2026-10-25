/** ST-03: the coupon is saved with the cart (localStorage) and re-validated on every load. */

export interface StoredCoupon {
  code: string;
  /** Checkout email the coupon was last validated with (per-customer limits, OR-25). */
  email: string;
}

export const COUPON_CODE_MAX = 40;

export function normalizeCouponCode(code: string | null | undefined): string {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .slice(0, COUPON_CODE_MAX);
}

/** Read whatever is in storage; anything malformed is ignored. */
export function parseStoredCoupon(value: unknown): StoredCoupon | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const code = normalizeCouponCode(typeof record.code === "string" ? record.code : "");
  if (!code || !/^[A-Z0-9_-]+$/.test(code)) return null;
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase().slice(0, 254) : "";
  return { code, email };
}

export function storedCoupon(code: string, email = ""): StoredCoupon {
  return { code: normalizeCouponCode(code), email: email.trim().toLowerCase() };
}

/** Coupon rejection reasons the store explains (OR-25). Unknown codes stay generic. */
export type CouponReason =
  | "invalid_coupon"
  | "coupon_expired"
  | "coupon_not_started"
  | "coupon_limit_reached"
  | "coupon_customer_limit"
  | "unavailable";

const KNOWN: CouponReason[] = [
  "invalid_coupon",
  "coupon_expired",
  "coupon_not_started",
  "coupon_limit_reached",
  "coupon_customer_limit",
];

export function couponReason(code: string | null | undefined): Exclude<CouponReason, "unavailable"> {
  return KNOWN.includes(code as CouponReason) ? (code as Exclude<CouponReason, "unavailable">) : "invalid_coupon";
}

export function couponReasonKey(reason: CouponReason): string {
  switch (reason) {
    case "coupon_expired":
      return "coupon.expired";
    case "coupon_not_started":
      return "coupon.notStarted";
    case "coupon_limit_reached":
      return "coupon.limitReached";
    case "coupon_customer_limit":
      return "coupon.customerLimit";
    case "unavailable":
      return "cart.promoUnavailable";
    default:
      return "coupon.invalid";
  }
}

/** A stored coupon must be re-checked when nothing is applied yet or the quote is for another subtotal/email. */
export function needsRevalidation(
  stored: StoredCoupon | null,
  applied: { code: string; subtotalFils: number; email: string } | null,
  subtotalFils: number,
): boolean {
  if (!stored || subtotalFils <= 0) return false;
  if (!applied) return true;
  return applied.code !== stored.code || applied.subtotalFils !== subtotalFils || applied.email !== stored.email;
}
