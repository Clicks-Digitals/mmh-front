"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { Badge } from "@/components/admin/ui/badge";
import { AdminCard, AdminSectionHeader } from "@/components/admin/ui/card";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { FormField, adminTextareaClass } from "@/components/admin/ui/form-field";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { listAlerts, resolveAlert, type SupplierAlert } from "@/components/admin/oneepin/api";
import { describeFailure } from "@/components/admin/oneepin/errors";
import { alertKindLabel, severityTone } from "@/components/admin/oneepin/labels";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import Link from "next/link";
import { useState } from "react";

const PAGE_SIZE = 10;

const ALERT_HELP: Record<string, string> = {
  low_balance: "Top up the 1Epin wallet, then refresh the balance. The alert closes by itself once the balance is fine.",
  config: "A setup problem (login or IP). Fix it using the checklist above, then test the connection.",
  order_failed: "Open the order and decide: retry with 1Epin, or deliver by hand.",
  price_change: "1Epin changed the price of a linked product. Check that your sale price still makes a profit.",
  duplicate_code: "1Epin sent a code we already have. It was not delivered twice — check the order and deliver by hand.",
};

export function AlertsPanel({
  className,
  reloadKey = 0,
  onChanged,
}: {
  className?: string;
  reloadKey?: number;
  onChanged?: (openCount: number) => void;
}) {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("suppliers.write");
  const [state, setState] = useState<"open" | "resolved">("open");
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<SupplierAlert | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  const { data, loading, error, reload, token } = useAdminQuery(
    (tok) => listAlerts(tok, { status: state, page, page_size: PAGE_SIZE }),
    [state, page, reloadKey],
  );
  const rows = data?.results ?? [];

  async function resolve() {
    if (!token || !target) return;
    setPending(true);
    try {
      await resolveAlert(token, target.id, note.trim());
      toast.push("Alert resolved", "success");
      setTarget(null);
      if (state === "open" && data) onChanged?.(Math.max(0, data.count - 1));
      reload();
    } catch (err) {
      toast.push(describeFailure(err, "Could not resolve the alert."), "error");
      reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminCard padding="md" className={className}>
      <div id="alerts" />
      <AdminSectionHeader
        title={state === "open" ? "Open alerts" : "Resolved alerts"}
        description="Problems with 1Epin that a person should look at."
        action={
          <div className="flex gap-1 text-[12px]">
            {(["open", "resolved"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setState(s);
                  setPage(1);
                }}
                className={`rounded-full px-2.5 py-1 font-medium ${state === s ? "bg-[var(--clicks-blue-soft)] text-[var(--clicks-navy)]" : "text-[var(--clicks-muted)]"}`}
              >
                {s === "open" ? "Open" : "Resolved"}
              </button>
            ))}
          </div>
        }
      />
      {error ? (
        <p className="text-[13px] text-[var(--clicks-error)]">
          {error}{" "}
          <button type="button" className="font-semibold underline" onClick={reload}>
            Try again
          </button>
        </p>
      ) : loading && !data ? (
        <div className="h-16 animate-pulse rounded-lg bg-[#F3F5F9]" />
      ) : !rows.length ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
          {state === "open" ? "No open alerts — nothing needs attention." : "No resolved alerts yet."}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--clicks-border)]">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={severityTone(a.severity)} className="normal-case tracking-normal">
                    {alertKindLabel(a.kind, a.kind_label)}
                  </Badge>
                  {a.occurrences > 1 ? <span className="text-[11px] text-[var(--clicks-muted)]">×{a.occurrences}</span> : null}
                  <span className="text-[11px] text-[var(--clicks-muted)]">{formatAdminDateTime(a.updated_at)}</span>
                </div>
                <p className="mt-1 text-[var(--clicks-text)]">{a.message}</p>
                {!a.resolved && ALERT_HELP[a.kind] ? (
                  <p className="mt-0.5 text-[12px] text-[var(--clicks-muted)]">{ALERT_HELP[a.kind]}</p>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-3 text-[12px]">
                  {a.order_number ? (
                    <Link href={`/admin/orders/${encodeURIComponent(a.order_number)}`} className="font-semibold text-[var(--clicks-blue)]">
                      Order {a.order_number}
                    </Link>
                  ) : null}
                  {a.supplier_order_id ? (
                    <Link href={`/admin/integrations/1epin/orders/${a.supplier_order_id}`} className="font-semibold text-[var(--clicks-blue)]">
                      1Epin order details
                    </Link>
                  ) : null}
                </div>
                {a.resolved ? (
                  <p className="mt-1 text-[12px] text-[var(--clicks-muted)]">
                    Resolved {formatAdminDateTime(a.resolved_at)}
                    {a.resolved_by ? ` by ${a.resolved_by}` : " automatically"}
                    {a.resolution_note ? ` — “${a.resolution_note}”` : ""}
                  </p>
                ) : null}
              </div>
              {!a.resolved && canWrite ? (
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary h-8 text-xs"
                  onClick={() => {
                    setNote("");
                    setTarget(a);
                  }}
                >
                  Resolve
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.count ?? 0} onPageChange={setPage} />

      <ConfirmDialog
        open={Boolean(target)}
        title="Resolve this alert?"
        description="Mark it as handled. Add a short note so colleagues know what was done."
        confirmLabel="Resolve"
        pending={pending}
        onCancel={() => setTarget(null)}
        onConfirm={() => void resolve()}
      >
        <FormField label="Note" htmlFor="alert-note" optional hint="For example: “Topped up 200 USD”.">
          <textarea
            id="alert-note"
            className={adminTextareaClass}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>
      </ConfirmDialog>
    </AdminCard>
  );
}
