/**
 * Operations-side admin API (orders, refunds, payments, dashboard, audit) per
 * API-CONTRACT-2. Kept separate from the shared `lib/api/admin.ts` so both panel tracks can
 * evolve without stepping on each other; requests still go through `adminFetch`.
 */
import {
  adminFetch,
  type AdminCustomer,
  type AdminOrder,
  type AdminUser,
  type AuditLog,
  type Coupon,
  type DashboardStats,
  type ListParams,
  type Paginated,
  type Payment,
} from "@/lib/api/admin";

function toQuery(params?: ListParams): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

/* ─── Orders ─── */

export type OrderAction = {
  status?: string;
  label: string;
  enabled: boolean;
  disabled_reason?: string | null;
  advanced?: boolean;
  requires_reason?: boolean;
};

export type RefundAction = OrderAction & {
  remaining_fils: number;
  remaining_display: string;
  via: "paypal" | "manual" | string;
};

export type OrderActions = {
  fulfillment: OrderAction[];
  payment: OrderAction[];
  cancel: OrderAction;
  complete: OrderAction;
  refund: RefundAction;
};

export type OrderFieldDetail = {
  key: string;
  label_en?: string;
  label_ar?: string;
  value?: unknown;
  value_label_en?: string;
  value_label_ar?: string;
};

export type OrderItemCode = {
  id: number | string;
  masked: string;
  status?: string;
  status_label?: string;
  source?: string;
  delivered_at?: string | null;
  revealed_at?: string | null;
  customer_revealed_at?: string | null;
  revealed_by_customer?: boolean;
};

export type OrderDetailItem = {
  id: number | string;
  product_id?: string;
  variant_id?: number | string;
  product_name?: string;
  variant_name?: string;
  quantity: number;
  unit_price_fils: number;
  line_total_fils?: number;
  fulfillment_type?: string;
  customer_fields?: Record<string, unknown> | null;
  field_details?: OrderFieldDetail[];
  delivery_method?: string;
  delivery_contact?: string;
  region_name?: string;
  platform_name?: string;
  delivered?: boolean;
  delivery_state?: "delivered" | "partial" | "pending" | "retired_refunded" | string;
  delivery_state_label?: string;
  codes_delivered?: number | null;
  codes_pending?: number | null;
  delivered_at?: string | null;
  delivery_note?: string;
  delivery_note_customer_visible?: boolean;
  show_delivery_method?: boolean;
  available_codes_for_variant?: number | null;
  sellable_codes_for_variant?: number | null;
  codes?: OrderItemCode[];
};

export type OrderPayment = Payment & {
  provider_currency?: string;
  capture_id?: string | null;
  amount_display?: string;
  refunded_fils?: number;
  refunded_display?: string;
  voided?: boolean;
};

export type OrderRefund = {
  id: number | string;
  payment_id?: number | string | null;
  provider: string;
  status: string;
  amount_fils: number;
  amount_display?: string;
  currency?: string;
  provider_amount?: string | null;
  provider_currency?: string | null;
  provider_refund_id?: string | null;
  reason?: string;
  actor_email?: string | null;
  created_at: string;
};

export type RefundSummary = {
  paid_fils: number;
  refunded_fils: number;
  pending_refund_fils: number;
  remaining_fils: number;
  paid_display?: string;
  refunded_display?: string;
  remaining_display?: string;
  provider?: string;
  can_refund?: boolean;
};

export type OrderDetail = Omit<AdminOrder, "items" | "payments" | "refunds"> & {
  staff_notes?: string;
  locale?: string;
  payment_provider?: string;
  customer_status?: string;
  reserved_until?: string | null;
  refunded_fils?: number;
  refund_remaining_fils?: number;
  items?: OrderDetailItem[];
  payments?: OrderPayment[];
  refunds?: OrderRefund[];
  refund_summary?: RefundSummary;
  display?: { subtotal?: string; discount?: string; total?: string; refunded?: string; refund_remaining?: string };
  actions?: OrderActions;
};

export type OrderListRow = AdminOrder & {
  total_display?: string;
  payment_provider?: string;
  needs_action?: boolean;
  locale?: string;
};

export function listOrderRows(token: string, params?: ListParams) {
  return adminFetch<Paginated<OrderListRow>>(`/admin/orders/${toQuery(params)}`, { token });
}

function orderPath(id: number | string, suffix = "") {
  return `/admin/orders/${encodeURIComponent(String(id))}/${suffix}`;
}

export function getOrderDetail(token: string, id: number | string) {
  return adminFetch<OrderDetail>(orderPath(id), { token });
}

export function transitionOrderStatus(
  token: string,
  id: number | string,
  body: { payment_status?: string; fulfillment_status?: string; reason?: string },
) {
  return adminFetch<OrderDetail>(orderPath(id, "transition/"), {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** D7: one-step cancel for unpaid orders. */
export function cancelOrder(token: string, id: number | string, reason?: string) {
  return adminFetch<OrderDetail>(orderPath(id, "cancel/"), {
    token,
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

/** D5: omit amount_fils to refund everything that remains. */
export function refundOrder(
  token: string,
  id: number | string,
  body: { amount_fils?: number; reason?: string; manual?: boolean },
) {
  return adminFetch<OrderDetail>(orderPath(id, "refunds/"), {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** D12: internal notes, never shown to the customer. */
export function saveStaffNotes(token: string, id: number | string, staffNotes: string) {
  return adminFetch<OrderDetail>(orderPath(id, "staff-notes/"), {
    token,
    method: "PATCH",
    body: JSON.stringify({ staff_notes: staffNotes }),
  });
}

export type OrderHistoryEntry = {
  id: number | string;
  action: string;
  label?: string;
  entity_type?: string;
  entity_id?: string;
  entity_label?: string;
  order_number?: string | null;
  actor_id?: number | null;
  actor_email?: string | null;
  actor_name?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

export function getOrderHistory(token: string, id: number | string) {
  return adminFetch<{ order_number: string; results: OrderHistoryEntry[] }>(orderPath(id, "history/"), { token });
}

export function fulfillOrderFromStock(token: string, id: number | string) {
  return adminFetch<OrderDetail>(orderPath(id, "fulfill/"), { token, method: "POST" });
}

export function attachItemCode(
  token: string,
  id: number | string,
  itemId: number | string,
  body: { code: string; pin?: string },
) {
  return adminFetch<OrderDetail>(orderPath(id, `items/${encodeURIComponent(String(itemId))}/codes/`), {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function markItemDelivered(token: string, id: number | string, itemId: number | string, note: string) {
  return adminFetch<OrderDetail>(orderPath(id, `items/${encodeURIComponent(String(itemId))}/mark-delivered/`), {
    token,
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function resendDeliveryEmail(token: string, id: number | string) {
  return adminFetch<{ detail: string; sent: string[]; to: string }>(orderPath(id, "resend-email/"), {
    token,
    method: "POST",
  });
}

/* ─── Dashboard ─── */

export type DashboardLinks = Partial<
  Record<
    "awaiting_delivery" | "pending_payment_24h" | "pending_orders" | "manual_review" | "failed_fulfillment" | "today",
    string
  >
>;

export type DashboardActivity = {
  id: number | string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  entity_label?: string;
  order_number?: string | null;
  actor_id?: number | null;
  actor_email?: string | null;
  actor_name?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

export type DashboardData = Omit<DashboardStats, "recent_audit" | "recent_orders"> & {
  revenue_display?: string;
  gross_revenue_fils?: number;
  refunds_fils?: number;
  today?: { orders: number; paid_orders: number; revenue_fils: number; revenue_display?: string; since?: string };
  links?: DashboardLinks;
  recent_orders: OrderListRow[];
  recent_audit: DashboardActivity[] | null;
};

export function getDashboard(token: string) {
  return adminFetch<DashboardData>("/admin/dashboard/", { token });
}

/* ─── Payments ─── */

export function listPaymentRows(token: string, params?: ListParams) {
  return adminFetch<Paginated<OrderPayment>>(`/admin/payments/${toQuery(params)}`, { token });
}

/** OR-15: CSV for reconciliation, same filters as the list. Returns the CSV text. */
export function exportPaymentsCsv(token: string, params?: ListParams) {
  return adminFetch<string>(`/admin/payments/export/${toQuery(params)}`, { token });
}

/* ─── Customers ─── */

export type CustomerRow = Omit<AdminCustomer, "recent_orders"> & {
  user_id?: number | string;
  guest_orders_count?: number;
  recent_orders?: Array<{
    id: number | string;
    order_number: string;
    email?: string;
    total_fils: number;
    payment_status: string;
    fulfillment_status: string;
    created_at: string;
    is_guest?: boolean;
  }>;
};

export function listCustomerRows(token: string, params?: ListParams) {
  return adminFetch<Paginated<CustomerRow>>(`/admin/customers/${toQuery(params)}`, { token });
}

export function getCustomerDetail(token: string, id: string) {
  return adminFetch<CustomerRow>(`/admin/customers/${encodeURIComponent(id)}/`, { token });
}

export function patchCustomer(
  token: string,
  id: number | string,
  body: { phone?: string; status?: string; notes?: string; name?: string; disabled?: boolean },
) {
  return adminFetch<CustomerRow>(`/admin/customers/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/* ─── Coupons ─── */

export type CouponRow = Coupon & {
  status?: "scheduled" | "active" | "expired" | "inactive" | "used_up" | string;
  free_order_risk?: boolean;
  free_order_warning?: string;
};

export function listCouponRows(token: string, params?: ListParams) {
  return adminFetch<Paginated<CouponRow>>(`/admin/coupons/${toQuery(params)}`, { token });
}

/* ─── Audit ─── */

export type AuditRow = AuditLog & {
  actor_name?: string | null;
  entity_label?: string | null;
  order_number?: string | null;
};

export function listAuditRows(token: string, params?: ListParams) {
  return adminFetch<Paginated<AuditRow>>(`/admin/audit/${toQuery(params)}`, { token });
}

/* ─── Administrators ─── */

export type AdminUserRow = AdminUser & { role_label?: string };

export function listAdministratorRows(token: string, params?: ListParams) {
  return adminFetch<Paginated<AdminUserRow> | AdminUserRow[]>(`/admin/administrators/${toQuery(params)}`, { token });
}
