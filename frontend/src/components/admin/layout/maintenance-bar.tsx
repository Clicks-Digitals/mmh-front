"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { useAdminToken } from "@/hooks/use-admin-token";
import { getSiteSettings, updateSiteSettings } from "@/lib/api/admin";
import { getSettings } from "@/lib/api/cms";
import { Construction } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/** Fired by the Settings page after saving, so the bar updates without a reload. */
export const SETTINGS_CHANGED_EVENT = "mmh-admin-settings-changed";

export function notifySettingsChanged(settings: { maintenance_mode?: boolean }) {
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: settings }));
}

/**
 * D21 / CA-12: persistent bar while the store is in maintenance mode. Staff who can
 * manage settings get a one-click "Turn off"; everyone else is told who can.
 */
export function MaintenanceBar() {
  const token = useAdminToken();
  const { can } = useAdminAccess();
  const canManage = can("settings.manage");
  const toast = useAdminToast();
  const [on, setOn] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const settings = canManage && token ? await getSiteSettings(token) : await getSettings();
      setOn(Boolean(settings?.maintenance_mode));
    } catch {
      // keep the last known state
    }
  }, [canManage, token]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ maintenance_mode?: boolean }>).detail;
      if (detail && typeof detail.maintenance_mode === "boolean") setOn(detail.maintenance_mode);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(SETTINGS_CHANGED_EVENT, onChanged);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onChanged);
    };
  }, [load]);

  async function turnOff() {
    if (!token) return;
    setPending(true);
    try {
      const next = await updateSiteSettings(token, { maintenance_mode: false });
      setOn(Boolean(next.maintenance_mode));
      notifySettingsChanged(next);
      toast.push("Maintenance mode is off — the store is open again.", "success");
      setConfirm(false);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Could not turn off maintenance mode"), "error");
    } finally {
      setPending(false);
    }
  }

  if (!on) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-300 bg-amber-100 px-4 py-2 text-[13px] text-amber-950"
    >
      <Construction className="h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">The store is in maintenance mode.</span>{" "}
        Shoppers see a “back soon” page and cannot buy. Order pages and accounts still work.
      </p>
      {canManage ? (
        <div className="flex items-center gap-2">
          <Link href="/admin/settings" className="text-[12px] font-medium underline underline-offset-2">
            Settings
          </Link>
          <button type="button" className="admin-btn admin-btn-primary h-8 text-xs" onClick={() => setConfirm(true)}>
            Turn off
          </button>
        </div>
      ) : (
        <span className="text-[12px]">Ask an admin to turn it off in Settings.</span>
      )}
      <ConfirmDialog
        open={confirm}
        title="Turn off maintenance mode?"
        description="The store opens again for everyone straight away."
        confirmLabel="Turn off"
        pending={pending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void turnOff()}
      />
    </div>
  );
}
