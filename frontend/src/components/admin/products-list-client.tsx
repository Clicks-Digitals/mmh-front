"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { resolveAdminMediaUrl } from "@/components/admin/lib/media-url";
import { formatJod } from "@/components/admin/lib/money";
import { Badge } from "@/components/admin/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { useAdminToken } from "@/hooks/use-admin-token";
import { useAdminUrlState } from "@/hooks/use-admin-url-state";
import { asList, listCategories, listPlatforms, listProducts, type AdminProduct } from "@/lib/api/admin";
import { formatAdminDate } from "@/lib/admin/format";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 24;
const DEFAULT_ORDERING = "-updated_at";
const DEFAULTS = { search: "", category: "", platform: "", status: "", stock: "", ordering: "", page: "1" };

/** Price range of the published variants (the API computes it from published variants only). */
function priceRange(row: AdminProduct) {
  if (row.price_min_fils != null && row.price_max_fils != null) {
    if (row.price_min_fils === row.price_max_fils) return formatJod(row.price_min_fils);
    return `${formatJod(row.price_min_fils)} – ${formatJod(row.price_max_fils)}`;
  }
  return <span className="text-[var(--clicks-muted)]">No published price</span>;
}

const STATUS_LABEL: Record<string, string> = { PUBLISHED: "Published", DRAFT: "Draft", ARCHIVED: "Archived" };

export function ProductsListClient() {
  const token = useAdminToken();
  const canWrite = useAdminAccess().can("catalog.write");
  const { state, debounced, set, reset, page, hasFilters } = useAdminUrlState(DEFAULTS);
  const [items, setItems] = useState<AdminProduct[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const { data: meta } = useAdminQuery(async (tok) => {
    const [cats, plats] = await Promise.all([listCategories(tok, { page_size: 100 }), listPlatforms(tok, { page_size: 100 })]);
    return { categories: asList(cats).items, platforms: asList(plats).items };
  });

  const query = JSON.stringify(debounced);
  useEffect(() => {
    let cancelled = false;
    const q = JSON.parse(query) as typeof DEFAULTS;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!token) {
        setError("Your session has expired. Sign in again.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await listProducts(token, {
          page: Number(q.page) || 1,
          page_size: PAGE_SIZE,
          search: q.search || undefined,
          category: q.category || undefined,
          platform: q.platform || undefined,
          status: q.status || undefined,
          stock: q.stock || undefined,
          ordering: q.ordering || DEFAULT_ORDERING,
        });
        if (cancelled) return;
        setItems(data.results);
        setCount(data.count);
      } catch (err) {
        if (cancelled) return;
        setItems([]);
        setCount(0);
        setError(adminErrorMessage(err, "Failed to load products"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, query, tick]);

  const columns: DataTableColumn<AdminProduct>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Product",
        sortKey: "name_en",
        mobilePrimary: true,
        render: (row) => {
          const src = resolveAdminMediaUrl(row.primary_image_url || row.image_url);
          return (
            <div className="flex min-w-0 items-center gap-3">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="h-10 w-10 shrink-0 rounded-md bg-[var(--clicks-bg)] object-cover" loading="lazy" />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded-md bg-[var(--clicks-bg)]" aria-hidden />
              )}
              <div className="min-w-0">
                <Link
                  href={`/admin/products/${row.slug}`}
                  className="block truncate font-medium text-[var(--clicks-navy)] hover:text-[var(--clicks-blue)]"
                >
                  {row.name_en}
                </Link>
                <p className="truncate text-[11px] text-[var(--clicks-muted)]">
                  {row.fulfillment_type === "DIRECT_TOPUP" ? "Direct top-up" : "Codes"} · {row.category_name || "No category"}
                </p>
              </div>
            </div>
          );
        },
      },
      { key: "platform", header: "Platform", render: (row) => row.platform_name || row.platform_slug || "—" },
      {
        key: "regions",
        header: "Region",
        mobileHidden: true,
        render: (row) => (row.region_labels?.length ? row.region_labels.join(", ") : "—"),
      },
      {
        key: "variants",
        header: "Variants",
        className: "tabular-nums",
        render: (row) => row.variants_count ?? row.variants?.length ?? 0,
      },
      { key: "price", header: "Price on store", className: "tabular-nums whitespace-nowrap", render: (row) => priceRange(row) },
      {
        key: "codes",
        header: "Codes in stock",
        className: "tabular-nums",
        render: (row) => (row.fulfillment_type === "DIRECT_TOPUP" ? <span className="text-[var(--clicks-muted)]">n/a</span> : row.codes_available ?? 0),
      },
      {
        key: "supplier",
        header: "Supplier",
        mobileHidden: true,
        render: (row) => (row.supplier_names?.length ? row.supplier_names.join(", ") : "—"),
      },
      {
        key: "status",
        header: "Status",
        sortKey: "status",
        render: (row) => <Badge status={row.status}>{STATUS_LABEL[row.status] ?? row.status}</Badge>,
      },
      {
        key: "updated",
        header: "Updated",
        sortKey: "updated_at",
        sortFirst: "desc",
        className: "whitespace-nowrap",
        render: (row) => formatAdminDate(row.updated_at),
      },
      {
        key: "actions",
        header: "",
        render: (row) => (
          <Link href={`/admin/products/${row.slug}`} className="text-xs font-medium text-[var(--clicks-blue)]">
            {canWrite ? "Edit" : "View"}
          </Link>
        ),
      },
    ],
    [canWrite],
  );

  return (
    <div>
      <PageHeader
        title="Products"
        description="Everything you sell. Open a product to change its prices (variants), photos, required details and codes."
        actions={
          canWrite ? (
            <Link href="/admin/products/new" className="admin-btn admin-btn-primary">
              New product
            </Link>
          ) : null
        }
      />
      <Filters
        search={state.search}
        onSearchChange={(v) => set({ search: v })}
        searchPlaceholder="Search name, web address or SKU…"
        onClear={reset}
        filters={[
          {
            key: "category",
            label: "Category",
            value: state.category,
            onChange: (v) => set({ category: v }),
            options: [
              { value: "", label: "All categories" },
              ...(meta?.categories ?? []).map((c) => ({ value: String(c.id), label: c.name_en })),
            ],
          },
          {
            key: "platform",
            label: "Platform",
            value: state.platform,
            onChange: (v) => set({ platform: v }),
            options: [
              { value: "", label: "All platforms" },
              ...(meta?.platforms ?? []).map((p) => ({ value: String(p.id), label: p.name_en })),
            ],
          },
          {
            key: "status",
            label: "Status",
            value: state.status,
            onChange: (v) => set({ status: v }),
            options: [
              { value: "", label: "All statuses" },
              { value: "PUBLISHED", label: "Published" },
              { value: "DRAFT", label: "Draft" },
              { value: "ARCHIVED", label: "Archived" },
            ],
          },
          {
            key: "stock",
            label: "Code stock",
            value: state.stock,
            onChange: (v) => set({ stock: v }),
            options: [
              { value: "", label: "Any code stock" },
              { value: "in_stock", label: "Has codes" },
              { value: "low_stock", label: "Low on codes" },
              { value: "out_of_stock", label: "No codes" },
            ],
          },
        ]}
      />
      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        rowKey={(row) => String(row.id)}
        ordering={state.ordering}
        defaultOrdering={DEFAULT_ORDERING}
        onOrderingChange={(next) => set({ ordering: next === DEFAULT_ORDERING ? "" : next })}
        empty={
          <EmptyState
            title={hasFilters ? "No products match these filters" : "No products yet"}
            description={hasFilters ? "Try clearing the filters." : "Create your first product to start selling."}
            action={
              hasFilters ? (
                <button type="button" className="text-sm font-semibold text-[var(--clicks-blue)]" onClick={reset}>
                  Clear filters
                </button>
              ) : canWrite ? (
                <Link href="/admin/products/new" className="text-sm font-semibold text-[var(--clicks-blue)]">
                  New product
                </Link>
              ) : undefined
            }
          />
        }
        error={error ? <ErrorState message={error} onRetry={() => setTick((n) => n + 1)} /> : null}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={count} onPageChange={(p) => set({ page: String(p) })} />
    </div>
  );
}
