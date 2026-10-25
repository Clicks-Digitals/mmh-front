"use client";

import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { exportPaymentsCsv, listPaymentRows, type OrderPayment } from "@/components/admin/ops/api";
import { MobileSortSelect, OpsTable } from "@/components/admin/ops/ops-table";
import { Badge } from "@/components/admin/ui/badge";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorSummary } from "@/components/admin/lib/errors";
import { formatJod } from "@/components/admin/lib/money";
import {
  nextOrdering,
  orderHref,
  paymentProviderLabel,
  paymentStatusLabel,
  PAYMENT_PROVIDER_OPTIONS,
  PAYMENT_STATUS_LABELS,
} from "@/components/admin/lib/orders";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import Link from "next/link";
import { useAdminUrlState } from "@/hooks/use-admin-url-state";
import { useState } from "react";

const PROVIDERS = [{ value: "", label: "Any provider" }, ...PAYMENT_PROVIDER_OPTIONS];

const SORT_OPTIONS = [
  { value: "-created_at", label: "Newest first" },
  { value: "created_at", label: "Oldest first" },
  { value: "-paid_at", label: "Recently paid" },
  { value: "-amount_fils", label: "Highest amount" },
];

const DEFAULTS = {
  search: "",
  status: "",
  provider: "",
  date_from: "",
  date_to: "",
  include_voided: "",
  ordering: "-created_at",
  page: "1",
};

export function PaymentsListClient() {
  const toast = useAdminToast();
  // Filters, search, sorting and page live in the URL (like the orders list).
  const { state, debounced, set, reset, page } = useAdminUrlState(DEFAULTS);
  const [exporting, setExporting] = useState(false);
  const ordering = state.ordering || "-created_at";

  const filters = {
    search: debounced.search.trim() || undefined,
    status: debounced.status || undefined,
    provider: debounced.provider || undefined,
    date_from: debounced.date_from || undefined,
    date_to: debounced.date_to || undefined,
    include_voided: debounced.include_voided ? 1 : undefined,
    ordering: debounced.ordering || "-created_at",
  };
  const debouncedPage = Number(debounced.page) || 1;
  const { data, loading, error, reload, token } = useAdminQuery(
    (tok) => listPaymentRows(tok, { ...filters, page: debouncedPage, page_size: ADMIN_LIST_PAGE_SIZE }),
    [filters, debouncedPage],
  );
  const rows = data?.results ?? [];
  const dateError =
    state.date_from && state.date_to && state.date_to < state.date_from ? "The end date is before the start date." : "";

  async function exportCsv() {
    if (!token) return;
    setExporting(true);
    try {
      const csv = await exportPaymentsCsv(token, filters);
      const blob = new Blob([typeof csv === "string" ? csv : String(csv)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.push("Payments exported", "success");
    } catch (err) {
      toast.push(adminErrorSummary(err, "The export failed. Try again."), "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Every payment attempt with the money that actually arrived and what was refunded. Use the export to reconcile with PayPal."
        actions={
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            disabled={exporting || Boolean(dateError)}
            onClick={() => void exportCsv()}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        }
      />
      <Filters
        search={state.search}
        onSearchChange={(v) => set({ search: v })}
        searchPlaceholder="Order number, e-mail or PayPal id…"
        filters={[
          {
            key: "status",
            label: "Status",
            value: state.status,
            onChange: (v) => set({ status: v }),
            options: [
              { value: "", label: "Any status" },
              ...Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
          {
            key: "provider",
            label: "Provider",
            value: state.provider,
            onChange: (v) => set({ provider: v }),
            options: PROVIDERS,
          },
        ]}
        onClear={reset}
      />
      <div className="-mt-2 mb-3 flex flex-wrap items-end gap-3 text-[12px]">
        <label className="flex flex-col gap-1 text-[var(--clicks-muted)]">
          Started from
          <input type="date" className="admin-input h-9 w-auto" value={state.date_from} onChange={(e) => set({ date_from: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[var(--clicks-muted)]">
          Until
          <input type="date" className="admin-input h-9 w-auto" value={state.date_to} onChange={(e) => set({ date_to: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-[var(--clicks-text)]">
          <input
            type="checkbox"
            checked={Boolean(state.include_voided)}
            onChange={(e) => set({ include_voided: e.target.checked ? "1" : "" })}
          />
          Show voided attempts
        </label>
        {dateError ? <p className="pb-2 text-[var(--clicks-error)]">{dateError}</p> : null}
      </div>
      <MobileSortSelect ordering={ordering} options={SORT_OPTIONS} onChange={(v) => set({ ordering: v })} />
      <OpsTable<OrderPayment>
        rows={rows}
        loading={loading && !data}
        rowKey={(r) => String(r.id)}
        ordering={ordering}
        onSort={(field) => set({ ordering: nextOrdering(ordering, field) })}
        empty={<EmptyState title="No payments match" description="Try another filter or date range." />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
        columns={[
          {
            key: "order",
            header: "Order",
            primary: true,
            render: (r) =>
              r.order_number ? (
                <Link href={orderHref({ order_number: r.order_number })} className="font-medium text-[var(--clicks-blue)]">
                  {r.order_number}
                </Link>
              ) : (
                "—"
              ),
          },
          { key: "provider", header: "Provider", sortField: "provider", render: (r) => paymentProviderLabel(r.provider) },
          {
            key: "status",
            header: "Status",
            sortField: "status",
            render: (r) => (
              <span className="inline-flex flex-wrap items-center gap-1">
                <Badge status={r.status}>{paymentStatusLabel(r.status)}</Badge>
                {r.voided ? <Badge tone="neutral">Voided</Badge> : null}
              </span>
            ),
          },
          {
            key: "amount",
            header: "Amount (JOD)",
            sortField: "amount_fils",
            className: "tabular-nums whitespace-nowrap",
            render: (r) => r.amount_display || formatJod(r.amount_fils),
          },
          {
            key: "provider_amount",
            header: "Charged",
            className: "tabular-nums whitespace-nowrap",
            render: (r) => (r.provider_amount ? `${r.provider_currency || r.currency || ""} ${r.provider_amount}` : "—"),
          },
          {
            key: "refunded",
            header: "Refunded",
            className: "tabular-nums whitespace-nowrap",
            render: (r) => (r.refunded_fils ? r.refunded_display || formatJod(r.refunded_fils) : "—"),
          },
          {
            key: "capture",
            header: "PayPal capture",
            render: (r) => <span className="break-all font-mono text-[11px]">{r.capture_id || r.provider_capture_id || "—"}</span>,
          },
          {
            key: "paid",
            header: "Paid at",
            sortField: "paid_at",
            className: "whitespace-nowrap",
            render: (r) => (r.paid_at ? formatAdminDateTime(r.paid_at) : "—"),
          },
          {
            key: "created",
            header: "Started",
            sortField: "created_at",
            className: "whitespace-nowrap",
            render: (r) => formatAdminDateTime(r.created_at),
          },
        ]}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={data?.count ?? 0} onPageChange={(p) => set({ page: String(p) })} />
    </div>
  );
}
