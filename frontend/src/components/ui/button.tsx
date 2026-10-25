import { FOCUS_RING } from "@/components/ui/control";
import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

type Variant = "primary" | "secondary" | "ghost" | "gold" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  href?: string;
  onClick?: () => void;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: "bg-gold text-elevated hover:bg-amber active:bg-gold-deep disabled:bg-gold/32 disabled:text-elevated/58 font-semibold",
  secondary: "bg-brand text-fg hover:bg-accent active:bg-brand-deep disabled:bg-brand/40 disabled:text-muted disabled:opacity-60",
  ghost: "bg-transparent text-muted hover:bg-brand/16 hover:text-fg active:bg-brand/20",
  gold: "bg-gold text-elevated hover:bg-amber font-semibold active:bg-gold-deep disabled:bg-gold/32 disabled:text-elevated/58",
  danger: "bg-danger/15 text-danger hover:bg-danger/25",
  outline: "border border-gold/55 bg-transparent text-gold hover:border-gold hover:bg-gold/8 disabled:border-line disabled:bg-transparent disabled:text-muted disabled:opacity-60",
};

const sizes: Record<Size, string> = {
  sm: "h-9 min-h-9 px-3 text-sm rounded-[10px]",
  md: "h-11 min-h-11 px-4 text-sm rounded-[12px]",
  lg: "h-12 min-h-12 px-5 text-[15px] rounded-[12px]",
  icon: "h-11 min-h-11 w-11 rounded-[12px] p-0",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-200 disabled:cursor-not-allowed",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    FOCUS_RING,
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  disabled,
  children,
  href,
  type,
  ...props
}: ButtonProps) {
  const classes = buttonClass(variant, size, className);
  if (href) {
    return (
      <Link href={href} className={cn(classes, (disabled || loading) && "pointer-events-none opacity-50")} onClick={props.onClick}>
        {children}
      </Link>
    );
  }
  return (
    <button className={classes} disabled={disabled || loading} type={type ?? "button"} {...props}>
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
}
