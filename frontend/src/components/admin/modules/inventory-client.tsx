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
import { formatJod } from "@/components/admin/lib/money";
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
        key: "name",
        header: "Variant",
        mobilePrimary: true,
        render: (v) => (
          <div>
            <p className="font-medium text-[var(--clicks-navy)]">{v.product_name ? `${v.product_name} — ` : ""}{v.name_en || "—"}</p>
            <p className="font-mono text-[11px] text-[var(--clicks-muted)]">{v.sku}</p>
          </div>
        ),
      },
      {
        key: "price",
        header: "Price",
        render: (v) => <span className="tabular-nums">{formatJod(v.price_fils)}</span>,
      },
      {
        key: "available",
        header: "Codes available",
        render: (v) => (
          <span className="tabular-nums">
            <span className="font-semibold">{v.available_codes ?? v.codes_available ?? 0}</span>
            {(v.codes_available ?? 0) !== (v.available_codes ?? v.codes_available ?? 0) ? (
              <span className="block text-[10px] text-[var(--clicks-muted)]">{v.codes_available} in stock, some held for checkouts</span>
            ) : null}
          </span>
        ),
      },
      {
        key: "stock",
        header: "On the store",
        render: (v) => {
          const st = v.effective_stock_status || v.stock_status || "OUT_OF_STOCK";
          return <Badge status={st}>{st === "IN_STOCK" ? "Selling" : st === "OUT_OF_STOCK" ? "Out of stock" : "Unknown"}</Badge>;
        },
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
              Import codes
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
        description="How many codes you have, and which variants are running low. Only published code variants are tracked; top-ups have no code stock."
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
            <StatCard label="Codes available" value={data.stats.codes_available} hint="Ready to sell" icon={KeyRound} />
            <StatCard label="Codes reserved" value={data.stats.codes_reserved ?? 0} hint="Held for orders being delivered" icon={Package} />
            <StatCard label="Codes delivered" value={data.stats.codes_delivered ?? 0} hint="Sent to customers" />
            <StatCard
              label="Variants selling"
              value={`${data.stats.effective_in_stock ?? "—"} / ${data.stats.tracked_variants ?? "—"}`}
              hint={`${data.stats.effective_out_of_stock ?? 0} published code variant(s) out of stock`}
              icon={ShieldAlert}
            />
            <StatCard
              label="Low stock"
              value={data.stats.low_stock ?? data.low_stock_variants?.length ?? 0}
              hint={`Available ≤ ${data.stats.low_stock_threshold} (Settings)`}
              icon={Boxes}
            />
          </div>

          <AdminCard className="mt-4" padding="md">
            <AdminSectionHeader
              title="Low stock variants"
              description={`Published code variants with ${data.stats.low_stock_threshold} or fewer available codes (available ≤ threshold). Change the threshold in Settings.`}
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
              <EmptyState title="Nothing is running low" description={`Every published code variant has more than ${data.stats.low_stock_threshold} codes available.`} />
            )}
          </AdminCard>
        </>
      ) : null}
    </div>
  );
}
