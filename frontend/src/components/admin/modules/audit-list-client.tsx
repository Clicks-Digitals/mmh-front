"use client";

import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { listAuditRows, type AuditRow } from "@/components/admin/ops/api";
import { OpsTable } from "@/components/admin/ops/ops-table";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import {
  ACTION_GROUPS,
  ENTITY_TYPE_LABELS,
  auditActionLabel,
  auditEntityHref,
  auditEntityText,
  auditMetaRows,
  summarizeAuditMeta,
} from "@/components/admin/lib/audit";
import { localInputToIso } from "@/components/admin/lib/datetime";
import { roleLabel } from "@/components/admin/lib/roles";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Meta keys that hold role values → show labels instead of "ORDER_MANAGER" (RO-17). */
function readableMeta(meta: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (key.endsWith("_label")) continue;
    if (key === "role" && typeof value === "string") out[key] = (meta?.role_label as string) || roleLabel(value);
    else if (key === "role" && value && typeof value === "object" && "from" in value && "to" in value) {
      const change = value as { from?: string; to?: string; from_label?: string; to_label?: string };
      out[key] = { from: change.from_label || roleLabel(change.from), to: change.to_label || roleLabel(change.to) };
    } else out[key] = value;
  }
  return out;
}

function actorText(r: AuditRow): string {
  if (r.actor_name) return r.actor_name;
  if (r.actor_email) return r.actor_email;
  if (r.action === "codes.customer_reveal") return "Customer";
  if (r.action === "auth.login_failed") return typeof r.meta?.email === "string" ? `Someone using ${r.meta.email}` : "Unknown";
  return "System";
}

/** "2026-10-25" (date input) → start/end of that local day as ISO. */
function dayBoundary(day: string, end: boolean): string | undefined {
  if (!day) return undefined;
  return localInputToIso(`${day}T${end ? "23:59" : "00:00"}`) ?? undefined;
}

export function AuditListClient({
  initialSearch = "",
  initialEntityType = "",
  initialActionPrefix = "",
}: {
  initialSearch?: string;
  initialEntityType?: string;
  initialActionPrefix?: string;
}) {
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [entityType, setEntityType] = useState(initialEntityType);
  const [actionPrefix, setActionPrefix] = useState(initialActionPrefix);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const { data, loading, error, reload } = useAdminQuery(
    (tok) =>
      listAuditRows(tok, {
        page,
        page_size: ADMIN_LIST_PAGE_SIZE,
        search: search || undefined,
        entity_type: entityType || undefined,
        action_prefix: actionPrefix || undefined,
        date_from: dayBoundary(dateFrom, false),
        date_to: dayBoundary(dateTo, true),
      }),
    [page, search, entityType, actionPrefix, dateFrom, dateTo],
  );

  function reset<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Who did what and when: order changes, refunds, code reveals, sign-ins and settings. Search by order number, e-mail, code or name."
      />
      <Filters
        search={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Order number, e-mail, coupon, staff name…"
        filters={[
          {
            key: "group",
            label: "What happened",
            value: actionPrefix,
            onChange: reset(setActionPrefix),
            options: [{ value: "", label: "Everything" }, ...ACTION_GROUPS],
          },
          {
            key: "entity",
            label: "Affected item",
            value: entityType,
            onChange: reset(setEntityType),
            options: [
              { value: "", label: "Any item" },
              ...Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
        onClear={() => {
          setSearchInput("");
          setEntityType("");
          setActionPrefix("");
          setDateFrom("");
          setDateTo("");
          setPage(1);
        }}
      />
      <div className="-mt-2 mb-3 flex flex-wrap items-end gap-3 text-[12px]">
        <label className="flex flex-col gap-1 text-[var(--clicks-muted)]">
          From
          <input type="date" className="admin-input h-9 w-auto" value={dateFrom} onChange={(e) => reset(setDateFrom)(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[var(--clicks-muted)]">
          Until
          <input type="date" className="admin-input h-9 w-auto" value={dateTo} onChange={(e) => reset(setDateTo)(e.target.value)} />
        </label>
      </div>
      <OpsTable<AuditRow>
        rows={data?.results ?? []}
        loading={loading && !data}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="Nothing found" description="Try another search or a wider date range." />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
        columns={[
          {
            key: "action",
            header: "What happened",
            primary: true,
            render: (r) => <span className="font-medium text-[var(--clicks-navy)]">{auditActionLabel(r.action)}</span>,
          },
          {
            key: "entity",
            header: "Item",
            render: (r) => {
              if (!r.entity_type && !r.order_number) return "—";
              const href = auditEntityHref(r);
              const text = auditEntityText(r);
              return href ? (
                <Link href={href} className="break-words text-xs text-[var(--clicks-blue)]">
                  {text}
                </Link>
              ) : (
                <span className="break-words text-xs">{text}</span>
              );
            },
          },
          { key: "actor", header: "By", render: (r) => <span className="break-all text-xs">{actorText(r)}</span> },
          {
            key: "meta",
            header: "Details",
            render: (r) => {
              const summary = summarizeAuditMeta(readableMeta(r.meta));
              return summary ? (
                <button
                  type="button"
                  className="block w-full max-w-full whitespace-normal break-words text-start text-xs text-[var(--clicks-muted)] hover:text-[var(--clicks-blue)] md:max-w-[360px] md:truncate md:whitespace-nowrap"
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
          {
            key: "when",
            header: "When",
            className: "whitespace-nowrap",
            render: (r) => <span className="text-xs">{formatAdminDateTime(r.created_at)}</span>,
          },
        ]}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={data?.count ?? 0} onPageChange={setPage} />

      <AdminModal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? auditActionLabel(detail.action) : ""}
        description={detail ? `${actorText(detail)} · ${formatAdminDateTime(detail.created_at)}` : undefined}
        wide
      >
        {detail ? (
          <dl className="min-w-0 space-y-2 text-sm">
            <div className="grid min-w-0 gap-0.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3">
              <dt className="text-xs font-semibold text-[var(--clicks-muted)]">Item</dt>
              <dd className="min-w-0 break-words text-xs">{auditEntityText(detail)}</dd>
            </div>
            {auditMetaRows(readableMeta(detail.meta)).map((row) => (
              <div key={row.key} className="grid min-w-0 gap-0.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3">
                <dt className="text-xs font-semibold text-[var(--clicks-muted)]">{row.label}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </AdminModal>
    </div>
  );
}
