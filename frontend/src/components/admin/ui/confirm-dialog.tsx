"use client";

import { cn } from "@/lib/cn";
import { useEffect } from "react";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  pending,
  onConfirm,
  onCancel,
  confirmDisabled,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** disable the confirm button (e.g. required reason missing) */
  confirmDisabled?: boolean;
  /** extra inputs rendered between the description and the buttons */
  children?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--clicks-navy)]/45 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        className="admin-card w-full max-w-md p-5 shadow-[var(--admin-shadow-hover)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="admin-confirm-title" className="text-[15px] font-semibold text-[var(--clicks-navy)]">
          {title}
        </h2>
        {description ? <p className="mt-2 text-[13px] text-[var(--clicks-muted)]">{description}</p> : null}
        {children ? <div className="mt-4 space-y-3">{children}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={pending} className="admin-btn admin-btn-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
            className={cn("admin-btn disabled:opacity-60", danger ? "admin-btn-danger" : "admin-btn-primary")}
          >
            {pending ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
