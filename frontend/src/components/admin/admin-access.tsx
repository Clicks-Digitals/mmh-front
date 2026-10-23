"use client";

import { useAdminToken } from "@/hooks/use-admin-token";
import { getAdminMe } from "@/lib/api/admin";
import { hasPermission, type AdminRole, type PermissionKey } from "@/server/auth/permissions";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type AdminAccess = {
  userId: string;
  role: string;
  permissions: string[];
  can: (permission: PermissionKey) => boolean;
  refresh: () => Promise<void>;
};

const AdminAccessContext = createContext<AdminAccess | null>(null);

const REFRESH_MIN_INTERVAL_MS = 60_000;

/**
 * Holds the current admin's role + permissions. Seeded from the server layout (which
 * reads GET auth/me/), then re-fetched from auth/me/ when the window regains focus so
 * role/permission edits apply without signing out.
 */
export function AdminAccessProvider({
  userId,
  role: initialRole,
  permissions: initialPermissions,
  children,
}: {
  userId: string;
  role: string;
  permissions: string[];
  children: React.ReactNode;
}) {
  const token = useAdminToken();
  const [access, setAccess] = useState({ role: initialRole, permissions: initialPermissions });
  // 0 = never fetched on the client; the server layout already supplied fresh access.
  const lastFetch = useRef(0);

  const refresh = useCallback(async () => {
    if (!token) return;
    lastFetch.current = Date.now();
    try {
      const me = await getAdminMe(token);
      setAccess({
        role: me.role || initialRole,
        permissions: Array.isArray(me.permissions) ? me.permissions : initialPermissions,
      });
    } catch {
      // keep the last known access; API calls are still enforced server-side
    }
  }, [token, initialRole, initialPermissions]);

  useEffect(() => {
    lastFetch.current = Date.now();
    const onFocus = () => {
      if (Date.now() - lastFetch.current < REFRESH_MIN_INTERVAL_MS) return;
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const value = useMemo<AdminAccess>(
    () => ({
      userId,
      role: access.role,
      permissions: access.permissions,
      can: (permission) => hasPermission(access.permissions, permission, access.role as AdminRole),
      refresh,
    }),
    [userId, access, refresh],
  );

  return <AdminAccessContext.Provider value={value}>{children}</AdminAccessContext.Provider>;
}

export function useAdminAccess(): AdminAccess {
  const ctx = useContext(AdminAccessContext);
  if (!ctx) {
    return {
      userId: "",
      role: "",
      permissions: [],
      can: () => false,
      refresh: async () => {},
    };
  }
  return ctx;
}

/** Render children only when the current admin has the permission. */
export function Can({ permission, children }: { permission: PermissionKey; children: React.ReactNode }) {
  const { can } = useAdminAccess();
  return can(permission) ? <>{children}</> : null;
}
