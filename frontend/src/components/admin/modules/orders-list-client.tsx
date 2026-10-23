"use client";

import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { Badge } from "@/components/admin/ui/badge";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import {
  FULFILLMENT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  fulfillmentStatusLabel,
  paymentStatusLabel,
} from "@/components/admin/lib/orders";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminResource } from "@/hooks/use-admin-resource";
import { listOrders, type AdminOrder } from "@/lib/api/admin";
import { formatFils } from "@/server/money";
import Link from "next/link";
import { useState } from "react";

export function OrdersListClient({
  initialPaymentStatus = "",
  initialFulfillmentStatus = "",
}: {
  initialPaymentStatus?: string;
  initialFulfillmentStatus?: string;
}) {
  const [paymentStatus, setPaymentStatus] = useState(initialPaymentStatus);
  const [fulfillmentStatus, setFulfillmentStatus] = useState(initialFulfillmentStatus);
  const { page, setPage, search, setSearch, items, count, loading, error, reload } = useAdminResource<AdminOrder>(
    async (token, p, s) => {
      const data = await listOrders(token, {
        page: p,
        page_size: ADMIN_LIST_PAGE_SIZE,
        search: s || undefined,
        payment_status: paymentStatus || undefined,
        fulfillment_status: fulfillmentStatus || undefined,
      });
      return { items: data.results, count: data.count };
    },
    [paymentStatus, fulfillmentStatus],
  );

  return (
    <div>
      <PageHeader title="Orders" description="Customer orders. Open an order to deliver, refund or change its status." />
      <Filters
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Order number, e-mail, name or phone…"
        filters={[
          {
            key: "payment",
            label: "Payment status",
            value: paymentStatus,
            onChange: (v) => {
              setPaymentStatus(v);
              setPage(1);
            },
            options: [
              { value: "", label: "Any payment" },
              ...Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
          {
            key: "fulfillment",
            label: "Fulfillment status",
            value: fulfillmentStatus,
            onChange: (v) => {
              setFulfillmentStatus(v);
              setPage(1);
            },
            options: [
              { value: "", label: "Any fulfillment" },
              ...Object.entries(FULFILLMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
        onClear={() => {
          setSearch("");
          setPaymentStatus("");
          setFulfillmentStatus("");
        }}
      />
      <DataTable
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="No orders" description="No orders match these filters." />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
        columns={[
          {
            key: "number",
            header: "Order",
            render: (r) => (
              <Link href={`/admin/orders/${r.id}`} className="font-medium text-[var(--clicks-blue)]">
                {r.order_number}
              </Link>
            ),
          },
          {
            key: "customer",
            header: "Customer",
            render: (r) => (
              <div>
                <p>{r.full_name || "—"}</p>
                <p className="text-xs text-[var(--clicks-muted)]">{r.email}</p>
              </div>
            ),
          },
          {
            key: "payment",
            header: "Payment",
            render: (r) => <Badge status={r.payment_status}>{paymentStatusLabel(r.payment_status)}</Badge>,
          },
          {
            key: "fulfillment",
            header: "Fulfillment",
            render: (r) => <Badge status={r.fulfillment_status}>{fulfillmentStatusLabel(r.fulfillment_status)}</Badge>,
          },
          { key: "items", header: "Items", className: "tabular-nums", render: (r) => r.item_count ?? "—" },
          {
            key: "total",
            header: "Total",
            className: "tabular-nums",
            render: (r) => `${formatFils(r.total_fils)} JOD`,
          },
          { key: "created", header: "Created", render: (r) => formatAdminDateTime(r.created_at) },
        ]}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={setPage} />
    </div>
  );
}
