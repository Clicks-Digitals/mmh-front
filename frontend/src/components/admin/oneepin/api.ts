/**
 * 1Epin supplier admin API (backend/suppliers/admin_urls.py). Kept out of the shared
 * `lib/api/admin.ts` so the 1Epin screens can evolve on their own; every request still goes
 * through `adminFetch` (401/403 handling).
 */
import { adminFetch, type ListParams, type Paginated } from "@/lib/api/admin";
import type { OrderDetail } from "@/components/admin/ops/api";

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

const id = (value: number | string) => encodeURIComponent(String(value));

/* ─── Status / connection ─── */

export type OneEpinMode = "mock" | "test" | "live" | string;

export type OneEpinFullStatus = {
  supplier?: string;
  mode?: OneEpinMode;
  environment?: string;
  base_url?: string;
  email_configured?: boolean;
  password_configured?: boolean;
  callback_configured?: boolean;
  credentials_configured?: boolean;
  last_balance?: string | null;
  last_balance_currency?: string;
  last_checked_at?: string | null;
  balance?: { amount: string | null; currency: string; checked_at: string | null };
  low_balance?: boolean;
  low_balance_threshold?: string;
  live_enabled?: boolean;
  live_purchasing?: boolean;
  live_locked?: boolean;
  trading_enabled?: boolean;
  trading_disabled_reason?: string;
  mappings_count_as_stock?: boolean;
  /** Full URL (with the secret token) only for suppliers.write; masked "********" otherwise. */
  callback_url?: string;
  callback_token_configured?: boolean;
  api_settings_url?: string;
  proxy_configured?: boolean;
  outgoing_ip?: string | null;
  outgoing_ip_checked_at?: string | null;
  outgoing_ip_error?: string;
  last_catalog_sync?: string | null;
  last_catalog_sync_result?: Partial<CatalogSyncResult>;
  catalog_items?: number;
  mappings?: number;
  open_alerts?: number;
  orders_in_flight?: number;
  orders_manual_review?: number;
  fx_to_jod?: string;
  currency?: string;
};

export type PingResult = OneEpinFullStatus & { ok?: boolean; message?: string; detail?: string; code?: string };

export type BalanceResult = {
  ok: boolean;
  cached: boolean;
  balance: string | null;
  amount?: string | null;
  currency: string;
  last_checked_at: string | null;
  low_balance?: boolean;
  message: string;
  detail?: string;
  code?: string;
};

export type CatalogSyncResult = {
  ok: boolean;
  created: number;
  updated: number;
  deactivated: number;
  total: number;
  price_alerts?: number;
  environment?: string;
  synced_at?: string;
  message?: string;
  detail?: string;
  code?: string;
};

export function getStatus(token: string, opts: { refreshIp?: boolean } = {}) {
  return adminFetch<OneEpinFullStatus>(`/admin/1epin/status/${opts.refreshIp ? "?refresh_ip=1" : ""}`, { token });
}

export function ping(token: string) {
  return adminFetch<PingResult>("/admin/1epin/ping/", { token, method: "POST" });
}

export function getBalance(token: string) {
  return adminFetch<BalanceResult>("/admin/1epin/balance/", { token });
}

export function refreshBalance(token: string) {
  return adminFetch<BalanceResult>("/admin/1epin/balance/refresh/", { token, method: "POST" });
}

export function syncCatalog(token: string) {
  return adminFetch<CatalogSyncResult>("/admin/1epin/catalog/sync/", { token, method: "POST" });
}

/* ─── Catalog ─── */

export type CatalogItemMappingRef = {
  id: number;
  product: string;
  product_name: string;
  variant: number | null;
  variant_name: string | null;
  variant_sku: string | null;
  auto_buy: boolean;
  ignored: boolean;
};

export type CatalogItem = {
  id: number;
  environment: string;
  external_product_id: string;
  external_category_id: string;
  category_name: string;
  category_type: string;
  product_name: string;
  price: string;
  previous_price: string | null;
  currency: string;
  cost_fils: number | null;
  cost_jod: string | null;
  is_tiered: boolean;
  active: boolean;
  last_seen_at: string | null;
  mapped?: boolean;
  mappings?: CatalogItemMappingRef[];
};

export type CatalogCategory = { id: string; name: string; type: string; products: number };

export function listCatalog(token: string, params?: ListParams) {
  return adminFetch<Paginated<CatalogItem>>(`/admin/1epin/catalog/${toQuery(params)}`, { token });
}

export function listCatalogCategories(token: string) {
  return adminFetch<CatalogCategory[]>("/admin/1epin/catalog/categories/", { token });
}

/* ─── Mappings ─── */

export type CountsAsStockReason =
  | null
  | "ignored"
  | "unmapped_variant"
  | "supplier_inactive"
  | "live_disabled"
  | "unsupported_supplier"
  | "auto_buy_off"
  | "catalog_missing"
  | "catalog_stale"
  | string;

export type OneEpinMapping = {
  id: number;
  supplier_id: number;
  supplier_slug?: string;
  supplier_name?: string;
  product: string;
  product_name: string | null;
  /** Product web address: admin product endpoints are addressed by slug, not id. */
  product_slug?: string | null;
  variant: number | null;
  variant_name: string | null;
  variant_sku: string | null;
  external_product_id: string;
  external_name?: string;
  ignored: boolean;
  created_at?: string;
  catalog_item_id: number | null;
  catalog_item: CatalogItem | null;
  category_type: string;
  quantity_per_unit: number;
  prefer_supplier: boolean;
  auto_buy: boolean;
  allow_loss: boolean;
  max_cost_fils: number | null;
  user_template: string;
  barem: string | null;
  cost: string | null;
  cost_currency: string | null;
  cost_fils: number | null;
  cost_jod: string | null;
  sale_price_fils: number | null;
  sale_price_jod: string | null;
  margin_fils: number | null;
  margin_jod: string | null;
  margin_pct: number | null;
  warning: string;
  warnings: string[];
  counts_as_stock: boolean;
  counts_as_stock_reason: CountsAsStockReason;
  counts_as_stock_message: string;
};

export type MappingSettings = {
  quantity_per_unit?: number;
  prefer_supplier?: boolean;
  auto_buy?: boolean;
  allow_loss?: boolean;
  ignored?: boolean;
  max_cost_fils?: number | null;
  user_template?: string;
  barem?: string | null;
};

export type MappingCreate = MappingSettings & {
  variant_id: number | string;
  catalog_item_id?: number;
  external_product_id?: string;
};

export function listMappings(token: string, params?: ListParams) {
  return adminFetch<Paginated<OneEpinMapping>>(`/admin/1epin/mappings/${toQuery(params)}`, { token });
}

export function getMapping(token: string, mappingId: number | string) {
  return adminFetch<OneEpinMapping>(`/admin/1epin/mappings/${id(mappingId)}/`, { token });
}

export function createMapping(token: string, body: MappingCreate) {
  return adminFetch<OneEpinMapping>("/admin/1epin/mappings/", { token, method: "POST", body: JSON.stringify(body) });
}

export function updateMapping(
  token: string,
  mappingId: number | string,
  body: MappingSettings & { variant_id?: number | string; catalog_item_id?: number },
) {
  return adminFetch<OneEpinMapping>(`/admin/1epin/mappings/${id(mappingId)}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteMapping(token: string, mappingId: number | string) {
  return adminFetch<void>(`/admin/1epin/mappings/${id(mappingId)}/`, { token, method: "DELETE" });
}

/* ─── Supplier orders ─── */

export type SupplierOrderStatus =
  | "NOT_SUBMITTED"
  | "SUBMITTING"
  | "PROCESSING"
  | "WAITING"
  | "COMPLETED"
  | "FAILED"
  | "MANUAL_REVIEW"
  | "UNKNOWN";

export type SupplierOrderRow = {
  id: number;
  order_id: number | null;
  order_number: string | null;
  order_item_id: number;
  attempt: number;
  external_order_number: string;
  environment: string;
  external_product_id: string;
  product_name: string;
  kind: string;
  quantity: number;
  units: number;
  player_user: string;
  status: SupplierOrderStatus | string;
  status_label: string;
  /** A later attempt exists for the same item (shown as "Replaced by attempt N"). */
  superseded?: boolean;
  superseded_by_attempt?: number | null;
  /** Raw 1Epin reason (e.g. "wrong_player_id") behind the readable message. */
  raw_reason?: string;
  placed: boolean;
  result_code: string;
  order_status_code: number | null;
  message: string;
  unit_price: string | null;
  cost: string | null;
  currency: string;
  cost_fils: number | null;
  cost_jod: string | null;
  balance_after: string | null;
  pins_received: number;
  codes_delivered: number;
  submit_count: number;
  check_count: number;
  retry_after: string | null;
  submitted_at: string | null;
  last_checked_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  item: { id: number; product_name: string; variant_name: string; quantity: number } | null;
};

export type SupplierOrderDetail = SupplierOrderRow & {
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  attempts?: Array<{
    id: number;
    attempt: number;
    external_order_number: string;
    status: string;
    message: string;
    created_at: string;
  }>;
  callbacks?: Array<{ id: number; processed: boolean; reason: string; payload: Record<string, unknown>; created_at: string }>;
  api_logs?: Array<{
    id: number;
    action: string;
    ok: boolean;
    result_code: string;
    message: string;
    duration_ms: number | null;
    created_at: string;
  }>;
};

export function listSupplierOrders(token: string, params?: ListParams) {
  return adminFetch<Paginated<SupplierOrderRow>>(`/admin/1epin/orders/${toQuery(params)}`, { token });
}

export function getSupplierOrder(token: string, soId: number | string) {
  return adminFetch<SupplierOrderDetail>(`/admin/1epin/orders/${id(soId)}/`, { token });
}

export function checkSupplierOrder(token: string, soId: number | string) {
  return adminFetch<{ result: string; supplier_order: SupplierOrderRow }>(`/admin/1epin/orders/${id(soId)}/check/`, {
    token,
    method: "POST",
  });
}

/* ─── Per order item (admin order page) ─── */

export type ItemAction = { enabled: boolean; disabled_reason: string; requires_confirmation?: boolean };

export type BuyQuote = {
  mapping_id: number;
  external_product_id: string;
  product_name: string;
  units: number;
  quantity: number;
  cost: string | null;
  currency: string | null;
  cost_fils: number | null;
  cost_jod: string | null;
  sale_fils: number;
  /** Limit for the whole purchase (null = no limit set). */
  max_cost_fils?: number | null;
  over_limit?: boolean;
};

export type ItemSupplierOrder = {
  supplier_order_id: number | null;
  status: SupplierOrderStatus | string | null;
  status_label: string;
  external_order_number: string | null;
  message: string;
  cost: string | null;
  cost_currency: string | null;
  cost_fils: number | null;
  cost_jod: string | null;
  in_flight: boolean;
  attempts: number;
  mapped: boolean;
  mapping_id: number | null;
  updated_at: string | null;
  kind?: "epin" | "topup";
  /** Top-ups: the player value a new purchase sends (rendered user template). */
  player_user?: string | null;
  player_user_error?: string;
  /** Raw 1Epin reason (e.g. "wrong_player_id") behind the readable message. */
  raw_reason?: string;
  actions: {
    check: ItemAction;
    retry: ItemAction;
    buy_now: ItemAction & { quote?: BuyQuote | null };
  };
};

export type ItemActionResponse = OrderDetail & {
  supplier_action?: { result: string; supplier_order: SupplierOrderRow | null };
};

function itemPath(order: number | string, itemId: number | string, action: "check" | "retry" | "buy") {
  return `/admin/orders/${id(order)}/items/${id(itemId)}/supplier/${action}/`;
}

export function itemSupplierCheck(token: string, order: number | string, itemId: number | string) {
  return adminFetch<ItemActionResponse>(itemPath(order, itemId, "check"), { token, method: "POST" });
}

export function itemSupplierRetry(token: string, order: number | string, itemId: number | string) {
  return adminFetch<ItemActionResponse>(itemPath(order, itemId, "retry"), {
    token,
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
}

export function itemSupplierBuy(token: string, order: number | string, itemId: number | string) {
  return adminFetch<ItemActionResponse>(itemPath(order, itemId, "buy"), {
    token,
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
}

/* ─── Alerts ─── */

export type AlertKind = "low_balance" | "config" | "order_failed" | "price_change" | "duplicate_code" | string;

export type SupplierAlert = {
  id: number;
  kind: AlertKind;
  kind_label: string;
  severity: "error" | "warning" | "info" | string;
  message: string;
  order_number: string | null;
  supplier_order_id: number | null;
  occurrences: number;
  meta: Record<string, unknown>;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string;
  created_at: string;
  updated_at: string;
};

export function listAlerts(token: string, params?: ListParams) {
  return adminFetch<Paginated<SupplierAlert>>(`/admin/1epin/alerts/${toQuery(params)}`, { token });
}

export function resolveAlert(token: string, alertId: number | string, note: string) {
  return adminFetch<SupplierAlert>(`/admin/1epin/alerts/${id(alertId)}/resolve/`, {
    token,
    method: "POST",
    body: JSON.stringify(note ? { note } : {}),
  });
}

/* ─── API logs ─── */

export type OneEpinLog = {
  id: number;
  supplier?: string;
  action: string;
  ok: boolean;
  result_code: string;
  order_number: string;
  duration_ms: number | null;
  environment: string;
  message: string;
  created_at: string;
};

/** Latest 50 calls (not paginated); filter by our 1Epin order number and/or action. */
export function listLogs(token: string, params?: { order_number?: string; action?: string }) {
  return adminFetch<OneEpinLog[] | Paginated<OneEpinLog>>(`/admin/1epin/logs/${toQuery(params)}`, { token });
}

/* ─── Dashboard block ─── */

export type DashboardOneEpin = {
  mode: OneEpinMode;
  balance: string | null;
  currency: string | null;
  balance_checked_at: string | null;
  low_balance: boolean;
  open_alerts: number;
  manual_review_orders: number;
};
