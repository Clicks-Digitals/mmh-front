"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { RevealCodeDialog } from "@/components/admin/modules/reveal-code-dialog";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, errorCode } from "@/components/admin/lib/errors";
import { jodInputToFils } from "@/components/admin/lib/money";
import {
  fulfillmentStatusLabel,
  paymentStatusLabel,
  transitionIsDanger,
  transitionLabel,
  transitionNeedsConfirm,
  transitionReasonRequired,
  type TransitionKind,
} from "@/components/admin/lib/orders";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import {
  attachOrderItemCode,
  fulfillOrder,
  getOrder,
  markOrderItemDelivered,
  resendOrderEmail,
  transitionOrder,
  type AdminOrder,
  type AdminOrderCode,
  type AdminOrderItem,
} from "@/lib/api/admin";
import { formatFils } from "@/server/money";
import Link from "next/link";
import { useState } from "react";

type TransitionDraft = { kind: TransitionKind; target: string; reason: string; amount: string };

function CustomerFields({ fields }: { fields: AdminOrderItem["customer_fields"] }) {
  const entries = Object.entries(fields ?? {}).filter(([, v]) => v !== "" && v != null);
  if (!entries.length) return null;
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-lg bg-[#F7F8FC] px-3 py-2 text-xs sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <dt className="text-[var(--clicks-muted)]">{key.replaceAll("_", " ")}:</dt>
          <dd className="break-all font-mono font-medium text-[var(--clicks-navy)]">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OrderDetailClient({ id }: { id: string }) {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("orders.write");
  const canFulfill = can("orders.fulfill");
  const canReveal = can("codes.reveal");

  const [pending, setPending] = useState(false);
  const [transition, setTransition] = useState<TransitionDraft | null>(null);
  const [attachItem, setAttachItem] = useState<AdminOrderItem | null>(null);
  const [attachForm, setAttachForm] = useState({ code: "", pin: "" });
  const [deliverItem, setDeliverItem] = useState<AdminOrderItem | null>(null);
  const [deliverNote, setDeliverNote] = useState("");
  const [confirmFulfill, setConfirmFulfill] = useState(false);
  const [confirmResend, setConfirmResend] = useState(false);
  const [revealTarget, setRevealTarget] = useState<AdminOrderCode | null>(null);

  const { data: order, setData: setOrder, loading, error, reload, token } = useAdminQuery(
    (tok) => getOrder(tok, id),
    [id],
  );

  async function run(action: (tok: string, o: AdminOrder) => Promise<AdminOrder | void>, success: string) {
    if (!token || !order) return false;
    setPending(true);
    try {
      const next = await action(token, order);
      if (next) setOrder(next);
      toast.push(success, "success");
      return true;
    } catch (err) {
      const code = errorCode(err);
      if (code === "refund_first") {
        toast.push(`${adminErrorMessage(err)} Use a refund transition, then cancel.`, "error");
      } else {
        toast.push(adminErrorMessage(err, "Action failed"), "error");
      }
      return false;
    } finally {
      setPending(false);
    }
  }

  if (loading) return <div className="admin-card h-48 animate-pulse" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!order) return <EmptyState title="Order not found" />;

  const items = order.items ?? [];
  const hasPaypal = Boolean(order.payments?.some((p) => p.provider === "paypal"));
  const paypalRefundable = Boolean(
    order.payments?.some((p) => p.provider === "paypal" && (p.status === "PAID" || p.status === "PARTIALLY_REFUNDED")),
  );
  const isPaid = order.payment_status === "PAID";
  const undeliveredCodeItems = items.filter((i) => i.fulfillment_type === "CODE" && !i.delivered);
  const paymentOptions = order.allowed_payment_transitions ?? [];
  const fulfillmentOptions = order.allowed_fulfillment_transitions ?? [];

  function openTransition(kind: TransitionKind, target: string) {
    const draft = { kind, target, reason: "", amount: "" };
    if (!transitionNeedsConfirm(kind, target) && !transitionReasonRequired(kind, target)) {
      void submitTransition(draft);
      return;
    }
    setTransition(draft);
  }

  async function submitTransition(draft: TransitionDraft) {
    const body: Parameters<typeof transitionOrder>[2] = {};
    if (draft.kind === "payment") body.payment_status = draft.target;
    else body.fulfillment_status = draft.target;
    if (draft.reason.trim()) body.reason = draft.reason.trim();
    if (draft.kind === "payment" && draft.target === "PARTIALLY_REFUNDED") {
      const fils = jodInputToFils(draft.amount);
      if (fils != null) {
        if (Number.isNaN(fils) || fils <= 0) {
          toast.push("Enter a valid refund amount in JOD", "error");
          return;
        }
        body.refund_amount_fils = fils;
      }
    }
    const ok = await run(
      (tok, o) => transitionOrder(tok, o.id, body),
      `${transitionLabel(draft.kind, draft.target, { currentPayment: order?.payment_status, hasPaypal })} — done`,
    );
    if (ok) setTransition(null);
  }

  const partialAmountFils = transition ? jodInputToFils(transition.amount) : null;
  const transitionInvalid = Boolean(
    transition &&
      ((transitionReasonRequired(transition.kind, transition.target) && !transition.reason.trim()) ||
        (transition.target === "PARTIALLY_REFUNDED" &&
          paypalRefundable &&
          (partialAmountFils == null || Number.isNaN(partialAmountFils) || partialAmountFils <= 0)) ||
        (partialAmountFils != null && Number.isNaN(partialAmountFils))),
  );

  function transitionDescription(t: TransitionDraft): string {
    if (t.kind === "payment") {
      switch (t.target) {
        case "PAID":
          return "Use only when payment was received outside the website (e.g. bank transfer). Paying triggers stock allocation and the customer e-mail.";
        case "REFUNDED":
          return paypalRefundable
            ? "This sends a refund through PayPal for the remaining captured amount. Delivered codes are not recovered automatically."
            : "Marks the order refunded. Return the money to the customer through the original channel.";
        case "PARTIALLY_REFUNDED":
          return paypalRefundable
            ? "Sends a partial PayPal refund for the amount below."
            : "Marks the order partially refunded. Return the money through the original channel.";
        case "CANCELLED":
          return "Cancels the order. Paid orders must be refunded first.";
        default:
          return `Change payment status to ${paymentStatusLabel(t.target)}.`;
      }
    }
    if (t.target === "COMPLETED") return "Marks the whole order delivered. Make sure every item reached the customer.";
    if (t.target === "CANCELLED") return "Cancels fulfillment. Paid orders must be refunded first.";
    return `Change fulfillment status to ${fulfillmentStatusLabel(t.target)}.`;
  }

  return (
    <div>
      <PageHeader
        title={`Order ${order.order_number}`}
        description={`Placed ${formatAdminDateTime(order.created_at)}${
          order.updated_at ? ` · updated ${formatAdminDateTime(order.updated_at)}` : ""
        }`}
        actions={
          <>
            {canFulfill && isPaid && undeliveredCodeItems.length ? (
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                disabled={pending}
                onClick={() => setConfirmFulfill(true)}
              >
                Deliver from stock
              </button>
            ) : null}
            {canFulfill && isPaid ? (
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={pending}
                onClick={() => setConfirmResend(true)}
              >
                Resend email
              </button>
            ) : null}
            <Link href="/admin/orders" className="text-sm font-medium text-[var(--clicks-blue)]">
              Back to orders
            </Link>
          </>
        }
      />

      {order.fulfillment_status === "MANUAL_REVIEW" ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          This order needs manual review — usually not enough codes in stock or a supplier problem. Import codes and
          use “Deliver from stock”, attach codes by hand, or mark top-ups delivered.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="admin-card p-4">
            <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Items</h2>
            {items.length ? (
              <ul className="mt-3 divide-y divide-[var(--clicks-border)]">
                {items.map((item) => {
                  const isCode = item.fulfillment_type === "CODE";
                  const liveCodes = (item.codes ?? []).filter((c) => c.status !== "UNAVAILABLE").length;
                  return (
                    <li key={String(item.id)} className="py-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-[var(--clicks-navy)]">
                            {item.product_name || "Item"}
                            {item.variant_name ? (
                              <span className="font-normal text-[var(--clicks-muted)]"> · {item.variant_name}</span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--clicks-muted)]">
                            Qty {item.quantity} × {formatFils(item.unit_price_fils)} JOD
                            {item.platform_name ? ` · ${item.platform_name}` : ""}
                            {item.region_name ? ` · ${item.region_name}` : ""}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <Badge tone="info">{isCode ? "Code" : "Direct top-up"}</Badge>
                            {item.delivered ? (
                              <Badge tone="success">
                                Delivered{item.delivered_at ? ` ${formatAdminDateTime(item.delivered_at)}` : ""}
                              </Badge>
                            ) : (
                              <Badge tone="warning">Not delivered</Badge>
                            )}
                            {isCode ? (
                              <span className="text-[11px] text-[var(--clicks-muted)]">
                                {liveCodes}/{item.quantity} codes
                                {item.available_codes_for_variant != null
                                  ? ` · ${item.available_codes_for_variant} in stock for this variant`
                                  : ""}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-end">
                          <p className="tabular-nums font-medium">
                            {formatFils(item.line_total_fils ?? item.unit_price_fils * item.quantity)} JOD
                          </p>
                          {canFulfill && isPaid && !item.delivered ? (
                            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                              {isCode ? (
                                <button
                                  type="button"
                                  className="admin-btn admin-btn-secondary h-8 text-xs"
                                  onClick={() => {
                                    setAttachForm({ code: "", pin: "" });
                                    setAttachItem(item);
                                  }}
                                >
                                  Attach code
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="admin-btn admin-btn-secondary h-8 text-xs"
                                  onClick={() => {
                                    setDeliverNote("");
                                    setDeliverItem(item);
                                  }}
                                >
                                  Mark delivered
                                </button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <CustomerFields fields={item.customer_fields} />

                      {item.delivery_method || item.delivery_contact ? (
                        <p className="mt-2 text-xs text-[var(--clicks-muted)]">
                          Delivery:{" "}
                          <span className="font-medium text-[var(--clicks-text)]">
                            {item.delivery_method === "email"
                              ? "By e-mail"
                              : item.delivery_method === "account"
                                ? "In account"
                                : item.delivery_method || "—"}
                          </span>
                          {item.delivery_contact ? ` · ${item.delivery_contact}` : ""}
                        </p>
                      ) : null}
                      {item.delivery_note ? (
                        <p className="mt-1 text-xs text-[var(--clicks-muted)]">
                          Delivery note: <span className="text-[var(--clicks-text)]">{item.delivery_note}</span>
                        </p>
                      ) : null}

                      {item.codes?.length ? (
                        <ul className="mt-2 space-y-1 rounded-lg bg-[var(--clicks-bg)] px-3 py-2 text-xs">
                          {item.codes.map((c) => (
                            <li key={String(c.id)} className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-mono">{c.masked}</span>
                              <span className="flex flex-wrap items-center gap-2">
                                {c.source ? (
                                  <span className="text-[11px] text-[var(--clicks-muted)]">
                                    {c.source.replaceAll("_", " ").toLowerCase()}
                                  </span>
                                ) : null}
                                {c.delivered_at ? (
                                  <span className="text-[11px] text-[var(--clicks-muted)]">
                                    {formatAdminDateTime(c.delivered_at)}
                                  </span>
                                ) : null}
                                <Badge status={c.status || "AVAILABLE"} />
                                {canReveal ? (
                                  <button
                                    type="button"
                                    className="text-[11px] font-semibold text-[var(--clicks-blue)]"
                                    onClick={() => setRevealTarget(c)}
                                  >
                                    Reveal
                                  </button>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--clicks-muted)]">No line items.</p>
            )}
          </div>

          <div className="admin-card p-4">
            <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Payments</h2>
            {order.payments?.length ? (
              <ul className="mt-3 divide-y divide-[var(--clicks-border)] text-sm">
                {order.payments.map((p) => (
                  <li key={String(p.id)} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0 text-xs text-[var(--clicks-muted)]">
                      <p className="text-sm font-medium capitalize text-[var(--clicks-navy)]">{p.provider || "manual"}</p>
                      {p.external_ref ? <p>Ref {p.external_ref}</p> : null}
                      {p.provider_order_id ? <p>Provider order {p.provider_order_id}</p> : null}
                      {p.provider_capture_id ? <p>Capture {p.provider_capture_id}</p> : null}
                      {p.provider_amount ? (
                        <p>
                          Charged {p.provider_amount} {p.currency || ""}
                        </p>
                      ) : null}
                      <p>
                        Created {formatAdminDateTime(p.created_at)}
                        {p.paid_at ? ` · paid ${formatAdminDateTime(p.paid_at)}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="tabular-nums">{formatFils(p.amount_fils)} JOD</p>
                      <Badge status={p.status}>{paymentStatusLabel(p.status)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[var(--clicks-muted)]">No payment records.</p>
            )}
          </div>

          {order.refunds?.length ? (
            <div className="admin-card p-4">
              <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Refunds</h2>
              <ul className="mt-3 divide-y divide-[var(--clicks-border)] text-sm">
                {order.refunds.map((r, idx) => (
                  <li key={`${r.payment_id}-${r.id || idx}`} className="flex items-center justify-between gap-3 py-2">
                    <div className="text-xs text-[var(--clicks-muted)]">
                      <p className="text-sm font-medium capitalize text-[var(--clicks-navy)]">{r.provider}</p>
                      {r.id ? <p>Refund {r.id}</p> : null}
                    </div>
                    <div className="text-end">
                      <p className="tabular-nums">
                        {r.amount} {r.currency}
                      </p>
                      {r.status ? <Badge status={r.status} /> : null}
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
              <Badge status={order.payment_status}>{paymentStatusLabel(order.payment_status)}</Badge>
              <Badge status={order.fulfillment_status}>{fulfillmentStatusLabel(order.fulfillment_status)}</Badge>
            </div>
            <dl className="mt-4 space-y-1 text-xs text-[var(--clicks-muted)]">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{formatFils(order.subtotal_fils ?? order.total_fils)} JOD</dd>
              </div>
              <div className="flex justify-between">
                <dt>Discount{order.coupon_code ? ` (${order.coupon_code})` : ""}</dt>
                <dd className="tabular-nums">−{formatFils(order.discount_fils ?? 0)} JOD</dd>
              </div>
            </dl>
          </div>

          <div className="admin-card space-y-1 p-4 text-sm">
            <p className="font-semibold text-[var(--clicks-navy)]">Customer</p>
            <p>{order.full_name || "—"}</p>
            <p className="break-all text-[var(--clicks-muted)]">{order.email || "—"}</p>
            {order.phone ? <p className="text-[var(--clicks-muted)]">{order.phone}</p> : null}
            <p className="text-xs text-[var(--clicks-muted)]">{order.user ? "Registered account" : "Guest checkout"}</p>
            <div className="pt-2 text-xs text-[var(--clicks-muted)]">
              <p>Region confirmed: {order.region_confirmed ? "yes" : "no"}</p>
              <p>Refund policy accepted: {order.refund_confirmed ? "yes" : "no"}</p>
            </div>
            {order.notes ? (
              <div className="pt-2">
                <p className="text-xs font-semibold text-[var(--clicks-navy)]">Order notes</p>
                <p className="whitespace-pre-wrap text-xs">{order.notes}</p>
              </div>
            ) : null}
          </div>

          {canWrite ? (
            <div className="admin-card p-4">
              <p className="text-sm font-semibold text-[var(--clicks-navy)]">Payment status</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {paymentOptions.length ? (
                  paymentOptions.map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={pending}
                      onClick={() => openTransition("payment", status)}
                      className={`admin-btn h-8 text-xs disabled:opacity-60 ${
                        transitionIsDanger(status) ? "admin-btn-danger" : "admin-btn-secondary"
                      }`}
                    >
                      {transitionLabel("payment", status, { currentPayment: order.payment_status, hasPaypal })}
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-[var(--clicks-muted)]">No payment changes possible from this status.</p>
                )}
              </div>
              <p className="mt-4 text-sm font-semibold text-[var(--clicks-navy)]">Fulfillment status</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {fulfillmentOptions.length ? (
                  fulfillmentOptions.map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={pending}
                      onClick={() => openTransition("fulfillment", status)}
                      className={`admin-btn h-8 text-xs disabled:opacity-60 ${
                        transitionIsDanger(status) ? "admin-btn-danger" : "admin-btn-secondary"
                      }`}
                    >
                      {transitionLabel("fulfillment", status)}
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-[var(--clicks-muted)]">No fulfillment changes possible from this status.</p>
                )}
              </div>
              {order.can_cancel === false && isPaid ? (
                <p className="mt-3 text-[11px] text-[var(--clicks-muted)]">
                  Paid orders can only be cancelled after a refund.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(transition)}
        title={
          transition
            ? `${transitionLabel(transition.kind, transition.target, { currentPayment: order.payment_status, hasPaypal })}?`
            : ""
        }
        description={transition ? transitionDescription(transition) : undefined}
        danger={transition ? transitionIsDanger(transition.target) : false}
        confirmLabel="Confirm"
        pending={pending}
        confirmDisabled={transitionInvalid}
        onCancel={() => setTransition(null)}
        onConfirm={() => transition && void submitTransition(transition)}
      >
        {transition && transition.target === "PARTIALLY_REFUNDED" ? (
          <FormField
            label="Refund amount (JOD)"
            htmlFor="refund-amount"
            required={paypalRefundable}
            hint={`Order total ${formatFils(order.total_fils)} JOD. Sent to PayPal as fils (1 JOD = 1000 fils).`}
          >
            <input
              id="refund-amount"
              inputMode="decimal"
              className={adminInputClass}
              value={transition.amount}
              onChange={(e) => setTransition((t) => (t ? { ...t, amount: e.target.value } : t))}
            />
          </FormField>
        ) : null}
        {transition ? (
          <FormField
            label="Reason"
            htmlFor="transition-reason"
            required={transitionReasonRequired(transition.kind, transition.target)}
            hint="Saved in the audit log."
          >
            <textarea
              id="transition-reason"
              className={adminTextareaClass}
              value={transition.reason}
              maxLength={500}
              onChange={(e) => setTransition((t) => (t ? { ...t, reason: e.target.value } : t))}
            />
          </FormField>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(attachItem)}
        title="Attach code"
        description={
          attachItem
            ? `Delivers this code to the customer for “${attachItem.product_name}${
                attachItem.variant_name ? ` · ${attachItem.variant_name}` : ""
              }”. Double-check it — the customer can see it immediately.`
            : undefined
        }
        confirmLabel="Attach & deliver"
        pending={pending}
        confirmDisabled={!attachForm.code.trim()}
        onCancel={() => setAttachItem(null)}
        onConfirm={() =>
          void (async () => {
            if (!attachItem) return;
            const ok = await run(
              (tok, o) =>
                attachOrderItemCode(tok, o.id, attachItem.id, {
                  code: attachForm.code.trim(),
                  ...(attachForm.pin.trim() ? { pin: attachForm.pin.trim() } : {}),
                }),
              "Code attached",
            );
            if (ok) setAttachItem(null);
          })()
        }
      >
        <FormField label="Code" htmlFor="attach-code" required>
          <input
            id="attach-code"
            autoComplete="off"
            className={`${adminInputClass} font-mono`}
            value={attachForm.code}
            onChange={(e) => setAttachForm((f) => ({ ...f, code: e.target.value }))}
          />
        </FormField>
        <FormField label="PIN" htmlFor="attach-pin" hint="Only if the card has a separate PIN / serial.">
          <input
            id="attach-pin"
            autoComplete="off"
            className={`${adminInputClass} font-mono`}
            value={attachForm.pin}
            onChange={(e) => setAttachForm((f) => ({ ...f, pin: e.target.value }))}
          />
        </FormField>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deliverItem)}
        title="Mark top-up delivered?"
        description="Confirm the top-up was credited to the customer's account. The customer receives a delivery e-mail."
        confirmLabel="Mark delivered"
        pending={pending}
        onCancel={() => setDeliverItem(null)}
        onConfirm={() =>
          void (async () => {
            if (!deliverItem) return;
            const ok = await run(
              (tok, o) => markOrderItemDelivered(tok, o.id, deliverItem.id, { note: deliverNote.trim() }),
              "Item marked delivered",
            );
            if (ok) setDeliverItem(null);
          })()
        }
      >
        <FormField
          label="Delivery note"
          htmlFor="deliver-note"
          hint="Optional — e.g. supplier transaction id. Shown to staff only."
        >
          <textarea
            id="deliver-note"
            className={adminTextareaClass}
            value={deliverNote}
            maxLength={2000}
            onChange={(e) => setDeliverNote(e.target.value)}
          />
        </FormField>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmFulfill}
        title="Deliver from stock?"
        description="Assigns available codes from inventory to the undelivered code items and e-mails the customer. Items without enough stock stay in manual review."
        confirmLabel="Deliver"
        pending={pending}
        onCancel={() => setConfirmFulfill(false)}
        onConfirm={() =>
          void (async () => {
            const ok = await run((tok, o) => fulfillOrder(tok, o.id), "Fulfillment ran");
            if (ok) setConfirmFulfill(false);
          })()
        }
      />

      <ConfirmDialog
        open={confirmResend}
        title="Resend delivery e-mail?"
        description={`Sends the delivery e-mail(s) again to ${order.email}.`}
        confirmLabel="Resend"
        pending={pending}
        onCancel={() => setConfirmResend(false)}
        onConfirm={() =>
          void (async () => {
            if (!token) return;
            setPending(true);
            try {
              const res = await resendOrderEmail(token, order.id);
              toast.push(res.detail || `E-mail sent to ${res.to}`, "success");
              setConfirmResend(false);
            } catch (err) {
              toast.push(adminErrorMessage(err, "E-mail failed"), "error");
            } finally {
              setPending(false);
            }
          })()
        }
      />

      <RevealCodeDialog
        target={revealTarget ? { id: revealTarget.id, masked: revealTarget.masked } : null}
        onClose={() => setRevealTarget(null)}
      />
    </div>
  );
}
