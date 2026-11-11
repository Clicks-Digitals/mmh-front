"use client";

import { cn } from "@/lib/cn";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type RowAction = {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

export function RowActions({
  actions,
  className,
  label,
}: {
  actions: RowAction[];
  className?: string;
  /** text trigger (e.g. "More") instead of the bare ⋯ icon */
  label?: string;
}) {
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

  if (!actions.length) return null;

  return (
    <div ref={ref} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        className={
          label
            ? "admin-btn admin-btn-secondary gap-1.5"
            : "inline-flex h-8 w-8 items-center justify-center rounded-[var(--admin-radius-sm)] text-[var(--clicks-muted)] hover:bg-[#F3F5F9] hover:text-[var(--clicks-text)]"
        }
        aria-label={label ? undefined : "More actions"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {label ? <span>{label}</span> : null}
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute end-0 top-full z-30 mt-1 min-w-[168px] overflow-hidden rounded-[var(--admin-radius)] border border-[var(--clicks-border)] bg-white py-1 shadow-[var(--admin-shadow-hover)]"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              className={cn(
                "flex h-8 w-full items-center px-3 text-start text-[13px] disabled:opacity-40",
                action.tone === "danger"
                  ? "text-[var(--clicks-error)] hover:bg-red-50"
                  : "text-[var(--clicks-text)] hover:bg-[#F5F7FB]",
              )}
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
