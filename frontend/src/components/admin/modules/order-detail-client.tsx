"use client";

import { Badge } from "@/components/admin/ui/badge";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { getOrder, transitionOrder } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import { formatFils } from "@/server/money";
import Link from "next/link";
import { useState } from "react";

const PAYMENT_NEXT: Record<string, string[]> = {
  PENDING: ["PAID", "FAILED", "CANCELLED", "AUTHORIZED"],
  AUTHORIZED: ["PAID", "FAILED", "CANCELLED"],
  PAID: ["REFUNDED", "PARTIALLY_REFUNDED"],
};

const FULFILLMENT_NEXT: Record<string, string[]> = {
  NOT_STARTED: ["QUEUED", "CANCELLED"],
  QUEUED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED", "MANUAL_REVIEW", "CANCELLED"],
  MANUAL_REVIEW: ["PROCESSING", "COMPLETED", "FAILED", "CANCELLED"],
  FAILED: ["QUEUED", "MANUAL_REVIEW", "CANCELLED"],
};

export function OrderDetailClient({ id }: { id: string }) {
  const toast = useAdminToast();
  const [pending, setPending] = useState(false);
  const [partialJod, setPartialJod] = useState("");
  const { data: order, setData: setOrder, loading, error, reload, token } = useAdminQuery(
    (tok) => getOrder(tok, id),
    [id],
  );

  async function doTransition(body: { payment_status?: string; fulfillment_status?: string; refund_amount_fils?: number }) {
    if (!token || !order) return;
    setPending(true);
    try {
      const next = await transitionOrder(token, order.id, body);
      setOrder(next);
      toast.push("Order updated", "success");
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Transition failed", "error");
    } finally {
      setPending(false);
    }
  }

  if (loading) return <div className="admin-card h-48 animate-pulse" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!order) return <EmptyState title="Order not found" />;

  const paymentOptions = PAYMENT_NEXT[order.payment_status] ?? [];
  const fulfillmentOptions = FULFILLMENT_NEXT[order.fulfillment_status] ?? [];

  return (
    <div>
      <PageHeader
        title={`Order ${order.order_number}`}
        description={formatAdminDateTime(order.created_at)}
        actions={
          <Link href="/admin/orders" className="text-sm font-medium text-[var(--clicks-blue)]">
            Back to orders
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="admin-card p-4">
            <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Line items</h2>
            {order.items?.length ? (
              <ul className="mt-3 divide-y divide-[var(--clicks-border)]">
                {order.items.map((item) => (
                  <li key={String(item.id)} className="py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{item.product_name || item.variant_name || "Item"}</p>
                        <p className="text-xs text-[var(--clicks-muted)]">
                          Qty {item.quantity}
                          {item.platform_name ? ` · ${item.platform_name}` : ""}
                          {item.region_name ? ` · ${item.region_name}` : ""}
                        </p>
                      </div>
                      <p className="tabular-nums">
                        {formatFils(item.line_total_fils ?? item.unit_price_fils * item.quantity)} JOD
                      </p>
                    </div>
                    {item.codes?.length ? (
                      <ul className="mt-2 space-y-1 rounded-lg bg-[var(--clicks-bg)] px-3 py-2 font-mono text-xs">
                        {item.codes.map((c) => (
                          <li key={String(c.id)} className="flex justify-between gap-2">
                            <span>{c.masked}</span>
                            <Badge status={c.status || "AVAILABLE"} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--clicks-muted)]">No line items returned.</p>
            )}
          </div>

          {order.payments?.length ? (
            <div className="admin-card p-4">
              <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Payments</h2>
              <ul className="mt-3 divide-y divide-[var(--clicks-border)] text-sm">
                {order.payments.map((p) => (
                  <li key={String(p.id)} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">{p.provider}</p>
                      <p className="text-xs text-[var(--clicks-muted)]">{p.external_ref || "—"}</p>
                      {p.provider_order_id ? (
                        <p className="text-xs text-[var(--clicks-muted)]">Order {p.provider_order_id}</p>
                      ) : null}
                      {p.provider_capture_id ? (
                        <p className="text-xs text-[var(--clicks-muted)]">Capture {p.provider_capture_id}</p>
                      ) : null}
                      {p.provider_amount ? (
                        <p className="text-xs text-[var(--clicks-muted)]">
                          Charged {p.provider_amount} {p.currency || ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-end">
                      <p className="tabular-nums">{formatFils(p.amount_fils)} JOD</p>
                      <Badge status={p.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="admin-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Total</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatFils(order.total_fils)} JOD</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge status={order.payment_status} />
              <Badge status={order.fulfillment_status} />
            </div>
            {order.subtotal_fils != null ? (
              <dl className="mt-4 space-y-1 text-xs text-[var(--clicks-muted)]">
                <div className="flex justify-between">
                  <dt>Subtotal</dt>
                  <dd className="tabular-nums">{formatFils(order.subtotal_fils)} JOD</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Discount</dt>
                  <dd className="tabular-nums">{formatFils(order.discount_fils ?? 0)} JOD</dd>
                </div>
              </dl>
            ) : null}
          </div>

          <div className="admin-card p-4 text-sm">
            <p className="font-semibold text-[var(--clicks-navy)]">Customer</p>
            <p className="mt-2">{order.full_name || "—"}</p>
            <p className="text-[var(--clicks-muted)]">{order.email || "—"}</p>
            {order.phone ? <p className="text-[var(--clicks-muted)]">{order.phone}</p> : null}
          </div>

          <div className="admin-card p-4">
            <p className="text-sm font-semibold text-[var(--clicks-navy)]">Payment transitions</p>
            {order.payments?.some((payment) => payment.provider === "paypal" && payment.status === "PAID") ? (
              <label className="mt-3 block text-xs text-[var(--clicks-muted)]">
                Partial refund (JOD)
                <input
                  value={partialJod}
                  onChange={(event) => setPartialJod(event.target.value)}
                  inputMode="decimal"
                  className="mt-1 h-9 w-full rounded-md border border-[var(--clicks-border)] px-2 text-sm"
                />
              </label>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {paymentOptions.length ? (
                paymentOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const paypalPaid = order.payments?.some(
                        (payment) => payment.provider === "paypal" && (payment.status === "PAID" || payment.status === "PARTIALLY_REFUNDED"),
                      );
                      if (status === "PARTIALLY_REFUNDED" && paypalPaid) {
                        const fils = Math.round(Number(partialJod) * 1000);
                        if (!Number.isFinite(fils) || fils <= 0) {
                          toast.push("Enter a partial refund amount in JOD", "error");
                          return;
                        }
                        void doTransition({ payment_status: status, refund_amount_fils: fils });
                        return;
                      }
                      void doTransition({ payment_status: status });
                    }}
                    className="admin-btn admin-btn-secondary h-8 text-xs disabled:opacity-60"
                  >
                    → {status === "REFUNDED" && order.payments?.some((payment) => payment.provider === "paypal")
                      ? "Refund PayPal"
                      : status.replaceAll("_", " ")}
                  </button>
                ))
              ) : (
                <p className="text-xs text-[var(--clicks-muted)]">No payment transitions available.</p>
              )}
            </div>
            <p className="mt-4 text-sm font-semibold text-[var(--clicks-navy)]">Fulfillment transitions</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {fulfillmentOptions.length ? (
                fulfillmentOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={pending}
                    onClick={() => void doTransition({ fulfillment_status: status })}
                    className="admin-btn admin-btn-secondary h-8 text-xs disabled:opacity-60"
                  >
                    → {status.replaceAll("_", " ")}
                  </button>
                ))
              ) : (
                <p className="text-xs text-[var(--clicks-muted)]">No fulfillment transitions available.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
