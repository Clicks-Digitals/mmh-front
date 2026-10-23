export type AdminRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "CATALOG_MANAGER"
  | "ORDER_MANAGER"
  | "CONTENT_MANAGER"
  | "SUPPORT_AGENT"
  | "VIEWER";

/** Backend-aligned permission keys (accounts.permissions / seed_catalog). */
export const PERMISSIONS = {
  catalogRead: "catalog.read",
  catalogWrite: "catalog.write",
  ordersRead: "orders.read",
  ordersWrite: "orders.write",
  ordersFulfill: "orders.fulfill",
  codesReveal: "codes.reveal",
  codesRead: "codes.read",
  codesManage: "codes.manage",
  customersRead: "customers.read",
  customersWrite: "customers.write",
  contentRead: "content.read",
  contentWrite: "content.write",
  suppliersRead: "suppliers.read",
  suppliersWrite: "suppliers.write",
  auditRead: "audit.read",
  adminsRead: "admins.read",
  adminsWrite: "admins.write",
  settingsManage: "settings.manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL = Object.values(PERMISSIONS);

/** Mirrors backend/accounts/permissions.py ROLE_PERMISSIONS. */
const ROLE_MAP: Record<AdminRole, PermissionKey[]> = {
  SUPER_ADMIN: ALL,
  ADMIN: ALL,
  CATALOG_MANAGER: [
    PERMISSIONS.catalogRead,
    PERMISSIONS.catalogWrite,
    PERMISSIONS.contentRead,
    PERMISSIONS.contentWrite,
    PERMISSIONS.suppliersRead,
    PERMISSIONS.codesRead,
  ],
  ORDER_MANAGER: [
    PERMISSIONS.ordersRead,
    PERMISSIONS.ordersWrite,
    PERMISSIONS.ordersFulfill,
    PERMISSIONS.codesRead,
    PERMISSIONS.codesManage,
    PERMISSIONS.codesReveal,
    PERMISSIONS.customersRead,
  ],
  CONTENT_MANAGER: [PERMISSIONS.contentRead, PERMISSIONS.contentWrite, PERMISSIONS.catalogRead],
  SUPPORT_AGENT: [PERMISSIONS.ordersRead, PERMISSIONS.customersRead, PERMISSIONS.codesRead],
  VIEWER: [
    PERMISSIONS.catalogRead,
    PERMISSIONS.ordersRead,
    PERMISSIONS.customersRead,
    PERMISSIONS.contentRead,
    PERMISSIONS.suppliersRead,
    PERMISSIONS.auditRead,
    PERMISSIONS.codesRead,
  ],
};

export function permissionsFor(role: AdminRole | null | undefined): PermissionKey[] {
  if (!role) return [];
  return ROLE_MAP[role] ?? [];
}

export function can(role: AdminRole | null | undefined, permission: PermissionKey) {
  if (!role) return false;
  if (role === "SUPER_ADMIN") return true;
  return ROLE_MAP[role]?.includes(permission) ?? false;
}

export function hasPermission(
  permissions: readonly string[] | null | undefined,
  permission: PermissionKey,
  role?: AdminRole | null,
) {
  if (role === "SUPER_ADMIN") return true;
  // Role permissions are editable in the backend, so an explicit list is authoritative.
  if (Array.isArray(permissions)) return permissions.includes("*") || permissions.includes(permission);
  return can(role, permission);
}

/** Map admin routes → minimum permission to view the page. */
export const ROUTE_PERMISSIONS: Record<string, PermissionKey | undefined> = {
  "/admin": undefined,
  "/admin/products": PERMISSIONS.catalogRead,
  "/admin/categories": PERMISSIONS.catalogRead,
  "/admin/platforms": PERMISSIONS.catalogRead,
  "/admin/regions": PERMISSIONS.catalogRead,
  "/admin/inventory": PERMISSIONS.codesRead,
  "/admin/codes": PERMISSIONS.codesRead,
  "/admin/codes/import": PERMISSIONS.codesManage,
  "/admin/codes/imports": PERMISSIONS.codesManage,
  "/admin/integrations/1epin/logs": PERMISSIONS.suppliersRead,
  "/admin/orders": PERMISSIONS.ordersRead,
  "/admin/customers": PERMISSIONS.customersRead,
  "/admin/suppliers": PERMISSIONS.suppliersRead,
  "/admin/integrations/1epin": PERMISSIONS.suppliersRead,
  "/admin/payments": PERMISSIONS.ordersRead,
  "/admin/coupons": PERMISSIONS.ordersRead,
  "/admin/banners": PERMISSIONS.contentRead,
  "/admin/faqs": PERMISSIONS.contentRead,
  "/admin/pages": PERMISSIONS.contentRead,
  "/admin/administrators": PERMISSIONS.adminsRead,
  "/admin/roles": PERMISSIONS.adminsRead,
  "/admin/audit": PERMISSIONS.auditRead,
  "/admin/settings": PERMISSIONS.settingsManage,
};

export function permissionForPath(pathname: string): PermissionKey | undefined {
  if (ROUTE_PERMISSIONS[pathname] !== undefined || pathname in ROUTE_PERMISSIONS) {
    return ROUTE_PERMISSIONS[pathname];
  }
  // Match longest prefix for nested routes like /admin/products/new
  const match = Object.keys(ROUTE_PERMISSIONS)
    .filter((route) => route !== "/admin" && pathname.startsWith(route + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return match ? ROUTE_PERMISSIONS[match] : undefined;
}
