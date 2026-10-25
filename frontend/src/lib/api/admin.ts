import { ApiError, apiErrorCode, apiFetch } from "@/lib/api/client";
import { emitAdminApiError } from "@/components/admin/ops/api-events";

/* ─── Shared shapes ─── */

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type ListParams = {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  [key: string]: string | number | boolean | undefined | null;
};

export type DashboardTopProduct = {
  product_id: string | number;
  product_name: string;
  quantity: number;
  revenue_fils: number;
  orders: number;
};

export type DashboardAudit = {
  id: number;
  action: string;
  entity_type?: string;
  entity_id?: string;
  created_at: string;
  actor_id?: number | null;
};

export type DashboardStats = {
  revenue_fils: number;
  orders_count: number;
  customers_count: number;
  products_count: number;
  active_products: number;
  codes_available: number;
  low_stock_variants: number;
  low_stock_threshold?: number;
  out_of_stock_variants?: number;
  pending_orders: number;
  pending_payment_24h?: number;
  awaiting_delivery?: number;
  manual_review?: number;
  failed_fulfillment: number;
  active_suppliers: number;
  order_status_breakdown: Array<{
    payment_status: string;
    fulfillment_status: string;
    count: number;
  }>;
  top_products: DashboardTopProduct[];
  recent_orders: AdminOrder[];
  recent_audit: DashboardAudit[];
};

export type AdminProduct = {
  id: string;
  slug: string;
  kind: string;
  fulfillment_type?: string;
  brand?: string;
  artwork_key?: string | null;
  image_url?: string | null;
  primary_image_url?: string | null;
  status: string;
  featured?: boolean;
  bestseller?: boolean;
  trending?: boolean;
  rating?: number | null;
  review_count?: number;
  badges?: string[];
  tags?: string[];
  name_en: string;
  name_ar?: string;
  short_description_en?: string;
  short_description_ar?: string;
  description_en?: string;
  description_ar?: string;
  instructions_en?: string;
  instructions_ar?: string;
  how_to_use_en?: string[];
  how_to_use_ar?: string[];
  region_restrictions_en?: string;
  region_restrictions_ar?: string;
  refund_policy_en?: string;
  refund_policy_ar?: string;
  region_warning_en?: string;
  region_warning_ar?: string;
  delivery_estimate_en?: string;
  delivery_estimate_ar?: string;
  account_currency?: string;
  source?: string;
  refundable?: boolean;
  sort_order?: number;
  price_jod?: number | null;
  price_min_fils?: number | null;
  price_max_fils?: number | null;
  price_min_jod?: number | null;
  price_max_jod?: number | null;
  variants_count?: number;
  codes_available?: number;
  category_slug?: string | null;
  category_name?: string | null;
  platform_slug?: string | null;
  platform_name?: string | null;
  category_id?: number | string | null;
  platform_id?: number | string | null;
  category?: AdminCategory | null;
  platform?: AdminPlatform | null;
  variants?: AdminVariant[];
  fields?: AdminProductField[];
  media?: AdminMediaAsset[];
  supplier_mappings?: AdminSupplierMapping[];
  supplier_names?: string[];
  region_labels?: string[];
  /** CA-20: e.g. ["no_published_variants"] on detail/write responses */
  warnings?: string[];
  created_at?: string;
  updated_at?: string;
};

export type AdminMediaAsset = {
  id: number | string;
  key: string;
  url: string;
  alt?: string;
  mime_type?: string;
  product?: string | null;
  sort_order?: number;
  is_primary?: boolean;
  created_at?: string;
};

export type AdminSupplierMapping = {
  id: number | string;
  supplier_id: number | string;
  supplier_slug?: string;
  supplier_name?: string;
  product?: string;
  variant?: number | string | null;
  variant_sku?: string | null;
  variant_name?: string | null;
  external_product_id: string;
  external_name?: string;
  ignored?: boolean;
  created_at?: string;
  /** D18: only true when the supplier is active and live purchasing is enabled */
  counts_as_stock?: boolean;
  counts_as_stock_reason?: string | null;
  counts_as_stock_message?: string;
};

/** D17: options of a SELECT customer field */
export type AdminFieldOption = { value: string; label_en: string; label_ar?: string };

export type AdminProductField = {
  id?: number | string;
  key: string;
  type: string;
  required: boolean;
  sort_order?: number;
  label_en?: string;
  label_ar?: string;
  placeholder_en?: string;
  placeholder_ar?: string;
  help_text_en?: string;
  help_text_ar?: string;
  /** D17: "text" | "numeric" | "alphanumeric" | "email" | "phone" */
  input_format?: string;
  min_length?: number | null;
  max_length?: number | null;
  options?: AdminFieldOption[];
  delete?: boolean;
};

export type ProductWritePayload = Record<string, unknown> & {
  id: string;
  slug: string;
  kind: string;
  fulfillment_type: string;
  category_id: number | string;
  platform_id: number | string;
  brand: string;
  artwork_key: string;
  status?: string;
  name_en: string;
  name_ar?: string;
  short_description_en?: string;
  short_description_ar?: string;
  description_en?: string;
  description_ar?: string;
  featured?: boolean;
  bestseller?: boolean;
  trending?: boolean;
  source?: string;
  account_currency?: string;
  variants?: Array<Record<string, unknown>>;
  fields?: Array<Record<string, unknown>>;
};

export type AdminVariant = {
  id: number | string;
  sku: string;
  external_id?: string | null;
  denomination?: string | null;
  package_value?: string | null;
  package_currency?: string | null;
  price_fils: number;
  compare_at_price_fils?: number | null;
  cost_fils?: number | null;
  price_jod?: number;
  compare_at_price_jod?: number | null;
  stock_status?: string;
  min_quantity?: number;
  max_quantity?: number;
  sort_order?: number;
  published?: boolean;
  name_en?: string;
  name_ar?: string;
  region?: number | null;
  region_slug?: string | null;
  product?: string;
  codes_available?: number;
  codes_reserved?: number;
  codes_delivered?: number;
  low_stock?: boolean;
  available_codes?: number;
  effective_stock_status?: string;
  available?: boolean;
  available_quantity?: number | null;
  product_name?: string;
  fulfillment_type?: string;
};

export type AdminCategory = {
  id: number | string;
  slug: string;
  href?: string;
  artwork_key?: string | null;
  artwork_url?: string | null;
  status: string;
  sort_order?: number;
  name_en: string;
  name_ar?: string;
  description_en?: string;
  description_ar?: string;
  parent?: number | string | null;
  parent_slug?: string | null;
  products_count?: number;
  /** D20: shown in the store's top menu */
  show_in_menu?: boolean;
  children?: Array<{ id: number | string; slug: string; name_en: string }>;
};

export type AdminPlatform = {
  id: number | string;
  slug: string;
  artwork_key?: string | null;
  status: string;
  sort_order?: number;
  name_en: string;
  name_ar?: string;
  products_count?: number;
};

export type AdminRegion = {
  id: number | string;
  slug: string;
  currency: string;
  locked?: boolean;
  name_en: string;
  name_ar?: string;
  variants_count?: number;
};

export type AdminOrderCode = {
  id: number | string;
  masked: string;
  status?: string;
  source?: string;
  delivered_at?: string | null;
};

export type AdminOrderItem = {
  id: number | string;
  product_id?: string;
  variant_id?: number | string;
  product_name?: string;
  variant_name?: string;
  variant_sku?: string;
  quantity: number;
  unit_price_fils: number;
  line_total_fils?: number;
  fulfillment_type?: string;
  customer_fields?: Record<string, unknown> | null;
  delivery_method?: string;
  delivery_contact?: string;
  region_name?: string;
  platform_name?: string;
  delivered?: boolean;
  delivered_at?: string | null;
  delivery_note?: string;
  available_codes_for_variant?: number | null;
  codes?: AdminOrderCode[];
};

export type AdminRefund = {
  payment_id: number | string;
  provider: string;
  id: string;
  status: string;
  amount: string | number;
  currency: string;
};

export type AdminOrder = {
  id: number | string;
  order_number: string;
  email: string;
  full_name: string;
  phone?: string;
  notes?: string;
  payment_status: string;
  fulfillment_status: string;
  total_fils: number;
  subtotal_fils?: number;
  discount_fils?: number;
  total_jod?: number;
  currency?: string;
  item_count?: number;
  user?: number | string | null;
  coupon?: number | string | null;
  coupon_code?: string | null;
  items?: AdminOrderItem[];
  payments?: Payment[];
  refunds?: AdminRefund[];
  can_cancel?: boolean;
  allowed_payment_transitions?: string[];
  allowed_fulfillment_transitions?: string[];
  region_confirmed?: boolean;
  refund_confirmed?: boolean;
  created_at: string;
  updated_at?: string;
};

export type AdminCustomer = {
  id: number | string;
  email: string;
  name: string;
  phone?: string;
  status?: string;
  notes?: string;
  locale?: string;
  disabled?: boolean;
  created_at?: string;
  updated_at?: string;
  orders_count?: number;
  total_spent_fils?: number;
  recent_orders?: Array<{
    id: number | string;
    order_number: string;
    total_fils: number;
    payment_status: string;
    fulfillment_status: string;
    created_at: string;
  }>;
};

export type DigitalCodeRow = {
  id: number | string;
  masked: string;
  status?: string;
  source?: string;
  variant?: number | string | null;
  variant_sku?: string;
  variant_name?: string;
  product_id?: string | null;
  product_name?: string | null;
  order_item?: number | string | null;
  order_number?: string | null;
  revealed_at?: string | null;
  delivered_at?: string | null;
  created_at?: string;
  status_label?: string;
  revealed_by_email?: string | null;
  customer_revealed_at?: string | null;
  revealed_by_customer?: boolean;
};

export type CodeImportPreviewRow = {
  row: number;
  sku?: string;
  variant_id?: number | null;
  code_masked?: string;
  pin_masked?: string;
  status: string;
  error?: string;
};

export type CodeImportBatch = {
  id: number;
  filename: string;
  mode: string;
  status: string;
  variant?: number | null;
  variant_sku?: string | null;
  variant_name?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  uploaded_by?: number | null;
  uploaded_by_email?: string | null;
  total_rows: number;
  valid_rows: number;
  imported_rows: number;
  duplicate_rows: number;
  failed_rows: number;
  preview_rows?: CodeImportPreviewRow[];
  error_report?: Array<{ row: number; sku?: string; error: string; type?: "duplicate" | "invalid" | string }>;
  auto_delivered_orders?: number;
  /** confirm response only (D3) */
  waiting_orders?: { delivered: number; partially_delivered: number; order_numbers: string[] };
  waiting_orders_message?: string;
  created_at: string;
  completed_at?: string | null;
};

export type InventoryOverview = {
  stats: {
    variants_total: number;
    out_of_stock: number;
    in_stock: number;
    codes_available: number;
    codes_reserved?: number;
    codes_delivered?: number;
    codes_unavailable?: number;
    codes_total?: number;
    low_stock_threshold: number;
    /** D24: published CODE variants by sellable status */
    tracked_variants?: number;
    effective_in_stock?: number;
    effective_out_of_stock?: number;
    low_stock?: number;
    low_stock_rule?: string;
  };
  low_stock_variants: AdminVariant[];
};

export type Supplier = {
  id: number | string;
  slug: string;
  name: string;
  active: boolean;
  environment?: string;
  email_configured?: boolean;
  password_configured?: boolean;
  callback_configured?: boolean;
  last_balance?: string | null;
  last_checked_at?: string | null;
  created_at?: string;
  live_locked?: boolean;
  live_purchasing?: boolean;
  mappings?: SupplierMappingRow[];
  recent_orders?: Array<{
    id: number | string;
    order_item_id?: number | string;
    supplier_ref?: string;
    status?: string;
    created_at?: string;
  }>;
  recent_logs?: SupplierLog[];
};

export type SupplierMappingRow = {
  id: number | string;
  product: string;
  product_name?: string | null;
  variant?: number | string | null;
  variant_name?: string | null;
  variant_sku?: string | null;
  external_product_id: string;
  external_name?: string;
  ignored?: boolean;
  created_at?: string;
  counts_as_stock?: boolean;
  counts_as_stock_reason?: string | null;
  counts_as_stock_message?: string;
};

export type SupplierLog = {
  id: number | string;
  action: string;
  ok?: boolean;
  status?: string;
  status_code?: number | null;
  message?: string;
  created_at: string;
  meta?: Record<string, unknown>;
};

export type OneEpinStatus = {
  supplier?: string;
  mode?: string;
  environment?: string;
  email_configured?: boolean;
  password_configured?: boolean;
  callback_configured?: boolean;
  last_balance?: string | null;
  last_balance_currency?: string;
  last_checked_at?: string | null;
  live_locked?: boolean;
  credentials_configured?: boolean;
  live_purchasing?: boolean;
};

export type OneEpinPingResult = OneEpinStatus & { ok?: boolean; message?: string; detail?: string; code?: string };

export type OneEpinBalance = {
  ok: boolean;
  cached: boolean;
  balance: string | null;
  amount?: string | null;
  currency: string;
  last_checked_at: string | null;
  message: string;
  detail?: string;
};

export type OneEpinSyncResult = {
  ok: boolean;
  noop?: boolean;
  message?: string;
  detail?: string;
  [key: string]: unknown;
};

export type Payment = {
  id: number | string;
  order?: number | string;
  order_number?: string;
  provider: string;
  status: string;
  amount_fils: number;
  currency?: string;
  provider_amount?: string;
  provider_order_id?: string | null;
  provider_capture_id?: string | null;
  external_ref?: string | null;
  external_id?: string | null;
  paid_at?: string | null;
  created_at: string;
  updated_at?: string;
};

export type Coupon = {
  id: number | string;
  code: string;
  description?: string;
  percent_off?: number | string | null;
  amount_off_fils?: number | null;
  active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  max_uses?: number | null;
  max_uses_per_customer?: number | null;
  used_count?: number;
  created_at?: string;
};

export type Banner = {
  id: number | string;
  href: string;
  kicker?: string;
  tone?: string;
  placement?: string;
  desktop_image?: string;
  mobile_image?: string;
  desktop_image_url?: string;
  mobile_image_url?: string;
  title_en: string;
  title_ar?: string;
  subtitle_en?: string;
  subtitle_ar?: string;
  published: boolean;
  sort_order?: number;
  start_at?: string | null;
  end_at?: string | null;
  /** CA-24: computed by the API */
  status?: "unpublished" | "scheduled" | "expired" | "live" | string;
  created_at?: string;
  updated_at?: string;
};

export type FAQ = {
  id: number | string;
  question_en: string;
  question_ar?: string;
  answer_en: string;
  answer_ar?: string;
  published: boolean;
  sort_order?: number;
};

export type ContentPage = {
  id: number | string;
  slug: string;
  title_en: string;
  title_ar?: string;
  body_en?: string;
  body_ar?: string;
  published: boolean;
  /** D19 */
  show_in_footer?: boolean;
  sort_order?: number;
  updated_at?: string;
};

export type AdminUser = {
  id: number | string;
  email: string;
  first_name?: string;
  last_name?: string;
  kind?: string;
  role: string;
  title?: string;
  permissions?: string[];
  disabled?: boolean;
  date_joined?: string;
  last_login?: string | null;
  created_at?: string;
};

export type RoleInfo = {
  role: string;
  label: string;
  permissions: string[];
  editable?: boolean;
};

export type PermissionInfo = {
  key: string;
  description: string;
};

export type AuditLog = {
  id: number | string;
  actor?: number | null;
  actor_email?: string | null;
  action: string;
  entity_type?: string;
  entity_id?: string;
  meta?: Record<string, unknown>;
  created_at: string;
};

export type SiteSettings = {
  store_name: string;
  support_email?: string;
  support_phone?: string;
  business_hours?: string;
  whatsapp_number?: string;
  telegram_url?: string;
  instagram_url?: string;
  facebook_url?: string;
  tiktok_url?: string;
  youtube_url?: string;
  low_stock_threshold?: number;
  maintenance_mode?: boolean;
  updated_at?: string;
};

/* ─── Helpers ─── */

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

/** Fetch under `/api/v1/admin/...`. Accepts `/admin/...` or a relative admin path. */
export async function adminFetch<T>(path: string, init?: RequestInit & { token?: string }) {
  const trimmed = path.startsWith("/") ? path : `/${path}`;
  const full = trimmed.startsWith("/admin") ? trimmed : `/admin${trimmed}`;
  try {
    return await apiFetch<T>(full, init);
  } catch (error) {
    // RO-09 / RO-15: let the panel react to revoked sessions and changed permissions.
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      emitAdminApiError({ status: error.status, code: apiErrorCode(error), path: full });
    }
    throw error;
  }
}

/* ─── Dashboard ─── */

export async function getDashboardStats(token: string): Promise<DashboardStats> {
  return adminFetch<DashboardStats>("/admin/dashboard/", { token });
}

/* ─── Catalog ─── */

export function listProducts(token: string, params?: ListParams) {
  return adminFetch<Paginated<AdminProduct>>(`/admin/products/${toQuery(params)}`, { token });
}

export function getProduct(token: string, idOrSlug: string) {
  return adminFetch<AdminProduct>(`/admin/products/${encodeURIComponent(idOrSlug)}/`, { token });
}

export function createProduct(token: string, body: ProductWritePayload | Partial<AdminProduct>) {
  return adminFetch<AdminProduct>("/admin/products/", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateProduct(
  token: string,
  idOrSlug: string,
  body: Partial<ProductWritePayload> | Partial<AdminProduct>,
) {
  return adminFetch<AdminProduct>(`/admin/products/${encodeURIComponent(idOrSlug)}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function archiveProduct(token: string, slug: string) {
  return adminFetch<AdminProduct>(`/admin/products/${encodeURIComponent(slug)}/archive/`, { token, method: "POST" });
}

export function unarchiveProduct(token: string, slug: string) {
  return adminFetch<AdminProduct>(`/admin/products/${encodeURIComponent(slug)}/unarchive/`, { token, method: "POST" });
}

export function createVariant(token: string, body: Record<string, unknown> & { product: string }) {
  return adminFetch<AdminVariant>("/admin/variants/", { token, method: "POST", body: JSON.stringify(body) });
}

export function updateVariant(token: string, id: number | string, body: Record<string, unknown>) {
  return adminFetch<AdminVariant>(`/admin/variants/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteVariant(token: string, id: number | string) {
  return adminFetch<void>(`/admin/variants/${encodeURIComponent(String(id))}/`, { token, method: "DELETE" });
}

export function deleteProduct(token: string, idOrSlug: string) {
  return adminFetch<{ detail?: string; status?: string; slug?: string } | void>(
    `/admin/products/${encodeURIComponent(idOrSlug)}/`,
    {
      token,
      method: "DELETE",
    },
  );
}

export function duplicateProduct(token: string, idOrSlug: string, copyMappings = false) {
  return adminFetch<AdminProduct>(`/admin/products/${encodeURIComponent(idOrSlug)}/duplicate/`, {
    token,
    method: "POST",
    body: JSON.stringify({ copy_mappings: copyMappings }),
  });
}

export function uploadProductMedia(
  token: string,
  idOrSlug: string,
  file: File,
  opts?: { alt?: string; is_primary?: boolean },
) {
  const form = new FormData();
  form.append("file", file);
  if (opts?.alt) form.append("alt", opts.alt);
  if (opts?.is_primary) form.append("is_primary", "true");
  return adminFetch<AdminMediaAsset>(`/admin/products/${encodeURIComponent(idOrSlug)}/media/`, {
    token,
    method: "POST",
    body: form,
  });
}

export function updateMediaAsset(
  token: string,
  mediaId: number | string,
  body: { alt?: string; is_primary?: boolean; sort_order?: number },
) {
  return adminFetch<AdminMediaAsset>(`/admin/media/${encodeURIComponent(String(mediaId))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteMediaAsset(token: string, mediaId: number | string) {
  return adminFetch<void>(`/admin/media/${encodeURIComponent(String(mediaId))}/`, {
    token,
    method: "DELETE",
  });
}

export function reorderProductMedia(token: string, idOrSlug: string, orderedIds: Array<number | string>) {
  return adminFetch<AdminMediaAsset[]>(`/admin/products/${encodeURIComponent(idOrSlug)}/media/reorder/`, {
    token,
    method: "POST",
    body: JSON.stringify({ ordered_ids: orderedIds }),
  });
}

export function createProductMapping(
  token: string,
  idOrSlug: string,
  body: {
    supplier_id: number | string;
    external_product_id: string;
    variant_id?: number | string | null;
    external_name?: string;
  },
) {
  return adminFetch<AdminSupplierMapping>(`/admin/products/${encodeURIComponent(idOrSlug)}/mappings/`, {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateSupplierMapping(
  token: string,
  mappingId: number | string,
  body: Partial<AdminSupplierMapping> & { variant_id?: number | string | null },
) {
  return adminFetch<AdminSupplierMapping>(
    `/admin/supplier-mappings/${encodeURIComponent(String(mappingId))}/`,
    {
      token,
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
}

export function deleteSupplierMapping(token: string, mappingId: number | string) {
  return adminFetch<void>(`/admin/supplier-mappings/${encodeURIComponent(String(mappingId))}/`, {
    token,
    method: "DELETE",
  });
}

export function uploadMedia(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return adminFetch<{ url: string; path: string; mime_type?: string }>("/admin/media/upload/", {
    token,
    method: "POST",
    body: form,
  });
}

export function listCategories(token: string, params?: ListParams) {
  return adminFetch<Paginated<AdminCategory> | AdminCategory[]>(`/admin/categories/${toQuery(params)}`, { token });
}

export function createCategory(token: string, body: Partial<AdminCategory>) {
  return adminFetch<AdminCategory>("/admin/categories/", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateCategory(token: string, id: number | string, body: Partial<AdminCategory>) {
  return adminFetch<AdminCategory>(`/admin/categories/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteCategory(token: string, id: number | string) {
  return adminFetch<void>(`/admin/categories/${encodeURIComponent(String(id))}/`, {
    token,
    method: "DELETE",
  });
}

export function listPlatforms(token: string, params?: ListParams) {
  return adminFetch<Paginated<AdminPlatform> | AdminPlatform[]>(`/admin/platforms/${toQuery(params)}`, { token });
}

export function createPlatform(token: string, body: Partial<AdminPlatform>) {
  return adminFetch<AdminPlatform>("/admin/platforms/", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updatePlatform(token: string, id: number | string, body: Partial<AdminPlatform>) {
  return adminFetch<AdminPlatform>(`/admin/platforms/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deletePlatform(token: string, id: number | string) {
  return adminFetch<void>(`/admin/platforms/${encodeURIComponent(String(id))}/`, {
    token,
    method: "DELETE",
  });
}

export function listRegions(token: string, params?: ListParams) {
  return adminFetch<Paginated<AdminRegion> | AdminRegion[]>(`/admin/regions/${toQuery(params)}`, { token });
}

export function createRegion(token: string, body: Partial<AdminRegion>) {
  return adminFetch<AdminRegion>("/admin/regions/", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateRegion(token: string, id: number | string, body: Partial<AdminRegion>) {
  return adminFetch<AdminRegion>(`/admin/regions/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteRegion(token: string, id: number | string) {
  return adminFetch<void>(`/admin/regions/${encodeURIComponent(String(id))}/`, {
    token,
    method: "DELETE",
  });
}

/* ─── Inventory / codes ─── */

export function getInventoryOverview(token: string) {
  return adminFetch<InventoryOverview>("/admin/inventory/", { token });
}

export function listCodes(token: string, params?: ListParams) {
  return adminFetch<Paginated<DigitalCodeRow>>(`/admin/codes/${toQuery(params)}`, { token });
}

export function revealCode(token: string, codeId: number | string) {
  return adminFetch<{ id: number | string; code: string; masked: string }>(
    `/admin/codes/${encodeURIComponent(String(codeId))}/reveal/`,
    { token, method: "POST" },
  );
}

export function listVariants(token: string, params?: ListParams) {
  return adminFetch<Paginated<AdminVariant> | AdminVariant[]>(`/admin/variants/${toQuery(params)}`, {
    token,
  });
}

export function previewCodeImport(token: string, form: FormData) {
  return adminFetch<{ batch: CodeImportBatch; max_rows: number }>("/admin/codes/import/preview/", {
    token,
    method: "POST",
    body: form,
  });
}

export function confirmCodeImport(token: string, batchId: number) {
  return adminFetch<CodeImportBatch>("/admin/codes/import/confirm/", {
    token,
    method: "POST",
    body: JSON.stringify({ batch_id: batchId }),
  });
}

export function listCodeImports(token: string, params?: ListParams) {
  return adminFetch<Paginated<CodeImportBatch>>(`/admin/codes/imports/${toQuery(params)}`, { token });
}

export function getCodeImport(token: string, id: number | string) {
  return adminFetch<CodeImportBatch>(`/admin/codes/imports/${encodeURIComponent(String(id))}/`, {
    token,
  });
}

export function downloadCodeImportTemplate(token: string, mode: "SIMPLE" | "ADVANCED") {
  return adminFetch<string>(`/admin/codes/import/template/?mode=${mode}`, { token });
}

export function downloadCodeImportErrors(token: string, batchId: number) {
  return adminFetch<string>(`/admin/codes/imports/${batchId}/errors/`, { token });
}

export function createManualCode(
  token: string,
  body: { variant_id: number | string; code: string; pin?: string },
) {
  return adminFetch<DigitalCodeRow>("/admin/codes/create/", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deactivateCode(token: string, id: number | string) {
  return adminFetch<DigitalCodeRow>(`/admin/codes/${encodeURIComponent(String(id))}/deactivate/`, {
    token,
    method: "POST",
  });
}

/* ─── Orders ─── */

export function listOrders(token: string, params?: ListParams) {
  return adminFetch<Paginated<AdminOrder>>(`/admin/orders/${toQuery(params)}`, { token });
}

export function getOrder(token: string, id: string) {
  return adminFetch<AdminOrder>(`/admin/orders/${encodeURIComponent(id)}/`, { token });
}

export function transitionOrder(
  token: string,
  id: number | string,
  body: { payment_status?: string; fulfillment_status?: string; refund_amount_fils?: number; reason?: string },
) {
  return adminFetch<AdminOrder>(`/admin/orders/${encodeURIComponent(String(id))}/transition/`, {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fulfillOrder(token: string, id: number | string) {
  return adminFetch<AdminOrder>(`/admin/orders/${encodeURIComponent(String(id))}/fulfill/`, { token, method: "POST" });
}

export function attachOrderItemCode(
  token: string,
  id: number | string,
  itemId: number | string,
  body: { code: string; pin?: string },
) {
  return adminFetch<AdminOrder>(
    `/admin/orders/${encodeURIComponent(String(id))}/items/${encodeURIComponent(String(itemId))}/codes/`,
    { token, method: "POST", body: JSON.stringify(body) },
  );
}

export function markOrderItemDelivered(
  token: string,
  id: number | string,
  itemId: number | string,
  body: { note?: string },
) {
  return adminFetch<AdminOrder>(
    `/admin/orders/${encodeURIComponent(String(id))}/items/${encodeURIComponent(String(itemId))}/mark-delivered/`,
    { token, method: "POST", body: JSON.stringify(body) },
  );
}

export function resendOrderEmail(token: string, id: number | string) {
  return adminFetch<{ detail: string; sent: string[]; to: string }>(
    `/admin/orders/${encodeURIComponent(String(id))}/resend-email/`,
    { token, method: "POST" },
  );
}

/* ─── Customers ─── */

export function listCustomers(token: string, params?: ListParams) {
  return adminFetch<Paginated<AdminCustomer>>(`/admin/customers/${toQuery(params)}`, { token });
}

export function getCustomer(token: string, id: string) {
  return adminFetch<AdminCustomer>(`/admin/customers/${encodeURIComponent(id)}/`, { token });
}

export function updateCustomer(
  token: string,
  id: number | string,
  body: { phone?: string; status?: string; notes?: string },
) {
  return adminFetch<AdminCustomer>(`/admin/customers/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/* ─── Suppliers / 1Epin ─── */

export function listSuppliers(token: string, params?: ListParams) {
  return adminFetch<Paginated<Supplier> | Supplier[]>(`/admin/suppliers/${toQuery(params)}`, { token });
}

export function getSupplier(token: string, id: string) {
  return adminFetch<Supplier>(`/admin/suppliers/${encodeURIComponent(id)}/`, { token });
}

export function createSupplier(token: string, body: { slug?: string; name: string; active: boolean }) {
  return adminFetch<Supplier>("/admin/suppliers/", { token, method: "POST", body: JSON.stringify(body) });
}

export function updateSupplier(
  token: string,
  id: number | string,
  body: Partial<{ slug: string; name: string; active: boolean }>,
) {
  return adminFetch<Supplier>(`/admin/suppliers/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteSupplier(token: string, id: number | string) {
  return adminFetch<void>(`/admin/suppliers/${encodeURIComponent(String(id))}/`, { token, method: "DELETE" });
}

export function getOneEpinStatus(token: string) {
  return adminFetch<OneEpinStatus>("/admin/1epin/status/", { token });
}

export function pingOneEpin(token: string) {
  return adminFetch<OneEpinPingResult>("/admin/1epin/ping/", { token, method: "POST" });
}

export function getOneEpinBalance(token: string) {
  return adminFetch<OneEpinBalance>("/admin/1epin/balance/", { token });
}

export function refreshOneEpinBalance(token: string) {
  return adminFetch<OneEpinBalance>("/admin/1epin/balance/refresh/", { token, method: "POST" });
}

export function syncOneEpin(token: string) {
  return adminFetch<OneEpinSyncResult>("/admin/1epin/sync/", { token, method: "POST" });
}

export function listOneEpinLogs(token: string, params?: ListParams) {
  return adminFetch<Paginated<SupplierLog> | SupplierLog[]>(`/admin/1epin/logs/${toQuery(params)}`, {
    token,
  });
}

/* ─── Payments ─── */

export function listPayments(token: string, params?: ListParams) {
  return adminFetch<Paginated<Payment>>(`/admin/payments/${toQuery(params)}`, { token });
}

/* ─── Marketing ─── */

export function listCoupons(token: string, params?: ListParams) {
  return adminFetch<Paginated<Coupon>>(`/admin/coupons/${toQuery(params)}`, { token });
}

export function createCoupon(token: string, body: Partial<Coupon>) {
  return adminFetch<Coupon>("/admin/coupons/", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateCoupon(token: string, id: number | string, body: Partial<Coupon>) {
  return adminFetch<Coupon>(`/admin/coupons/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteCoupon(token: string, id: number | string) {
  return adminFetch<void>(`/admin/coupons/${encodeURIComponent(String(id))}/`, {
    token,
    method: "DELETE",
  });
}

export function listBanners(token: string, params?: ListParams) {
  return adminFetch<Paginated<Banner> | Banner[]>(`/admin/banners/${toQuery(params)}`, { token });
}

export function createBanner(token: string, body: Partial<Banner>) {
  return adminFetch<Banner>("/admin/banners/", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateBanner(token: string, id: number | string, body: Partial<Banner>) {
  return adminFetch<Banner>(`/admin/banners/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteBanner(token: string, id: number | string) {
  return adminFetch<void>(`/admin/banners/${encodeURIComponent(String(id))}/`, {
    token,
    method: "DELETE",
  });
}

/** CA-24: clear the desktop or mobile image of a banner. */
export function deleteBannerImage(token: string, id: number | string, target: "desktop" | "mobile") {
  return adminFetch<Banner>(`/admin/banners/${encodeURIComponent(String(id))}/image/?target=${target}`, {
    token,
    method: "DELETE",
  });
}

export function uploadBannerImage(token: string, id: number | string, file: File, target: "desktop" | "mobile") {
  const form = new FormData();
  form.append("file", file);
  form.append("target", target);
  return adminFetch<Banner>(`/admin/banners/${encodeURIComponent(String(id))}/image/`, {
    token,
    method: "POST",
    body: form,
  });
}

/* ─── CMS ─── */

export function listFaqs(token: string, params?: ListParams) {
  return adminFetch<Paginated<FAQ> | FAQ[]>(`/admin/faqs/${toQuery(params)}`, { token });
}

export function createFaq(token: string, body: Partial<FAQ>) {
  return adminFetch<FAQ>("/admin/faqs/", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateFaq(token: string, id: number | string, body: Partial<FAQ>) {
  return adminFetch<FAQ>(`/admin/faqs/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteFaq(token: string, id: number | string) {
  return adminFetch<void>(`/admin/faqs/${encodeURIComponent(String(id))}/`, {
    token,
    method: "DELETE",
  });
}

export function listPages(token: string, params?: ListParams) {
  return adminFetch<Paginated<ContentPage> | ContentPage[]>(`/admin/pages/${toQuery(params)}`, { token });
}

export function createPage(token: string, body: Partial<ContentPage>) {
  return adminFetch<ContentPage>("/admin/pages/", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updatePage(token: string, slug: string, body: Partial<ContentPage>) {
  return adminFetch<ContentPage>(`/admin/pages/${encodeURIComponent(slug)}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deletePage(token: string, slug: string) {
  return adminFetch<void>(`/admin/pages/${encodeURIComponent(slug)}/`, {
    token,
    method: "DELETE",
  });
}

/* ─── Administration ─── */

export function listAdministrators(token: string, params?: ListParams) {
  return adminFetch<Paginated<AdminUser> | AdminUser[]>(`/admin/administrators/${toQuery(params)}`, {
    token,
  });
}

export function createAdministrator(
  token: string,
  body: { email: string; password: string; full_name: string; role: string; title?: string },
) {
  return adminFetch<AdminUser>("/admin/administrators/", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateAdministrator(
  token: string,
  id: number | string,
  body: { role?: string; title?: string; disabled?: boolean; full_name?: string; password?: string },
) {
  return adminFetch<AdminUser>(`/admin/administrators/${encodeURIComponent(String(id))}/`, {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function listRoles(token: string) {
  return adminFetch<RoleInfo[]>("/admin/roles/", { token });
}

export function listPermissions(token: string) {
  return adminFetch<PermissionInfo[]>("/admin/permissions/", { token });
}

export function updateRolePermissions(token: string, role: string, permissions: string[]) {
  return adminFetch<{ role: string; permissions: string[] }>(
    `/admin/roles/${encodeURIComponent(role)}/permissions/`,
    {
      token,
      method: "PUT",
      body: JSON.stringify({ permissions }),
    },
  );
}

export function listAuditLogs(token: string, params?: ListParams) {
  return adminFetch<Paginated<AuditLog>>(`/admin/audit/${toQuery(params)}`, { token });
}

/* ─── Settings ─── */

export function getSiteSettings(token: string) {
  return adminFetch<SiteSettings>("/admin/settings/", { token });
}

export function updateSiteSettings(token: string, body: Partial<SiteSettings>) {
  return adminFetch<SiteSettings>("/admin/settings/", {
    token,
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/**
 * Load every page of a paginated list (page_size within the backend max of 100),
 * stopping at `maxPages` as a safety net.
 */
export async function fetchAllPages<T>(
  load: (params: ListParams) => Promise<Paginated<T> | T[]>,
  params: ListParams = {},
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await load({ ...params, page, page_size: 100 });
    if (Array.isArray(data)) return data;
    out.push(...(data.results ?? []));
    if (!data.next) break;
  }
  return out;
}

/* ─── Current admin ─── */

export type AdminMe = {
  id: number | string;
  email: string;
  first_name?: string;
  last_name?: string;
  kind?: string;
  role?: string | null;
  permissions?: string[];
};

export function getAdminMe(token: string) {
  return apiFetch<AdminMe>("/auth/me/", { token });
}

/** Normalize list responses that may be paginated or a bare array. */
export function asList<T>(data: Paginated<T> | T[] | null | undefined): { items: T[]; count: number } {
  if (!data) return { items: [], count: 0 };
  if (Array.isArray(data)) return { items: data, count: data.length };
  return { items: data.results ?? [], count: data.count ?? data.results?.length ?? 0 };
}
