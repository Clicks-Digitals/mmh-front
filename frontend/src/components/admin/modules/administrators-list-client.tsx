"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, adminFieldErrors } from "@/components/admin/lib/errors";
import { assignableRoles, canManageAdmin, roleLabel } from "@/components/admin/lib/roles";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminResource } from "@/hooks/use-admin-resource";
import {
  asList,
  createAdministrator,
  listAdministrators,
  updateAdministrator,
  type AdminUser,
} from "@/lib/api/admin";
import { useState } from "react";

const emptyCreate = { email: "", password: "", full_name: "", role: "VIEWER", title: "" };

type EditForm = { full_name: string; title: string; role: string; disabled: boolean; password: string };

export function AdministratorsListClient() {
  const toast = useAdminToast();
  const { can, role: myRole, userId } = useAdminAccess();
  const canWrite = can("admins.write");
  const roles = assignableRoles(myRole);
  const { token, page, setPage, search, setSearch, items, count, loading, error, reload } =
    useAdminResource<AdminUser>(async (tok, p, s) => {
      const data = await listAdministrators(tok, { page: p, page_size: ADMIN_LIST_PAGE_SIZE, search: s || undefined });
      return asList(data);
    });

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ full_name: "", title: "", role: "VIEWER", disabled: false, password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [pending, setPending] = useState(false);

  async function create() {
    if (!token) return;
    setPending(true);
    setErrors({});
    try {
      await createAdministrator(token, {
        email: createForm.email.trim(),
        password: createForm.password,
        full_name: createForm.full_name.trim(),
        role: createForm.role,
        title: createForm.title.trim() || undefined,
      });
      toast.push("Administrator created", "success");
      setCreateOpen(false);
      setCreateForm(emptyCreate);
      reload();
    } catch (err) {
      setErrors(adminFieldErrors(err));
      toast.push(adminErrorMessage(err, "Create failed"), "error");
    } finally {
      setPending(false);
    }
  }

  function openEdit(row: AdminUser) {
    setEditing(row);
    setErrors({});
    setEditForm({
      full_name: row.first_name ?? "",
      title: row.title ?? "",
      role: row.role,
      disabled: Boolean(row.disabled),
      password: "",
    });
  }

  function editBody(row: AdminUser) {
    const body: Parameters<typeof updateAdministrator>[2] = {};
    const currentName = row.first_name ?? "";
    if (editForm.full_name.trim() && editForm.full_name.trim() !== currentName) body.full_name = editForm.full_name.trim();
    if (editForm.title.trim() !== (row.title ?? "")) body.title = editForm.title.trim();
    if (editForm.role !== row.role) body.role = editForm.role;
    if (editForm.disabled !== Boolean(row.disabled)) body.disabled = editForm.disabled;
    if (editForm.password) body.password = editForm.password;
    return body;
  }

  async function saveEdit() {
    if (!token || !editing) return;
    const body = editBody(editing);
    if (!Object.keys(body).length) {
      setEditing(null);
      return;
    }
    setPending(true);
    setErrors({});
    try {
      await updateAdministrator(token, editing.id, body);
      toast.push("Administrator updated", "success");
      setEditing(null);
      setConfirmEdit(false);
      reload();
    } catch (err) {
      setErrors(adminFieldErrors(err));
      setConfirmEdit(false);
      toast.push(adminErrorMessage(err, "Update failed"), "error");
    } finally {
      setPending(false);
    }
  }

  const isSelf = editing ? String(editing.id) === String(userId) : false;
  const pendingBody = editing ? editBody(editing) : {};
  const sensitive = Boolean(pendingBody.role || pendingBody.disabled !== undefined || pendingBody.password);
  const editRoleOptions = editing && !roles.includes(editing.role) ? [editing.role, ...roles] : roles;

  return (
    <div>
      <PageHeader
        title="Administrators"
        description="Staff accounts that can sign in to this panel."
        actions={
          canWrite ? (
            <button
              type="button"
              onClick={() => {
                setCreateForm(emptyCreate);
                setErrors({});
                setCreateOpen(true);
              }}
              className="admin-btn admin-btn-primary"
            >
              New admin
            </button>
          ) : null
        }
      />
      <Filters search={search} onSearchChange={setSearch} searchPlaceholder="Search admins…" />
      <DataTable
        columns={[
          {
            key: "name",
            header: "Admin",
            render: (r) => (
              <div>
                <p className="font-medium">
                  {[r.first_name, r.last_name].filter(Boolean).join(" ") || r.email}
                  {String(r.id) === String(userId) ? <span className="ms-1.5 text-[11px] text-[var(--clicks-muted)]">(you)</span> : null}
                </p>
                {r.title ? <p className="text-[11px] text-[var(--clicks-muted)]">{r.title}</p> : null}
              </div>
            ),
          },
          { key: "email", header: "Email", render: (r) => r.email },
          { key: "role", header: "Role", render: (r) => roleLabel(r.role) },
          {
            key: "status",
            header: "Status",
            render: (r) => <Badge status={r.disabled ? "DISABLED" : "ACTIVE"}>{r.disabled ? "Disabled" : "Active"}</Badge>,
          },
          { key: "login", header: "Last login", render: (r) => <span className="text-xs">{formatAdminDateTime(r.last_login)}</span> },
          ...(canWrite
            ? [
                {
                  key: "actions",
                  header: "",
                  render: (r: AdminUser) =>
                    canManageAdmin(myRole, r.role) || String(r.id) === String(userId) ? (
                      <button type="button" className="text-xs font-medium text-[var(--clicks-blue)]" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                    ) : (
                      <span className="text-[11px] text-[var(--clicks-muted)]">Super admin only</span>
                    ),
                },
              ]
            : []),
        ]}
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="No administrators" />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={setPage} />

      <AdminModal open={createOpen} onClose={() => setCreateOpen(false)} title="New administrator">
        <div className="space-y-3">
          <FormField label="Full name" htmlFor="ad-name" required error={errors.full_name}>
            <input
              id="ad-name"
              className={adminInputClass}
              value={createForm.full_name}
              onChange={(e) => setCreateForm((f) => ({ ...f, full_name: e.target.value }))}
            />
          </FormField>
          <FormField label="Email" htmlFor="ad-email" required error={errors.email}>
            <input
              id="ad-email"
              type="email"
              className={adminInputClass}
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
            />
          </FormField>
          <FormField
            label="Password"
            htmlFor="ad-pass"
            required
            hint="At least 12 characters; not too common or similar to the e-mail."
            error={errors.password}
          >
            <input
              id="ad-pass"
              type="password"
              autoComplete="new-password"
              className={adminInputClass}
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
            />
          </FormField>
          <FormField
            label="Role"
            htmlFor="ad-role"
            hint={myRole === "SUPER_ADMIN" ? "See the Roles page for what each role can do." : "Only a super admin can create Admin or Super admin accounts."}
            error={errors.role}
          >
            <select
              id="ad-role"
              className={adminInputClass}
              value={createForm.role}
              onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Job title" htmlFor="ad-title" hint="Optional, e.g. “Support lead”." error={errors.title}>
            <input
              id="ad-title"
              className={adminInputClass}
              value={createForm.title}
              onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || !createForm.email.trim() || !createForm.full_name.trim() || createForm.password.length < 12}
              onClick={() => void create()}
              className="admin-btn admin-btn-primary disabled:opacity-60"
            >
              {pending ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </AdminModal>

      <AdminModal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.email}` : ""}
        description={editing ? `Last login: ${formatAdminDateTime(editing.last_login)}` : undefined}
      >
        {editing ? (
          <div className="space-y-3">
            <FormField label="Full name" htmlFor="ed-name" error={errors.full_name}>
              <input
                id="ed-name"
                className={adminInputClass}
                value={editForm.full_name}
                onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </FormField>
            <FormField label="Job title" htmlFor="ed-title" error={errors.title}>
              <input
                id="ed-title"
                className={adminInputClass}
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
              />
            </FormField>
            <FormField
              label="Role"
              htmlFor="ed-role"
              hint={isSelf ? "You cannot change your own role." : "Takes effect on their next page load."}
              error={errors.role}
            >
              <select
                id="ed-role"
                className={adminInputClass}
                disabled={isSelf}
                value={editForm.role}
                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
              >
                {editRoleOptions.map((r) => (
                  <option key={r} value={r} disabled={!roles.includes(r)}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  disabled={isSelf}
                  checked={editForm.disabled}
                  onChange={(e) => setEditForm((f) => ({ ...f, disabled: e.target.checked }))}
                />
                Account disabled
              </label>
              <p className="ps-6 text-[11px] text-[var(--clicks-muted)]">
                {isSelf ? "You cannot disable your own account." : "Disabled admins are signed out and cannot sign in."}
              </p>
              {errors.disabled ? <p className="ps-6 text-[11px] text-[var(--clicks-error)]">{errors.disabled}</p> : null}
            </div>
            <FormField
              label="Set new password"
              htmlFor="ed-pass"
              hint="Leave empty to keep the current password. Min 12 characters; signs them out everywhere."
              error={errors.password}
            >
              <input
                id="ed-pass"
                type="password"
                autoComplete="new-password"
                className={adminInputClass}
                value={editForm.password}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
              />
            </FormField>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || (editForm.password.length > 0 && editForm.password.length < 12)}
                onClick={() => (sensitive ? setConfirmEdit(true) : void saveEdit())}
                className="admin-btn admin-btn-primary disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : null}
      </AdminModal>

      <ConfirmDialog
        open={confirmEdit}
        title="Apply these account changes?"
        description={[
          pendingBody.role ? `Role → ${roleLabel(pendingBody.role)}.` : "",
          pendingBody.disabled === true ? "The account will be disabled and signed out." : "",
          pendingBody.disabled === false ? "The account will be re-enabled." : "",
          pendingBody.password ? "The password will be replaced and all sessions signed out." : "",
        ]
          .filter(Boolean)
          .join(" ")}
        danger={pendingBody.disabled === true}
        pending={pending}
        confirmLabel="Apply"
        onCancel={() => setConfirmEdit(false)}
        onConfirm={() => void saveEdit()}
      />
    </div>
  );
}
