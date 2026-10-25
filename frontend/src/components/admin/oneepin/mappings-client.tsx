"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { deleteMapping, listMappings, type OneEpinMapping } from "@/components/admin/oneepin/api";
import { describeFailure } from "@/components/admin/oneepin/errors";
import { catalogTypeLabel, filsJod, jodText } from "@/components/admin/oneepin/labels";
import { LinkDialog, type LinkTarget } from "@/components/admin/oneepin/link-dialog";
import { MarginText, OneEpinTabs, StockBadge } from "@/components/admin/oneepin/ui";
import { useAdminUrlResource } from "@/hooks/use-admin-url-resource";
import Link from "next/link";
import { useState } from "react";

const PAGE_SIZE = 25;
const DEFAULTS = { search: "", auto_buy: "" };

export function OneEpinMappingsClient() {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("suppliers.write");
  const [link, setLink] = useState<LinkTarget | null>(null);
  const [toDelete, setToDelete] = useState<OneEpinMapping | null>(null);
  const [pending, setPending] = useState(false);

  const list = useAdminUrlResource<OneEpinMapping, typeof DEFAULTS>(DEFAULTS, async (token, s) => {
    const data = await listMappings(token, {
      page: Number(s.page) || 1,
      page_size: PAGE_SIZE,
      search: s.search || undefined,
      auto_buy: s.auto_buy || undefined,
    });
    return { items: data.results ?? [], count: data.count ?? 0 };
  });
  const { state, set } = list;

  async function remove() {
    if (!list.token || !toDelete) return;
    setPending(true);
    try {
      await deleteMapping(list.token, toDelete.id);
      toast.push("Link removed", "success");
      setToDelete(null);
      list.reload();
    } catch (err) {
      toast.push(describeFailure(err, "Could not remove the link."), "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Products linked to 1Epin"
        description="Each row is one of our product options that 1Epin can deliver. Check the profit: red means 1Epin costs more than our sale price."
        actions={
          canWrite ? (
            <Link href="/admin/integrations/1epin/catalog?mapped=false" className="admin-btn admin-btn-primary">
              Link a product
            </Link>
          ) : null
        }
      />
      <OneEpinTabs />
      <Filters
        search={state.search}
        onSearchChange={(v) => set({ search: v })}
        searchPlaceholder="Our product, option, SKU or 1Epin product…"
        filters={[
          {
            key: "auto_buy",
            label: "Buying",
            value: state.auto_buy,
            onChange: (v) => set({ auto_buy: v }),
            options: [
              { value: "", label: "Automatic and manual" },
              { value: "true", label: "Buys automatically" },
              { value: "false", label: "Manual purchase only" },
            ],
          },
        ]}
        onClear={list.hasFilters ? list.reset : undefined}
      />
      <DataTable<OneEpinMapping>
        rows={list.items}
        loading={list.loading}
        rowKey={(r) => String(r.id)}
        error={list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        empty={
          <EmptyState
            title={list.hasFilters ? "No links match" : "Nothing is linked to 1Epin yet"}
            description={
              list.hasFilters ? "Try another search." : "Open the 1Epin catalog and use “Link to product option…”, or use a product's Supplier tab."
            }
          />
        }
        columns={[
          {
            key: "ours",
            header: "Our product option",
            mobilePrimary: true,
            render: (r) => (
              <div className="min-w-0">
                <Link
                  href={`/admin/products/${encodeURIComponent(r.product)}?tab=supplier`}
                  className="font-medium text-[var(--clicks-blue)]"
                >
                  {r.product_name}
                  {r.variant_name ? ` – ${r.variant_name}` : ""}
                </Link>
                {r.variant_sku ? <p className="font-mono text-[11px] text-[var(--clicks-muted)]">{r.variant_sku}</p> : null}
              </div>
            ),
          },
          {
            key: "theirs",
            header: "1Epin product",
            render: (r) => (
              <div className="min-w-0 text-[12px]">
                <p>{r.catalog_item?.product_name || r.external_name || "—"}</p>
                <p className="text-[11px] text-[var(--clicks-muted)]">
                  {catalogTypeLabel(r.category_type || r.catalog_item?.category_type)} · ID {r.external_product_id}
                </p>
                {r.warnings?.length ? (
                  <ul className="mt-0.5 text-[11px] text-amber-700">
                    {r.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ),
          },
          { key: "cost", header: "1Epin cost", className: "tabular-nums whitespace-nowrap", render: (r) => jodText(r.cost_jod) },
          { key: "sale", header: "Our price", className: "tabular-nums whitespace-nowrap", render: (r) => jodText(r.sale_price_jod) },
          { key: "margin", header: "Profit", render: (r) => <MarginText fils={r.margin_fils} pct={r.margin_pct} /> },
          { key: "stock", header: "Stock", render: (r) => <StockBadge counts={r.counts_as_stock} reason={r.counts_as_stock_reason} /> },
          {
            key: "settings",
            header: "Settings",
            render: (r) => (
              <div className="flex flex-col items-start gap-0.5 text-[11px] text-[var(--clicks-muted)]">
                {r.ignored ? (
                  <Badge tone="neutral">Paused</Badge>
                ) : r.auto_buy ? (
                  <Badge tone="success" className="normal-case tracking-normal">
                    Buys automatically
                  </Badge>
                ) : (
                  <Badge tone="warning" className="normal-case tracking-normal">
                    Manual only
                  </Badge>
                )}
                {r.category_type !== "topup" ? <span>{r.prefer_supplier ? "1Epin first" : "Our codes first"}</span> : null}
                {r.max_cost_fils !== null ? <span>Max {filsJod(r.max_cost_fils)}</span> : null}
                {r.allow_loss ? <span className="text-[var(--clicks-error)]">Loss allowed</span> : null}
              </div>
            ),
          },
          {
            key: "actions",
            header: "",
            render: (r) =>
              canWrite ? (
                <div className="flex justify-end gap-3 text-xs">
                  <button type="button" className="font-medium text-[var(--clicks-blue)]" onClick={() => setLink({ kind: "edit", mapping: r })}>
                    Edit
                  </button>
                  <button type="button" className="font-medium text-red-600" onClick={() => setToDelete(r)}>
                    Remove
                  </button>
                </div>
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
      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Remove this 1Epin link?"
        description={
          toDelete
            ? `${toDelete.product_name}${toDelete.variant_name ? ` – ${toDelete.variant_name}` : ""} will no longer be bought from 1Epin. If it has no codes of our own it may show as out of stock. Orders already placed are not affected.`
            : undefined
        }
        danger
        confirmLabel="Remove"
        pending={pending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
