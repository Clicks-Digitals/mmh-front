"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { RevealCodeDialog } from "@/components/admin/modules/reveal-code-dialog";
import { OneEpinItemBlock, itemSupplierOrder } from "@/components/admin/oneepin/order-item-block";
import { ActionButton, MoreMenu, Notice } from "@/components/admin/ops/controls";
import {
  attachItemCode,
  cancelOrder,
  fulfillOrderFromStock,
  getOrderDetail,
  getOrderHistory,
  markItemDelivered,
  refundOrder,
  resendDeliveryEmail,
  saveStaffNotes,
  transitionOrderStatus,
  updateItemCustomerFields,
  type OrderAction,
  type OrderDetail,
  type OrderDetailItem,
  type OrderHistoryEntry,
  type OrderItemCode,
} from "@/components/admin/ops/api";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import {
  auditActionLabel,
  auditMetaKeyLabel,
  formatAuditValue,
  isInternalMetaKey,
  summarizeAuditMeta,
} from "@/components/admin/lib/audit";
import { adminErrorSummary, errorCode } from "@/components/admin/lib/errors";
import { formatJod, formatJodDiscount, jodInputToFils } from "@/components/admin/lib/money";
import {
  actionHint,
  codeStatusText,
  codeStatusTone,
  customerStatusLabel,
  deliveryMethodLabel,
  fulfillmentButtons,
  fulfillmentStatusLabel,
  isPaidLike,
  isOrderCancelled,
  itemDeliverySummary,
  itemFieldRows,
  paidWithText,
  paymentProviderLabel,
  paymentStatusLabel,
  refundViaText,
  splitPaymentActions,
} from "@/components/admin/lib/orders";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { useAdminToken } from "@/hooks/use-admin-token";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/* ─── Dialog drafts ─── */

type StatusDraft = {
  kind: "payment" | "fulfillment";
  status: string;
  label: string;
  requiresReason: boolean;
  danger: boolean;
  description: string;
  reason: string;
};

type RefundDraft = { mode: "all" | "part"; amount: string; reason: string; manual: boolean };

function statusDescription(kind: "payment" | "fulfillment", status: string): string {
  if (kind === "payment") {
    switch (status) {
      case "PAID":
        return "Use this only when the money arrived outside the website (cash, bank transfer…). Codes are delivered from stock right away and the customer gets an e-mail.";
      case "AUTHORIZED":
        return "Only for PayPal payments that were approved but not captured yet. You rarely need this.";
      case "FAILED":
        return "Marks the payment as failed. The customer can still pay again from their order page, or the order expires.";
      default:
        return "Changes the payment status.";
    }
  }
  switch (status) {
    case "COMPLETED":
      return "Every item is delivered. This closes the order — no more delivery actions will be offered.";
    case "FAILED":
      return "Marks the delivery as failed. Use it when a supplier could not deliver; you can retry or refund afterwards.";
    case "MANUAL_REVIEW":
      return "Flags the order for a person to look at (e.g. missing stock).";
    default:
      return "Changes the delivery status shown to staff.";
  }
}

const CONFIRM_FULFILLMENT = new Set(["COMPLETED", "FAILED"]);

/* ─── Small pieces ─── */

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="admin-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--clicks-muted)]">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-[var(--clicks-navy)]" : ""}`}>{value}</dd>
    </div>
  );
}

function CodeRow({
  code,
  orderPaymentStatus,
  canReveal,
  onReveal,
}: {
  code: OrderItemCode;
  orderPaymentStatus: string;
  canReveal: boolean;
  onReveal: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="font-mono">{code.masked}</span>
      <span className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--clicks-muted)]">
        {code.delivered_at ? <span>Delivered {formatAdminDateTime(code.delivered_at)}</span> : null}
        {code.customer_revealed_at ? (
          <span className="font-medium text-emerald-700">
            Revealed by customer {formatAdminDateTime(code.customer_revealed_at)}
          </span>
        ) : code.status === "DELIVERED" ? (
          <span>Not opened by the customer yet</span>
        ) : null}
        <Badge tone={codeStatusTone(code)}>{codeStatusText(code, orderPaymentStatus)}</Badge>
        {canReveal && code.status !== "UNAVAILABLE" ? (
          <button type="button" className="font-semibold text-[var(--clicks-blue)]" onClick={onReveal}>
            Reveal
          </button>
        ) : null}
      </span>
    </li>
  );
}

function ItemCard({
  item,
  order,
  canFulfill,
  canReveal,
  pending,
  onAttach,
  onMarkDelivered,
  onReveal,
  onOrderUpdated,
}: {
  item: OrderDetailItem;
  order: OrderDetail;
  canFulfill: boolean;
  canReveal: boolean;
  pending: boolean;
  onAttach: () => void;
  onMarkDelivered: () => void;
  onReveal: (code: OrderItemCode) => void;
  /** 1Epin item actions return the refreshed order */
  onOrderUpdated?: (next: OrderDetail) => void;
}) {
  const isCode = item.fulfillment_type === "CODE";
  const paid = isPaidLike(order.payment_status);
  const fields = itemFieldRows(item);
  const showMethod = item.show_delivery_method ?? isCode;
  const summary = itemDeliverySummary(item, order);
  const delivered = item.codes_delivered ?? (item.codes ?? []).filter((c) => c.status !== "UNAVAILABLE").length;
  const notPaidReason = "Available once the order is paid.";
  // Backend decides (e.g. disabled while a 1Epin purchase is in flight); fall back to "paid".
  const staffAction = isCode ? item.staff_actions?.attach : item.staff_actions?.mark_delivered;
  const actionEnabled = staffAction ? staffAction.enabled : paid;
  const actionReason = staffAction ? staffAction.disabled_reason : paid ? "" : notPaidReason;
  const supplierOrder = itemSupplierOrder(item);
  const canEditFields = canFulfill && !isCode && paid && !item.delivered && !isOrderCancelled(order) && Boolean(onOrderUpdated);
  const [editingFields, setEditingFields] = useState(false);

  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[var(--clicks-navy)]">
            {item.product_name || "Item"}
            {item.variant_name ? <span className="font-normal text-[var(--clicks-muted)]"> · {item.variant_name}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-[var(--clicks-muted)]">
            Qty {item.quantity} × {formatJod(item.unit_price_fils)}
            {item.platform_name ? ` · ${item.platform_name}` : ""}
            {item.region_name ? ` · ${item.region_name}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="info">{isCode ? "Code" : "Direct top-up"}</Badge>
            <Badge tone={summary.tone}>
              {summary.label}
              {summary.state === "delivered" && summary.deliveredAt ? ` ${formatAdminDateTime(summary.deliveredAt)}` : ""}
            </Badge>
            {summary.state === "retired_refunded" && summary.deliveredAt ? (
              <span className="text-[11px] text-[var(--clicks-muted)]">
                (were delivered {formatAdminDateTime(summary.deliveredAt)})
              </span>
            ) : null}
            {isCode && summary.showStats ? (
              <span className="text-[11px] text-[var(--clicks-muted)]">
                {delivered} of {item.quantity} code{item.quantity === 1 ? "" : "s"} delivered
                {item.codes_pending ? ` · ${item.codes_pending} still to deliver` : ""}
                {item.codes_pending && item.sellable_codes_for_variant != null
                  ? ` · ${item.sellable_codes_for_variant} in stock`
                  : ""}
              </span>
            ) : null}
          </div>
        </div>
        <div className="text-end">
          <p className="font-medium tabular-nums">{formatJod(item.line_total_fils ?? item.unit_price_fils * item.quantity)}</p>
          {canFulfill && summary.showActions ? (
            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
              <ActionButton
                small
                label={isCode ? "Attach code" : "Mark delivered"}
                enabled={actionEnabled}
                reason={actionReason}
                pending={pending}
                onClick={isCode ? onAttach : onMarkDelivered}
              />
            </div>
          ) : null}
        </div>
      </div>

      {item.review_reason ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          Needs a person: {item.review_reason}
        </p>
      ) : null}

      {fields.length ? (
        <div className="mt-2 rounded-lg bg-[#F7F8FC] px-3 py-2 text-xs">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-[var(--clicks-muted)]">
              {isCode ? "Details from the customer" : "Top-up details (where to deliver)"}
            </p>
            {canEditFields ? (
              <ActionButton
                small
                label="Edit top-up details"
                enabled={!supplierOrder?.in_flight}
                reason={supplierOrder?.in_flight ? "A 1Epin purchase is in progress — check it first" : ""}
                pending={pending}
                onClick={() => setEditingFields(true)}
              />
            ) : null}
          </div>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className="flex gap-2">
                <dt className="text-[var(--clicks-muted)]">{f.label}:</dt>
                <dd className="break-all font-mono font-medium text-[var(--clicks-navy)]">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {showMethod && (item.delivery_method || item.delivery_contact) ? (
        <p className="mt-2 text-xs text-[var(--clicks-muted)]">
          Delivery: <span className="font-medium text-[var(--clicks-text)]">{deliveryMethodLabel(item.delivery_method)}</span>
          {item.delivery_contact ? ` · ${item.delivery_contact}` : ""}
        </p>
      ) : null}
      {item.delivery_note ? (
        <p className="mt-1 text-xs text-[var(--clicks-muted)]">
          Note to the customer <span className="italic">(visible to the customer)</span>:{" "}
          <span className="text-[var(--clicks-text)]">{item.delivery_note}</span>
        </p>
      ) : null}

      {item.codes?.length ? (
        <ul className="mt-2 divide-y divide-[var(--clicks-border)] rounded-lg bg-[var(--clicks-bg)] px-3 py-1 text-xs">
          {item.codes.map((c) => (
            <CodeRow
              key={String(c.id)}
              code={c}
              orderPaymentStatus={order.payment_status}
              canReveal={canReveal}
              onReveal={() => onReveal(c)}
            />
          ))}
        </ul>
      ) : null}

      {onOrderUpdated ? <OneEpinItemBlock order={order} item={item} canFulfill={canFulfill} onOrderUpdated={onOrderUpdated} /> : null}
      {editingFields && onOrderUpdated ? (
        <EditTopupDetailsDialog
          order={order}
          item={item}
          onClose={() => setEditingFields(false)}
          onSaved={(next) => {
            setEditingFields(false);
            onOrderUpdated(next);
          }}
        />
      ) : null}
    </li>
  );
}

/** Editable rows: every field the customer filled in (labels from the order, keys as fallback). */
export function editableFieldRows(item: OrderDetailItem): Array<{ key: string; label: string; value: string }> {
  const rows: Array<{ key: string; label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const detail of item.field_details ?? []) {
    if (!detail.key || seen.has(detail.key)) continue;
    seen.add(detail.key);
    rows.push({ key: detail.key, label: detail.label_en || detail.key, value: detail.value == null ? "" : String(detail.value) });
  }
  for (const [key, raw] of Object.entries(item.customer_fields ?? {})) {
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, label: key, value: raw == null ? "" : String(raw) });
  }
  return rows;
}

function EditTopupDetailsDialog({
  order,
  item,
  onClose,
  onSaved,
}: {
  order: OrderDetail;
  item: OrderDetailItem;
  onClose: () => void;
  onSaved: (next: OrderDetail) => void;
}) {
  const token = useAdminToken();
  const toast = useAdminToast();
  const rows = editableFieldRows(item);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.key, r.value])));
  const [error, setError] = useState<{ message: string; field: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = Object.fromEntries(
    rows.filter((r) => (values[r.key] ?? "").trim() !== r.value.trim()).map((r) => [r.key, (values[r.key] ?? "").trim()]),
  );
  const dirty = Object.keys(changed).length > 0;

  return (
    <ConfirmDialog
      open
      title="Edit top-up details"
      description="Correct what the customer typed (e.g. a wrong player ID) before retrying with 1Epin or delivering by hand. The change is checked like at checkout and recorded in the order history."
      confirmLabel="Save details"
      cancelLabel="Go back"
      pending={saving}
      confirmDisabled={!dirty}
      onCancel={onClose}
      onConfirm={() =>
        void (async () => {
          if (!token || !dirty) return;
          setSaving(true);
          setError(null);
          try {
            const next = await updateItemCustomerFields(token, order.order_number || order.id, item.id, changed);
            toast.push("Top-up details saved", "success");
            onSaved(next);
          } catch (err) {
            const body = (err as { body?: { field?: unknown } })?.body;
            setError({
              message: adminErrorSummary(err, "The details could not be saved."),
              field: typeof body?.field === "string" ? body.field : "",
            });
          } finally {
            setSaving(false);
          }
        })()
      }
    >
      <div className="space-y-3">
        {rows.map((row) => (
          <FormField
            key={row.key}
            label={row.label}
            htmlFor={`edit-field-${row.key}`}
            error={error?.field === row.key ? error.message : undefined}
          >
            <input
              id={`edit-field-${row.key}`}
              autoComplete="off"
              className={`${adminInputClass} font-mono`}
              value={values[row.key] ?? ""}
              maxLength={255}
              onChange={(e) => setValues((v) => ({ ...v, [row.key]: e.target.value }))}
            />
          </FormField>
        ))}
        {error && !error.field ? <Notice tone="error">{error.message}</Notice> : null}
      </div>
    </ConfirmDialog>
  );
}

function historyDetail(entry: OrderHistoryEntry): string {
  const meta = entry.meta ?? {};
  const parts: string[] = [];
  if (typeof meta.amount === "string") parts.push(meta.amount);
  if (meta.changes && typeof meta.changes === "object") {
    for (const [field, change] of Object.entries(meta.changes as Record<string, unknown>)) {
      if (change == null || isInternalMetaKey(field)) continue;
      parts.push(`${auditMetaKeyLabel(field)}: ${formatAuditValue(change, field)}`);
    }
  }
  if (typeof meta.via === "string" && meta.via) parts.push(`Via: ${formatAuditValue(meta.via, "via")}`);
  if (typeof meta.reason === "string" && meta.reason) parts.push(`Reason: ${meta.reason}`);
  if (typeof meta.masked === "string" && entry.action !== "orders.transition") parts.push(meta.masked);
  if (parts.length) return parts.join(" · ");
  if (entry.action === "orders.staff_notes") return "";
  return summarizeAuditMeta(
    Object.fromEntries(
      Object.entries(meta).filter(([k]) => !["order_number", "email"].includes(k)),
    ),
    3,
  );
}

function OrderHistory({ orderKey, reloadKey, canAudit, orderNumber }: { orderKey: string; reloadKey: number; canAudit: boolean; orderNumber: string }) {
  const { data, loading, error, reload } = useAdminQuery((tok) => getOrderHistory(tok, orderKey), [orderKey, reloadKey]);
  const entries = data?.results ?? [];
  return (
    <Section
      title="History"
      action={
        canAudit ? (
          <Link
            href={`/admin/audit?order_number=${encodeURIComponent(orderNumber)}`}
            className="text-xs font-medium text-[var(--clicks-blue)]"
          >
            Open in audit log
          </Link>
        ) : null
      }
    >
      {loading ? (
        <div className="h-16 animate-pulse rounded-lg bg-[var(--clicks-bg)]" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : entries.length ? (
        <ol className="relative space-y-3 border-s border-[var(--clicks-border)] ps-4 text-[13px]">
          {entries.map((entry) => {
            const detail = historyDetail(entry);
            return (
              <li key={String(entry.id)} className="relative">
                <span className="absolute -start-[21px] top-1.5 h-2 w-2 rounded-full bg-[var(--clicks-blue)]" aria-hidden />
                <p className="font-medium text-[var(--clicks-navy)]">{entry.label || auditActionLabel(entry.action)}</p>
                <p className="text-[11px] text-[var(--clicks-muted)]">
                  {formatAdminDateTime(entry.created_at)} · {entry.actor_name || entry.actor_email || "System"}
                </p>
                {detail ? <p className="mt-0.5 break-words text-xs text-[var(--clicks-text)]">{detail}</p> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-[var(--clicks-muted)]">Nothing recorded yet — the order was just created.</p>
      )}
    </Section>
  );
}

function StaffNotes({
  order,
  canWrite,
  onSaved,
}: {
  order: OrderDetail;
  canWrite: boolean;
  onSaved: (next: OrderDetail) => void;
}) {
  const toast = useAdminToast();
  const token = useAdminToken();
  const saved = order.staff_notes ?? "";
  const [draft, setDraft] = useState(saved);
  const [base, setBase] = useState(saved);
  const [pending, setPending] = useState(false);
  // A save elsewhere (or another tab) changed the notes: take the new value unless editing.
  if (saved !== base) {
    setBase(saved);
    if (draft === base) setDraft(saved);
  }
  const dirty = draft.trim() !== saved.trim();

  if (!canWrite) {
    return (
      <Section title="Staff notes">
        {saved ? (
          <p className="whitespace-pre-wrap text-sm">{saved}</p>
        ) : (
          <p className="text-sm text-[var(--clicks-muted)]">No staff notes.</p>
        )}
      </Section>
    );
  }

  return (
    <Section title="Staff notes">
      <textarea
        aria-label="Staff notes"
        className={adminTextareaClass}
        value={draft}
        maxLength={5000}
        placeholder="e.g. Customer called, asked to deliver to a different Player ID."
        onChange={(e) => setDraft(e.target.value)}
      />
      <p className="mt-1 text-[11px] text-[var(--clicks-muted)]">
        Only staff can see these notes. Every change is recorded in the order history.
      </p>
      <div className="mt-2 flex justify-end gap-2">
        {dirty ? (
          <button type="button" className="admin-btn admin-btn-secondary h-8 text-xs" onClick={() => setDraft(saved)}>
            Discard
          </button>
        ) : null}
        <button
          type="button"
          disabled={!dirty || pending}
          className="admin-btn admin-btn-primary h-8 text-xs disabled:opacity-55"
          onClick={() =>
            void (async () => {
              if (!token) return;
              setPending(true);
              try {
                const next = await saveStaffNotes(token, order.id, draft);
                onSaved(next);
                toast.push("Staff notes saved", "success");
              } catch (err) {
                toast.push(adminErrorSummary(err, "Could not save the notes."), "error");
              } finally {
                setPending(false);
              }
            })()
          }
        >
          {pending ? "Saving…" : "Save notes"}
        </button>
      </div>
    </Section>
  );
}

/* ─── Page ─── */

export function OrderDetailClient({ id }: { id: string }) {
  const toast = useAdminToast();
  const router = useRouter();
  const { can } = useAdminAccess();
  const canWrite = can("orders.write");
  const canFulfill = can("orders.fulfill");
  const canNotify = can("orders.notify") || canFulfill;
  const canReveal = can("codes.reveal");
  const canAudit = can("audit.read");
  const canCustomers = can("customers.read");

  const [pending, setPending] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [statusDraft, setStatusDraft] = useState<StatusDraft | null>(null);
  const [refundDraft, setRefundDraft] = useState<RefundDraft | null>(null);
  const [refundError, setRefundError] = useState("");
  const [cancelDraft, setCancelDraft] = useState<{ reason: string } | null>(null);
  const [attachItem, setAttachItem] = useState<OrderDetailItem | null>(null);
  const [attachForm, setAttachForm] = useState({ code: "", pin: "" });
  const [attachError, setAttachError] = useState("");
  const [deliverItem, setDeliverItem] = useState<OrderDetailItem | null>(null);
  const [deliverNote, setDeliverNote] = useState("");
  const [confirmFulfill, setConfirmFulfill] = useState(false);
  const [confirmResend, setConfirmResend] = useState(false);
  const [revealTarget, setRevealTarget] = useState<OrderItemCode | null>(null);

  const { data: order, setData: setOrder, loading, error, reload, token } = useAdminQuery(
    (tok) => getOrderDetail(tok, id),
    [id],
  );

  // OR-22: show the order number (not the internal id) in the address bar / breadcrumb.
  const orderNumber = order?.order_number;
  useEffect(() => {
    if (orderNumber && decodeURIComponent(id) !== orderNumber) {
      router.replace(`/admin/orders/${encodeURIComponent(orderNumber)}`);
    }
  }, [id, orderNumber, router]);

  async function run(
    action: (tok: string, o: OrderDetail) => Promise<OrderDetail | void>,
    success: string,
    onError?: (message: string, err: unknown) => boolean,
  ): Promise<boolean> {
    if (!token || !order) return false;
    setPending(true);
    try {
      const next = await action(token, order);
      if (next && typeof next === "object" && "order_number" in next) setOrder(next);
      else reload();
      setHistoryTick((n) => n + 1);
      toast.push(success, "success");
      return true;
    } catch (err) {
      const message = adminErrorSummary(err, "That did not work. Try again.");
      if (!onError || !onError(message, err)) toast.push(message, "error");
      // The order may have moved on (another tab, webhook): show its real state.
      if (errorCode(err)) reload();
      return false;
    } finally {
      setPending(false);
    }
  }

  if (loading && !order) return <div className="admin-card h-48 animate-pulse" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!order) return <EmptyState title="Order not found" description="Check the order number and try again." />;

  const items = order.items ?? [];
  const actions = order.actions;
  const paid = isPaidLike(order.payment_status);
  const cancelled = isOrderCancelled(order);
  const undeliveredCodeItems = items.filter((i) => i.fulfillment_type === "CODE" && !i.delivered);
  const summary = order.refund_summary;
  const refund = actions?.refund;
  const remainingFils = refund?.remaining_fils ?? summary?.remaining_fils ?? order.refund_remaining_fils ?? 0;
  const refundedFils = summary?.refunded_fils ?? order.refunded_fils ?? 0;
  const via = refundViaText(refund?.via);
  const { primary: paymentPrimary, advanced: paymentAdvanced } = splitPaymentActions(actions?.payment);
  const fulfillmentActions = fulfillmentButtons(actions?.fulfillment);

  function openStatus(kind: "payment" | "fulfillment", action: OrderAction) {
    if (!action.status || !action.enabled) return;
    const draft: StatusDraft = {
      kind,
      status: action.status,
      label: action.label,
      requiresReason: Boolean(action.requires_reason),
      danger: action.status === "FAILED",
      description: statusDescription(kind, action.status),
      reason: "",
    };
    const needsConfirm = kind === "payment" || CONFIRM_FULFILLMENT.has(action.status) || draft.requiresReason;
    if (!needsConfirm) {
      void submitStatus(draft);
      return;
    }
    setStatusDraft(draft);
  }

  async function submitStatus(draft: StatusDraft) {
    const body: { payment_status?: string; fulfillment_status?: string; reason?: string } =
      draft.kind === "payment" ? { payment_status: draft.status } : { fulfillment_status: draft.status };
    if (draft.reason.trim()) body.reason = draft.reason.trim();
    const ok = await run((tok, o) => transitionOrderStatus(tok, o.id, body), `${draft.label} — done`);
    if (ok) setStatusDraft(null);
  }

  // Refund dialog validation (D5)
  const refundAmountFils =
    refundDraft?.mode === "part" ? jodInputToFils(refundDraft.amount) : refundDraft ? remainingFils : null;
  let refundInputError = "";
  if (refundDraft?.mode === "part" && refundDraft.amount.trim()) {
    if (refundAmountFils == null || Number.isNaN(refundAmountFils) || refundAmountFils <= 0) {
      refundInputError = "Enter an amount in JOD, e.g. 2.500";
    } else if (refundAmountFils > remainingFils) {
      refundInputError = `That is more than the ${formatJod(remainingFils)} that can still be refunded.`;
    }
  }
  const refundValid =
    refundDraft != null &&
    !refundInputError &&
    refundAmountFils != null &&
    !Number.isNaN(refundAmountFils) &&
    refundAmountFils > 0;

  async function submitRefund() {
    if (!refundDraft || !refundValid || refundAmountFils == null) return;
    setRefundError("");
    const body: { amount_fils?: number; reason?: string; manual?: boolean } = {};
    if (refundDraft.mode === "part") body.amount_fils = refundAmountFils;
    if (refundDraft.reason.trim()) body.reason = refundDraft.reason.trim();
    if (refund?.via !== "paypal" || refundDraft.manual) body.manual = true;
    const ok = await run(
      (tok, o) => refundOrder(tok, o.id, body),
      `Refund of ${formatJod(refundAmountFils)} recorded`,
      (message, err) => {
        const code = errorCode(err);
        if (["refund_exceeds_remaining", "invalid_amount", "nothing_to_refund", "refund_pending", "not_refundable"].includes(code ?? "") || (err as { status?: number })?.status === 502) {
          setRefundError(
            (err as { status?: number })?.status === 502
              ? `PayPal did not accept the refund: ${message} Nothing was refunded.`
              : message,
          );
          return true;
        }
        return false;
      },
    );
    if (ok) setRefundDraft(null);
  }

  const statusLine = [
    `Placed ${formatAdminDateTime(order.created_at)}`,
    order.customer_status ? `Customer sees: ${customerStatusLabel(order.customer_status)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <PageHeader
        title={`Order ${order.order_number}`}
        description={statusLine}
        actions={
          <>
            {canFulfill && paid && !cancelled && undeliveredCodeItems.length ? (
              <ActionButton
                variant="primary"
                label="Deliver codes from stock"
                enabled={order.actions?.deliver_from_stock ? order.actions.deliver_from_stock.enabled : true}
                reason={order.actions?.deliver_from_stock?.disabled_reason ?? ""}
                pending={pending}
                onClick={() => setConfirmFulfill(true)}
              />
            ) : null}
            {canNotify && paid ? (
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={pending}
                onClick={() => setConfirmResend(true)}
              >
                Resend e-mail to customer
              </button>
            ) : null}
            <Link href="/admin/orders" className="text-sm font-medium text-[var(--clicks-blue)]">
              Back to orders
            </Link>
          </>
        }
      />

      <div className="mb-4 space-y-2">
        {cancelled ? (
          <Notice tone="info">This order is cancelled. Nothing else needs to be done.</Notice>
        ) : order.payment_status === "REFUNDED" ? (
          <Notice tone="info">
            This order was fully refunded. Its codes are retired and can no longer be viewed by the customer.
          </Notice>
        ) : !paid ? (
          <Notice tone="warning">
            Waiting for the customer to pay. Delivery starts automatically once payment arrives. Unpaid orders expire
            after 72 hours.
            {order.reserved_until ? ` Stock is held for this order until ${formatAdminDateTime(order.reserved_until)}.` : ""}
          </Notice>
        ) : order.fulfillment_status === "MANUAL_REVIEW" ? (
          <Notice tone="warning">
            This order needs a person to finish it — usually there were not enough codes in stock or a supplier problem.
            Import codes and use “Deliver codes from stock”, attach codes by hand, or mark top-ups delivered.
          </Notice>
        ) : order.fulfillment_status !== "COMPLETED" ? (
          <Notice tone="info">Paid — deliver the remaining items below.</Notice>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Section title="Items">
            {items.length ? (
              <ul className="divide-y divide-[var(--clicks-border)]">
                {items.map((item) => (
                  <ItemCard
                    key={String(item.id)}
                    item={item}
                    order={order}
                    canFulfill={canFulfill}
                    canReveal={canReveal}
                    pending={pending}
                    onAttach={() => {
                      setAttachForm({ code: "", pin: "" });
                      setAttachError("");
                      setAttachItem(item);
                    }}
                    onMarkDelivered={() => {
                      setDeliverNote("");
                      setDeliverItem(item);
                    }}
                    onReveal={(code) => setRevealTarget(code)}
                    onOrderUpdated={(next) => {
                      setOrder(next);
                      setHistoryTick((n) => n + 1);
                    }}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--clicks-muted)]">No items.</p>
            )}
          </Section>

          <Section title="Payments">
            {order.payments?.length ? (
              <ul className="divide-y divide-[var(--clicks-border)] text-sm">
                {order.payments.map((p) => (
                  <li key={String(p.id)} className={`flex items-start justify-between gap-3 py-2 ${p.voided ? "opacity-60" : ""}`}>
                    <div className="min-w-0 text-xs text-[var(--clicks-muted)]">
                      <p className="text-sm font-medium text-[var(--clicks-navy)]">{paymentProviderLabel(p.provider)}</p>
                      {p.provider_amount ? (
                        <p>
                          Charged {p.provider_currency || p.currency || ""} {p.provider_amount}
                        </p>
                      ) : null}
                      {p.capture_id || p.provider_capture_id ? <p>PayPal capture {p.capture_id || p.provider_capture_id}</p> : null}
                      {p.external_ref ? <p>Reference {p.external_ref}</p> : null}
                      <p>
                        Started {formatAdminDateTime(p.created_at)}
                        {p.paid_at ? ` · paid ${formatAdminDateTime(p.paid_at)}` : ""}
                      </p>
                      {p.voided ? <p>Voided — this attempt is no longer needed.</p> : null}
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="tabular-nums">{p.amount_display || formatJod(p.amount_fils)}</p>
                      <Badge status={p.status}>{paymentStatusLabel(p.status)}</Badge>
                      {p.refunded_fils ? (
                        <p className="mt-1 text-[11px] text-[var(--clicks-muted)]">
                          Refunded {p.refunded_display || formatJod(p.refunded_fils)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--clicks-muted)]">No payment attempts yet.</p>
            )}
          </Section>

          {order.refunds?.length ? (
            <Section title="Refunds">
              <ul className="divide-y divide-[var(--clicks-border)] text-sm">
                {order.refunds.map((r) => (
                  <li key={String(r.id)} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0 text-xs text-[var(--clicks-muted)]">
                      <p className="text-sm font-medium text-[var(--clicks-navy)]">
                        {r.provider === "paypal" ? "Through PayPal" : "Manual refund"}
                      </p>
                      <p>
                        {formatAdminDateTime(r.created_at)}
                        {r.actor_email ? ` · by ${r.actor_email}` : ""}
                      </p>
                      {r.reason ? <p>Reason: {r.reason}</p> : null}
                      {r.provider_amount ? (
                        <p>
                          Sent {r.provider_currency || ""} {r.provider_amount}
                          {r.provider_refund_id ? ` · PayPal refund ${r.provider_refund_id}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="font-medium tabular-nums">{r.amount_display || formatJod(r.amount_fils)}</p>
                      <Badge status={r.status} />
                    </div>
                  </li>
                ))}
              </ul>
              <dl className="mt-2 space-y-1 border-t border-[var(--clicks-border)] pt-2 text-xs">
                <Row label="Refunded in total" value={order.display?.refunded || formatJod(refundedFils)} strong />
                <Row label="Can still be refunded" value={order.display?.refund_remaining || formatJod(remainingFils)} />
              </dl>
            </Section>
          ) : null}

          <OrderHistory
            orderKey={String(order.id)}
            reloadKey={historyTick}
            canAudit={canAudit}
            orderNumber={order.order_number}
          />
        </div>

        <div className="min-w-0 space-y-4">
          <section className="admin-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Total</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{order.display?.total || formatJod(order.total_fils)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge status={order.payment_status}>{paymentStatusLabel(order.payment_status)}</Badge>
              <Badge status={order.fulfillment_status}>{fulfillmentStatusLabel(order.fulfillment_status)}</Badge>
            </div>
            <dl className="mt-4 space-y-1 text-xs">
              <Row label="Subtotal" value={order.display?.subtotal || formatJod(order.subtotal_fils ?? order.total_fils)} />
              <Row
                label={`Discount${order.coupon_code ? ` (${order.coupon_code})` : ""}`}
                value={formatJodDiscount(order.discount_fils)}
              />
              {refundedFils ? <Row label="Refunded" value={formatJodDiscount(refundedFils)} /> : null}
              {paid ? <Row label="Can still be refunded" value={formatJod(remainingFils)} /> : null}
              {order.payment_provider ? <Row label="Payment" value={paidWithText(order.payment_provider)} /> : null}
            </dl>
          </section>

          {canWrite ? (
            <section className="admin-card space-y-4 p-4">
              <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Order actions</h2>

              {fulfillmentActions.length || actions?.complete ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--clicks-muted)]">Delivery status</p>
                  <div className="flex flex-wrap gap-2">
                    {fulfillmentActions.map((a) => (
                      <ActionButton
                        key={a.status}
                        small
                        label={a.label}
                        enabled={a.enabled}
                        reason={actionHint(a)}
                        pending={pending}
                        onClick={() => openStatus("fulfillment", a)}
                      />
                    ))}
                    {actions?.complete && order.fulfillment_status !== "COMPLETED" && !cancelled ? (
                      <ActionButton
                        small
                        variant="primary"
                        label={actions.complete.label || "Set status: Completed"}
                        enabled={actions.complete.enabled}
                        reason={actionHint(actions.complete)}
                        pending={pending}
                        onClick={() =>
                          openStatus("fulfillment", { ...actions.complete, status: "COMPLETED" })
                        }
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}

              {paymentPrimary.length || paymentAdvanced.length ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--clicks-muted)]">Payment</p>
                  <div className="flex flex-wrap items-start gap-2">
                    {paymentPrimary.map((a) => (
                      <ActionButton
                        key={a.status}
                        small
                        label={a.label}
                        enabled={a.enabled}
                        reason={actionHint(a)}
                        pending={pending}
                        onClick={() => openStatus("payment", a)}
                      />
                    ))}
                    <MoreMenu
                      items={paymentAdvanced.map((a) => ({
                        key: a.status ?? a.label,
                        label: a.label,
                        description: a.status ? statusDescription("payment", a.status) : undefined,
                        disabled: !a.enabled || pending,
                        reason: actionHint(a),
                        danger: a.status === "FAILED",
                        onSelect: () => openStatus("payment", a),
                      }))}
                    />
                  </div>
                </div>
              ) : null}

              {refund && (paid || refundedFils > 0) ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-[var(--clicks-muted)]">Refund</p>
                  <ActionButton
                    small
                    variant="danger"
                    label={via.button}
                    enabled={refund.enabled}
                    reason={actionHint(refund)}
                    pending={pending}
                    onClick={() => {
                      setRefundError("");
                      setRefundDraft({ mode: "all", amount: "", reason: "", manual: false });
                    }}
                  />
                  {refund.enabled ? (
                    <p className="text-[11px] text-[var(--clicks-muted)]">
                      Up to {refund.remaining_display || formatJod(remainingFils)} can still be refunded. You can refund in
                      several parts.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {actions?.cancel && !cancelled ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-[var(--clicks-muted)]">Cancel</p>
                  <ActionButton
                    small
                    variant="danger"
                    label={actions.cancel.label || "Cancel order"}
                    enabled={actions.cancel.enabled}
                    reason={actionHint(actions.cancel)}
                    pending={pending}
                    onClick={() => setCancelDraft({ reason: "" })}
                  />
                </div>
              ) : null}

              {cancelled ? <p className="text-xs text-[var(--clicks-muted)]">Cancelled orders have no further actions.</p> : null}
            </section>
          ) : (
            <section className="admin-card p-4 text-xs text-[var(--clicks-muted)]">
              Your role can view this order but cannot change its status, refund or cancel it.
            </section>
          )}

          <section className="admin-card space-y-1 p-4 text-sm">
            <h2 className="font-semibold text-[var(--clicks-navy)]">Customer</h2>
            <p>{order.full_name || "—"}</p>
            <p className="break-all text-[var(--clicks-muted)]">
              {canCustomers && order.email ? (
                <Link href={`/admin/customers?search=${encodeURIComponent(order.email)}`} className="text-[var(--clicks-blue)]">
                  {order.email}
                </Link>
              ) : (
                order.email || "—"
              )}
            </p>
            {order.phone ? <p className="text-[var(--clicks-muted)]">{order.phone}</p> : null}
            <p className="text-xs text-[var(--clicks-muted)]">{order.user ? "Registered account" : "Guest checkout (no account)"}</p>
            {order.locale ? (
              <p className="text-xs text-[var(--clicks-muted)]">
                E-mails are sent in {order.locale === "ar" ? "Arabic" : "English"}.
              </p>
            ) : null}
            <div className="pt-2 text-xs text-[var(--clicks-muted)]">
              <p>Confirmed the region: {order.region_confirmed ? "yes" : "no"}</p>
              <p>Accepted the refund policy: {order.refund_confirmed ? "yes" : "no"}</p>
            </div>
            {order.notes ? (
              <div className="pt-2">
                <p className="text-xs font-semibold text-[var(--clicks-navy)]">Note from the customer</p>
                <p className="whitespace-pre-wrap text-xs">{order.notes}</p>
              </div>
            ) : null}
          </section>

          <StaffNotes order={order} canWrite={canWrite} onSaved={(next) => {
            setOrder(next);
            setHistoryTick((n) => n + 1);
          }} />
        </div>
      </div>

      {/* Status change (payment / delivery) */}
      <ConfirmDialog
        open={Boolean(statusDraft)}
        title={statusDraft ? `${statusDraft.label}?` : ""}
        description={statusDraft?.description}
        danger={statusDraft?.danger}
        confirmLabel={statusDraft?.label ?? "Confirm"}
        cancelLabel="Go back"
        pending={pending}
        confirmDisabled={Boolean(statusDraft?.requiresReason && !statusDraft.reason.trim())}
        onCancel={() => setStatusDraft(null)}
        onConfirm={() => statusDraft && void submitStatus(statusDraft)}
      >
        {statusDraft ? (
          <FormField
            label="Reason"
            htmlFor="status-reason"
            required={statusDraft.requiresReason}
            hint={statusDraft.requiresReason ? "Required. Saved in the order history, e.g. “Paid by bank transfer, ref 1234”." : "Optional. Saved in the order history."}
          >
            <textarea
              id="status-reason"
              className={adminTextareaClass}
              value={statusDraft.reason}
              maxLength={500}
              onChange={(e) => setStatusDraft((d) => (d ? { ...d, reason: e.target.value } : d))}
            />
          </FormField>
        ) : null}
      </ConfirmDialog>

      {/* Refund (D5) */}
      <ConfirmDialog
        open={Boolean(refundDraft)}
        title={via.button}
        description={via.explain}
        danger
        confirmLabel={refundValid && refundAmountFils ? `Refund ${formatJod(refundAmountFils)}` : "Refund"}
        cancelLabel="Go back"
        pending={pending}
        confirmDisabled={!refundValid}
        onCancel={() => setRefundDraft(null)}
        onConfirm={() => void submitRefund()}
      >
        {refundDraft ? (
          <>
            <dl className="space-y-1 rounded-lg bg-[var(--clicks-bg)] px-3 py-2 text-xs">
              <Row label="Paid" value={summary?.paid_display || formatJod(summary?.paid_fils ?? order.total_fils)} />
              <Row label="Already refunded" value={summary?.refunded_display || formatJod(refundedFils)} />
              <Row label="Can still be refunded" value={formatJod(remainingFils)} strong />
            </dl>
            <fieldset className="space-y-2 text-sm">
              <legend className="sr-only">How much to refund</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="refund-mode"
                  checked={refundDraft.mode === "all"}
                  onChange={() => setRefundDraft((d) => (d ? { ...d, mode: "all" } : d))}
                />
                Everything left ({formatJod(remainingFils)})
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="refund-mode"
                  checked={refundDraft.mode === "part"}
                  onChange={() => setRefundDraft((d) => (d ? { ...d, mode: "part" } : d))}
                />
                Only part of it
              </label>
            </fieldset>
            {refundDraft.mode === "part" ? (
              <FormField
                label="Amount to refund (JOD)"
                htmlFor="refund-amount"
                required
                hint={`Up to ${formatJod(remainingFils)}. Example: 2.500`}
                error={refundInputError}
              >
                <input
                  id="refund-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  className={adminInputClass}
                  value={refundDraft.amount}
                  onChange={(e) => {
                    setRefundError("");
                    setRefundDraft((d) => (d ? { ...d, amount: e.target.value } : d));
                  }}
                />
              </FormField>
            ) : null}
            <FormField label="Reason" htmlFor="refund-reason" hint="Optional. Shown in the order history.">
              <textarea
                id="refund-reason"
                className={adminTextareaClass}
                value={refundDraft.reason}
                maxLength={500}
                onChange={(e) => setRefundDraft((d) => (d ? { ...d, reason: e.target.value } : d))}
              />
            </FormField>
            {refund?.via === "paypal" ? (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={refundDraft.manual}
                  onChange={(e) => setRefundDraft((d) => (d ? { ...d, manual: e.target.checked } : d))}
                />
                <span>I already returned this money another way — only record it, do not send it through PayPal.</span>
              </label>
            ) : null}
            <p className="text-[11px] text-[var(--clicks-muted)]">
              Codes the customer already received are not taken back. A full refund retires the codes so they can no
              longer be viewed. The customer gets a refund e-mail.
            </p>
            {refundError ? <Notice tone="error">{refundError}</Notice> : null}
          </>
        ) : null}
      </ConfirmDialog>

      {/* Cancel (D7) */}
      <ConfirmDialog
        open={Boolean(cancelDraft)}
        title="Cancel this order?"
        description="The order is closed for good: the customer can no longer pay for it and any reserved stock is released. The customer gets a cancellation e-mail."
        danger
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        pending={pending}
        onCancel={() => setCancelDraft(null)}
        onConfirm={() =>
          void (async () => {
            if (!cancelDraft) return;
            const ok = await run((tok, o) => cancelOrder(tok, o.id, cancelDraft.reason.trim() || undefined), "Order cancelled");
            if (ok) setCancelDraft(null);
          })()
        }
      >
        <FormField label="Reason" htmlFor="cancel-reason" hint="Optional. Saved in the order history.">
          <textarea
            id="cancel-reason"
            className={adminTextareaClass}
            value={cancelDraft?.reason ?? ""}
            maxLength={500}
            onChange={(e) => setCancelDraft((d) => (d ? { reason: e.target.value } : d))}
          />
        </FormField>
      </ConfirmDialog>

      {/* Attach code */}
      <ConfirmDialog
        open={Boolean(attachItem)}
        title="Attach a code"
        description={
          attachItem
            ? `Delivers this code to the customer for “${attachItem.product_name}${
                attachItem.variant_name ? ` · ${attachItem.variant_name}` : ""
              }”. Double-check it — the customer can see it immediately.`
            : undefined
        }
        confirmLabel="Attach and deliver"
        cancelLabel="Go back"
        pending={pending}
        confirmDisabled={!attachForm.code.trim()}
        onCancel={() => setAttachItem(null)}
        onConfirm={() =>
          void (async () => {
            if (!attachItem) return;
            setAttachError("");
            const ok = await run(
              (tok, o) =>
                attachItemCode(tok, o.id, attachItem.id, {
                  code: attachForm.code.trim(),
                  ...(attachForm.pin.trim() ? { pin: attachForm.pin.trim() } : {}),
                }),
              "Code attached and delivered",
              (message) => {
                setAttachError(message);
                return true;
              },
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
        <FormField label="PIN" htmlFor="attach-pin" hint="Only if the card has a separate PIN or serial.">
          <input
            id="attach-pin"
            autoComplete="off"
            className={`${adminInputClass} font-mono`}
            value={attachForm.pin}
            onChange={(e) => setAttachForm((f) => ({ ...f, pin: e.target.value }))}
          />
        </FormField>
        {attachError ? <Notice tone="error">{attachError}</Notice> : null}
      </ConfirmDialog>

      {/* Mark top-up delivered */}
      <ConfirmDialog
        open={Boolean(deliverItem)}
        title="Mark this top-up delivered?"
        description="Confirm the top-up reached the customer's game account. The customer gets a delivery e-mail."
        confirmLabel="Mark delivered"
        cancelLabel="Go back"
        pending={pending}
        onCancel={() => setDeliverItem(null)}
        onConfirm={() =>
          void (async () => {
            if (!deliverItem) return;
            const ok = await run(
              (tok, o) => markItemDelivered(tok, o.id, deliverItem.id, deliverNote.trim()),
              "Top-up marked delivered",
            );
            if (ok) setDeliverItem(null);
          })()
        }
      >
        <FormField
          label="Message to the customer"
          htmlFor="deliver-note"
          hint="Optional. Visible to the customer on their order page and in the e-mail — e.g. “Added 660 UC to your account.” Put internal details in Staff notes instead."
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
        title="Deliver codes from stock?"
        description="Takes codes from your stock for the items still waiting and e-mails them to the customer. Items without enough stock stay in “Needs review”."
        confirmLabel="Deliver"
        cancelLabel="Go back"
        pending={pending}
        onCancel={() => setConfirmFulfill(false)}
        onConfirm={() =>
          void (async () => {
            const ok = await run((tok, o) => fulfillOrderFromStock(tok, o.id), "Delivery from stock finished");
            if (ok) setConfirmFulfill(false);
          })()
        }
      />

      <ConfirmDialog
        open={confirmResend}
        title="Resend the e-mail?"
        description={`Sends the delivery e-mail again to ${order.email}.`}
        confirmLabel="Resend e-mail"
        cancelLabel="Go back"
        pending={pending}
        onCancel={() => setConfirmResend(false)}
        onConfirm={() =>
          void (async () => {
            if (!token) return;
            setPending(true);
            try {
              const res = await resendDeliveryEmail(token, order.id);
              toast.push(res.to ? `E-mail sent to ${res.to}` : res.detail || "E-mail sent", "success");
              setConfirmResend(false);
              setHistoryTick((n) => n + 1);
            } catch (err) {
              toast.push(adminErrorSummary(err, "The e-mail could not be sent."), "error");
            } finally {
              setPending(false);
            }
          })()
        }
      />

      <RevealCodeDialog
        target={revealTarget ? { id: revealTarget.id, masked: revealTarget.masked } : null}
        onClose={() => setRevealTarget(null)}
        onRevealed={() => setHistoryTick((n) => n + 1)}
      />
    </div>
  );
}
