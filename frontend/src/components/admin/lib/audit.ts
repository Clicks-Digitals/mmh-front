/** Readable labels for audit actions recorded by the backend. */
const ACTION_LABELS: Record<string, string> = {
  "orders.fulfill": "Re-ran fulfillment",
  "orders.resend_email": "Resent delivery e-mail",
  "orders.refund": "Refunded order",
  "orders.transition": "Changed order status",
  "orders.manual_paid": "Marked order paid manually",
  "orders.payment_forced_paid": "Forced payment to paid",
  "orders.manual_review": "Sent order to manual review",
  "orders.code_attached": "Attached code to order item",
  "orders.codes_allocated": "Allocated codes from stock",
  "orders.item_delivered": "Marked item delivered",
  "codes.customer_reveal": "Customer viewed codes",
  "codes.import.completed": "Imported codes",
  "codes.manual_create": "Added code manually",
  "codes.refund_retired": "Retired codes after refund",
  "admin.password_reset_via_email": "Administrator reset password by e-mail",
  "cms.banner.image_uploaded": "Uploaded banner image",
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

function short(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length ? value.map(short).join(", ") : "none";
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if ("from" in rec && "to" in rec) return `${short(rec.from)} → ${short(rec.to)}`;
    return Object.keys(rec).join(", ");
  }
  return String(value);
}

const PREFERRED_KEYS = [
  "order_number",
  "slug",
  "sku",
  "code",
  "email",
  "role",
  "masked",
  "status",
  "previous_status",
  "reason",
  "fields",
  "changed",
  "added",
  "removed",
  "sent",
  "assigned",
];

/** Short "key: value · key: value" summary of an audit meta object. */
export function summarizeAuditMeta(meta: Record<string, unknown> | null | undefined, max = 4): string {
  if (!meta || typeof meta !== "object") return "";
  const keys = Object.keys(meta);
  const ordered = [
    ...PREFERRED_KEYS.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !PREFERRED_KEYS.includes(k)),
  ];
  const parts: string[] = [];
  for (const key of ordered) {
    const value = meta[key];
    if (value == null || value === "") continue;
    if (key === "changes" && typeof value === "object" && !Array.isArray(value)) {
      for (const [field, change] of Object.entries(value as Record<string, unknown>)) {
        parts.push(`${words(field)}: ${short(change)}`);
      }
      continue;
    }
    parts.push(`${words(key)}: ${short(value)}`);
  }
  const shown = parts.slice(0, max);
  return parts.length > max ? `${shown.join(" · ")} · +${parts.length - max} more` : shown.join(" · ");
}
