import type { Locale } from "@/types";

export function formatJod(amount: number, locale: Locale = "en"): string {
  const formatted = new Intl.NumberFormat(locale === "ar" ? "ar-JO-u-nu-latn" : "en-JO", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return locale === "ar" ? `${formatted} د.أ` : `JOD ${formatted}`;
}

export function discountPercent(price: number, compareAt?: number): number | null {
  if (!compareAt || compareAt <= price) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-JO-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}
