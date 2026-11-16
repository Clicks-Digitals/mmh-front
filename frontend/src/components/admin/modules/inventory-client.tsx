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
import {
  fetchAllPages,
  getInventoryOverview,
  listCategories,
  listRegions,
  listVariants,
  type AdminVariant,
} from "@/lib/api/admin";
import { categoryTreeOptions } from "@/components/admin/lib/category-tree";
import { adminInputClass } from "@/components/admin/ui/form-field";
import { formatJod } from "@/components/admin/lib/money";
import { Boxes, KeyRound, Package, Search, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
        key: "region",
        header: "Region",
        render: (v) => <span className="text-[12px]">{v.region_slug ? String(v.region_slug).toUpperCase() : "Everywhere"}</span>,
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

          <OptionFinder columns={columns} />

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

/** Find any code option by category, region or name — then import codes for it. */
function OptionFinder({ columns }: { columns: DataTableColumn<AdminVariant>[] }) {
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(typed.trim()), 300);
    return () => window.clearTimeout(id);
  }, [typed]);

  const { data: lookups } = useAdminQuery(async (token) => {
    const [categories, regions] = await Promise.all([
      fetchAllPages((p) => listCategories(token, p)),
      fetchAllPages((p) => listRegions(token, p)),
    ]);
    return { categories, regions };
  });
  const active = Boolean(category || region || search);
  const { data: rows, loading, error, reload } = useAdminQuery(
    async (token) => {
      if (!active) return [] as AdminVariant[];
      return fetchAllPages((p) =>
        listVariants(token, { ...p, category, region, search, fulfillment_type: "CODE", exclude_archived: true }),
      );
    },
    [category, region, search],
  );

  return (
    <AdminCard className="mt-4" padding="md">
      <AdminSectionHeader title="Find an option" description="Pick a category and region to jump straight to the option you want to add codes to." />
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_200px_1fr]">
        <select aria-label="Category" className={adminInputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categoryTreeOptions(lookups?.categories ?? []).map(({ category: c, label }) => (
            <option key={String(c.id)} value={c.slug}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Region" className={adminInputClass} value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">All regions</option>
          {(lookups?.regions ?? []).map((r) => (
            <option key={String(r.id)} value={r.slug}>
              {r.name_en} ({r.currency})
            </option>
          ))}
          <option value="none">No region</option>
        </select>
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--clicks-muted)]" aria-hidden />
          <input className={`${adminInputClass} ps-9`} placeholder="Product, option or SKU…" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
      </div>
      {!active ? (
        <p className="py-6 text-center text-[13px] text-[var(--clicks-muted)]">Choose a category or region, or type a name, to see its options.</p>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !rows?.length ? (
        <div className="h-24 animate-pulse rounded-lg bg-[#F3F5F9]" />
      ) : rows?.length ? (
        <DataTable columns={columns} rows={rows} rowKey={(v) => String(v.id)} dense className="border-0 shadow-none" />
      ) : (
        <EmptyState title="No code options match" description="Try another category or region." />
      )}
    </AdminCard>
  );
}
