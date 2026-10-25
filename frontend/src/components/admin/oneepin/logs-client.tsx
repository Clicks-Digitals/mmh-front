"use client";

import { Badge } from "@/components/admin/ui/badge";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { listLogs, type OneEpinLog } from "@/components/admin/oneepin/api";
import { durationText, logActionLabel, orderNumberFromSupplierRef } from "@/components/admin/oneepin/labels";
import { OneEpinTabs, ResultCode } from "@/components/admin/oneepin/ui";
import { formatAdminDateTime } from "@/lib/admin/format";
import { asList } from "@/lib/api/admin";
import { useAdminUrlResource } from "@/hooks/use-admin-url-resource";
import Link from "next/link";

const DEFAULTS = { order_number: "", action: "" };

const ACTIONS = [
  { value: "", label: "All calls" },
  { value: "addOrder", label: "Place order" },
  { value: "checkOrder", label: "Check order" },
  { value: "checkBalance", label: "Balance check" },
  { value: "allProducts", label: "Catalog download" },
  { value: "ping", label: "Connection test" },
  { value: "balance", label: "Balance (panel)" },
  { value: "sync", label: "Catalog sync (panel)" },
];

export function OneEpinLogsPageClient() {
  const list = useAdminUrlResource<OneEpinLog, typeof DEFAULTS>(DEFAULTS, async (token, s) => {
    const data = await listLogs(token, { order_number: s.order_number.trim() || undefined, action: s.action || undefined });
    const { items } = asList(data);
    return { items, count: items.length };
  });
  const { state, set } = list;

  return (
    <div>
      <PageHeader
        title="1Epin logs"
        description="The latest 50 requests we sent to 1Epin and their answer. The result code says what 1Epin answered (00 = success). Passwords and codes are never logged."
      />
      <OneEpinTabs />
      <Filters
        search={state.order_number}
        onSearchChange={(v) => set({ order_number: v })}
        searchPlaceholder="Exact 1Epin order number, e.g. MMH-1001-55-1…"
        searchHint="Type the full 1Epin order number to see only its calls."
        filters={[{ key: "action", label: "Call", value: state.action, onChange: (v) => set({ action: v }), options: ACTIONS }]}
        onClear={list.hasFilters ? list.reset : undefined}
      />
      <DataTable<OneEpinLog>
        rows={list.items}
        loading={list.loading}
        rowKey={(r) => String(r.id)}
        error={list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        empty={<EmptyState title={list.hasFilters ? "No calls match" : "No calls yet"} description="Calls appear here as soon as we talk to 1Epin." />}
        columns={[
          { key: "when", header: "When", className: "whitespace-nowrap", mobilePrimary: true, render: (r) => formatAdminDateTime(r.created_at) },
          { key: "action", header: "Call", render: (r) => logActionLabel(r.action) },
          {
            key: "result",
            header: "Result",
            render: (r) => (
              <div className="flex flex-col items-start gap-1">
                <Badge tone={r.ok ? "success" : "warning"}>{r.ok ? "OK" : "Not completed"}</Badge>
                {r.result_code ? <ResultCode code={r.result_code} /> : null}
              </div>
            ),
          },
          {
            key: "order",
            header: "Order number",
            render: (r) => {
              if (!r.order_number) return <span className="text-[var(--clicks-muted)]">—</span>;
              const ours = orderNumberFromSupplierRef(r.order_number);
              return (
                <div className="text-[12px]">
                  <Link
                    href={`/admin/integrations/1epin/orders?search=${encodeURIComponent(r.order_number)}`}
                    className="font-mono text-[var(--clicks-blue)]"
                  >
                    {r.order_number}
                  </Link>
                  {ours ? (
                    <p>
                      <Link href={`/admin/orders/${encodeURIComponent(ours)}`} className="text-[11px] text-[var(--clicks-blue)]">
                        Our order {ours}
                      </Link>
                    </p>
                  ) : null}
                </div>
              );
            },
          },
          { key: "duration", header: "Took", className: "tabular-nums whitespace-nowrap", render: (r) => durationText(r.duration_ms) },
          { key: "env", header: "Mode", render: (r) => (r.environment ? <Badge tone="neutral">{r.environment}</Badge> : "—") },
          { key: "message", header: "Message", render: (r) => <span className="text-[12px]">{r.message || "—"}</span> },
        ]}
      />
    </div>
  );
}
