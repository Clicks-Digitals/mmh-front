import { FULFILLMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/components/admin/lib/orders";
import { ROLE_LABELS } from "@/components/admin/lib/roles";

/** Readable labels for audit actions recorded by the backend. */
const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.logout": "Signed out",
  "auth.password_changed": "Changed own password",
  "auth.permission_denied": "Tried an action without permission",
  "orders.cancelled": "Cancelled order",
  "orders.staff_notes": "Edited staff notes",
  "orders.waiting_delivered": "Delivered waiting orders after stock arrived",
  "customer.disabled": "Disabled customer account",
  "customer.enabled": "Enabled customer account",
  "cms.banner.image_removed": "Removed banner image",
  "orders.fulfill": "Re-ran delivery from stock",
  "orders.resend_email": "Resent delivery e-mail",
  "orders.refund": "Issued refund",
  "orders.transition": "Changed order status",
  "orders.manual_paid": "Marked order paid manually",
  "orders.payment_forced_paid": "Forced payment to paid",
  "orders.manual_review": "Order needs review",
  "orders.code_attached": "Attached code to order item",
  "orders.codes_allocated": "Allocated codes from stock",
  "orders.item_delivered": "Marked item delivered",
  "codes.customer_reveal": "Customer viewed codes",
  "codes.import.completed": "Imported codes",
  "codes.manual_create": "Added code manually",
  "codes.refund_retired": "Retired codes after refund",
  "admin.password_reset_via_email": "Administrator reset password by e-mail",
  "cms.banner.image_uploaded": "Uploaded banner image",
  "catalog.category.image_uploaded": "Uploaded category picture",
  "catalog.category.image_removed": "Removed category picture",
  "catalog.platform.image_uploaded": "Uploaded platform logo",
  "catalog.platform.image_removed": "Removed platform logo",
  "cms.home_tile.created": "Created home tile",
  "cms.home_tile.updated": "Updated home tile",
  "cms.home_tile.deleted": "Deleted home tile",
  "cms.home_tile.image_uploaded": "Uploaded home tile picture",
  "cms.home_tile.image_removed": "Removed home tile picture",
  "settings.image_uploaded": "Uploaded logo / home picture",
  "settings.image_removed": "Removed logo / home picture",
  "media.uploaded": "Uploaded media",
  "media.deleted": "Deleted media",
  "codes.reveal": "Revealed code",
  "codes.deactivate": "Deactivated code",
  "coupons.create": "Created coupon",
  "coupons.update": "Updated coupon",
  "coupons.delete": "Deleted coupon",
  "product.created": "Created product",
  "product.updated": "Updated product",
  "product.deleted": "Deleted product",
  "product.archived": "Archived product",
  "product.unarchived": "Unarchived product",
  "product.duplicated": "Duplicated product",
  "admin.created": "Created administrator",
  "admin.updated": "Updated administrator",
  "admin.disabled": "Disabled administrator",
  "admin.enabled": "Enabled administrator",
  "admin.password_reset": "Reset administrator password",
  "role.permissions_updated": "Changed role permissions",
  "customer.updated": "Updated customer",
  "settings.updated": "Updated settings",
  "supplier.mapping.updated": "Updated supplier mapping",
  "supplier.mapping.deleted": "Deleted supplier mapping",
  "supplier.mapping.created": "Created supplier mapping",
};

const VERBS: Record<string, string> = {
  created: "Created",
  create: "Created",
  updated: "Updated",
  update: "Updated",
  deleted: "Deleted",
  delete: "Deleted",
  destroy: "Deleted",
};

function words(value: string): string {
  return value.replaceAll(/[._-]+/g, " ").trim();
}

/** "catalog.variant.updated" -> "Updated catalog variant"; known actions use curated labels. */
export function auditActionLabel(action: string): string {
  if (!action) return "—";
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const parts = action.split(".");
  const last = parts[parts.length - 1];
  if (VERBS[last] && parts.length > 1) {
    return `${VERBS[last]} ${words(parts.slice(0, -1).join(" "))}`;
  }
  const sentence = words(action);
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/* ─── Readable meta values (enum values, "via", money, ids) ─── */

/** Enum values whose sentence-case form reads badly. */
const ENUM_SPECIALS: Record<string, string> = {
  PARTIALLY_REFUNDED: "Partially refunded",
  MANUAL_REVIEW: "Needs review",
  DIRECT_TOPUP: "Direct top-up",
  NOT_STARTED: "Not started",
  SUPER_ADMIN: "Super admin",
  CSV: "CSV",
  XLSX: "Excel file",
};

// Letters and underscores only, so order numbers / codes like "AB12" or "SAVE10" stay as they are.
const SCREAMING_CASE = /^[A-Z]+(?:_[A-Z]+)*$/;

/** "NOT_STARTED" -> "Not started", "PARTIALLY_REFUNDED" -> "Partially refunded"; other text unchanged. */
export function humanizeEnumValue(value: string): string {
  const text = value.trim();
  if (!SCREAMING_CASE.test(text)) return value;
  if (ENUM_SPECIALS[text]) return ENUM_SPECIALS[text];
  if (text.length <= 3) return text; // JOD, USD, SKU…
  const sentence = text.toLowerCase().replaceAll("_", " ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Who/what did it, for `meta.via`. */
const VIA_LABELS: Record<string, string> = {
  owner: "Customer (signed in)",
  access_token: "Customer (email link)",
  staff: "Staff",
  admin: "Staff",
  paypal: "PayPal",
  manual: "Manual (outside PayPal)",
  webhook: "PayPal notification",
  system: "System",
};

const PROVIDER_LABELS: Record<string, string> = { paypal: "PayPal", manual: "Manual", free: "Free order" };

/** Plain names for meta keys. */
const META_KEY_LABELS: Record<string, string> = {
  order_number: "Order",
  order_numbers: "Orders",
  previous_status: "Previous status",
  payment_status: "Payment",
  fulfillment_status: "Delivery",
  via: "Via",
  masked: "Code",
  sku: "SKU",
  email: "E-mail",
  target_email: "E-mail",
  slug: "Web address",
  name_en: "Name",
  title_en: "Title",
  question_en: "Question",
  fields: "Changed fields",
  assigned: "Codes assigned",
  filename: "File",
  total_rows: "Rows",
  imported: "Imported",
  skipped: "Skipped",
  product_name: "Product",
  variant_name: "Option",
  qty: "Quantity",
  provider: "Payment provider",
  provider_amount: "Amount charged",
  provider_currency: "Currency",
  provider_refund_id: "PayPal refund",
  paypal_capture_id: "PayPal capture",
  paypal_order_id: "PayPal order",
  ip: "IP address",
  percent_off: "Percent off",
  amount_off_fils: "Amount off",
  free_order: "Free order",
  partially_delivered: "Partly delivered",
  waiting_orders_delivered: "Waiting orders delivered",
  permission: "Permission",
  path: "Page",
};

/** Ids that are useful to staff (PayPal references) despite the `_id` suffix. */
const VISIBLE_ID_KEYS = new Set(["paypal_capture_id", "paypal_order_id", "provider_refund_id", "refund_id"]);

/** Internal keys hidden from staff: database ids, label helpers, raw snapshots. */
export function isInternalMetaKey(key: string): boolean {
  if (VISIBLE_ID_KEYS.has(key)) return false;
  if (key === "id" || key === "ids" || /_ids?$/.test(key)) return true;
  if (key.endsWith("_label")) return true;
  return ["before", "after", "user_agent", "uid", "token"].includes(key);
}

/** Status values use the same wording as the order pages. */
/** Keys whose values are identifiers typed by people (never humanised). */
const IDENTIFIER_KEYS = new Set([
  "order_number",
  "order_numbers",
  "code",
  "sku",
  "masked",
  "slug",
  "email",
  "target_email",
  "filename",
  "external_product_id",
  "paypal_capture_id",
  "paypal_order_id",
  "provider_refund_id",
  "refund_id",
  "name",
  "name_en",
  "title_en",
]);

function enumForKey(value: string, key: string): string {
  if (!value) return "—";
  if (IDENTIFIER_KEYS.has(key)) return value;
  if (key === "payment_status" && PAYMENT_STATUS_LABELS[value]) return PAYMENT_STATUS_LABELS[value];
  if (key === "fulfillment_status" && FULFILLMENT_STATUS_LABELS[value]) return FULFILLMENT_STATUS_LABELS[value];
  if (key === "role" && ROLE_LABELS[value]) return ROLE_LABELS[value];
  return humanizeEnumValue(value);
}

function sentenceCase(value: string): string {
  const spaced = value.replaceAll(/[._-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
}

export function auditMetaKeyLabel(key: string): string {
  return META_KEY_LABELS[key] ?? sentenceCase(key);
}

function formatFilsValue(value: unknown): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return `JOD ${(n / 1000).toFixed(n % 10 === 0 ? 2 : 3)}`;
}

/** One meta value as short readable text. `key` gives context (via, provider, *_fils). */
export function formatAuditValue(value: unknown, key = "", max = 60): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (key.endsWith("_fils")) return formatFilsValue(value) ?? String(value);
    return String(value);
  }
  if (typeof value === "string") {
    if (key === "via" && VIA_LABELS[value]) return VIA_LABELS[value];
    if (key === "provider" && PROVIDER_LABELS[value.toLowerCase()]) return PROVIDER_LABELS[value.toLowerCase()];
    if (key.endsWith("_fils")) {
      const money = formatFilsValue(value);
      if (money) return money;
    }
    if (value.includes("→")) {
      return value
        .split("→")
        .map((part) => enumForKey(part.trim(), key))
        .join(" → ");
    }
    const text = enumForKey(value, key);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  if (Array.isArray(value)) {
    if (!value.length) return "none";
    return value.map((v) => formatAuditValue(v, key, max)).join(", ");
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if ("from" in rec && "to" in rec) {
      const from = typeof rec.from_label === "string" && rec.from_label ? rec.from_label : formatAuditValue(rec.from, key, max);
      const to = typeof rec.to_label === "string" && rec.to_label ? rec.to_label : formatAuditValue(rec.to, key, max);
      return `${from} → ${to}`;
    }
    return Object.entries(rec)
      .filter(([k]) => !isInternalMetaKey(k))
      .map(([k, v]) => `${auditMetaKeyLabel(k)}: ${formatAuditValue(v, k, max)}`)
      .join(", ");
  }
  return String(value);
}

export type AuditMetaRow = { key: string; label: string; value: string };

const PREFERRED_KEYS = [
  "order_number",
  "slug",
  "sku",
  "code",
  "email",
  "role",
  "masked",
  "amount",
  "status",
  "previous_status",
  "via",
  "reason",
  "fields",
  "changed",
  "added",
  "removed",
  "sent",
  "assigned",
];

/** Readable rows for an audit meta object: internal keys hidden, `changes` expanded per field. */
export function auditMetaRows(meta: Record<string, unknown> | null | undefined, max = 500): AuditMetaRow[] {
  if (!meta || typeof meta !== "object") return [];
  const keys = Object.keys(meta).filter((k) => !isInternalMetaKey(k));
  const ordered = [
    ...PREFERRED_KEYS.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !PREFERRED_KEYS.includes(k)),
  ];
  const rows: AuditMetaRow[] = [];
  for (const key of ordered) {
    const value = meta[key];
    if (value == null || value === "") continue;
    if (key === "changes" && typeof value === "object" && !Array.isArray(value)) {
      for (const [field, change] of Object.entries(value as Record<string, unknown>)) {
        if (isInternalMetaKey(field)) continue;
        rows.push({ key: `changes.${field}`, label: auditMetaKeyLabel(field), value: formatAuditValue(change, field, max) });
      }
      continue;
    }
    if (key === "fields" && Array.isArray(value)) {
      const names = value.map((f) => sentenceCase(String(f)).toLowerCase());
      rows.push({ key, label: auditMetaKeyLabel(key), value: names.length ? names.join(", ") : "none" });
      continue;
    }
    rows.push({ key, label: auditMetaKeyLabel(key), value: formatAuditValue(value, key, max) });
  }
  return rows;
}

/** Short "label: value · label: value" summary of an audit meta object. */
export function summarizeAuditMeta(meta: Record<string, unknown> | null | undefined, max = 4): string {
  const parts = auditMetaRows(meta, 60).map((row) => `${row.label}: ${row.value}`);
  const shown = parts.slice(0, max);
  return parts.length > max ? `${shown.join(" · ")} · +${parts.length - max} more` : shown.join(" · ");
}

/** Friendly names for audit entity types (filters + entity column). */
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  Order: "Order",
  Product: "Product",
  ProductVariant: "Product option",
  Category: "Category",
  Platform: "Platform",
  Region: "Region",
  DigitalCode: "Code",
  CodeImportBatch: "Code import",
  Coupon: "Coupon",
  User: "Staff / user account",
  Role: "Role",
  CustomerProfile: "Customer",
  Banner: "Banner",
  FAQ: "FAQ",
  ContentPage: "Page",
  SiteSettings: "Settings",
  Supplier: "Supplier",
  SupplierProductMapping: "Supplier mapping",
  MediaAsset: "Media",
};

export function entityTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return ENTITY_TYPE_LABELS[type] ?? type;
}

/** Action groups for the audit filter (backend `action_prefix`). */
export const ACTION_GROUPS: Array<{ value: string; label: string }> = [
  { value: "orders.", label: "Orders & refunds" },
  { value: "codes.", label: "Codes" },
  { value: "auth.", label: "Sign-ins & access" },
  { value: "admin.", label: "Staff accounts" },
  { value: "role.", label: "Role permissions" },
  { value: "customer.", label: "Customers" },
  { value: "coupons.", label: "Coupons" },
  { value: "product.", label: "Products" },
  { value: "catalog.", label: "Categories, platforms & options" },
  { value: "cms.", label: "Store content" },
  { value: "supplier.", label: "Suppliers" },
  { value: "settings.", label: "Settings" },
];

type AuditEntryLike = {
  entity_type?: string | null;
  entity_id?: string | number | null;
  order_number?: string | null;
  meta?: Record<string, unknown> | null;
};

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

/** Where an audit entry's target lives in the panel (OR-14), or null when there is no page. */
export function auditEntityHref(entry: AuditEntryLike): string | null {
  const type = entry.entity_type ?? "";
  const id = entry.entity_id != null ? String(entry.entity_id) : "";
  const orderNumber = entry.order_number || metaString(entry.meta, "order_number");
  if (orderNumber && (type === "Order" || type === "DigitalCode" || !type)) {
    return `/admin/orders/${encodeURIComponent(orderNumber)}`;
  }
  switch (type) {
    case "Order":
      return id ? `/admin/orders/${encodeURIComponent(id)}` : null;
    case "Product": {
      const key = id || metaString(entry.meta, "slug");
      return key ? `/admin/products/${encodeURIComponent(key)}` : null;
    }
    case "User": {
      const email = metaString(entry.meta, "email") || metaString(entry.meta, "target_email");
      return email ? `/admin/administrators?search=${encodeURIComponent(email)}` : "/admin/administrators";
    }
    case "CustomerProfile":
      return id ? `/admin/customers/${encodeURIComponent(id)}` : null;
    case "Coupon": {
      const code = metaString(entry.meta, "code");
      return code ? `/admin/coupons?search=${encodeURIComponent(code)}` : "/admin/coupons";
    }
    case "Supplier":
      return id ? `/admin/suppliers/${encodeURIComponent(id)}` : null;
    case "CodeImportBatch":
      return "/admin/codes/imports";
    case "Role":
      return "/admin/roles";
    case "SiteSettings":
      return "/admin/settings";
    default:
      return null;
  }
}

/** "Order 1A2B…", "User jane@…" from the API; local fallback for older rows. */
export function auditEntityText(entry: AuditEntryLike & { entity_label?: string | null }): string {
  if (entry.entity_label) return entry.entity_label;
  if (!entry.entity_type) return "—";
  const orderNumber = entry.order_number || metaString(entry.meta, "order_number");
  if (entry.entity_type === "Order" && orderNumber) return `Order ${orderNumber}`;
  return `${entityTypeLabel(entry.entity_type)}${entry.entity_id ? ` #${entry.entity_id}` : ""}`;
}
