"use client";

import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { auditActionLabel, summarizeAuditMeta } from "@/components/admin/lib/audit";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminResource } from "@/hooks/use-admin-resource";
import { listAuditLogs, type AuditLog } from "@/lib/api/admin";
import { useState } from "react";

const ENTITY_TYPES = [
  "Order",
  "Product",
  "ProductVariant",
  "Category",
  "Platform",
  "Region",
  "DigitalCode",
  "Coupon",
  "User",
  "Role",
  "CustomerProfile",
  "Banner",
  "FAQ",
  "ContentPage",
  "SiteSettings",
  "Supplier",
  "SupplierProductMapping",
];

export function AuditListClient() {
  const [entityType, setEntityType] = useState("");
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const { page, setPage, search, setSearch, items, count, loading, error, reload } = useAdminResource<AuditLog>(
    async (token, p, s) => {
      const data = await listAuditLogs(token, {
        page: p,
        page_size: ADMIN_LIST_PAGE_SIZE,
        search: s || undefined,
        entity_type: entityType || undefined,
      });
      return { items: data.results, count: data.count };
    },
    [entityType],
  );

  return (
    <div>
      <PageHeader title="Audit log" description="Who changed what in the panel (and sensitive store events like code reveals)." />
      <Filters
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Action, entity id or admin e-mail…"
        filters={[
          {
            key: "entity",
            label: "Entity type",
            value: entityType,
            onChange: (v) => {
              setEntityType(v);
              setPage(1);
            },
            options: [{ value: "", label: "All entities" }, ...ENTITY_TYPES.map((t) => ({ value: t, label: t }))],
          },
        ]}
        onClear={() => {
          setSearch("");
          setEntityType("");
        }}
      />
      <DataTable
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="No audit events" />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
        columns={[
          {
            key: "action",
            header: "Action",
            render: (r) => (
              <div>
                <p className="font-medium text-[var(--clicks-navy)]">{auditActionLabel(r.action)}</p>
                <p className="font-mono text-[10px] text-[var(--clicks-muted)]">{r.action}</p>
              </div>
            ),
          },
          {
            key: "entity",
            header: "Entity",
            render: (r) => (r.entity_type ? <span className="text-xs">{`${r.entity_type} #${r.entity_id ?? ""}`}</span> : "—"),
          },
          { key: "actor", header: "By", render: (r) => <span className="text-xs">{r.actor_email || "System / customer"}</span> },
          {
            key: "meta",
            header: "Details",
            render: (r) => {
              const summary = summarizeAuditMeta(r.meta);
              return summary ? (
                <button
                  type="button"
                  className="max-w-[360px] truncate text-start text-xs text-[var(--clicks-muted)] hover:text-[var(--clicks-blue)]"
                  title="Show all details"
                  onClick={() => setDetail(r)}
                >
                  {summary}
                </button>
              ) : (
                "—"
              );
            },
          },
          { key: "when", header: "When", render: (r) => <span className="text-xs">{formatAdminDateTime(r.created_at)}</span> },
        ]}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={setPage} />

      <AdminModal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? auditActionLabel(detail.action) : ""}
        description={detail ? `${detail.actor_email || "System / customer"} · ${formatAdminDateTime(detail.created_at)}` : undefined}
        wide
      >
        {detail ? (
          <dl className="space-y-2 text-sm">
            {Object.entries(detail.meta ?? {}).map(([key, value]) => (
              <div key={key} className="grid gap-1 sm:grid-cols-[160px_1fr]">
                <dt className="text-xs font-semibold text-[var(--clicks-muted)]">{key.replaceAll("_", " ")}</dt>
                <dd className="break-all font-mono text-xs">
                  {typeof value === "object" && value !== null ? JSON.stringify(value, null, 1) : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </AdminModal>
    </div>
  );
}
