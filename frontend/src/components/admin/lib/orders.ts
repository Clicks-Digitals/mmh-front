export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending payment",
  AUTHORIZED: "Approved, not captured",
  PAID: "Paid",
  FAILED: "Payment failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
};

export const FULFILLMENT_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  QUEUED: "Queued",
  PROCESSING: "Processing",
  COMPLETED: "Delivered",
  FAILED: "Delivery failed",
  MANUAL_REVIEW: "Needs review",
  CANCELLED: "Cancelled",
};

export function paymentStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PAYMENT_STATUS_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}

export function fulfillmentStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return FULFILLMENT_STATUS_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}

export type TransitionKind = "payment" | "fulfillment";

/** Action-style button label for a transition target. */
export function transitionLabel(
  kind: TransitionKind,
  target: string,
  ctx: { currentPayment?: string; hasPaypal?: boolean } = {},
): string {
  if (kind === "payment") {
    switch (target) {
      case "PAID":
        return "Mark paid";
      case "AUTHORIZED":
        return "Mark authorized";
      case "FAILED":
        return "Mark payment failed";
      case "CANCELLED":
        return "Cancel order";
      case "REFUNDED":
        if (ctx.currentPayment === "PARTIALLY_REFUNDED") {
          return ctx.hasPaypal ? "Refund remaining (PayPal)" : "Mark fully refunded";
        }
        return ctx.hasPaypal ? "Full refund (PayPal)" : "Mark refunded";
      case "PARTIALLY_REFUNDED":
        return ctx.hasPaypal ? "Partial refund (PayPal)" : "Mark partially refunded";
      default:
        return `Set ${paymentStatusLabel(target).toLowerCase()}`;
    }
  }
  switch (target) {
    case "QUEUED":
      return "Queue";
    case "PROCESSING":
      return "Start processing";
    case "COMPLETED":
      return "Mark delivered";
    case "FAILED":
      return "Mark fulfillment failed";
    case "MANUAL_REVIEW":
      return "Send to manual review";
    case "CANCELLED":
      return "Cancel fulfillment";
    default:
      return `Set ${fulfillmentStatusLabel(target).toLowerCase()}`;
  }
}

/** Transitions that need a confirmation dialog (money-moving or destructive). */
export function transitionNeedsConfirm(kind: TransitionKind, target: string): boolean {
  if (kind === "payment") return ["PAID", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED", "FAILED"].includes(target);
  return ["CANCELLED", "FAILED", "COMPLETED"].includes(target);
}

/** The backend requires a reason only for manual PAID; we also ask (optional) for refunds/cancel. */
export function transitionReasonRequired(kind: TransitionKind, target: string): boolean {
  return kind === "payment" && target === "PAID";
}

export function transitionIsDanger(target: string): boolean {
  return ["CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "FAILED"].includes(target);
}

/* ─── Operations helpers (API-driven order page, orders list URL state) ─── */

/** D4: partially refunded orders still count as paid for delivery, reveal and e-mails. */
export function isPaidLike(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === "PAID" || paymentStatus === "PARTIALLY_REFUNDED";
}

/** Link to an order page by its number, so the breadcrumb shows the number (OR-22). */
export function orderHref(order: { order_number?: string | null; id?: number | string | null }): string {
  const key = order.order_number || (order.id != null ? String(order.id) : "");
  return `/admin/orders/${encodeURIComponent(key)}`;
}

export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  awaiting_payment: "Awaiting payment",
  payment_failed: "Payment failed",
  processing: "Being delivered",
  delivered: "Delivered",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
  cancelled: "Cancelled",
  expired: "Expired (not paid in time)",
};

export function customerStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return CUSTOMER_STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

export type OrderActionLike = {
  status?: string;
  label: string;
  enabled: boolean;
  disabled_reason?: string | null;
  advanced?: boolean;
  requires_reason?: boolean;
};

/** OR-26: rarely-needed payment transitions (approved / failed) live in a "More" menu. */
export function splitPaymentActions<T extends OrderActionLike>(
  actions: T[] | null | undefined,
): { primary: T[]; advanced: T[] } {
  const list = actions ?? [];
  return {
    primary: list.filter((a) => !a.advanced),
    advanced: list.filter((a) => a.advanced),
  };
}

/** Fulfillment buttons; COMPLETED has its own "Set status: Completed" and CANCELLED is "Cancel order". */
export function fulfillmentButtons<T extends OrderActionLike>(actions: T[] | null | undefined): T[] {
  return (actions ?? []).filter((a) => a.status !== "COMPLETED" && a.status !== "CANCELLED");
}

/** Hint text for a disabled action ("" when enabled). */
export function actionHint(action: OrderActionLike | null | undefined): string {
  if (!action || action.enabled) return "";
  return action.disabled_reason || "Not available for this order right now.";
}

export function refundViaText(via: string | null | undefined): { button: string; explain: string } {
  if (via === "paypal") {
    return {
      button: "Refund through PayPal",
      explain: "The money is sent back to the customer's PayPal account automatically.",
    };
  }
  return {
    button: "Record a manual refund",
    explain:
      "This order was not paid through PayPal. Return the money yourself (cash, bank transfer…) — this only records it.",
  };
}

type CodeLike = {
  status?: string | null;
  status_label?: string | null;
  customer_revealed_at?: string | null;
  revealed_by_customer?: boolean | null;
};

const CODE_STATUS_TEXT: Record<string, string> = {
  AVAILABLE: "In stock",
  RESERVED: "Reserved",
  DELIVERED: "Delivered",
  UNAVAILABLE: "Deactivated",
};

/** D11 / OR-23: "Retired (refunded)" etc. from the API, with a local fallback. */
export function codeStatusText(code: CodeLike, orderPaymentStatus?: string | null): string {
  if (code.status_label) return code.status_label;
  if (code.status === "UNAVAILABLE" && orderPaymentStatus === "REFUNDED") return "Retired (refunded)";
  const status = code.status ?? "";
  return CODE_STATUS_TEXT[status] ?? (status ? status.replaceAll("_", " ").toLowerCase() : "—");
}

export function codeStatusTone(code: CodeLike): "success" | "warning" | "neutral" | "info" {
  switch (code.status) {
    case "DELIVERED":
      return "success";
    case "RESERVED":
      return "warning";
    case "AVAILABLE":
      return "info";
    default:
      return "neutral";
  }
}

export function deliveryStateTone(state: string | null | undefined): "success" | "warning" | "neutral" {
  if (state === "delivered") return "success";
  if (state === "retired_refunded") return "neutral";
  return "warning";
}

type FieldDetailLike = { key: string; label_en?: string | null; value?: unknown; value_label_en?: string | null };

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase() : key;
}

/** OR-21: customer-entered fields with their labels (field_details), falling back to readable keys. */
export function itemFieldRows(item: {
  field_details?: FieldDetailLike[] | null;
  customer_fields?: Record<string, unknown> | null;
}): Array<{ key: string; label: string; value: string }> {
  const rows: Array<{ key: string; label: string; value: string }> = [];
  const seen = new Set<string>();
  for (const detail of item.field_details ?? []) {
    const raw = detail.value;
    if (raw === "" || raw == null) continue;
    seen.add(detail.key);
    const value = detail.value_label_en ? `${detail.value_label_en} (${String(raw)})` : String(raw);
    rows.push({ key: detail.key, label: detail.label_en || humanizeKey(detail.key), value });
  }
  for (const [key, raw] of Object.entries(item.customer_fields ?? {})) {
    if (seen.has(key) || raw === "" || raw == null) continue;
    rows.push({ key, label: humanizeKey(key), value: String(raw) });
  }
  return rows;
}

export function deliveryMethodLabel(method: string | null | undefined): string {
  if (method === "email") return "By e-mail";
  if (method === "account") return "In the customer's account";
  return method || "—";
}

/* ─── Orders list URL state (OR-13) ─── */

export type OrdersView = "" | "needs_action" | "awaiting_payment_24h";

export type OrdersQuery = {
  view: OrdersView;
  payment_status: string;
  fulfillment_status: string;
  search: string;
  ordering: string;
  page: number;
  created_from: string;
  created_to: string;
};

export const ORDER_SORT_FIELDS = ["created_at", "total_fils", "payment_status", "fulfillment_status", "order_number"];

type ParamsLike = { get(name: string): string | null };

function truthy(value: string | null): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

export function parseOrdersQuery(params: ParamsLike): OrdersQuery {
  const view: OrdersView = truthy(params.get("needs_action"))
    ? "needs_action"
    : truthy(params.get("awaiting_payment_24h"))
      ? "awaiting_payment_24h"
      : "";
  const ordering = params.get("ordering") ?? "";
  const bare = ordering.replace(/^-/, "");
  const page = Number(params.get("page") ?? "1");
  return {
    view,
    payment_status: params.get("payment_status") ?? "",
    fulfillment_status: params.get("fulfillment_status") ?? "",
    search: params.get("search") ?? params.get("q") ?? "",
    ordering: ORDER_SORT_FIELDS.includes(bare) ? ordering : "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    created_from: params.get("created_from") ?? "",
    created_to: params.get("created_to") ?? "",
  };
}

/** Query string (without "?") for the orders list; defaults are omitted. */
export function ordersQueryString(q: Partial<OrdersQuery>): string {
  const sp = new URLSearchParams();
  if (q.view === "needs_action") sp.set("needs_action", "1");
  if (q.view === "awaiting_payment_24h") sp.set("awaiting_payment_24h", "1");
  if (q.payment_status) sp.set("payment_status", q.payment_status);
  if (q.fulfillment_status) sp.set("fulfillment_status", q.fulfillment_status);
  if (q.search?.trim()) sp.set("search", q.search.trim());
  if (q.created_from) sp.set("created_from", q.created_from);
  if (q.created_to) sp.set("created_to", q.created_to);
  if (q.ordering && q.ordering !== "-created_at") sp.set("ordering", q.ordering);
  if (q.page && q.page > 1) sp.set("page", String(q.page));
  return sp.toString();
}

/** Click on a sortable header: another column → newest/largest first; same column → flip. */
export function nextOrdering(current: string, field: string): string {
  const active = current || "-created_at";
  if (active === `-${field}`) return field;
  return `-${field}`;
}
