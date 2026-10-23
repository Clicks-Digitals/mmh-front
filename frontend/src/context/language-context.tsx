"use client";

import { formatMessage, translate } from "@/data/translations";
import { localeDir, readLocaleCookie, writeLocaleCookie } from "@/lib/locale";
import { STORAGE_KEYS } from "@/lib/storage";
import type { Locale } from "@/types";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

interface LanguageContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
  hydrated: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function applyDocumentLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDir(locale);
}

function storeLocale(locale: Locale) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.locale, JSON.stringify(locale));
  } catch {
    /* storage unavailable */
  }
  writeLocaleCookie(locale);
}

/**
 * The server renders with the `mmh-locale` cookie; this provider keeps that value, mirrors it to
 * localStorage, and refreshes server components after a switch.
 */
export function LanguageProvider({ children, initialLocale = "en" }: { children: ReactNode; initialLocale?: Locale }) {
  const router = useRouter();
  const [override, setOverride] = useState<Locale | null>(null);
  const locale: Locale = override ?? initialLocale;

  useEffect(() => {
    // One-time migration: a locale saved only in localStorage (older visits) becomes the cookie.
    if (readLocaleCookie()) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEYS.locale);
    } catch {
      stored = null;
    }
    const legacy: Locale | null = stored?.includes("ar") ? "ar" : stored?.includes("en") ? "en" : null;
    writeLocaleCookie(legacy ?? initialLocale);
    if (legacy && legacy !== initialLocale) {
      applyDocumentLocale(legacy);
      router.refresh();
    }
  }, [initialLocale, router]);

  const setLocale = useCallback(
    (next: Locale) => {
      setOverride(next);
      storeLocale(next);
      applyDocumentLocale(next);
      router.refresh();
    },
    [router],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      dir: localeDir(locale),
      setLocale,
      t: (key, values) => formatMessage(translate(locale, key), values),
      hydrated: true,
    }),
    [locale, setLocale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
