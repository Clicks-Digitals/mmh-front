"use client";

import { useCurrency } from "@/context/currency-context";
import { useLanguage } from "@/context/language-context";
import { FOCUS_RING } from "@/components/ui/control";
import { cn } from "@/lib/cn";
import { CURRENCY_META, currencyName } from "@/lib/currency";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

function symbolOf(code: string, locale: "en" | "ar") {
  const meta = CURRENCY_META[code];
  if (!meta) return code;
  return locale === "ar" ? meta.symbolAr : meta.symbolEn === code ? "" : meta.symbolEn;
}

/** Display-currency picker (prices are still charged in JOD). Hidden when only JOD is on. */
export function CurrencySelect({ className, tone = "header" }: { className?: string; tone?: "header" | "menu" }) {
  const { currency, currencies, setCurrency } = useCurrency();
  const { t, locale } = useLanguage();
  if (currencies.length < 2) return null;
  if (tone === "menu") {
    return (
      <div className={cn("w-full", className)} role="group" aria-label={t("currency.label")}>
        <div className="grid grid-cols-3 gap-1.5">
          {currencies.map((c) => {
            const active = c.code === currency.code;
            return (
              <button
                key={c.code}
                type="button"
                title={currencyName(c.code, locale)}
                onClick={() => setCurrency(c.code)}
                className={cn("mmh-chip flex flex-col items-center px-1 py-1.5 text-center", FOCUS_RING)}
                aria-pressed={active}
              >
                <span className={cn("text-[13px] font-bold", active ? "text-gold" : "text-fg")}>{c.code}</span>
                <span className="truncate text-[10px] text-muted">{currencyName(c.code, locale)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return <CurrencyPopover className={className} />;
}

function CurrencyPopover({ className }: { className?: string }) {
  const { currency, currencies, setCurrency } = useCurrency();
  const { t, locale } = useLanguage();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    list.current?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function show() {
    setActive(Math.max(0, currencies.findIndex((c) => c.code === currency.code)));
    setOpen(true);
  }

  function choose(code: string) {
    setCurrency(code);
    setOpen(false);
    button.current?.focus();
  }

  function onListKey(event: KeyboardEvent) {
    const last = currencies.length - 1;
    if (event.key === "ArrowDown") setActive((i) => Math.min(last, i + 1));
    else if (event.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter" || event.key === " ") choose(currencies[active].code);
    else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      if (event.key === "Escape") button.current?.focus();
      return;
    } else return;
    event.preventDefault();
  }

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${t("currency.label")}: ${currency.code}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
        className={cn(
          "inline-flex h-10 items-center gap-1 rounded-xl px-2.5 text-[13px] font-medium text-fg/85 transition hover:bg-white/8 hover:text-fg",
          open && "bg-white/8 text-fg",
          FOCUS_RING,
        )}
      >
        <span className="text-muted">{t("currency.label")}:</span>
        <span className="font-semibold">{currency.code}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={t("currency.label")}
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKey}
          className="mmh-currency-pop absolute end-0 top-full z-[var(--z-dropdown)] mt-2 max-h-[min(70vh,26rem)] w-64 overflow-y-auto overscroll-contain rounded-2xl border border-line-strong bg-elevated/95 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.5)] outline-none backdrop-blur-md"
        >
          {currencies.map((c, index) => {
            const selected = c.code === currency.code;
            const symbol = symbolOf(c.code, locale);
            return (
              <li
                key={c.code}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(c.code)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] transition-colors",
                  index === active && "bg-white/8",
                  selected && "text-gold",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-11 shrink-0 items-center justify-center rounded-lg border text-[11px] font-bold tracking-wide",
                    selected ? "border-gold bg-gold/12 shadow-[0_0_14px_-4px_var(--primary)]" : "border-line bg-white/4 text-fg",
                  )}
                >
                  {c.code}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg/90">{currencyName(c.code, locale)}</span>
                {selected ? <Check className="h-4 w-4 shrink-0 text-gold" aria-hidden /> : symbol ? <span className="shrink-0 text-[12px] text-muted">{symbol}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
