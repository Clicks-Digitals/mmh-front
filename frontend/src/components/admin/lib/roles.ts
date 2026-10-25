export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "CATALOG_MANAGER",
  "ORDER_MANAGER",
  "CONTENT_MANAGER",
  "SUPPORT_AGENT",
  "VIEWER",
] as const;

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  ADMIN: "Admin",
  CATALOG_MANAGER: "Catalog manager",
  ORDER_MANAGER: "Order manager",
  CONTENT_MANAGER: "Content manager",
  SUPPORT_AGENT: "Support agent",
  VIEWER: "Viewer",
};

const PRIVILEGED = new Set(["SUPER_ADMIN", "ADMIN"]);

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role.replaceAll("_", " ");
}

/** Mirrors backend escalation rules: SUPER_ADMIN may assign any role; others only roles below ADMIN. */
export function assignableRoles(actorRole: string | null | undefined): string[] {
  if (actorRole === "SUPER_ADMIN") return [...ADMIN_ROLES];
  return ADMIN_ROLES.filter((role) => !PRIVILEGED.has(role));
}

/** Whether the actor may edit the target account at all (not counting self-restrictions). */
export function canManageAdmin(actorRole: string | null | undefined, targetRole: string | null | undefined): boolean {
  if (actorRole === "SUPER_ADMIN") return true;
  return !PRIVILEGED.has(targetRole ?? "");
}

/** RO-05: what each role is for, in plain language (role dropdown + Roles page). */
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  SUPER_ADMIN: "Full control of everything, including other administrators and role permissions.",
  ADMIN: "Runs the whole store: products, orders, refunds, codes, customers, settings and staff accounts.",
  CATALOG_MANAGER: "Adds and edits products, prices, categories and store content. Cannot see orders.",
  ORDER_MANAGER: "Handles orders end to end: delivery, refunds, cancelling, importing and revealing codes.",
  CONTENT_MANAGER: "Edits banners, pages and FAQs. Can view products but not change them.",
  SUPPORT_AGENT: "Looks up orders and customers and resends delivery e-mails. Cannot refund or see codes.",
  VIEWER: "Read-only access to most sections. Cannot change anything.",
};

export function roleDescription(role: string | null | undefined): string {
  return (role && ROLE_DESCRIPTIONS[role]) || "";
}

/** RO-05: granting these roles hands over the whole store. */
export function isPrivilegedRole(role: string | null | undefined): boolean {
  return PRIVILEGED.has(role ?? "");
}

export function privilegedRoleWarning(role: string | null | undefined): string {
  if (role === "SUPER_ADMIN") {
    return "Super admins can do everything, including removing other administrators. Only give this to the store owner.";
  }
  if (role === "ADMIN") {
    return "Admins can refund money, reveal secret codes and manage staff. Only give this to people you fully trust.";
  }
  return "";
}

/** RO-05 / RO-12: plain-language permission names instead of keys. */
export const PERMISSION_TEXT: Record<string, { title: string; description: string }> = {
  "catalog.read": { title: "View products", description: "See products, prices, categories and stock." },
  "catalog.write": { title: "Edit products", description: "Create and change products, options, prices and categories." },
  "orders.read": { title: "View orders", description: "See orders, payments and coupons." },
  "orders.write": {
    title: "Change orders and money",
    description: "Refund, cancel, mark paid, edit coupons and order notes.",
  },
  "orders.fulfill": { title: "Deliver orders", description: "Deliver codes, mark top-ups delivered, resend e-mails." },
  "orders.notify": { title: "Resend order e-mails", description: "Send the delivery e-mail to the customer again." },
  "codes.read": { title: "View code stock", description: "See how many codes are in stock (codes stay hidden)." },
  "codes.manage": { title: "Import and manage codes", description: "Import code files, add or deactivate codes." },
  "codes.reveal": {
    title: "Reveal secret codes",
    description: "Show the full code or PIN. Every reveal is recorded.",
  },
  "customers.read": { title: "View customers", description: "See customer accounts and their orders." },
  "customers.write": { title: "Edit customers", description: "Change customer details and disable accounts." },
  "content.read": { title: "View store content", description: "See banners, pages and FAQs." },
  "content.write": { title: "Edit store content", description: "Change banners, pages and FAQs." },
  "suppliers.read": { title: "View suppliers", description: "See suppliers and the 1Epin connection." },
  "suppliers.write": { title: "Manage suppliers", description: "Change suppliers, product mappings and 1Epin settings." },
  "audit.read": { title: "View the activity log", description: "See who changed what and when." },
  "admins.read": { title: "View staff accounts", description: "See administrators and roles." },
  "admins.write": { title: "Manage staff accounts", description: "Create staff, change roles, reset passwords." },
  "settings.manage": { title: "Store settings", description: "Change store details, contact info and maintenance mode." },
};

export type PermissionFlag = "money" | "secret";

/** RO-05: flag permissions that move money or expose secret codes. */
export function permissionFlags(key: string): PermissionFlag[] {
  if (key === "orders.write") return ["money"];
  if (key === "codes.reveal") return ["secret"];
  return [];
}

export function permissionTitle(key: string, fallback?: string): string {
  return PERMISSION_TEXT[key]?.title ?? fallback ?? key;
}

export function permissionDescription(key: string, fallback?: string): string {
  return PERMISSION_TEXT[key]?.description ?? fallback ?? "";
}
