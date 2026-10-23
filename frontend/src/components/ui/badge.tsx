import { cn } from "@/lib/cn";
import type { ProductBadge } from "@/types";

const STYLES: Record<ProductBadge, string> = {
  new: "bg-brand/20 text-fg",
  bestseller: "bg-gold/15 text-gold",
  limited: "bg-gold/12 text-gold",
  sale: "bg-gold text-elevated",
  digital: "bg-brand/20 text-fg",
  region_locked: "bg-gold/12 text-gold",
  topup: "border border-brand/50 bg-brand/15 text-fg",
};

interface BadgeProps {
  badge: ProductBadge;
  label: string;
  className?: string;
}

export function Badge({ badge, label, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center rounded-md px-2 text-[11px] font-semibold uppercase tracking-wide shadow-[0_0_0_1px_rgba(23,24,43,0.45)] backdrop-blur-sm",
        STYLES[badge],
        className,
      )}
    >
      {label}
    </span>
  );
}
