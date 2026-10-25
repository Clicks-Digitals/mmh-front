"use client";

import { ADMIN_API_ERROR_EVENT, type AdminApiErrorDetail } from "@/components/admin/ops/api-events";
import { useAdminToken } from "@/hooks/use-admin-token";
import { getAdminMe } from "@/lib/api/admin";
import { hasPermission, type AdminRole, type PermissionKey } from "@/server/auth/permissions";
import { getSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/** Permission keys the backend knows that are newer than the shared PermissionKey list (D13). */
export type AdminPermission = PermissionKey | "orders.notify";

type AdminAccess = {
  userId: string;
  role: string;
  permissions: string[];
  can: (permission: AdminPermission) => boolean;
  refresh: () => Promise<void>;
};

const AdminAccessContext = createContext<AdminAccess | null>(null);

const REFRESH_MIN_INTERVAL_MS = 60_000;
const NOTICE_MS = 6_000;

function sameAccess(a: { role: string; permissions: string[] }, b: { role: string; permissions: string[] }) {
  if (a.role !== b.role || a.permissions.length !== b.permissions.length) return false;
  const set = new Set(a.permissions);
  return b.permissions.every((p) => set.has(p));
}

/**
 * Holds the current admin's role + permissions. Seeded from the server layout (which
 * reads GET auth/me/), re-fetched from auth/me/ when the window regains focus, and
 * immediately after any 403 from the admin API (RO-09). A 401 means the session was
 * revoked (password reset, disabled, role change) → sign out and go to the login page (RO-15).
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
  const router = useRouter();
  const [access, setAccess] = useState({ role: initialRole, permissions: initialPermissions });
  const [notice, setNotice] = useState("");
  const accessRef = useRef(access);
  // 0 = never fetched on the client; the server layout already supplied fresh access.
  const lastFetch = useRef(0);
  const handling401 = useRef(false);

  useEffect(() => {
    accessRef.current = access;
  }, [access]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? "" : current)), NOTICE_MS);
  }, []);

  /** Re-read auth/me; returns true when role or permissions changed. */
  const reload = useCallback(async (): Promise<boolean> => {
    if (!token) return false;
    lastFetch.current = Date.now();
    try {
      const me = await getAdminMe(token);
      const next = {
        role: me.role || accessRef.current.role,
        permissions: Array.isArray(me.permissions) ? me.permissions : accessRef.current.permissions,
      };
      const changed = !sameAccess(accessRef.current, next);
      if (changed) {
        setAccess(next);
        // Server components re-check page access (e.g. redirect to "no access").
        router.refresh();
      }
      return changed;
    } catch {
      // keep the last known access; API calls are still enforced server-side
      return false;
    }
  }, [token, router]);

  const refresh = useCallback(async () => {
    await reload();
  }, [reload]);

  useEffect(() => {
    lastFetch.current = Date.now();
    const onFocus = () => {
      if (Date.now() - lastFetch.current < REFRESH_MIN_INTERVAL_MS) return;
      void reload().then((changed) => {
        if (changed) showNotice("Your permissions changed. The page now shows what your role can do.");
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload, showNotice]);

  useEffect(() => {
    async function onSessionRejected() {
      if (handling401.current) return;
      handling401.current = true;
      try {
        // The access token may simply have expired: ask NextAuth for a fresh one first.
        const session = await getSession();
        const fresh = session?.user?.accessToken;
        if (fresh) {
          try {
            await getAdminMe(fresh);
            showNotice("Your session was refreshed. Please try that again.");
            return;
          } catch {
            // still rejected → really signed out
          }
        }
        await signOut({ redirect: false }).catch(() => undefined);
        router.replace("/admin/login?reason=session");
        router.refresh();
      } finally {
        handling401.current = false;
      }
    }

    function onApiError(event: Event) {
      const detail = (event as CustomEvent<AdminApiErrorDetail>).detail;
      if (!detail) return;
      if (detail.status === 401) {
        void onSessionRejected();
        return;
      }
      if (detail.status === 403) {
        void reload().then((changed) => {
          if (changed) showNotice("Your permissions changed. The page now shows what your role can do.");
        });
      }
    }
    window.addEventListener(ADMIN_API_ERROR_EVENT, onApiError);
    return () => window.removeEventListener(ADMIN_API_ERROR_EVENT, onApiError);
  }, [reload, showNotice, router]);

  const value = useMemo<AdminAccess>(
    () => ({
      userId,
      role: access.role,
      permissions: access.permissions,
      can: (permission) => hasPermission(access.permissions, permission as PermissionKey, access.role as AdminRole),
      refresh,
    }),
    [userId, access, refresh],
  );

  return (
    <AdminAccessContext.Provider value={value}>
      {children}
      {notice ? (
        <div
          role="status"
          className="fixed inset-x-0 top-3 z-[70] mx-auto w-fit max-w-[calc(100%-2rem)] rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-[13px] text-amber-900 shadow-[var(--admin-shadow-hover)]"
        >
          {notice}
          <button
            type="button"
            className="ms-3 text-[12px] font-semibold underline"
            onClick={() => setNotice("")}
          >
            OK
          </button>
        </div>
      ) : null}
    </AdminAccessContext.Provider>
  );
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
export function Can({ permission, children }: { permission: AdminPermission; children: React.ReactNode }) {
  const { can } = useAdminAccess();
  return can(permission) ? <>{children}</> : null;
}
