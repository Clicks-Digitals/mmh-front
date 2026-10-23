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
import { useAdminResource } from "@/hooks/use-admin-resource";
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

const STATUSES = [
  { value: "", label: "Any status" },
  { value: "AVAILABLE", label: "Available" },
  { value: "RESERVED", label: "Reserved" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "UNAVAILABLE", label: "Deactivated" },
];

export function CodesListClient({ initialVariant = "", initialStatus = "" }: { initialVariant?: string; initialStatus?: string }) {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canReveal = can("codes.reveal");
  const canManage = can("codes.manage");
  const [status, setStatus] = useState(initialStatus);
  const [variant, setVariant] = useState(initialVariant);

  const { data: variants } = useAdminQuery<AdminVariant[]>((tok) =>
    fetchAllPages((params) => listVariants(tok, params)).catch(() => []),
  );

  const { token, page, setPage, search, setSearch, items, count, loading, error, reload } =
    useAdminResource<DigitalCodeRow>(
      async (tok, p, s) => {
        const data = await listCodes(tok, {
          page: p,
          page_size: ADMIN_LIST_PAGE_SIZE,
          search: s || undefined,
          status: status || undefined,
          variant: variant || undefined,
        });
        return { items: data.results, count: data.count };
      },
      [status, variant],
    );

  const [revealTarget, setRevealTarget] = useState<DigitalCodeRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<DigitalCodeRow | null>(null);
  const [pending, setPending] = useState(false);

  async function confirmDeactivate() {
    if (!token || !deactivateTarget) return;
    setPending(true);
    try {
      await deactivateCode(token, deactivateTarget.id);
      toast.push("Code deactivated", "success");
      setDeactivateTarget(null);
      reload();
    } catch (err) {
      toast.push(adminErrorMessage(err, "Deactivate failed"), "error");
    } finally {
      setPending(false);
    }
  }

  const columns: DataTableColumn<DigitalCodeRow>[] = [
    { key: "masked", header: "Code", render: (r) => <span className="font-mono text-xs">{r.masked}</span> },
    {
      key: "variant",
      header: "Variant",
      render: (r) => (
        <div>
          <p className="font-mono text-xs">{r.variant_sku || "—"}</p>
          {r.variant_name ? <p className="text-[11px] text-[var(--clicks-muted)]">{r.variant_name}</p> : null}
        </div>
      ),
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
      render: (r) => (
        <Badge status={r.status || "AVAILABLE"}>{STATUSES.find((s) => s.value === r.status)?.label ?? r.status}</Badge>
      ),
    },
    { key: "source", header: "Source", render: (r) => <span className="text-xs">{r.source?.replaceAll("_", " ").toLowerCase() || "—"}</span> },
    { key: "created", header: "Added", render: (r) => <span className="text-xs">{formatAdminDateTime(r.created_at)}</span> },
    { key: "revealed", header: "Last revealed", render: (r) => <span className="text-xs">{formatAdminDateTime(r.revealed_at)}</span> },
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

  return (
    <div>
      <PageHeader
        title="Digital codes"
        description="Code inventory (always masked). Revealing a code is audit-logged."
        actions={
          canManage ? (
            <Link href="/admin/codes/import" className="admin-btn admin-btn-primary">
              Import codes
            </Link>
          ) : null
        }
      />
      <Filters
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Masked code, SKU or order number…"
        filters={[
          {
            key: "status",
            label: "Status",
            value: status,
            onChange: (v) => {
              setStatus(v);
              setPage(1);
            },
            options: STATUSES,
          },
          {
            key: "variant",
            label: "Variant",
            value: variant,
            onChange: (v) => {
              setVariant(v);
              setPage(1);
            },
            options: [
              { value: "", label: "All variants" },
              ...(variant && !(variants ?? []).some((v) => String(v.id) === variant)
                ? [{ value: variant, label: `Variant #${variant}` }]
                : []),
              ...(variants ?? []).map((v) => ({
                value: String(v.id),
                label: `${v.sku}${v.name_en ? ` — ${v.name_en}` : ""}`,
              })),
            ],
          },
        ]}
        onClear={() => {
          setSearch("");
          setStatus("");
          setVariant("");
        }}
      />
      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="No codes" description="No codes match these filters." />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={setPage} />

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
            ? `Code ${deactivateTarget.masked} will no longer be sold or delivered. Use this for invalid or duplicate codes. This cannot be undone from the panel.`
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
