"use client";

import { useLanguage } from "@/context/language-context";
import { BASE_CURRENCY, CURRENCY_COOKIE, formatMoney, type DisplayCurrency } from "@/lib/currency";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type CurrencyState = {
  /** The currency prices are shown in. */
  currency: DisplayCurrency;
  currencies: DisplayCurrency[];
  setCurrency: (code: string) => void;
  /** A JOD amount in the chosen currency. */
  format: (amountJod: number) => string;
  /** A JOD amount in JOD (what is actually charged). */
  formatJodAmount: (amountJod: number) => string;
  /** True when prices are shown converted (not in JOD). */
  converted: boolean;
};

const CurrencyContext = createContext<CurrencyState | null>(null);

export function CurrencyProvider({
  children,
  currencies,
  initialCode,
}: {
  children: ReactNode;
  currencies: DisplayCurrency[];
  initialCode?: string;
}) {
  const { locale } = useLanguage();
  const list = useMemo(() => (currencies.length ? currencies : [BASE_CURRENCY]), [currencies]);
  const [code, setCode] = useState(() => (list.some((c) => c.code === initialCode) ? initialCode! : "JOD"));
  const currency = list.find((c) => c.code === code) ?? BASE_CURRENCY;

  const setCurrency = useCallback((next: string) => {
    setCode(next);
    try {
      document.cookie = `${CURRENCY_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // cookies blocked: the choice lasts for this visit only
    }
  }, []);

  const value = useMemo<CurrencyState>(
    () => ({
      currency,
      currencies: list,
      setCurrency,
      format: (amount) => formatMoney(amount, currency, locale),
      formatJodAmount: (amount) => formatMoney(amount, BASE_CURRENCY, locale),
      converted: currency.code !== "JOD",
    }),
    [currency, list, setCurrency, locale],
  );
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/** Outside a provider (e.g. maintenance page) everything is shown in JOD. */
export function useCurrency(): CurrencyState {
  const { locale } = useLanguage();
  const ctx = useContext(CurrencyContext);
  if (ctx) return ctx;
  const jod = (amount: number) => formatMoney(amount, BASE_CURRENCY, locale);
  return { currency: BASE_CURRENCY, currencies: [BASE_CURRENCY], setCurrency: () => {}, format: jod, formatJodAmount: jod, converted: false };
}
