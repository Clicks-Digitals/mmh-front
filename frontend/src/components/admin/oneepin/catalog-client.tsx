"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { Badge } from "@/components/admin/ui/badge";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { listCatalog, listCatalogCategories, syncCatalog, type CatalogItem } from "@/components/admin/oneepin/api";
import { describeFailure } from "@/components/admin/oneepin/errors";
import { catalogTypeLabel, jodText, supplierAmount } from "@/components/admin/oneepin/labels";
import { LinkDialog, type LinkTarget } from "@/components/admin/oneepin/link-dialog";
import { OneEpinTabs } from "@/components/admin/oneepin/ui";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { useAdminUrlResource } from "@/hooks/use-admin-url-resource";
import Link from "next/link";
import { useState } from "react";

const PAGE_SIZE = 25;
const DEFAULTS = { search: "", category: "", type: "", mapped: "", active: "true" };

function PriceCell({ item }: { item: CatalogItem }) {
  const prev = item.previous_price ? Number(item.previous_price) : null;
  const now = Number(item.price);
  const change = prev && Number.isFinite(now) && prev !== now ? ((now - prev) / prev) * 100 : null;
  return (
    <div className="whitespace-nowrap tabular-nums">
      <p>{supplierAmount(item.price, item.currency)}</p>
      <p className="text-[11px] text-[var(--clicks-muted)]">≈ {jodText(item.cost_jod)}</p>
      {change !== null ? (
        <p className={`text-[11px] ${change > 0 ? "text-[var(--clicks-error)]" : "text-emerald-700"}`}>
          {change > 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}% since last sync
        </p>
      ) : null}
    </div>
  );
}

export function OneEpinCatalogClient() {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("suppliers.write");
  const [link, setLink] = useState<LinkTarget | null>(null);
  const [syncing, setSyncing] = useState(false);

  const list = useAdminUrlResource<CatalogItem, typeof DEFAULTS>(DEFAULTS, async (token, s) => {
    const data = await listCatalog(token, {
      page: Number(s.page) || 1,
      page_size: PAGE_SIZE,
      search: s.search || undefined,
      category: s.category || undefined,
      type: s.type || undefined,
      mapped: s.mapped || undefined,
      active: s.active || undefined,
    });
    return { items: data.results ?? [], count: data.count ?? 0 };
  });
  const categories = useAdminQuery((tok) => listCatalogCategories(tok));
  const { state, set } = list;

  async function runSync() {
    if (!list.token) return;
    setSyncing(true);
    try {
      const r = await syncCatalog(list.token);
      toast.push(r.message || `Synced ${r.total} products`, "success");
      list.reload();
      categories.reload();
    } catch (err) {
      toast.push(describeFailure(err, "Catalog sync did not run."), "error");
    } finally {
      setSyncing(false);
    }
  }

  const categoryOptions = [
    { value: "", label: "All categories" },
    ...(categories.data ?? [])
      .filter((c) => !state.type || c.type === state.type)
      .map((c) => ({ value: c.id || c.name, label: `${c.name} (${c.products})` })),
  ];

  return (
    <div>
      <PageHeader
        title="1Epin catalog"
        description="Everything 1Epin sells, with their price and the cost in JOD. Link a 1Epin product to one of our product options so it can be bought automatically."
        actions={
          canWrite ? (
            <button type="button" className="admin-btn admin-btn-secondary" disabled={syncing} onClick={() => void runSync()}>
              {syncing ? "Syncing…" : "Sync catalog"}
            </button>
          ) : null
        }
      />
      <OneEpinTabs />
      <Filters
        search={state.search}
        onSearchChange={(v) => set({ search: v })}
        searchPlaceholder="Product, category or 1Epin product ID…"
        filters={[
          {
            key: "type",
            label: "Type",
            value: state.type,
            onChange: (v) => set({ type: v, category: "" }),
            options: [
              { value: "", label: "E-pins and top-ups" },
              { value: "epin", label: "E-pins (codes)" },
              { value: "topup", label: "Top-ups" },
            ],
          },
          { key: "category", label: "Category", value: state.category, onChange: (v) => set({ category: v }), options: categoryOptions },
          {
            key: "mapped",
            label: "Linked",
            value: state.mapped,
            onChange: (v) => set({ mapped: v }),
            options: [
              { value: "", label: "Linked or not" },
              { value: "true", label: "Linked to our products" },
              { value: "false", label: "Not linked yet" },
            ],
          },
          {
            key: "active",
            label: "Availability",
            value: state.active,
            onChange: (v) => set({ active: v }),
            options: [
              { value: "true", label: "Sold by 1Epin now" },
              { value: "false", label: "No longer sold" },
              { value: "all", label: "All" },
            ],
          },
        ]}
        onClear={list.hasFilters ? list.reset : undefined}
      />
      <DataTable<CatalogItem>
        rows={list.items}
        loading={list.loading}
        rowKey={(r) => String(r.id)}
        error={list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        empty={
          <EmptyState
            title={list.hasFilters ? "No 1Epin products match" : "The catalog is empty"}
            description={
              list.hasFilters
                ? "Try another search or clear the filters."
                : canWrite
                  ? "Use “Sync catalog” to download 1Epin's product list."
                  : "Ask someone who manages suppliers to sync the 1Epin catalog."
            }
          />
        }
        columns={[
          {
            key: "name",
            header: "1Epin product",
            mobilePrimary: true,
            render: (r) => (
              <div className="min-w-0">
                <p className="font-medium text-[var(--clicks-navy)]">{r.product_name}</p>
                <p className="font-mono text-[11px] text-[var(--clicks-muted)]">ID {r.external_product_id}</p>
              </div>
            ),
          },
          { key: "category", header: "Category", render: (r) => r.category_name || "—" },
          {
            key: "type",
            header: "Type",
            render: (r) => (
              <span className="flex flex-wrap gap-1">
                <Badge tone="info" className="normal-case tracking-normal">
                  {catalogTypeLabel(r.category_type)}
                </Badge>
                {r.is_tiered ? <Badge tone="neutral">By amount</Badge> : null}
              </span>
            ),
          },
          { key: "price", header: "Price / our cost", render: (r) => <PriceCell item={r} /> },
          {
            key: "linked",
            header: "Linked to",
            render: (r) =>
              r.mappings?.length ? (
                <ul className="space-y-0.5 text-[12px]">
                  {r.mappings.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/admin/products/${encodeURIComponent(m.product)}?tab=supplier`}
                        className="font-medium text-[var(--clicks-blue)]"
                      >
                        {m.product_name}
                        {m.variant_name ? ` – ${m.variant_name}` : ""}
                      </Link>
                      {m.ignored ? <span className="ms-1 text-[var(--clicks-muted)]">(paused)</span> : !m.auto_buy ? <span className="ms-1 text-[var(--clicks-muted)]">(manual)</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[12px] text-[var(--clicks-muted)]">Not linked</span>
              ),
          },
          {
            key: "status",
            header: "Status",
            render: (r) => (
              <div>
                <Badge tone={r.active ? "success" : "error"} className="normal-case tracking-normal">
                  {r.active ? "Sold now" : "No longer sold"}
                </Badge>
                <p className="mt-0.5 text-[11px] text-[var(--clicks-muted)]">Seen {formatAdminDateTime(r.last_seen_at)}</p>
              </div>
            ),
          },
          {
            key: "actions",
            header: "",
            render: (r) =>
              canWrite && r.active ? (
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary h-8 whitespace-nowrap text-xs"
                  onClick={() => setLink({ kind: "fromCatalog", item: r })}
                >
                  Link to product option…
                </button>
              ) : null,
          },
        ]}
      />
      <Pagination page={list.page} pageSize={PAGE_SIZE} total={list.count} onPageChange={(p) => set({ page: String(p) })} />

      <LinkDialog
        target={link}
        onClose={() => setLink(null)}
        onSaved={() => {
          setLink(null);
          list.reload();
        }}
      />
    </div>
  );
}
