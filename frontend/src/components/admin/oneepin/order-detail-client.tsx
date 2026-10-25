"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { AdminCard, AdminSectionHeader } from "@/components/admin/ui/card";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { checkSupplierOrder, getSupplierOrder } from "@/components/admin/oneepin/api";
import { describeFailure } from "@/components/admin/oneepin/errors";
import {
  catalogTypeLabel,
  durationText,
  jodText,
  logActionLabel,
  orderStatusCodeLabel,
  resultCodeMessage,
  supplierAmount,
  supplierStatusLabel,
} from "@/components/admin/oneepin/labels";
import { OneEpinTabs, ResultCode, SupplierStatusBadge } from "@/components/admin/oneepin/ui";
import { canCheckSupplierOrder } from "@/components/admin/oneepin/orders-client";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { Badge } from "@/components/admin/ui/badge";
import Link from "next/link";
import { useState } from "react";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-[13px]">
      <dt className="shrink-0 text-[var(--clicks-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-end text-[var(--clicks-text)]">{children}</dd>
    </div>
  );
}

export function OneEpinOrderDetailClient({ id }: { id: string }) {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canFulfill = can("orders.fulfill");
  const canLogs = can("suppliers.read");
  const [checking, setChecking] = useState(false);
  const { data: so, loading, error, reload, token } = useAdminQuery((tok) => getSupplierOrder(tok, id), [id]);

  async function check() {
    if (!token || !so) return;
    setChecking(true);
    try {
      const res = await checkSupplierOrder(token, so.id);
      toast.push(`Checked with 1Epin: ${supplierStatusLabel(res.supplier_order.status, res.supplier_order.status_label)}.`, "success");
      reload();
    } catch (err) {
      toast.push(describeFailure(err, "Could not check with 1Epin."), "error");
    } finally {
      setChecking(false);
    }
  }

  if (loading && !so) return <div className="admin-card h-48 animate-pulse" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!so) return <EmptyState title="1Epin order not found" />;

  const codeHelp = so.result_code && so.result_code !== "00" ? resultCodeMessage(so.result_code) : "";

  return (
    <div>
      <PageHeader
        title={`1Epin order ${so.external_order_number}`}
        description={`Attempt ${so.attempt} for ${so.order_number ? `order ${so.order_number}` : "an order"}. Created ${formatAdminDateTime(so.created_at)}.`}
        actions={
          <>
            {so.order_number ? (
              <Link href={`/admin/orders/${encodeURIComponent(so.order_number)}`} className="admin-btn admin-btn-secondary">
                Open our order
              </Link>
            ) : null}
            {canFulfill && canCheckSupplierOrder(so.status) ? (
              <button type="button" className="admin-btn admin-btn-primary" disabled={checking} onClick={() => void check()}>
                {checking ? "Checking…" : "Check now"}
              </button>
            ) : null}
          </>
        }
      />
      <OneEpinTabs />

      <div className="grid gap-3 lg:grid-cols-3">
        <AdminCard padding="md" className="lg:col-span-2">
          <AdminSectionHeader title="Status" />
          <SupplierStatusBadge status={so.status} label={so.status_label} withHelp />
          {so.message ? <p className="mt-2 text-[13px]">{so.message}</p> : null}
          {codeHelp ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
              1Epin code {so.result_code}: {codeHelp}
            </p>
          ) : null}
          <dl className="mt-3 divide-y divide-[var(--clicks-border)]">
            <Row label="Item">
              {so.item ? `${so.item.product_name}${so.item.variant_name ? ` – ${so.item.variant_name}` : ""} (qty ${so.item.quantity})` : `#${so.order_item_id}`}
            </Row>
            <Row label="1Epin product">
              {so.product_name} <span className="font-mono text-[11px] text-[var(--clicks-muted)]">ID {so.external_product_id}</span>
            </Row>
            <Row label="Type">{catalogTypeLabel(so.kind)}</Row>
            <Row label="Quantity at 1Epin">
              {so.quantity} (covers {so.units} of ours)
            </Row>
            {so.player_user ? <Row label="Player ID sent">{<span className="font-mono">{so.player_user}</span>}</Row> : null}
            <Row label="Accepted by 1Epin">{so.placed ? "Yes" : "No"}</Row>
            {so.order_status_code !== null ? <Row label="1Epin order state">{orderStatusCodeLabel(so.order_status_code)}</Row> : null}
            <Row label="Codes received / delivered">
              {so.pins_received} / {so.codes_delivered}
            </Row>
            <Row label="Mode">
              <Badge tone="neutral">{so.environment}</Badge>
            </Row>
          </dl>
        </AdminCard>

        <AdminCard padding="md">
          <AdminSectionHeader title="Money" />
          <dl className="divide-y divide-[var(--clicks-border)]">
            <Row label="Unit price">{supplierAmount(so.unit_price, so.currency)}</Row>
            <Row label="Total cost">{supplierAmount(so.cost, so.currency)}</Row>
            <Row label="Cost in JOD">{jodText(so.cost_jod)}</Row>
            <Row label="1Epin balance after">{supplierAmount(so.balance_after, so.currency)}</Row>
          </dl>
          <AdminSectionHeader title="Timeline" className="mt-4" />
          <dl className="divide-y divide-[var(--clicks-border)]">
            <Row label="Sent">{formatAdminDateTime(so.submitted_at)}</Row>
            <Row label="Last checked">{formatAdminDateTime(so.last_checked_at)}</Row>
            <Row label="Completed">{formatAdminDateTime(so.completed_at)}</Row>
            {so.retry_after ? <Row label="Retry after">{formatAdminDateTime(so.retry_after)}</Row> : null}
            <Row label="Sent / checked">
              {so.submit_count}× / {so.check_count}×
            </Row>
            {so.created_by ? <Row label="Started by">{so.created_by}</Row> : null}
          </dl>
        </AdminCard>
      </div>

      {so.attempts && so.attempts.length > 1 ? (
        <AdminCard padding="md" className="mt-3">
          <AdminSectionHeader title="All attempts for this item" description="A new attempt is only made after the previous one definitely failed." />
          <ul className="divide-y divide-[var(--clicks-border)] text-[13px]">
            {so.attempts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  #{a.attempt}{" "}
                  {a.id === so.id ? (
                    <span className="font-mono">{a.external_order_number}</span>
                  ) : (
                    <Link href={`/admin/integrations/1epin/orders/${a.id}`} className="font-mono text-[var(--clicks-blue)]">
                      {a.external_order_number}
                    </Link>
                  )}
                  <span className="ms-2 text-[12px] text-[var(--clicks-muted)]">{a.message}</span>
                </span>
                <span className="flex items-center gap-2">
                  <SupplierStatusBadge status={a.status} />
                  <span className="text-[11px] text-[var(--clicks-muted)]">{formatAdminDateTime(a.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </AdminCard>
      ) : null}

      <AdminCard padding="md" className="mt-3">
        <AdminSectionHeader
          title="Messages from 1Epin (callbacks)"
          description="1Epin tells us when the order finishes. We never trust these blindly — we always confirm with 1Epin first."
        />
        {so.callbacks?.length ? (
          <ul className="divide-y divide-[var(--clicks-border)] text-[13px]">
            {so.callbacks.map((c) => (
              <li key={c.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={c.processed ? "success" : "warning"} className="normal-case tracking-normal">
                    {c.processed ? "Confirmed and applied" : "Not applied"}
                  </Badge>
                  <span className="text-[11px] text-[var(--clicks-muted)]">{formatAdminDateTime(c.created_at)}</span>
                  {c.reason ? <span className="font-mono text-[11px] text-[var(--clicks-muted)]">{c.reason}</span> : null}
                </div>
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-[#F7F8FC] p-2 text-[11px]">{JSON.stringify(c.payload, null, 2)}</pre>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--clicks-muted)]">No callbacks received for this order.</p>
        )}
      </AdminCard>

      <AdminCard padding="md" className="mt-3">
        <AdminSectionHeader
          title="Calls to 1Epin"
          description="Each request we sent for this order and 1Epin's answer code."
          action={
            canLogs ? (
              <Link
                href={`/admin/integrations/1epin/logs?order_number=${encodeURIComponent(so.external_order_number)}`}
                className="text-[12px] font-semibold text-[var(--clicks-blue)]"
              >
                Open in logs
              </Link>
            ) : null
          }
        />
        {so.api_logs?.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead className="text-[11px] text-[var(--clicks-muted)]">
                <tr>
                  <th className="py-1.5 pe-3 text-start">When</th>
                  <th className="py-1.5 pe-3 text-start">Call</th>
                  <th className="py-1.5 pe-3 text-start">Result</th>
                  <th className="py-1.5 pe-3 text-start">Message</th>
                  <th className="py-1.5 text-start">Took</th>
                </tr>
              </thead>
              <tbody>
                {so.api_logs.map((l) => (
                  <tr key={l.id} className="border-t border-[var(--clicks-border)] align-top">
                    <td className="whitespace-nowrap py-1.5 pe-3">{formatAdminDateTime(l.created_at)}</td>
                    <td className="py-1.5 pe-3">{logActionLabel(l.action)}</td>
                    <td className="py-1.5 pe-3">
                      {l.result_code ? <ResultCode code={l.result_code} /> : <Badge tone={l.ok ? "success" : "warning"}>{l.ok ? "OK" : "Failed"}</Badge>}
                    </td>
                    <td className="py-1.5 pe-3 text-[12px] text-[var(--clicks-muted)]">{l.message || "—"}</td>
                    <td className="whitespace-nowrap py-1.5 tabular-nums">{durationText(l.duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--clicks-muted)]">No calls recorded.</p>
        )}
      </AdminCard>

      {so.request || so.response ? (
        <details className="admin-card mt-3 p-4 text-[12px]">
          <summary className="cursor-pointer font-semibold text-[var(--clicks-navy)]">Technical details (for your developer)</summary>
          <p className="mt-2 text-[var(--clicks-muted)]">Passwords are never stored; codes are masked.</p>
          <pre className="mt-2 max-h-60 overflow-auto rounded bg-[#F7F8FC] p-2">{JSON.stringify({ request: so.request, response: so.response }, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}
