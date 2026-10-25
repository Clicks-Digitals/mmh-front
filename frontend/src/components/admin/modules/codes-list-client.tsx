"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { RevealCodeDialog } from "@/components/admin/modules/reveal-code-dialog";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { useAdminUrlResource } from "@/hooks/use-admin-url-resource";
import {
  deactivateCode,
  fetchAllPages,
  listCodes,
  listVariants,
  type AdminVariant,
  type DigitalCodeRow,
} from "@/lib/api/admin";
import Link from "next/link";
import { useState } from "react";
import { VariantName } from "@/components/admin/ui/variant-name";
import { variantOptionLabel } from "@/components/admin/lib/variants";

const STATUSES = [
  { value: "", label: "Any status" },
  { value: "AVAILABLE", label: "Available (ready to sell)" },
  { value: "RESERVED", label: "Reserved (being delivered)" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "UNAVAILABLE", label: "Deactivated / retired" },
];

const SOURCE_LABEL: Record<string, string> = { CSV_IMPORT: "File import", MANUAL: "Added by hand", SUPPLIER: "Supplier" };

/** CA-11 / RO-11: only code variants have code stock; one paginated request set, reused. */
export function codeVariantLabel(v: Partial<Pick<AdminVariant, "sku" | "name_en" | "product_name">>): string {
  return variantOptionLabel(v);
}

/** Filters come from the URL (?variant=, ?status=, ?search=), so links from products/inventory work. */
export function CodesListClient() {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canReveal = can("codes.reveal");
  const canManage = can("codes.manage");

  const { data: variants } = useAdminQuery<AdminVariant[]>((tok) =>
    fetchAllPages((params) => listVariants(tok, { ...params, fulfillment_type: "CODE" })).catch(() => []),
  );

  const { state, set, reset, page, hasFilters, token, items, count, loading, error, reload } = useAdminUrlResource<
    DigitalCodeRow,
    { search: string; status: string; variant: string; ordering: string }
  >({ search: "", status: "", variant: "", ordering: "" }, async (tok, s) => {
    const data = await listCodes(tok, {
      page: Number(s.page) || 1,
      page_size: ADMIN_LIST_PAGE_SIZE,
      search: s.search.trim() || undefined,
      status: s.status || undefined,
      variant: s.variant || undefined,
      ordering: s.ordering || "-created_at",
    });
    return { items: data.results, count: data.count };
  });

  const [revealTarget, setRevealTarget] = useState<DigitalCodeRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<DigitalCodeRow | null>(null);
  const [pending, setPending] = useState(false);

  async function confirmDeactivate() {
    if (!token || !deactivateTarget) return;
    setPending(true);
    try {
      await deactivateCode(token, deactivateTarget.id);
      toast.push("Code deactivated — it will not be sold", "success");
      setDeactivateTarget(null);
      reload();
    } catch (err) {
      toast.push(adminErrorMessage(err, "Deactivate failed"), "error");
    } finally {
      setPending(false);
    }
  }

  const columns: DataTableColumn<DigitalCodeRow>[] = [
    { key: "masked", header: "Code", mobilePrimary: true, render: (r) => <span className="font-mono text-xs">{r.masked}</span> },
    {
      key: "variant",
      header: "Variant",
      render: (r) => <VariantName productName={r.product_name} variantName={r.variant_name} sku={r.variant_sku} />,
    },
    {
      key: "order",
      header: "Order",
      render: (r) =>
        r.order_number ? (
          can("orders.read") ? (
            <Link href={`/admin/orders/${encodeURIComponent(r.order_number)}`} className="text-[var(--clicks-blue)]">
              {r.order_number}
            </Link>
          ) : (
            r.order_number
          )
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      header: "Status",
      sortKey: "status",
      render: (r) => (
        <Badge status={r.status || "AVAILABLE"}>{r.status_label || STATUSES.find((s) => s.value === r.status)?.label || r.status}</Badge>
      ),
    },
    { key: "source", header: "Added by", mobileHidden: true, render: (r) => <span className="text-xs">{SOURCE_LABEL[r.source ?? ""] ?? r.source ?? "—"}</span> },
    {
      key: "created",
      header: "Added",
      sortKey: "created_at",
      sortFirst: "desc",
      render: (r) => <span className="text-xs">{formatAdminDateTime(r.created_at)}</span>,
    },
    {
      key: "revealed",
      header: "Seen",
      render: (r) => (
        <span className="text-xs">
          {r.customer_revealed_at ? <span className="block">Customer: {formatAdminDateTime(r.customer_revealed_at)}</span> : null}
          {r.revealed_at ? (
            <span className="block text-[var(--clicks-muted)]">
              Staff{r.revealed_by_email ? ` (${r.revealed_by_email})` : ""}: {formatAdminDateTime(r.revealed_at)}
            </span>
          ) : null}
          {!r.customer_revealed_at && !r.revealed_at ? "—" : null}
        </span>
      ),
    },
  ];
  if (canReveal || canManage) {
    columns.push({
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex justify-end gap-3 text-xs">
          {canReveal ? (
            <button type="button" className="font-medium text-[var(--clicks-blue)]" onClick={() => setRevealTarget(r)}>
              Reveal
            </button>
          ) : null}
          {canManage && r.status === "AVAILABLE" ? (
            <button type="button" className="font-medium text-[var(--clicks-error)]" onClick={() => setDeactivateTarget(r)}>
              Deactivate
            </button>
          ) : null}
        </div>
      ),
    });
  }

  const variantOptions = variants ?? [];

  return (
    <div>
      <PageHeader
        title="Digital codes"
        description="All codes in stock and delivered. Codes are always shown masked; revealing one is recorded in the activity log."
        actions={
          canManage ? (
            <Link href="/admin/codes/import" className="admin-btn admin-btn-primary">
              Import codes
            </Link>
          ) : null
        }
      />
      <Filters
        search={state.search}
        onSearchChange={(v) => set({ search: v })}
        searchPlaceholder="Paste a full code, the last characters, a SKU or an order number…"
        searchHint="Tip: paste the complete code to check whether it is already in stock or delivered."
        filters={[
          { key: "status", label: "Status", value: state.status, onChange: (v) => set({ status: v }), options: STATUSES },
          {
            key: "variant",
            label: "Variant",
            value: state.variant,
            onChange: (v) => set({ variant: v }),
            options: [
              { value: "", label: "All code variants" },
              ...(state.variant && !variantOptions.some((v) => String(v.id) === state.variant)
                ? [{ value: state.variant, label: `Variant #${state.variant}` }]
                : []),
              ...variantOptions.map((v) => ({ value: String(v.id), label: codeVariantLabel(v) })),
            ],
          },
        ]}
        onClear={reset}
      />
      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        ordering={state.ordering}
        defaultOrdering="-created_at"
        onOrderingChange={(next) => set({ ordering: next === "-created_at" ? "" : next })}
        empty={
          <EmptyState
            title={hasFilters ? "No codes match" : "No codes yet"}
            description={
              state.search
                ? "This code is not in the system. Check for typos — searching the full code finds it whatever its PIN."
                : hasFilters
                  ? "No codes match these filters."
                  : "Import a file of codes to start selling code products."
            }
          />
        }
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={(p) => set({ page: String(p) })} />

      <RevealCodeDialog
        target={revealTarget ? { id: revealTarget.id, masked: revealTarget.masked } : null}
        onClose={() => setRevealTarget(null)}
        onRevealed={reload}
      />

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        title="Deactivate code?"
        description={
          deactivateTarget
            ? `Code ${deactivateTarget.masked} will no longer be sold or delivered. Use this for invalid or duplicate codes. This can't be undone from the panel.`
            : undefined
        }
        danger
        confirmLabel="Deactivate"
        pending={pending}
        onCancel={() => setDeactivateTarget(null)}
        onConfirm={() => void confirmDeactivate()}
      />
    </div>
  );
}
