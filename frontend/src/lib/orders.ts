/** Customer-facing order model shared by the success page, /order/[number] and the account pages. */

export type ApiOrderItem = {
  id: number;
  product_id?: string;
  variant_id?: number | null;
  quantity: number;
  unit_price_fils: number;
  line_total_fils?: number;
  product_name: string;
  variant_name?: string;
  fulfillment_type?: string;
  customer_fields?: Record<string, string> | null;
  delivery_method?: string;
  delivery_contact?: string;
  region_name?: string;
  platform_name?: string;
  delivered?: boolean;
  delivered_at?: string | null;
  codes?: Array<{ id: number; masked: string }>;
};

export type ApiOrder = {
  id: number;
  order_number: string;
  email?: string;
  full_name?: string;
  subtotal_fils?: number;
  discount_fils?: number;
  total_fils?: number;
  total_jod: number | string;
  currency?: string;
  payment_status: string;
  payment_provider?: string;
  fulfillment_status: string;
  created_at: string;
  items: ApiOrderItem[];
};

export type ApiRevealedCodes = {
  order_number: string;
  items: Array<{
    item_id: number;
    product_name: string;
    variant_name?: string;
    quantity: number;
    codes: Array<{ id: number; code: string; pin?: string }>;
  }>;
};

export type OrderFulfillmentType = "CODE" | "DIRECT_TOPUP";

export interface OrderItemView {
  id: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPriceFils: number;
  lineTotalFils: number;
  fulfillmentType: OrderFulfillmentType;
  fields: Array<{ key: string; label: string; maskedValue: string }>;
  regionName: string;
  platformName: string;
  delivered: boolean;
  deliveredAt: string | null;
  codes: Array<{ id: string; masked: string }>;
}

export interface OrderView {
  id: string;
  number: string;
  createdAt: string;
  email: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  paymentProvider: string;
  currency: string;
  subtotalFils: number;
  discountFils: number;
  totalFils: number;
  items: OrderItemView[];
}

export interface RevealedCode {
  id: string;
  code: string;
  pin: string;
}

/** Revealed codes keyed by order item id. */
export type RevealedCodes = Record<string, RevealedCode[]>;

const FIELD_LABELS: Record<string, string> = {
  playerId: "Player ID",
  userId: "User ID",
  zoneId: "Zone ID",
  serverId: "Server ID",
  characterId: "Character ID",
  email: "Email",
};

export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Mask account identifiers for display: keep the first 2 and last 2 characters. */
export function maskValue(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "••••";
  return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
}

function toFils(value: number | string | undefined, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export function mapApiOrder(order: ApiOrder): OrderView {
  const items = (order.items ?? []).map<OrderItemView>((item) => {
    const unit = toFils(item.unit_price_fils);
    return {
      id: String(item.id),
      productName: item.product_name,
      variantName: item.variant_name ?? "",
      quantity: item.quantity,
      unitPriceFils: unit,
      lineTotalFils: toFils(item.line_total_fils, unit * item.quantity),
      fulfillmentType: item.fulfillment_type === "DIRECT_TOPUP" ? "DIRECT_TOPUP" : "CODE",
      fields: Object.entries(item.customer_fields ?? {})
        .filter(([, value]) => String(value ?? "").trim())
        .map(([key, value]) => ({ key, label: fieldLabel(key), maskedValue: maskValue(String(value)) })),
      regionName: item.region_name ?? "",
      platformName: item.platform_name ?? "",
      delivered: Boolean(item.delivered),
      deliveredAt: item.delivered_at ?? null,
      codes: (item.codes ?? []).map((code) => ({ id: String(code.id), masked: code.masked })),
    };
  });
  const subtotal = toFils(order.subtotal_fils, items.reduce((sum, item) => sum + item.lineTotalFils, 0));
  const discount = toFils(order.discount_fils, 0);
  const total = toFils(order.total_fils, Math.round(Number(order.total_jod) * 1000) || subtotal - discount);
  return {
    id: String(order.id),
    number: order.order_number,
    createdAt: order.created_at,
    email: order.email ?? "",
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    paymentProvider: order.payment_provider ?? "",
    currency: order.currency ?? "JOD",
    subtotalFils: subtotal,
    discountFils: discount,
    totalFils: total,
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

export function isPaid(order: Pick<OrderView, "paymentStatus">): boolean {
  return order.paymentStatus === "PAID";
}

/** Fully delivered: every item delivered, or fulfillment completed. */
export function isDelivered(order: OrderView): boolean {
  if (order.fulfillmentStatus === "COMPLETED") return true;
  return order.items.length > 0 && order.items.every((item) => item.delivered);
}

/** The success page keeps polling while a paid order is still waiting for delivery. */
export function shouldPollOrder(order: OrderView | null): boolean {
  if (!order) return false;
  if (order.paymentStatus === "PENDING" || order.paymentStatus === "AUTHORIZED") return true;
  if (order.fulfillmentStatus === "CANCELLED" || order.fulfillmentStatus === "FAILED") return false;
  return isPaid(order) && !isDelivered(order);
}

export type TimelineStep = { key: "placed" | "paid" | "processing" | "delivered"; done: boolean; current: boolean };

export function orderTimeline(order: OrderView): TimelineStep[] {
  const paid = isPaid(order) || order.paymentStatus === "REFUNDED" || order.paymentStatus === "PARTIALLY_REFUNDED";
  const delivered = isDelivered(order);
  const processing = paid && (delivered || order.items.some((item) => item.delivered) || order.fulfillmentStatus !== "NOT_STARTED");
  const steps: TimelineStep[] = [
    { key: "placed", done: true, current: false },
    { key: "paid", done: paid, current: false },
    { key: "processing", done: processing, current: false },
    { key: "delivered", done: delivered, current: false },
  ];
  const firstOpen = steps.findIndex((step) => !step.done);
  if (firstOpen >= 0) steps[firstOpen].current = true;
  return steps;
}
