import type { Locale } from "@/types";

/** A display currency from Settings: `rate` = units per 1 JOD (prices are stored and charged in JOD). */
export type DisplayCurrency = { code: string; rate: number };

export const CURRENCY_COOKIE = "mmh-currency";
export const BASE_CURRENCY: DisplayCurrency = { code: "JOD", rate: 1 };

type Meta = { en: string; ar: string; symbolEn: string; symbolAr: string; decimals: number };

/** Names and symbols for the supported currencies (Gulf, Levant, USD). */
export const CURRENCY_META: Record<string, Meta> = {
  JOD: { en: "Jordanian dinar", ar: "دينار أردني", symbolEn: "JOD", symbolAr: "د.أ", decimals: 2 },
  USD: { en: "US dollar", ar: "دولار أمريكي", symbolEn: "$", symbolAr: "$", decimals: 2 },
  SAR: { en: "Saudi riyal", ar: "ريال سعودي", symbolEn: "SAR", symbolAr: "ر.س", decimals: 2 },
  AED: { en: "UAE dirham", ar: "درهم إماراتي", symbolEn: "AED", symbolAr: "د.إ", decimals: 2 },
  KWD: { en: "Kuwaiti dinar", ar: "دينار كويتي", symbolEn: "KWD", symbolAr: "د.ك", decimals: 3 },
  QAR: { en: "Qatari riyal", ar: "ريال قطري", symbolEn: "QAR", symbolAr: "ر.ق", decimals: 2 },
  BHD: { en: "Bahraini dinar", ar: "دينار بحريني", symbolEn: "BHD", symbolAr: "د.ب", decimals: 3 },
  OMR: { en: "Omani rial", ar: "ريال عماني", symbolEn: "OMR", symbolAr: "ر.ع", decimals: 3 },
  ILS: { en: "Israeli shekel", ar: "شيكل", symbolEn: "ILS", symbolAr: "₪", decimals: 2 },
  IQD: { en: "Iraqi dinar", ar: "دينار عراقي", symbolEn: "IQD", symbolAr: "د.ع", decimals: 0 },
  LBP: { en: "Lebanese pound", ar: "ليرة لبنانية", symbolEn: "LBP", symbolAr: "ل.ل", decimals: 0 },
  SYP: { en: "Syrian pound", ar: "ليرة سورية", symbolEn: "SYP", symbolAr: "ل.س", decimals: 0 },
};

export function currencyName(code: string, locale: Locale): string {
  const meta = CURRENCY_META[code];
  return meta ? (locale === "ar" ? meta.ar : meta.en) : code;
}

/** A JOD amount shown in `currency` (converted with its rate). */
export function formatMoney(amountJod: number, currency: DisplayCurrency, locale: Locale = "en"): string {
  const meta = CURRENCY_META[currency.code] ?? CURRENCY_META.JOD;
  const value = (Number(amountJod) || 0) * (currency.rate || 1);
  const decimals = meta.decimals;
  const formatted = new Intl.NumberFormat(locale === "ar" ? "ar-JO-u-nu-latn" : "en-US", {
    minimumFractionDigits: decimals && value % 1 !== 0 ? Math.min(2, decimals) : 0,
    maximumFractionDigits: decimals,
  }).format(decimals ? value : Math.round(value));
  if (currency.code === "USD") return `$${formatted}`;
  return locale === "ar" ? `${formatted} ${meta.symbolAr}` : `${meta.symbolEn} ${formatted}`;
}

/** Only well-formed, positive rates; JOD is always present and first. */
export function normalizeCurrencies(rows: unknown): DisplayCurrency[] {
  const list = Array.isArray(rows) ? rows : [];
  const out: DisplayCurrency[] = [BASE_CURRENCY];
  for (const row of list) {
    const code = String((row as { code?: unknown })?.code ?? "").toUpperCase();
    const rate = Number((row as { rate?: unknown })?.rate);
    if (!code || code === "JOD" || !CURRENCY_META[code] || !(rate > 0)) continue;
    if (!out.some((c) => c.code === code)) out.push({ code, rate });
  }
  return out;
}
