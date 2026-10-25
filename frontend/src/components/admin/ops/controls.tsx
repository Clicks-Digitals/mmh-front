"use client";

import { cn } from "@/lib/cn";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type Variant = "primary" | "secondary" | "danger";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "admin-btn-primary",
  secondary: "admin-btn-secondary",
  danger: "admin-btn-danger",
};

/**
 * Button driven by an API action: when disabled it stays visible and explains why
 * ("The order is not paid yet…"), so the next step is always obvious.
 */
export function ActionButton({
  label,
  enabled = true,
  reason,
  pending,
  variant = "secondary",
  onClick,
  className,
  small,
}: {
  label: string;
  enabled?: boolean;
  reason?: string | null;
  pending?: boolean;
  variant?: Variant;
  onClick: () => void;
  className?: string;
  small?: boolean;
}) {
  const hintId = useId();
  const disabled = !enabled || pending;
  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={!enabled && reason ? hintId : undefined}
        onClick={onClick}
        className={cn(
          "admin-btn disabled:cursor-not-allowed disabled:opacity-55",
          small ? "h-8 text-xs" : "",
          VARIANT_CLASS[variant],
        )}
      >
        {label}
      </button>
      {!enabled && reason ? (
        <p id={hintId} className="mt-1 max-w-xs text-[11px] leading-snug text-[var(--clicks-muted)]">
          {reason}
        </p>
      ) : null}
    </div>
  );
}

export type MenuItem = {
  key: string;
  label: string;
  description?: string;
  onSelect: () => void;
  disabled?: boolean;
  reason?: string | null;
  danger?: boolean;
};

/** Labelled "More" dropdown for rarely used actions (OR-26). */
export function MoreMenu({ label = "More", items }: { label?: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        className="admin-btn admin-btn-secondary h-8 gap-1 text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute end-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-[var(--admin-radius)] border border-[var(--clicks-border)] bg-white py-1 shadow-[var(--admin-shadow-hover)]"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cn(
                "block w-full px-3 py-2 text-start text-[13px] disabled:cursor-not-allowed disabled:opacity-50",
                item.danger ? "text-[var(--clicks-error)] hover:bg-red-50" : "text-[var(--clicks-text)] hover:bg-[#F5F7FB]",
              )}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <span className="block font-medium">{item.label}</span>
              {item.disabled && item.reason ? (
                <span className="mt-0.5 block text-[11px] text-[var(--clicks-muted)]">{item.reason}</span>
              ) : item.description ? (
                <span className="mt-0.5 block text-[11px] text-[var(--clicks-muted)]">{item.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const NOTICE_TONE = {
  info: "border-[var(--clicks-blue)]/20 bg-[var(--clicks-blue-soft)] text-[var(--clicks-navy)]",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: keyof typeof NOTICE_TONE;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-lg border px-3 py-2 text-[13px] leading-relaxed", NOTICE_TONE[tone], className)}
    >
      {children}
    </div>
  );
}
