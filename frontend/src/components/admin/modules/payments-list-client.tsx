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
import { nextOrdering, orderHref, paymentStatusLabel, PAYMENT_STATUS_LABELS } from "@/components/admin/lib/orders";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import Link from "next/link";
import { useEffect, useState } from "react";

const PROVIDERS = [
  { value: "", label: "Any provider" },
  { value: "paypal", label: "PayPal" },
  { value: "manual", label: "Manual" },
  { value: "free", label: "Free order" },
];

const SORT_OPTIONS = [
  { value: "-created_at", label: "Newest first" },
  { value: "created_at", label: "Oldest first" },
  { value: "-paid_at", label: "Recently paid" },
  { value: "-amount_fils", label: "Highest amount" },
];

function providerText(provider: string) {
  return PROVIDERS.find((p) => p.value === provider)?.label ?? provider;
}

export function PaymentsListClient() {
  const toast = useAdminToast();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [includeVoided, setIncludeVoided] = useState(false);
  const [ordering, setOrdering] = useState("-created_at");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const filters = {
    search: search || undefined,
    status: status || undefined,
    provider: provider || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    include_voided: includeVoided ? 1 : undefined,
    ordering,
  };
  const { data, loading, error, reload, token } = useAdminQuery(
    (tok) => listPaymentRows(tok, { ...filters, page, page_size: ADMIN_LIST_PAGE_SIZE }),
    [filters, page],
  );
  const rows = data?.results ?? [];
  const dateError = dateFrom && dateTo && dateTo < dateFrom ? "The end date is before the start date." : "";

  function change<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

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
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Order number, e-mail or PayPal id…"
        filters={[
          {
            key: "status",
            label: "Status",
            value: status,
            onChange: change(setStatus),
            options: [
              { value: "", label: "Any status" },
              ...Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
          { key: "provider", label: "Provider", value: provider, onChange: change(setProvider), options: PROVIDERS },
        ]}
        onClear={() => {
          setSearchInput("");
          setStatus("");
          setProvider("");
          setDateFrom("");
          setDateTo("");
          setIncludeVoided(false);
          setPage(1);
        }}
      />
      <div className="-mt-2 mb-3 flex flex-wrap items-end gap-3 text-[12px]">
        <label className="flex flex-col gap-1 text-[var(--clicks-muted)]">
          Started from
          <input type="date" className="admin-input h-9 w-auto" value={dateFrom} onChange={(e) => change(setDateFrom)(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[var(--clicks-muted)]">
          Until
          <input type="date" className="admin-input h-9 w-auto" value={dateTo} onChange={(e) => change(setDateTo)(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-[var(--clicks-text)]">
          <input type="checkbox" checked={includeVoided} onChange={(e) => change(setIncludeVoided)(e.target.checked)} />
          Show voided attempts
        </label>
        {dateError ? <p className="pb-2 text-[var(--clicks-error)]">{dateError}</p> : null}
      </div>
      <MobileSortSelect ordering={ordering} options={SORT_OPTIONS} onChange={change(setOrdering)} />
      <OpsTable<OrderPayment>
        rows={rows}
        loading={loading && !data}
        rowKey={(r) => String(r.id)}
        ordering={ordering}
        onSort={(field) => change(setOrdering)(nextOrdering(ordering, field))}
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
          { key: "provider", header: "Provider", sortField: "provider", render: (r) => providerText(r.provider) },
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
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={data?.count ?? 0} onPageChange={setPage} />
    </div>
  );
}
