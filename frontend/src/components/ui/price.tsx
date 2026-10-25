import { formatJod } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Locale } from "@/types";

interface PriceProps {
  amount: number;
  compareAt?: number;
  locale?: Locale;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Price({ amount, compareAt, locale = "en", size = "md", className }: PriceProps) {
  const sizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-2xl",
  };

  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-semibold tracking-tight", className)}>
      <span className={cn("text-gold", sizes[size])}>{formatJod(amount, locale)}</span>
      {compareAt && compareAt > amount ? (
        <span className="text-sm font-normal text-subtle line-through">{formatJod(compareAt, locale)}</span>
      ) : null}
    </span>
  );
}
