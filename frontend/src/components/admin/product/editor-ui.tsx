"use client";

import { cn } from "@/lib/cn";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

/** A titled card on the product editor. `collapsible` sections start folded unless `defaultOpen`. */
export function EditorSection({
  id,
  title,
  description,
  action,
  children,
  collapsible,
  defaultOpen = true,
  forceOpen,
  badge,
  className,
  bodyClassName,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** keep a collapsible section open (e.g. while it has errors) */
  forceOpen?: boolean;
  /** small marker after the title (e.g. an error dot or a count) */
  badge?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open || Boolean(forceOpen);
  const heading = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="text-[14px] font-semibold text-[var(--clicks-navy)]">{title}</span>
      {badge}
    </span>
  );
  return (
    <section id={id} className={cn("admin-card scroll-mt-24 overflow-hidden", className)}>
      <header className={cn("flex items-start justify-between gap-3 px-5 pt-4", shown ? "pb-0" : "pb-4")}>
        <div className="min-w-0">
          {collapsible ? (
            <button
              type="button"
              className="flex items-center gap-1.5 text-start"
              aria-expanded={shown}
              onClick={() => setOpen((v) => !v)}
            >
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-[var(--clicks-muted)] transition", !open && "-rotate-90")} aria-hidden />
              {heading}
            </button>
          ) : (
            heading
          )}
          {description ? (
            <p className={cn("mt-0.5 text-[12px] leading-5 text-[var(--clicks-muted)]", collapsible && "ps-[22px]")}>{description}</p>
          ) : null}
        </div>
        {action && shown ? <div className="shrink-0">{action}</div> : null}
      </header>
      {shown ? <div className={cn("px-5 pb-5 pt-4", bodyClassName)}>{children}</div> : null}
    </section>
  );
}

export type Lang = "en" | "ar";

/** English / Arabic switch. `errors` marks a language that has a problem. */
export function LangSwitch({
  value,
  onChange,
  errors,
  className,
}: {
  value: Lang;
  onChange: (lang: Lang) => void;
  errors?: Partial<Record<Lang, boolean>>;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label="Language" className={cn("inline-flex rounded-lg bg-[#F1F3F8] p-0.5", className)}>
      {(["en", "ar"] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          role="tab"
          aria-selected={value === lang}
          onClick={() => onChange(lang)}
          className={cn(
            "relative h-7 rounded-md px-3 text-[12px] font-semibold transition",
            value === lang ? "bg-white text-[var(--clicks-navy)] shadow-sm" : "text-[var(--clicks-muted)] hover:text-[var(--clicks-navy)]",
          )}
        >
          {lang === "en" ? "English" : "العربية"}
          {errors?.[lang] ? <span className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600" aria-label="has errors" /> : null}
        </button>
      ))}
    </div>
  );
}

/** On/off switch with a label and an optional hint underneath. */
export function Toggle({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled,
  hideLabel,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** keep the label for screen readers only */
  hideLabel?: boolean;
}) {
  return (
    <div className={cn("flex items-start gap-3", hideLabel ? "" : "justify-between")}>
      <label htmlFor={id} className={cn("min-w-0 cursor-pointer", hideLabel && "sr-only")}>
        <span className="block text-[13px] font-medium text-[var(--clicks-text)]">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] leading-4 text-[var(--clicks-muted)]">{hint}</span> : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-[var(--clicks-blue)]" : "bg-[#CBD1DE]",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white shadow transition",
            checked ? "translate-x-[18px] rtl:-translate-x-[18px]" : "translate-x-0.5 rtl:-translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** Big radio cards for a choice with 2–3 options. */
export function ChoiceCards<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
  columns = 2,
}: {
  name: string;
  value: T;
  options: Array<{ value: T; label: string; hint?: string; icon?: React.ReactNode }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  columns?: 1 | 2 | 3;
}) {
  return (
    <div role="radiogroup" className={cn("grid gap-2", columns === 2 && "grid-cols-2", columns === 3 && "grid-cols-3")}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            id={`${name}-${o.value}`}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-start transition disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "border-[var(--clicks-blue)] bg-[var(--clicks-blue-soft)] shadow-[0_0_0_1px_var(--clicks-blue)]"
                : "border-[var(--clicks-border)] bg-white hover:border-[var(--clicks-border-strong)]",
            )}
          >
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--clicks-navy)]">
              {o.icon}
              {o.label}
            </span>
            {o.hint ? <span className="text-[11px] leading-4 text-[var(--clicks-muted)]">{o.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Red "!" pill for a section with problems. */
export function ErrorPill({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex h-[18px] items-center rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
      {count === 1 ? "1 problem" : `${count} problems`}
    </span>
  );
}

/** Quiet grey count pill (e.g. "3"). */
export function CountPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#EEF1F6] px-1.5 text-[10px] font-semibold text-[var(--clicks-muted)]">
      {children}
    </span>
  );
}
