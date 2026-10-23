import type { Locale } from "@/types";

export interface AppliedCoupon {
  code: string;
  subtotalFils: number;
  discountFils: number;
  totalFils: number;
}

/** Integer fils from a JOD amount (avoids float drift: 8.9 → 8900). */
export function toFils(jod: number): number {
  return Math.round((Number(jod) || 0) * 1000);
}

export function filsToJod(fils: number): number {
  return Math.round(fils) / 1000;
}

/** A coupon quote only applies to the subtotal it was validated against. */
export function couponApplies(coupon: AppliedCoupon | null, subtotalFils: number): coupon is AppliedCoupon {
  return Boolean(coupon && coupon.subtotalFils === subtotalFils);
}

export function cartTotals(subtotalFils: number, coupon: AppliedCoupon | null) {
  const applied = couponApplies(coupon, subtotalFils) ? coupon : null;
  const discountFils = applied ? Math.min(Math.max(0, applied.discountFils), subtotalFils) : 0;
  return {
    subtotalFils,
    discountFils,
    totalFils: Math.max(0, subtotalFils - discountFils),
    code: applied?.code ?? "",
  };
}

export function formatDiscount(discountFils: number, locale: Locale = "en"): string {
  const amount = new Intl.NumberFormat(locale === "ar" ? "ar-JO" : "en-JO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(filsToJod(discountFils));
  return locale === "ar" ? `- ${amount} د.أ` : `- JOD ${amount}`;
}

/** Estimated PayPal charge from the public FX rate (JOD → PayPal currency). Null when unknown. */
export function estimatePayPalAmount(totalFils: number, fxRate: string | number | null | undefined): number | null {
  const rate = Number(fxRate);
  if (!Number.isFinite(rate) || rate <= 0 || totalFils <= 0) return null;
  return Math.round((totalFils / 1000) * rate * 100) / 100;
}
