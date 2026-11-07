"use client";

import { useEffect } from "react";

export function AdminModal({
  open,
  title,
  description,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--clicks-navy)]/40 p-3 sm:p-6"
      onClick={onClose}
    >
      {/* The dialog never grows past the viewport: the title bar stays put and the body scrolls
          (e.g. when "Advanced: built-in picture" expands). */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-modal-title"
        className={`admin-card flex w-full flex-col overflow-hidden p-0 shadow-[var(--admin-shadow-hover)] ${wide ? "max-w-2xl" : "max-w-lg"}`}
        style={{ maxHeight: "calc(100dvh - 1.5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--clicks-border)] px-5 pb-3 pt-5">
          <div className="min-w-0 break-words">
            <h2 id="admin-modal-title" className="text-base font-semibold text-[var(--clicks-navy)]">
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-[var(--clicks-muted)]">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-[var(--clicks-muted)] hover:bg-[var(--clicks-bg)]"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-4">{children}</div>
      </div>
    </div>
  );
}
