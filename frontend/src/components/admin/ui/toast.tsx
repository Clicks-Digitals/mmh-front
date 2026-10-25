"use client";

import { cn } from "@/lib/cn";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ToastTone = "info" | "success" | "error" | "warning";

type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
  /** how many times the same message was pushed while visible */
  count: number;
};

type ToastContextValue = {
  push: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertCircle,
  info: Info,
};

const MAX_VISIBLE = 3;
const DURATION: Record<ToastTone, number> = { success: 3500, info: 4500, warning: 6000, error: 7000 };

/**
 * Admin toasts (CA-26): identical messages are merged instead of stacking, at most three
 * are shown, they sit at the top-right so they never cover the sticky save bar, and they
 * are announced to screen readers (errors assertively).
 */
export function AdminToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const schedule = useCallback(
    (id: string, tone: ToastTone) => {
      const existing = timers.current.get(id);
      if (existing) window.clearTimeout(existing);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), DURATION[tone]),
      );
    },
    [dismiss],
  );

  const push = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const text = String(message ?? "").trim();
      if (!text) return;
      const id = `${tone}:${text}`;
      setItems((prev) => {
        const found = prev.find((item) => item.id === id);
        if (found) return prev.map((item) => (item.id === id ? { ...item, count: item.count + 1 } : item));
        const next = [...prev, { id, message: text, tone, count: 1 }];
        const overflow = next.slice(0, Math.max(0, next.length - MAX_VISIBLE));
        overflow.forEach((item) => {
          const t = timers.current.get(item.id);
          if (t) window.clearTimeout(t);
          timers.current.delete(item.id);
        });
        return next.slice(-MAX_VISIBLE);
      });
      schedule(id, tone);
    },
    [schedule],
  );

  const value = useMemo(() => ({ push }), [push]);
  const polite = items.filter((i) => i.tone !== "error");
  const urgent = items.filter((i) => i.tone === "error");

  const render = (item: ToastItem) => {
    const Icon = ICONS[item.tone];
    return (
      <div
        key={item.id}
        className={cn(
          "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-[var(--admin-radius)] border bg-white px-3.5 py-2.5 text-[13px] shadow-[var(--admin-shadow-hover)]",
          item.tone === "success" && "border-emerald-200",
          item.tone === "error" && "border-red-200",
          item.tone === "warning" && "border-amber-200",
          item.tone === "info" && "border-[var(--clicks-border)]",
        )}
      >
        <Icon
          aria-hidden
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            item.tone === "success" && "text-emerald-600",
            item.tone === "error" && "text-red-600",
            item.tone === "warning" && "text-amber-600",
            item.tone === "info" && "text-[var(--clicks-blue)]",
          )}
        />
        <p className="flex-1 text-[var(--clicks-navy)]">
          {item.message}
          {item.count > 1 ? <span className="ms-1 text-[11px] text-[var(--clicks-muted)]">×{item.count}</span> : null}
        </p>
        <button
          type="button"
          className="rounded p-0.5 text-[var(--clicks-muted)] hover:bg-[#F5F7FB]"
          onClick={() => dismiss(item.id)}
          aria-label="Dismiss message"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:end-4 sm:items-end">
        <div role="status" aria-live="polite" className="contents">
          {polite.map(render)}
        </div>
        <div role="alert" aria-live="assertive" className="contents">
          {urgent.map(render)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useAdminToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: (message: string) => {
        if (typeof window !== "undefined") console.info("[admin toast]", message);
      },
    };
  }
  return ctx;
}
