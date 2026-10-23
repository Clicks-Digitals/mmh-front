"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { Badge } from "@/components/admin/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { useAdminToken } from "@/hooks/use-admin-token";
import {
  asList,
  listCategories,
  listPlatforms,
  listProducts,
  type AdminProduct,
} from "@/lib/api/admin";
import { resolveMediaUrl } from "@/lib/media";
import { formatFils } from "@/server/money";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 24;

function priceRange(row: AdminProduct) {
  if (row.price_min_fils != null && row.price_max_fils != null) {
    if (row.price_min_fils === row.price_max_fils) return `${formatFils(row.price_min_fils)} JOD`;
    return `${formatFils(row.price_min_fils)} – ${formatFils(row.price_max_fils)} JOD`;
  }
  return row.price_jod != null ? `${row.price_jod} JOD` : "—";
}

export function ProductsListClient() {
  const token = useAdminToken();
  const canWrite = useAdminAccess().can("catalog.write");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [stock, setStock] = useState("");
  const [items, setItems] = useState<AdminProduct[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const { data: meta } = useAdminQuery(async (tok) => {
    const [cats, plats] = await Promise.all([
      listCategories(tok, { page_size: 200 }),
      listPlatforms(tok, { page_size: 200 }),
    ]);
    return { categories: asList(cats).items, platforms: asList(plats).items };
  });

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setError("Missing admin session token. Sign in again.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await listProducts(token, {
          page,
          page_size: PAGE_SIZE,
          search: debounced || undefined,
          category: category || undefined,
          platform: platform || undefined,
          status: status || undefined,
          stock: stock || undefined,
          ordering: "-updated_at",
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
  }, [token, page, debounced, category, platform, status, stock, tick]);

  const columns: DataTableColumn<AdminProduct>[] = useMemo(
    () => [
      {
        key: "image",
        header: "",
        render: (row) => {
          const src = resolveMediaUrl(row.primary_image_url || row.image_url);
          return src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="h-10 w-10 rounded-md object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-md bg-[var(--clicks-bg)]" />
          );
        },
      },
      {
        key: "name",
        header: "Product",
        render: (row) => (
          <div>
            <Link
              href={`/admin/products/${row.slug}`}
              className="font-medium text-[var(--clicks-navy)] hover:text-[var(--clicks-blue)]"
            >
              {row.name_en}
            </Link>
            <p className="font-mono text-[11px] text-[var(--clicks-muted)]">{row.id}</p>
          </div>
        ),
      },
      {
        key: "category",
        header: "Category",
        render: (row) => row.category_name || row.category_slug || "—",
      },
      {
        key: "platform",
        header: "Platform",
        render: (row) => row.platform_name || row.platform_slug || "—",
      },
      {
        key: "regions",
        header: "Region",
        render: (row) => (row.region_labels?.length ? row.region_labels.join(", ") : "—"),
      },
      {
        key: "variants",
        header: "Variants",
        className: "tabular-nums",
        render: (row) => row.variants_count ?? row.variants?.length ?? 0,
      },
      {
        key: "price",
        header: "Price",
        className: "tabular-nums",
        render: (row) => priceRange(row),
      },
      {
        key: "codes",
        header: "Available",
        className: "tabular-nums",
        render: (row) => row.codes_available ?? 0,
      },
      {
        key: "supplier",
        header: "Supplier",
        render: (row) => (row.supplier_names?.length ? row.supplier_names.join(", ") : "—"),
      },
      {
        key: "status",
        header: "Status",
        render: (row) => <Badge status={row.status} />,
      },
      {
        key: "updated",
        header: "Updated",
        render: (row) =>
          row.updated_at ? new Date(row.updated_at).toLocaleDateString() : "—",
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
        description="Manage digital catalog products, variants, media, and inventory."
        actions={
          canWrite ? (
            <Link href="/admin/products/new" className="admin-btn admin-btn-primary">
              New product
            </Link>
          ) : null
        }
      />
      <Filters
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search name, slug, SKU…"
        filters={[
          {
            key: "category",
            label: "Category",
            value: category,
            onChange: (v) => {
              setCategory(v);
              setPage(1);
            },
            options: [
              { value: "", label: "All categories" },
              ...(meta?.categories ?? []).map((c) => ({ value: String(c.id), label: c.name_en })),
            ],
          },
          {
            key: "platform",
            label: "Platform",
            value: platform,
            onChange: (v) => {
              setPlatform(v);
              setPage(1);
            },
            options: [
              { value: "", label: "All platforms" },
              ...(meta?.platforms ?? []).map((p) => ({ value: String(p.id), label: p.name_en })),
            ],
          },
          {
            key: "status",
            label: "Status",
            value: status,
            onChange: (v) => {
              setStatus(v);
              setPage(1);
            },
            options: [
              { value: "", label: "All statuses" },
              { value: "PUBLISHED", label: "Published" },
              { value: "DRAFT", label: "Draft" },
              { value: "ARCHIVED", label: "Archived" },
            ],
          },
          {
            key: "stock",
            label: "Stock",
            value: stock,
            onChange: (v) => {
              setStock(v);
              setPage(1);
            },
            options: [
              { value: "", label: "All stock" },
              { value: "in_stock", label: "In stock" },
              { value: "low_stock", label: "Low stock" },
              { value: "out_of_stock", label: "Out of stock" },
            ],
          },
        ]}
      />
      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        rowKey={(row) => String(row.id)}
        empty={
          <EmptyState
            title="No products"
            description="Create a product or adjust filters."
            action={
              <Link href="/admin/products/new" className="text-sm font-semibold text-[var(--clicks-blue)]">
                New product
              </Link>
            }
          />
        }
        error={error ? <ErrorState message={error} onRetry={() => setTick((n) => n + 1)} /> : null}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={count} onPageChange={setPage} />
    </div>
  );
}
