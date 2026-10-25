/** Customer-facing order model shared by the success page, /order/[number] and the account pages. */

import type { Locale } from "@/types";

export type ApiFieldDetail = {
  key: string;
  label_en?: string;
  label_ar?: string;
  value: string;
  value_label_en?: string;
  value_label_ar?: string;
};

export type ApiOrderItem = {
  id: number;
  product_id?: string;
  variant_id?: number | null;
  quantity: number;
  unit_price_fils: number;
  line_total_fils?: number;
  product_name: string;
  product_name_ar?: string;
  variant_name?: string;
  variant_name_ar?: string;
  fulfillment_type?: string;
  customer_fields?: Record<string, string> | null;
  field_details?: ApiFieldDetail[] | null;
  delivery_method?: string;
  delivery_contact?: string;
  region_name?: string;
  region_name_ar?: string;
  platform_name?: string;
  platform_name_ar?: string;
  delivered?: boolean;
  delivery_state?: string;
  codes_delivered?: number | null;
  codes_pending?: number | null;
  delivered_at?: string | null;
  delivery_note?: string;
  codes?: Array<{ id: number; masked: string }>;
};

/** One customer-facing state computed by the backend (customer_status). */
export type CustomerOrderStatus =
  | "awaiting_payment"
  | "payment_failed"
  | "processing"
  | "delivered"
  | "partially_refunded"
  | "refunded"
  | "cancelled"
  | "expired";

export type ApiOrder = {
  id: number;
  order_number: string;
  email?: string;
  full_name?: string;
  phone?: string;
  notes?: string;
  locale?: string;
  coupon_code?: string | null;
  subtotal_fils?: number;
  discount_fils?: number;
  total_fils?: number;
  total_jod: number | string;
  refunded_fils?: number;
  currency?: string;
  payment_status: string;
  payment_provider?: string;
  fulfillment_status: string;
  status?: string;
  awaiting_payment?: boolean;
  can_pay?: boolean;
  can_cancel?: boolean;
  created_at: string;
  items: ApiOrderItem[];
};

export type ApiRevealedCodes = {
  order_number: string;
  items: Array<{
    item_id: number;
    product_name: string;
    product_name_ar?: string;
    variant_name?: string;
    variant_name_ar?: string;
    quantity: number;
    codes_pending?: number;
    codes: Array<{ id: number; code: string; pin?: string }>;
  }>;
};

export type OrderFulfillmentType = "CODE" | "DIRECT_TOPUP";

export type DeliveryState = "delivered" | "partial" | "pending" | "retired_refunded";

export interface OrderFieldView {
  key: string;
  label: string;
  labelAr: string;
  /** Masked (long free-text values) or the option label (dropdowns). */
  displayValue: string;
  displayValueAr: string;
}

export interface OrderItemView {
  id: string;
  productName: string;
  productNameAr: string;
  variantName: string;
  variantNameAr: string;
  quantity: number;
  unitPriceFils: number;
  lineTotalFils: number;
  fulfillmentType: OrderFulfillmentType;
  fields: OrderFieldView[];
  regionName: string;
  regionNameAr: string;
  platformName: string;
  platformNameAr: string;
  delivered: boolean;
  deliveryState: DeliveryState;
  /** CODE items only; null for top-ups. */
  codesDelivered: number | null;
  codesPending: number | null;
  deliveredAt: string | null;
  deliveryNote: string;
  codes: Array<{ id: string; masked: string }>;
}

export interface OrderView {
  id: string;
  number: string;
  createdAt: string;
  email: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  status: CustomerOrderStatus;
  canPay: boolean;
  canCancel: boolean;
  paymentProvider: string;
  currency: string;
  subtotalFils: number;
  discountFils: number;
  totalFils: number;
  refundedFils: number;
  couponCode: string;
  notes: string;
  items: OrderItemView[];
}

export interface RevealedCode {
  id: string;
  code: string;
  pin: string;
}

/** Revealed codes keyed by order item id. */
export type RevealedCodes = Record<string, RevealedCode[]>;

const FIELD_LABELS: Record<string, { en: string; ar: string }> = {
  playerId: { en: "Player ID", ar: "معرّف اللاعب" },
  userId: { en: "User ID", ar: "معرّف المستخدم" },
  zoneId: { en: "Zone ID", ar: "معرّف المنطقة" },
  serverId: { en: "Server ID", ar: "معرّف الخادم" },
  characterId: { en: "Character ID", ar: "معرّف الشخصية" },
  email: { en: "Email", ar: "البريد الإلكتروني" },
};

export function fieldLabel(key: string, locale: Locale = "en"): string {
  const known = FIELD_LABELS[key];
  if (known) return known[locale];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Mask account identifiers for display (ST-28): short values (≤ 4 characters, e.g. a Zone ID)
 * are shown as typed; longer ones keep only the last 3 characters.
 */
export function maskValue(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return trimmed;
  return `•••${trimmed.slice(-3)}`;
}

function toFils(value: number | string | undefined | null, fallback = 0): number {
  const n = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(n) ? Math.round(n) : fallback;
}

const STATUSES: CustomerOrderStatus[] = [
  "awaiting_payment",
  "payment_failed",
  "processing",
  "delivered",
  "partially_refunded",
  "refunded",
  "cancelled",
  "expired",
];

/** Fallback for older payloads without `status` (mirrors backend customer_status). */
export function deriveCustomerStatus(paymentStatus: string, fulfillmentStatus: string): CustomerOrderStatus {
  if (paymentStatus === "REFUNDED") return "refunded";
  if (fulfillmentStatus === "CANCELLED" || paymentStatus === "CANCELLED") return "cancelled";
  if (paymentStatus === "PARTIALLY_REFUNDED") return "partially_refunded";
  if (paymentStatus === "PAID") return fulfillmentStatus === "COMPLETED" ? "delivered" : "processing";
  if (paymentStatus === "FAILED") return "payment_failed";
  return "awaiting_payment";
}

function itemFields(item: ApiOrderItem): OrderFieldView[] {
  const details = item.field_details?.length
    ? item.field_details
    : Object.entries(item.customer_fields ?? {}).map(([key, value]) => ({ key, value: String(value ?? "") }) as ApiFieldDetail);
  return details
    .filter((detail) => String(detail.value ?? "").trim())
    .map((detail) => {
      const optionEn = detail.value_label_en?.trim();
      const optionAr = detail.value_label_ar?.trim();
      const masked = maskValue(String(detail.value));
      return {
        key: detail.key,
        label: detail.label_en?.trim() || fieldLabel(detail.key, "en"),
        labelAr: detail.label_ar?.trim() || detail.label_en?.trim() || fieldLabel(detail.key, "ar"),
        displayValue: optionEn || masked,
        displayValueAr: optionAr || optionEn || masked,
      };
    });
}

function deliveryStateOf(item: ApiOrderItem, codeCount: number): DeliveryState {
  const state = item.delivery_state;
  if (state === "delivered" || state === "partial" || state === "pending" || state === "retired_refunded") return state;
  if (item.delivered) return "delivered";
  return codeCount > 0 ? "partial" : "pending";
}

export function mapApiOrder(order: ApiOrder): OrderView {
  const items = (order.items ?? []).map<OrderItemView>((item) => {
    const unit = toFils(item.unit_price_fils);
    const fulfillmentType: OrderFulfillmentType = item.fulfillment_type === "DIRECT_TOPUP" ? "DIRECT_TOPUP" : "CODE";
    const codes = (item.codes ?? []).map((code) => ({ id: String(code.id), masked: code.masked }));
    const isCode = fulfillmentType === "CODE";
    const codesDelivered = isCode ? toFils(item.codes_delivered, Math.min(codes.length, item.quantity)) : null;
    const codesPending = isCode ? toFils(item.codes_pending, Math.max(item.quantity - (codesDelivered ?? 0), 0)) : null;
    return {
      id: String(item.id),
      productName: item.product_name,
      productNameAr: item.product_name_ar || item.product_name,
      variantName: item.variant_name ?? "",
      variantNameAr: item.variant_name_ar || item.variant_name || "",
      quantity: item.quantity,
      unitPriceFils: unit,
      lineTotalFils: toFils(item.line_total_fils, unit * item.quantity),
      fulfillmentType,
      fields: itemFields(item),
      regionName: item.region_name ?? "",
      regionNameAr: item.region_name_ar || item.region_name || "",
      platformName: item.platform_name ?? "",
      platformNameAr: item.platform_name_ar || item.platform_name || "",
      delivered: Boolean(item.delivered),
      deliveryState: deliveryStateOf(item, codes.length),
      codesDelivered,
      codesPending,
      deliveredAt: item.delivered_at ?? null,
      deliveryNote: (item.delivery_note ?? "").trim(),
      codes,
    };
  });
  const subtotal = toFils(order.subtotal_fils, items.reduce((sum, item) => sum + item.lineTotalFils, 0));
  const discount = toFils(order.discount_fils, 0);
  const total = toFils(order.total_fils, Math.round(Number(order.total_jod) * 1000) || subtotal - discount);
  const status = STATUSES.includes(order.status as CustomerOrderStatus)
    ? (order.status as CustomerOrderStatus)
    : deriveCustomerStatus(order.payment_status, order.fulfillment_status);
  return {
    id: String(order.id),
    number: order.order_number,
    createdAt: order.created_at,
    email: order.email ?? "",
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    status,
    canPay: Boolean(order.can_pay),
    canCancel: Boolean(order.can_cancel),
    paymentProvider: order.payment_provider ?? "",
    currency: order.currency ?? "JOD",
    subtotalFils: subtotal,
    discountFils: discount,
    totalFils: total,
    refundedFils: toFils(order.refunded_fils, 0),
    couponCode: order.coupon_code ?? "",
    notes: order.notes ?? "",
    items,
  };
}

export function mapRevealedCodes(data: ApiRevealedCodes): RevealedCodes {
  const result: RevealedCodes = {};
  for (const item of data.items ?? []) {
    result[String(item.item_id)] = (item.codes ?? []).map((code) => ({
      id: String(code.id),
      code: code.code,
      pin: code.pin ?? "",
    }));
  }
  return result;
}

export function hasCodeItems(order: OrderView): boolean {
  return order.items.some((item) => item.fulfillmentType === "CODE");
}

export function deliveredCodeCount(order: OrderView): number {
  return order.items.reduce((sum, item) => sum + (item.fulfillmentType === "CODE" ? item.codes.length : 0), 0);
}

/** D4: partially refunded orders count as paid (codes stay revealable). */
export function isPaid(order: Pick<OrderView, "paymentStatus">): boolean {
  return order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED";
}

/** The order is closed: no delivery copy, spinners or polling (OR-07). */
export function isClosed(order: Pick<OrderView, "status">): boolean {
  return order.status === "cancelled" || order.status === "expired" || order.status === "refunded";
}

/** Fully delivered: every item delivered, or fulfillment completed. */
export function isDelivered(order: OrderView): boolean {
  if (order.fulfillmentStatus === "COMPLETED") return true;
  return order.items.length > 0 && order.items.every((item) => item.delivered);
}

/** Codes still on the way for a paid order (partial delivery, ST-28). */
export function pendingCodeCount(order: OrderView): { delivered: number; total: number; pending: number } {
  let delivered = 0;
  let total = 0;
  for (const item of order.items) {
    if (item.fulfillmentType !== "CODE") continue;
    total += item.quantity;
    delivered += item.codesDelivered ?? item.codes.length;
  }
  return { delivered, total, pending: Math.max(total - delivered, 0) };
}

/** The success page keeps polling while a payment is being confirmed or a paid order awaits delivery. */
export function shouldPollOrder(order: OrderView | null): boolean {
  if (!order) return false;
  if (isClosed(order) || order.status === "payment_failed") return false;
  if (order.fulfillmentStatus === "CANCELLED" || order.fulfillmentStatus === "FAILED") return false;
  if (order.paymentStatus === "PENDING" || order.paymentStatus === "AUTHORIZED") return true;
  return isPaid(order) && !isDelivered(order);
}

export type TimelineStep = { key: "placed" | "paid" | "processing" | "delivered"; done: boolean; current: boolean };

export function orderTimeline(order: OrderView): TimelineStep[] {
  const paid = isPaid(order) || order.paymentStatus === "REFUNDED";
  const delivered = isDelivered(order);
  const processing = paid && (delivered || order.items.some((item) => item.delivered) || order.fulfillmentStatus !== "NOT_STARTED");
  const steps: TimelineStep[] = [
    { key: "placed", done: true, current: false },
    { key: "paid", done: paid, current: false },
    { key: "processing", done: processing, current: false },
    { key: "delivered", done: delivered, current: false },
  ];
  const firstOpen = steps.findIndex((step) => !step.done);
  if (firstOpen >= 0 && !isClosed(order)) steps[firstOpen].current = true;
  return steps;
}
