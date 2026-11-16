"use client";

import { useCurrency } from "@/context/currency-context";
import { cn } from "@/lib/cn";
import type { Locale } from "@/types";

interface PriceProps {
  amount: number;
  compareAt?: number;
  locale?: Locale;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Show in JOD — the amount actually charged (checkout, payment). */
  charge?: boolean;
}

export function Price({ amount, compareAt, size = "md", className, charge = false }: PriceProps) {
  const { format, formatJodAmount } = useCurrency();
  const money = charge ? formatJodAmount : format;
  const sizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-2xl",
  };

  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-semibold tracking-tight", className)}>
      <span className={cn("text-gold", sizes[size])}>{money(amount)}</span>
      {compareAt && compareAt > amount ? (
        <span className="text-sm font-normal text-subtle line-through">{money(compareAt)}</span>
      ) : null}
    </span>
  );
}
