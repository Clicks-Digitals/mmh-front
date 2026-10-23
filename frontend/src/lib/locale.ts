import type { Locale } from "@/types";

export const LOCALE_COOKIE = "mmh-locale";

export function parseLocale(value: string | null | undefined): Locale {
  const raw = String(value ?? "").replace(/"/g, "").trim().toLowerCase();
  return raw.startsWith("ar") ? "ar" : "en";
}

export function localeDir(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** Persist the locale for server rendering (1 year, whole site). Client-only. */
export function writeLocaleCookie(locale: Locale) {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split(/;\s*/).find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  return match ? parseLocale(match.slice(LOCALE_COOKIE.length + 1)) : null;
}
