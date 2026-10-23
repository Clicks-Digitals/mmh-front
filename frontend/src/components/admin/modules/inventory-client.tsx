"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { Badge } from "@/components/admin/ui/badge";
import { AdminCard, AdminSectionHeader } from "@/components/admin/ui/card";
import { DataTable, type DataTableColumn } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { PageHeader } from "@/components/admin/ui/page-header";
import { StatCard } from "@/components/admin/ui/stat-card";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { getInventoryOverview, type AdminVariant } from "@/lib/api/admin";
import { formatFils } from "@/server/money";
import { Boxes, KeyRound, Package, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

export function InventoryClient() {
  const { can } = useAdminAccess();
  const canManage = can("codes.manage");
  const { data, loading, error, reload } = useAdminQuery((token) => getInventoryOverview(token));

  const columns: DataTableColumn<AdminVariant>[] = useMemo(
    () => [
      {
        key: "sku",
        header: "SKU",
        render: (v) => <span className="font-mono text-[12px]">{v.sku}</span>,
      },
      {
        key: "name",
        header: "Variant",
        render: (v) => <span className="font-medium text-[var(--clicks-navy)]">{v.name_en || "—"}</span>,
      },
      {
        key: "price",
        header: "Price",
        render: (v) => <span className="tabular-nums">{formatFils(v.price_fils)} JOD</span>,
      },
      {
        key: "available",
        header: "Available",
        render: (v) => <span className="font-semibold tabular-nums">{v.codes_available ?? 0}</span>,
      },
      {
        key: "stock",
        header: "Stock",
        render: (v) => <Badge status={v.stock_status || "OUT_OF_STOCK"} />,
      },
      {
        key: "actions",
        header: "",
        className: "w-24",
        render: (v) =>
          canManage && v.id ? (
            <Link
              href={`/admin/codes/import?variant=${v.id}`}
              className="text-[12px] font-medium text-[var(--clicks-blue)]"
            >
              Import
            </Link>
          ) : null,
      },
    ],
    [canManage],
  );

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Variant stock levels and digital code availability."
        actions={
          canManage ? (
            <Link href="/admin/codes/import" className="admin-btn admin-btn-primary">
              Import codes
            </Link>
          ) : null
        }
      />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="admin-card h-[88px] animate-pulse" />
          ))}
        </div>
      ) : null}
      {!loading && !error && data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Available" value={data.stats.codes_available} icon={KeyRound} />
            <StatCard label="Reserved" value={data.stats.codes_reserved ?? 0} icon={Package} />
            <StatCard label="Delivered" value={data.stats.codes_delivered ?? 0} />
            <StatCard label="Unavailable" value={data.stats.codes_unavailable ?? 0} icon={ShieldAlert} />
            <StatCard
              label="Low stock"
              value={data.low_stock_variants?.length ?? 0}
              hint={`Threshold ${data.stats.low_stock_threshold}`}
              icon={Boxes}
            />
          </div>

          <AdminCard className="mt-4" padding="md">
            <AdminSectionHeader
              title="Low stock variants"
              description="Variants at or below the configured availability threshold."
            />
            {data.low_stock_variants?.length ? (
              <DataTable
                columns={columns}
                rows={data.low_stock_variants}
                rowKey={(v) => String(v.id)}
                dense
                className="border-0 shadow-none"
              />
            ) : (
              <EmptyState title="No low-stock variants" description="All tracked variants are above threshold." />
            )}
          </AdminCard>
        </>
      ) : null}
    </div>
  );
}
