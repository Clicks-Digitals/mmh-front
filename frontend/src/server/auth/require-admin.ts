import { auth } from "@/auth";
import { getAdminMe } from "@/lib/api/admin";
import {
  hasPermission,
  permissionsFor,
  type AdminRole,
  type PermissionKey,
} from "@/server/auth/permissions";
import { redirect } from "next/navigation";
import { cache } from "react";

export type AdminUser = {
  id: string;
  email: string;
  name?: string | null;
  kind: "ADMIN";
  role: AdminRole;
  permissions: PermissionKey[];
  accessToken?: string;
  /** true when role/permissions came from a fresh GET auth/me/ (not the login-time session copy) */
  fresh: boolean;
};

/**
 * Role permissions are editable at runtime, so the login-time copy stored in the
 * session can go stale. Re-read them from GET auth/me/ once per request (React cache)
 * and fall back to the session copy only when the API is unreachable.
 */
const loadFreshAccess = cache(async (token: string | undefined) => {
  if (!token) return null;
  try {
    const me = await getAdminMe(token);
    if (me.kind && me.kind !== "ADMIN") return { revoked: true as const };
    return {
      revoked: false as const,
      role: (me.role ?? null) as AdminRole | null,
      permissions: Array.isArray(me.permissions) ? me.permissions : [],
      name: me.first_name || null,
    };
  } catch (error) {
    const status = (error as { status?: number })?.status;
    // 401: token revoked / account disabled -> force sign-in again.
    if (status === 401) return { revoked: true as const };
    return null;
  }
});

export async function requireAdmin(permission?: PermissionKey): Promise<AdminUser> {
  const session = await auth();
  if (!session?.user?.id || session.user.kind !== "ADMIN" || !session.user.role) {
    redirect("/admin/login");
  }

  const fresh = await loadFreshAccess(session.user.accessToken);
  if (fresh?.revoked) redirect("/admin/login?reason=session");

  const role = ((fresh && !fresh.revoked && fresh.role) || session.user.role) as AdminRole;
  const fromSession = session.user.permissions as string[] | undefined;
  const permissions = (
    fresh && !fresh.revoked
      ? fresh.permissions
      : fromSession?.length
        ? fromSession
        : permissionsFor(role)
  ) as PermissionKey[];

  if (permission && !hasPermission(permissions, permission, role)) {
    redirect("/admin/unauthorized");
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: (fresh && !fresh.revoked && fresh.name) || session.user.name,
    kind: "ADMIN",
    role,
    permissions,
    accessToken: session.user.accessToken,
    fresh: Boolean(fresh && !fresh.revoked),
  };
}
