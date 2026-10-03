import { apiFetch } from "@/lib/api/client";

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
  pending_orders: number;
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
  external_product_id: string;
  external_name?: string;
  ignored?: boolean;
  created_at?: string;
};

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
  delete?: boolean;
};

export type ProductWritePayload = {
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
  variants?: Array<Partial<AdminVariant> & { sku: string; price_fils: number; name_en?: string }>;
  fields?: Array<Partial<AdminProductField>>;
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
  products_count?: number;
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
  codes?: DigitalCodeRow[];
  delivery_method?: string;
  region_name?: string;
  platform_name?: string;
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
  items?: AdminOrderItem[];
  payments?: Payment[];
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
  locale?: string;
  created_at?: string;
  orders_count?: number;
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
  order_item?: number | string | null;
  order_number?: string | null;
  revealed_at?: string | null;
  created_at?: string;
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
  product_id?: string | null;
  uploaded_by?: number | null;
  uploaded_by_email?: string | null;
  total_rows: number;
  valid_rows: number;
  imported_rows: number;
  duplicate_rows: number;
  failed_rows: number;
  preview_rows?: CodeImportPreviewRow[];
  error_report?: Array<{ row: number; sku?: string; error: string }>;
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
  mappings?: unknown[];
  recent_orders?: unknown[];
  recent_logs?: SupplierLog[];
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
  configured?: boolean;
  mode?: string;
  environment?: string;
  email_configured?: boolean;
  password_configured?: boolean;
  callback_configured?: boolean;
  last_balance?: string | null;
  last_checked_at?: string | null;
  last_ping_at?: string | null;
  balance?: number | null;
  ok?: boolean;
  detail?: string;
  live_locked?: boolean;
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
  title_en: string;
  title_ar?: string;
  subtitle_en?: string;
  subtitle_ar?: string;
  published: boolean;
  sort_order?: number;
  start_at?: string | null;
  end_at?: string | null;
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
  created_at?: string;
};

export type RoleInfo = {
  role: string;
  label: string;
  permissions: string[];
};

export type PermissionInfo = {
  key: string;
  description: string;
};

export type AuditLog = {
  id: number | string;
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
  currency_display?: string;
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
  return apiFetch<T>(full, init);
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
  body: { payment_status?: string; fulfillment_status?: string; refund_amount_fils?: number },
) {
  return adminFetch<AdminOrder>(`/admin/orders/${encodeURIComponent(String(id))}/transition/`, {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ─── Customers ─── */

export function listCustomers(token: string, params?: ListParams) {
  return adminFetch<Paginated<AdminCustomer>>(`/admin/customers/${toQuery(params)}`, { token });
}

export function getCustomer(token: string, id: string) {
  return adminFetch<AdminCustomer>(`/admin/customers/${encodeURIComponent(id)}/`, { token });
}

/* ─── Suppliers / 1Epin ─── */

export function listSuppliers(token: string, params?: ListParams) {
  return adminFetch<Paginated<Supplier> | Supplier[]>(`/admin/suppliers/${toQuery(params)}`, { token });
}

export function getSupplier(token: string, id: string) {
  return adminFetch<Supplier>(`/admin/suppliers/${encodeURIComponent(id)}/`, { token });
}

export function getOneEpinStatus(token: string) {
  return adminFetch<OneEpinStatus>("/admin/1epin/status/", { token });
}

export function pingOneEpin(token: string) {
  return adminFetch<OneEpinStatus>("/admin/1epin/ping/", { token, method: "POST" });
}

export function getOneEpinBalance(token: string) {
  return adminFetch<{ balance: number | string | null; last_balance?: string | null }>("/admin/1epin/balance/", {
    token,
  });
}

export function syncOneEpin(token: string) {
  return adminFetch<{ ok: boolean; detail?: string; message?: string }>("/admin/1epin/sync/", {
    token,
    method: "POST",
  });
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
  body: { role?: string; title?: string; disabled?: boolean; full_name?: string },
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

/** Normalize list responses that may be paginated or a bare array. */
export function asList<T>(data: Paginated<T> | T[] | null | undefined): { items: T[]; count: number } {
  if (!data) return { items: [], count: 0 };
  if (Array.isArray(data)) return { items: data, count: data.length };
  return { items: data.results ?? [], count: data.count ?? data.results?.length ?? 0 };
}
