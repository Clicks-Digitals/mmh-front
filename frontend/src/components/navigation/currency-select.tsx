"use client";

import { useCurrency } from "@/context/currency-context";
import { useLanguage } from "@/context/language-context";
import { FOCUS_RING } from "@/components/ui/control";
import { cn } from "@/lib/cn";
import { currencyName } from "@/lib/currency";
import { ChevronDown } from "lucide-react";

/** Display-currency picker (prices are still charged in JOD). Hidden when only JOD is on. */
export function CurrencySelect({ className, tone = "header" }: { className?: string; tone?: "header" | "menu" }) {
  const { currency, currencies, setCurrency } = useCurrency();
  const { t, locale } = useLanguage();
  if (currencies.length < 2) return null;
  return (
    <label
      className={cn(
        "relative inline-flex h-10 items-center gap-1 rounded-xl text-[13px] font-medium",
        tone === "header" ? "px-2.5 text-fg/85 hover:bg-white/8 hover:text-fg" : "bg-white/8 px-3 text-white/80",
        className,
      )}
    >
      <span className="text-muted">{t("currency.label")}:</span>
      <span className="font-semibold">{currency.code}</span>
      <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
      <select
        aria-label={t("currency.label")}
        className={cn("absolute inset-0 cursor-pointer opacity-0", FOCUS_RING)}
        value={currency.code}
        onChange={(event) => {
          setCurrency(event.target.value);
        }}
      >
        {currencies.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {currencyName(c.code, locale)}
          </option>
        ))}
      </select>
    </label>
  );
}
