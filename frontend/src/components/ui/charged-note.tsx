"use client";

import { useCurrency } from "@/context/currency-context";
import { useLanguage } from "@/context/language-context";
import { cn } from "@/lib/cn";

/** When prices are shown converted: the JOD amount that is actually charged. */
export function ChargedNote({ amountJod, className }: { amountJod: number; className?: string }) {
  const { converted, formatJodAmount } = useCurrency();
  const { t } = useLanguage();
  if (!converted) return null;
  return <p className={cn("text-xs text-muted", className)}>{t("currency.chargedIn", { amount: formatJodAmount(amountJod) })}</p>;
}
