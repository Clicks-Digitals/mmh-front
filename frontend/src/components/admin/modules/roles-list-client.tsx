"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { Notice } from "@/components/admin/ops/controls";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import {
  permissionDescription,
  permissionFlags,
  permissionTitle,
  privilegedRoleWarning,
  roleDescription,
  roleLabel,
} from "@/components/admin/lib/roles";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { listPermissions, listRoles, updateRolePermissions, type RoleInfo } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import { useState } from "react";

function sameSet(a: Set<string>, b: string[]) {
  return a.size === b.length && b.every((k) => a.has(k));
}

export function RolesListClient() {
  const toast = useAdminToast();
  const { role: myRole, refresh } = useAdminAccess();
  const isSuperAdmin = myRole === "SUPER_ADMIN";
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [unknown, setUnknown] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);

  const { data, setData, loading, error, reload, token } = useAdminQuery(async (tok) => {
    const [roleList, permList] = await Promise.all([listRoles(tok), listPermissions(tok)]);
    return { roles: roleList, permissions: permList };
  });

  const roles = data?.roles ?? [];
  const permissions = data?.permissions ?? [];

  // Seed selection from first role once data arrives (render-time adjust, not an effect).
  if (data && !selected && data.roles.length) {
    setSelected(data.roles[0].role);
    setDraft(new Set(data.roles[0].permissions.filter((p) => p !== "*")));
  }

  const current = roles.find((r) => r.role === selected);
  const isFixed = Boolean(current && (current.editable === false || current.permissions.includes("*")));
  const readOnly = isFixed || !isSuperAdmin;
  const dirty = current ? !sameSet(draft, current.permissions.filter((p) => p !== "*")) : false;

  function selectRole(role: RoleInfo) {
    setSelected(role.role);
    setUnknown([]);
    setDraft(new Set(role.permissions.filter((p) => p !== "*")));
  }

  function togglePerm(key: string) {
    if (readOnly) return;
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    if (!token || !selected || readOnly) return;
    setPending(true);
    setUnknown([]);
    try {
      await updateRolePermissions(token, selected, Array.from(draft).sort());
      toast.push(`${roleLabel(selected)} permissions saved`, "success");
      const roleList = await listRoles(token);
      setData((prev) => (prev ? { ...prev, roles: roleList } : { roles: roleList, permissions }));
      const updated = roleList.find((r) => r.role === selected);
      if (updated) setDraft(new Set(updated.permissions.filter((p) => p !== "*")));
      void refresh();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { unknown?: string[] } | null) : null;
      if (body?.unknown?.length) setUnknown(body.unknown);
      toast.push(adminErrorMessage(err, "Save failed"), "error");
    } finally {
      setPending(false);
      setConfirmSave(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Roles"
        description={
          isSuperAdmin
            ? "What each staff role may do. Changes apply at once to everyone with that role."
            : "What each staff role may do. Only a super admin can change them."
        }
        actions={
          selected && !readOnly ? (
            <button
              type="button"
              disabled={pending || !dirty}
              onClick={() => setConfirmSave(true)}
              className="admin-btn admin-btn-primary disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save permissions"}
            </button>
          ) : null
        }
      />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading ? <div className="h-40 animate-pulse rounded-xl border border-[var(--clicks-border)] bg-white" /> : null}
      {!loading && !error && !roles.length ? <EmptyState title="No roles returned" /> : null}
      {!loading && !error && roles.length ? (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <div className="space-y-1 rounded-xl border border-[var(--clicks-border)] bg-white p-2">
            {roles.map((role) => (
              <button
                key={role.role}
                type="button"
                onClick={() => selectRole(role)}
                className={`block w-full rounded-lg px-3 py-2 text-start text-sm ${
                  selected === role.role
                    ? "bg-[var(--clicks-blue)]/10 font-semibold text-[var(--clicks-blue)]"
                    : "text-[var(--clicks-navy)] hover:bg-[var(--clicks-bg)]"
                }`}
              >
                {role.label || roleLabel(role.role)}
                <span className="ms-1 text-[11px] font-normal text-[var(--clicks-muted)]">
                  {role.permissions.includes("*") ? "· everything" : `· ${role.permissions.length} permissions`}
                </span>
                {roleDescription(role.role) ? (
                  <span className="mt-0.5 block text-[11px] font-normal leading-snug text-[var(--clicks-muted)]">
                    {roleDescription(role.role)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-[var(--clicks-border)] bg-white p-4">
            <p className="font-semibold text-[var(--clicks-navy)]">{current?.label || roleLabel(selected)}</p>
            {roleDescription(selected) ? (
              <p className="mt-1 text-[13px] text-[var(--clicks-muted)]">{roleDescription(selected)}</p>
            ) : null}
            {privilegedRoleWarning(selected) ? (
              <Notice tone="warning" className="mt-3">
                {privilegedRoleWarning(selected)}
              </Notice>
            ) : null}
            {isFixed ? (
              <p className="mt-4 rounded-lg bg-[var(--clicks-bg)] px-3 py-2 text-sm text-[var(--clicks-muted)]">
                Super admins can always do everything. This role cannot be changed.
              </p>
            ) : !isSuperAdmin ? (
              <p className="mt-3 text-xs text-[var(--clicks-muted)]">Read-only — only a super admin can edit permissions.</p>
            ) : null}
            {unknown.length ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                Some permissions were not accepted by the server: {unknown.map((k) => permissionTitle(k)).join(", ")}
              </p>
            ) : null}
            {!isFixed ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {permissions.map((perm) => (
                  <label
                    key={perm.key}
                    className={`flex items-start gap-2 rounded-lg border p-2 text-sm ${
                      unknown.includes(perm.key) ? "border-red-300" : "border-[var(--clicks-border)]"
                    } ${readOnly ? "opacity-80" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={readOnly}
                      checked={draft.has(perm.key)}
                      onChange={() => togglePerm(perm.key)}
                    />
                    <span className="min-w-0" title={perm.key}>
                      <span className="flex flex-wrap items-center gap-1.5 font-medium text-[var(--clicks-navy)]">
                        {permissionTitle(perm.key, perm.description)}
                        {permissionFlags(perm.key).includes("money") ? <Badge tone="error">Money</Badge> : null}
                        {permissionFlags(perm.key).includes("secret") ? <Badge tone="warning">Secret codes</Badge> : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--clicks-muted)]">
                        {permissionDescription(perm.key, perm.description)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmSave}
        title={`Save ${selected ? roleLabel(selected) : ""} permissions?`}
        description={`Everyone with the ${selected ? roleLabel(selected) : ""} role gains or loses these permissions right away.${
          draft.has("orders.write") && !current?.permissions.includes("orders.write")
            ? " They will be able to refund and cancel orders."
            : ""
        }${
          draft.has("codes.reveal") && !current?.permissions.includes("codes.reveal")
            ? " They will be able to see full secret codes."
            : ""
        }`}
        confirmLabel="Save permissions"
        cancelLabel="Go back"
        pending={pending}
        onCancel={() => setConfirmSave(false)}
        onConfirm={() => void save()}
      />
    </div>
  );
}
