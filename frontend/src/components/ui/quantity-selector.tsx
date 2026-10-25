"use client";

import { FOCUS_RING } from "@/components/ui/control";
import { useLanguage } from "@/context/language-context";
import { cn } from "@/lib/cn";
import { MAX_QTY_PER_LINE } from "@/lib/quantity";
import { Minus, Plus } from "lucide-react";

interface QuantitySelectorProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
  /** Called when the user tries to go past the maximum. */
  onLimit?: (max: number) => void;
  /** Sold out / not purchasable: both steppers disabled and the whole control dimmed. */
  disabled?: boolean;
}

export function QuantitySelector({ value, onChange, min = 1, max = MAX_QTY_PER_LINE, label, onLimit, disabled = false }: QuantitySelectorProps) {
  const { locale } = useLanguage();
  const cap = Math.min(max, MAX_QTY_PER_LINE);
  const atMax = disabled || value >= cap;
  return (
    <div className={cn("inline-flex h-11 items-center rounded-[12px] border border-line bg-elevated", disabled && "opacity-50")} aria-disabled={disabled || undefined}>
      <button
        type="button"
        className={cn("flex h-11 w-11 items-center justify-center rounded-[12px] text-muted hover:text-fg disabled:opacity-40", FOCUS_RING)}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        aria-label={locale === "ar" ? "تقليل الكمية" : "Decrease quantity"}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-8 text-center text-sm font-semibold" aria-label={label} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={cn("flex h-11 w-11 items-center justify-center rounded-[12px] text-muted hover:text-fg", atMax && "opacity-40", FOCUS_RING)}
        onClick={() => {
          if (disabled) return;
          if (atMax) {
            onLimit?.(cap);
            return;
          }
          onChange(Math.min(cap, value + 1));
        }}
        disabled={disabled}
        aria-disabled={atMax}
        aria-label={locale === "ar" ? "زيادة الكمية" : "Increase quantity"}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
