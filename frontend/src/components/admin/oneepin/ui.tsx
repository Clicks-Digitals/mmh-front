"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { Badge } from "@/components/admin/ui/badge";
import {
  countsAsStockText,
  marginView,
  resultCodeTitle,
  supplierStatusHelp,
  supplierStatusLabel,
  supplierStatusTone,
  supersededLabel,
  type Tone,
} from "@/components/admin/oneepin/labels";
import { cn } from "@/lib/cn";
import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const TABS: Array<{ href: string; label: string; anyOf: Array<"suppliers.read" | "orders.read"> }> = [
  { href: "/admin/integrations/1epin", label: "Overview", anyOf: ["suppliers.read"] },
  { href: "/admin/integrations/1epin/catalog", label: "1Epin catalog", anyOf: ["suppliers.read"] },
  { href: "/admin/integrations/1epin/mappings", label: "Linked products", anyOf: ["suppliers.read"] },
  { href: "/admin/integrations/1epin/orders", label: "1Epin orders", anyOf: ["suppliers.read", "orders.read"] },
  { href: "/admin/integrations/1epin/logs", label: "Logs", anyOf: ["suppliers.read"] },
];

/** Sub-navigation shared by every 1Epin page. */
export function OneEpinTabs() {
  const pathname = usePathname();
  const { can } = useAdminAccess();
  const tabs = TABS.filter((t) => t.anyOf.some((p) => can(p)));
  if (tabs.length < 2) return null;
  const active = (href: string) =>
    href === "/admin/integrations/1epin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label="1Epin sections" className="-mt-2 mb-4 flex gap-1 overflow-x-auto border-b border-[var(--clicks-border)]">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active(t.href) ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition",
            active(t.href)
              ? "border-[var(--clicks-blue)] text-[var(--clicks-navy)]"
              : "border-transparent text-[var(--clicks-muted)] hover:text-[var(--clicks-navy)]",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="admin-btn admin-btn-secondary h-7 gap-1 px-2 text-[11px]"
      aria-label={`${label}: ${value}`}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function SupplierStatusBadge({
  status,
  label,
  withHelp,
  supersededBy,
}: {
  status: string | null | undefined;
  label?: string | null;
  withHelp?: boolean;
  /** A later attempt replaced this one: history, not something to review. */
  supersededBy?: number | null;
}) {
  const text = supersededBy ? supersededLabel(supersededBy) : supplierStatusLabel(status, label);
  const help = supersededBy ? "A newer attempt took over for this item; nothing to do here." : supplierStatusHelp(status);
  return (
    <span className="inline-flex max-w-xs flex-col items-start gap-0.5">
      <Badge tone={supersededBy ? "neutral" : supplierStatusTone(status)} className="normal-case tracking-normal">
        <span title={help || undefined}>{text}</span>
      </Badge>
      {withHelp && help ? <span className="text-[11px] leading-snug text-[var(--clicks-muted)]">{help}</span> : null}
    </span>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  success: "text-emerald-700",
  warning: "text-amber-700",
  error: "text-[var(--clicks-error)]",
  info: "text-[var(--clicks-blue)]",
  neutral: "text-[var(--clicks-muted)]",
};

export function MarginText({ fils, pct }: { fils: number | null | undefined; pct: number | null | undefined }) {
  const view = marginView(fils, pct);
  return (
    <span className={cn("whitespace-nowrap tabular-nums", TONE_TEXT[view.tone], view.negative && "font-semibold")}>
      {view.text}
      {view.pct ? <span className="ms-1 text-[11px]">({view.pct})</span> : null}
      {view.negative ? <span className="ms-1 text-[11px]">loss</span> : null}
    </span>
  );
}

export function StockBadge({
  counts,
  reason,
  compact,
}: {
  counts: boolean | null | undefined;
  reason: string | null | undefined;
  compact?: boolean;
}) {
  return (
    <span className="flex max-w-xs flex-col items-start gap-0.5">
      <Badge tone={counts ? "success" : "neutral"} className="normal-case tracking-normal">
        {counts ? "Counts as stock" : "Not stock"}
      </Badge>
      {!compact ? (
        <span className="text-[11px] leading-snug text-[var(--clicks-muted)]">{countsAsStockText(counts, reason)}</span>
      ) : null}
    </span>
  );
}

/** "02 · 1Epin rejected our server's IP" */
export function ResultCode({ code }: { code: string | null | undefined }) {
  if (!code) return <span className="text-[var(--clicks-muted)]">—</span>;
  const ok = code === "00";
  return (
    <span className="inline-flex max-w-xs flex-col">
      <span className={cn("font-mono text-[12px]", ok ? "text-emerald-700" : "text-[var(--clicks-navy)]")}>{code}</span>
      <span className="text-[11px] leading-snug text-[var(--clicks-muted)]">{resultCodeTitle(code)}</span>
    </span>
  );
}

const OUTCOME_STYLE: Record<Exclude<Tone, "neutral">, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  info: "border-[var(--clicks-blue)]/20 bg-[var(--clicks-blue-soft)] text-[var(--clicks-navy)]",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  error: "border-red-200 bg-red-50 text-red-900",
};

export type Outcome = { tone: Exclude<Tone, "neutral">; title: string; message: string; at: string };

export function OutcomeBox({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return null;
  return (
    <div role="status" className={cn("rounded-lg border px-3 py-2 text-[13px] leading-relaxed", OUTCOME_STYLE[outcome.tone])}>
      <p className="font-semibold">{outcome.title}</p>
      {outcome.message ? <p>{outcome.message}</p> : null}
    </div>
  );
}
