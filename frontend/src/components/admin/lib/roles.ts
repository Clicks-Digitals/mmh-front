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
