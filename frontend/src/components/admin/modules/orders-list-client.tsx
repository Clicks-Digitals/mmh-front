"use client";

import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { listOrderRows, type OrderListRow } from "@/components/admin/ops/api";
import { MobileSortSelect, OpsTable } from "@/components/admin/ops/ops-table";
import { Badge } from "@/components/admin/ui/badge";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { formatJod } from "@/components/admin/lib/money";
import {
  FULFILLMENT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  fulfillmentStatusLabel,
  nextOrdering,
  orderHref,
  ordersQueryString,
  parseOrdersQuery,
  paymentStatusLabel,
  type OrdersQuery,
} from "@/components/admin/lib/orders";
import { formatAdminDate, formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const VIEW_OPTIONS = [
  { value: "", label: "All orders" },
  { value: "needs_action", label: "Needs delivery (paid, not finished)" },
  { value: "awaiting_payment_24h", label: "Awaiting payment (last 24 h)" },
];

const SORT_OPTIONS = [
  { value: "-created_at", label: "Newest first" },
  { value: "created_at", label: "Oldest first" },
  { value: "-total_fils", label: "Highest total" },
  { value: "total_fils", label: "Lowest total" },
  { value: "payment_status", label: "Payment status" },
  { value: "fulfillment_status", label: "Delivery status" },
];

export function OrdersListClient() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const query = parseOrdersQuery(params);
  const [searchInput, setSearchInput] = useState(query.search);

  // Back/forward or a link changed ?search — reflect it in the box (render-time adjust).
  const [seenSearch, setSeenSearch] = useState(query.search);
  if (query.search !== seenSearch) {
    setSeenSearch(query.search);
    if (query.search !== searchInput.trim()) setSearchInput(query.search);
  }

  function navigate(patch: Partial<OrdersQuery>, resetPage = true) {
    const next: OrdersQuery = { ...query, ...patch, ...(resetPage && !("page" in patch) ? { page: 1 } : {}) };
    const qs = ordersQueryString(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Debounced search → URL (OR-13).
  useEffect(() => {
    if (searchInput.trim() === query.search.trim()) return;
    const t = window.setTimeout(() => {
      navigate({ search: searchInput });
    }, 350);
    return () => window.clearTimeout(t);
    // navigate is recreated each render; the search text is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const apiParams = {
    page: query.page,
    page_size: ADMIN_LIST_PAGE_SIZE,
    search: query.search || undefined,
    payment_status: query.payment_status || undefined,
    fulfillment_status: query.fulfillment_status || undefined,
    needs_action: query.view === "needs_action" ? 1 : undefined,
    awaiting_payment_24h: query.view === "awaiting_payment_24h" ? 1 : undefined,
    created_from: query.created_from || undefined,
    created_to: query.created_to || undefined,
    ordering: query.ordering || "-created_at",
  };
  const { data, loading, error, reload } = useAdminQuery((tok) => listOrderRows(tok, apiParams), [apiParams]);
  const rows = data?.results ?? [];
  const count = data?.count ?? 0;
  const ordering = query.ordering || "-created_at";

  const filtersActive = Boolean(
    query.view || query.payment_status || query.fulfillment_status || query.search || query.created_from || query.created_to,
  );

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Open an order to deliver it, refund it or change its status. Filters and sorting stay in the address, so you can bookmark or share a view."
      />
      <Filters
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Order number, e-mail, name or phone…"
        filters={[
          {
            key: "view",
            label: "Quick view",
            value: query.view,
            onChange: (v) => navigate({ view: v as OrdersQuery["view"] }),
            options: VIEW_OPTIONS,
          },
          {
            key: "payment",
            label: "Payment status",
            value: query.payment_status,
            onChange: (v) => navigate({ payment_status: v }),
            options: [
              { value: "", label: "Any payment" },
              ...Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
          {
            key: "fulfillment",
            label: "Delivery status",
            value: query.fulfillment_status,
            onChange: (v) => navigate({ fulfillment_status: v }),
            options: [
              { value: "", label: "Any delivery status" },
              ...Object.entries(FULFILLMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
        onClear={
          filtersActive
            ? () => {
                setSearchInput("");
                router.replace(pathname, { scroll: false });
              }
            : undefined
        }
      />
      {query.created_from || query.created_to ? (
        <p className="-mt-2 mb-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--clicks-muted)]">
          Showing orders placed
          {query.created_from ? ` from ${formatAdminDateTime(query.created_from)}` : ""}
          {query.created_to ? ` until ${formatAdminDate(query.created_to)}` : ""}.
          <button
            type="button"
            className="font-semibold text-[var(--clicks-blue)]"
            onClick={() => navigate({ created_from: "", created_to: "" })}
          >
            Show all dates
          </button>
        </p>
      ) : null}
      <MobileSortSelect ordering={ordering} options={SORT_OPTIONS} onChange={(v) => navigate({ ordering: v })} />
      <OpsTable<OrderListRow>
        rows={rows}
        loading={loading && !data}
        rowKey={(r) => String(r.id)}
        ordering={ordering}
        onSort={(field) => navigate({ ordering: nextOrdering(ordering, field) })}
        empty={
          <EmptyState
            title={filtersActive ? "No orders match" : "No orders yet"}
            description={filtersActive ? "Try another filter or clear the search." : "New orders appear here as soon as customers check out."}
          />
        }
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
        columns={[
          {
            key: "number",
            header: "Order",
            sortField: "order_number",
            primary: true,
            render: (r) => (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Link href={orderHref(r)} className="font-medium text-[var(--clicks-blue)]">
                  {r.order_number}
                </Link>
                {r.needs_action ? <Badge tone="warning">Needs delivery</Badge> : null}
              </span>
            ),
          },
          {
            key: "customer",
            header: "Customer",
            render: (r) => (
              <div className="min-w-0">
                <p>{r.full_name || "—"}</p>
                <p className="break-all text-xs text-[var(--clicks-muted)]">{r.email}</p>
              </div>
            ),
          },
          {
            key: "payment",
            header: "Payment",
            sortField: "payment_status",
            render: (r) => <Badge status={r.payment_status}>{paymentStatusLabel(r.payment_status)}</Badge>,
          },
          {
            key: "fulfillment",
            header: "Delivery",
            sortField: "fulfillment_status",
            render: (r) => <Badge status={r.fulfillment_status}>{fulfillmentStatusLabel(r.fulfillment_status)}</Badge>,
          },
          { key: "items", header: "Items", className: "tabular-nums", render: (r) => r.item_count ?? "—" },
          {
            key: "total",
            header: "Total",
            sortField: "total_fils",
            className: "tabular-nums whitespace-nowrap",
            render: (r) => r.total_display || formatJod(r.total_fils),
          },
          {
            key: "created",
            header: "Placed",
            sortField: "created_at",
            className: "whitespace-nowrap",
            render: (r) => formatAdminDateTime(r.created_at),
          },
        ]}
      />
      <Pagination
        page={query.page}
        pageSize={ADMIN_LIST_PAGE_SIZE}
        total={count}
        onPageChange={(p) => navigate({ page: p }, false)}
      />
    </div>
  );
}
