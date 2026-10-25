"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { checkSupplierOrder, listSupplierOrders, type SupplierOrderRow } from "@/components/admin/oneepin/api";
import { describeFailure } from "@/components/admin/oneepin/errors";
import {
  SUPPLIER_ORDER_STATUSES,
  jodText,
  parseStatusList,
  resultCodeTitle,
  supplierStatusLabel,
  toggleStatus,
} from "@/components/admin/oneepin/labels";
import { OneEpinTabs, SupplierStatusBadge } from "@/components/admin/oneepin/ui";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminUrlResource } from "@/hooks/use-admin-url-resource";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { useState } from "react";

const PAGE_SIZE = 25;
const DEFAULTS = { status: "", created_from: "", created_to: "", search: "", needs_review: "" };

export function canCheckSupplierOrder(status: string | null | undefined): boolean {
  return Boolean(status) && status !== "COMPLETED";
}

export function OneEpinOrdersClient() {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canFulfill = can("orders.fulfill");
  const [checking, setChecking] = useState<number | null>(null);

  const list = useAdminUrlResource<SupplierOrderRow, typeof DEFAULTS>(DEFAULTS, async (token, s) => {
    const data = await listSupplierOrders(token, {
      page: Number(s.page) || 1,
      page_size: PAGE_SIZE,
      status: parseStatusList(s.status).join(",") || undefined,
      created_from: s.created_from || undefined,
      created_to: s.created_to || undefined,
      search: s.search || undefined,
      needs_review: s.needs_review === "1" ? 1 : undefined,
    });
    return { items: data.results ?? [], count: data.count ?? 0 };
  });
  const { state, set } = list;
  const selected = parseStatusList(state.status);

  async function check(row: SupplierOrderRow) {
    if (!list.token) return;
    setChecking(row.id);
    try {
      const res = await checkSupplierOrder(list.token, row.id);
      toast.push(`Checked with 1Epin: ${supplierStatusLabel(res.supplier_order.status, res.supplier_order.status_label)}.`, "success");
      list.reload();
    } catch (err) {
      toast.push(describeFailure(err, "Could not check with 1Epin."), "error");
    } finally {
      setChecking(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="1Epin orders"
        description="Every purchase we made (or tried to make) at 1Epin for a customer's order. “Needs review” means a person has to decide what to do."
      />
      <OneEpinTabs />
      <Filters
        search={state.search}
        onSearchChange={(v) => set({ search: v })}
        searchPlaceholder="Our order number, 1Epin order number or product…"
        onClear={list.hasFilters ? list.reset : undefined}
      >
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--clicks-muted)]">
          From
          <input
            type="date"
            className="admin-input h-9 w-auto!"
            value={state.created_from}
            onChange={(e) => set({ created_from: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--clicks-muted)]">
          To
          <input type="date" className="admin-input h-9 w-auto!" value={state.created_to} onChange={(e) => set({ created_to: e.target.value })} />
        </label>
      </Filters>
      {state.needs_review === "1" ? (
        <div className="-mt-2 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <span>
            Showing purchases that need a person: the latest attempt failed or stopped, and the customer&apos;s order is still open.
          </span>
          <button type="button" className="font-semibold text-[var(--clicks-blue)]" onClick={() => set({ needs_review: "" })}>
            Show all
          </button>
        </div>
      ) : null}
      <div className="-mt-2 mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
        <span className="text-[12px] text-[var(--clicks-muted)]">Status:</span>
        {SUPPLIER_ORDER_STATUSES.map((s) => {
          const on = selected.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => set({ status: toggleStatus(state.status, s) })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] font-medium transition",
                on
                  ? "border-[var(--clicks-blue)] bg-[var(--clicks-blue-soft)] text-[var(--clicks-navy)]"
                  : "border-[var(--clicks-border)] bg-white text-[var(--clicks-muted)] hover:text-[var(--clicks-navy)]",
              )}
            >
              {supplierStatusLabel(s)}
            </button>
          );
        })}
        {selected.length ? (
          <button type="button" className="text-[12px] font-semibold text-[var(--clicks-blue)]" onClick={() => set({ status: "" })}>
            Any status
          </button>
        ) : null}
      </div>

      <DataTable<SupplierOrderRow>
        rows={list.items}
        loading={list.loading}
        rowKey={(r) => String(r.id)}
        error={list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        empty={
          <EmptyState
            title={list.hasFilters ? "No 1Epin orders match" : "No 1Epin orders yet"}
            description={list.hasFilters ? "Try another filter." : "They appear here when a paid order needs 1Epin to deliver."}
          />
        }
        columns={[
          {
            key: "order",
            header: "Our order",
            mobilePrimary: true,
            render: (r) =>
              r.order_number ? (
                <Link href={`/admin/orders/${encodeURIComponent(r.order_number)}`} className="font-medium text-[var(--clicks-blue)]">
                  {r.order_number}
                </Link>
              ) : (
                "—"
              ),
          },
          {
            key: "item",
            header: "Item",
            render: (r) => (
              <span className="text-[12px]">
                {r.item ? `${r.item.product_name}${r.item.variant_name ? ` – ${r.item.variant_name}` : ""}` : `Item #${r.order_item_id}`}
              </span>
            ),
          },
          {
            key: "number",
            header: "1Epin order number",
            render: (r) => (
              <Link href={`/admin/integrations/1epin/orders/${r.id}`} className="font-mono text-[12px] text-[var(--clicks-blue)]">
                {r.external_order_number}
              </Link>
            ),
          },
          {
            key: "product",
            header: "1Epin product",
            render: (r) => (
              <div className="text-[12px]">
                <p>{r.product_name || "—"}</p>
                <p className="font-mono text-[11px] text-[var(--clicks-muted)]">ID {r.external_product_id}</p>
              </div>
            ),
          },
          {
            key: "qty",
            header: "Qty",
            className: "tabular-nums",
            render: (r) => (r.quantity !== r.units ? `${r.quantity} (for ${r.units})` : r.quantity),
          },
          { key: "cost", header: "Cost", className: "tabular-nums whitespace-nowrap", render: (r) => jodText(r.cost_jod) },
          {
            key: "status",
            header: "Status",
            render: (r) => <SupplierStatusBadge status={r.status} label={r.status_label} supersededBy={r.superseded ? r.superseded_by_attempt : null} />,
          },
          {
            key: "message",
            header: "Message",
            render: (r) => (
              <div className="max-w-xs text-[12px]">
                {r.result_code && r.result_code !== "00" ? (
                  <p className="font-medium text-[var(--clicks-navy)]">{resultCodeTitle(r.result_code)}</p>
                ) : null}
                <p className="text-[var(--clicks-muted)]">{r.message || "—"}</p>
              </div>
            ),
          },
          { key: "updated", header: "Updated", className: "whitespace-nowrap", render: (r) => formatAdminDateTime(r.updated_at) },
          {
            key: "actions",
            header: "",
            render: (r) => (
              <div className="flex justify-end gap-2">
                <Link href={`/admin/integrations/1epin/orders/${r.id}`} className="admin-btn admin-btn-ghost h-8 text-xs">
                  Details
                </Link>
                {canFulfill && canCheckSupplierOrder(r.status) ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary h-8 whitespace-nowrap text-xs"
                    disabled={checking !== null}
                    onClick={() => void check(r)}
                  >
                    {checking === r.id ? "Checking…" : "Check now"}
                  </button>
                ) : null}
              </div>
            ),
          },
        ]}
      />
      <Pagination page={list.page} pageSize={PAGE_SIZE} total={list.count} onPageChange={(p) => set({ page: String(p) })} />
    </div>
  );
}
