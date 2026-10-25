"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { listAdministratorRows, type AdminUserRow } from "@/components/admin/ops/api";
import { passwordAcceptable } from "@/components/admin/ops/auth-helpers";
import { Notice } from "@/components/admin/ops/controls";
import { OpsTable } from "@/components/admin/ops/ops-table";
import { PasswordField } from "@/components/admin/ops/password-field";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorSummary, adminFieldErrors } from "@/components/admin/lib/errors";
import {
  ADMIN_ROLES,
  assignableRoles,
  canManageAdmin,
  privilegedRoleWarning,
  roleDescription,
  roleLabel,
} from "@/components/admin/lib/roles";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { useAdminUrlState } from "@/hooks/use-admin-url-state";
import { asList, createAdministrator, updateAdministrator } from "@/lib/api/admin";
import { useState } from "react";

const emptyCreate = { email: "", password: "", full_name: "", role: "VIEWER", title: "" };
const CREATE_FIELDS = ["email", "password", "full_name", "role", "title"];

type EditForm = { full_name: string; title: string; role: string; disabled: boolean; password: string };

function withoutKey(errors: Record<string, string>, key: string) {
  if (!errors[key]) return errors;
  const next = { ...errors };
  delete next[key];
  return next;
}

function RoleSelect({
  id,
  value,
  options,
  allowed,
  disabled,
  hint,
  error,
  onChange,
}: {
  id: string;
  value: string;
  options: string[];
  allowed: string[];
  disabled?: boolean;
  hint: string;
  error?: string;
  onChange: (role: string) => void;
}) {
  const warning = privilegedRoleWarning(value);
  return (
    <FormField label="Role" htmlFor={id} hint={hint} error={error}>
      <select id={id} className={adminInputClass} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((r) => (
          <option key={r} value={r} disabled={!allowed.includes(r)}>
            {roleLabel(r)} — {roleDescription(r)}
          </option>
        ))}
      </select>
      {roleDescription(value) ? (
        <p className="rounded-lg bg-[var(--clicks-bg)] px-3 py-2 text-[12px] text-[var(--clicks-text)]">
          <span className="font-semibold">{roleLabel(value)}:</span> {roleDescription(value)}
        </p>
      ) : null}
      {warning ? <Notice tone="warning">{warning}</Notice> : null}
    </FormField>
  );
}

const LIST_DEFAULTS = { search: "", role: "", page: "1" };

/** Search, role filter and page live in the URL (?search=, ?role=, ?page=) so links like ?search=email work. */
export function AdministratorsListClient() {
  const toast = useAdminToast();
  const { can, role: myRole, userId } = useAdminAccess();
  const canWrite = can("admins.write");
  const roles = assignableRoles(myRole);

  const list = useAdminUrlState(LIST_DEFAULTS);
  const search = list.debounced.search.trim();
  const roleFilter = list.debounced.role;
  const page = Number(list.debounced.page) || 1;

  const { data, loading, error, reload, token } = useAdminQuery(
    async (tok) =>
      asList(
        await listAdministratorRows(tok, {
          page,
          page_size: ADMIN_LIST_PAGE_SIZE,
          search: search || undefined,
          role: roleFilter || undefined,
        }),
      ),
    [page, search, roleFilter],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ full_name: "", title: "", role: "VIEWER", disabled: false, password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [pending, setPending] = useState(false);

  function setCreate<K extends keyof typeof emptyCreate>(key: K, value: string) {
    setCreateForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => withoutKey(e, key));
    setFormError("");
  }

  function setEdit<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setEditForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => withoutKey(e, key));
    setFormError("");
  }

  function failed(err: unknown, fallback: string) {
    const fields = adminFieldErrors(err);
    setErrors(fields);
    const inline = Object.keys(fields).filter((k) => CREATE_FIELDS.includes(k) || k === "disabled");
    setFormError(inline.length ? "Please fix the highlighted fields." : adminErrorSummary(err, fallback));
  }

  async function create() {
    if (!token) return;
    setPending(true);
    setErrors({});
    setFormError("");
    try {
      await createAdministrator(token, {
        email: createForm.email.trim(),
        password: createForm.password,
        full_name: createForm.full_name.trim(),
        role: createForm.role,
        title: createForm.title.trim() || undefined,
      });
      toast.push("Staff account created", "success");
      setCreateOpen(false);
      setCreateForm(emptyCreate);
      reload();
    } catch (err) {
      failed(err, "Could not create the account.");
    } finally {
      setPending(false);
    }
  }

  function openEdit(row: AdminUserRow) {
    setEditing(row);
    setErrors({});
    setFormError("");
    setEditForm({
      full_name: [row.first_name, row.last_name].filter(Boolean).join(" "),
      title: row.title ?? "",
      role: row.role,
      disabled: Boolean(row.disabled),
      password: "",
    });
  }

  function editBody(row: AdminUserRow) {
    const body: Parameters<typeof updateAdministrator>[2] = {};
    const currentName = [row.first_name, row.last_name].filter(Boolean).join(" ");
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
    setFormError("");
    try {
      await updateAdministrator(token, editing.id, body);
      toast.push("Staff account saved", "success");
      setEditing(null);
      setConfirmEdit(false);
      reload();
    } catch (err) {
      setConfirmEdit(false);
      failed(err, "Could not save the account.");
    } finally {
      setPending(false);
    }
  }

  const isSelf = editing ? String(editing.id) === String(userId) : false;
  const pendingBody = editing ? editBody(editing) : {};
  const sensitive = Boolean(pendingBody.role || pendingBody.disabled !== undefined || pendingBody.password);
  const editRoleOptions = editing && !roles.includes(editing.role) ? [editing.role, ...roles] : roles;
  const createReady =
    createForm.email.trim() && createForm.full_name.trim() && passwordAcceptable(createForm.password, createForm.email);
  const editPasswordOk = !editForm.password || passwordAcceptable(editForm.password, editing?.email ?? "");
  const rows = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Administrators"
        description="Staff accounts that can sign in to this panel. The role decides what each person can see and do."
        actions={
          canWrite ? (
            <button
              type="button"
              onClick={() => {
                setCreateForm(emptyCreate);
                setErrors({});
                setFormError("");
                setCreateOpen(true);
              }}
              className="admin-btn admin-btn-primary"
            >
              New staff account
            </button>
          ) : null
        }
      />
      <Filters
        search={list.state.search}
        onSearchChange={(v) => list.set({ search: v })}
        searchPlaceholder="Name or e-mail…"
        filters={[
          {
            key: "role",
            label: "Role",
            value: list.state.role,
            onChange: (v) => list.set({ role: v }),
            options: [{ value: "", label: "Any role" }, ...ADMIN_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))],
          },
        ]}
        onClear={list.reset}
      />
      <OpsTable<AdminUserRow>
        rows={rows}
        loading={loading && !data}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="No staff accounts found" description={search ? "Try another name or e-mail." : undefined} />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
        columns={[
          {
            key: "name",
            header: "Name",
            primary: true,
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
          { key: "email", header: "E-mail", render: (r) => <span className="break-all">{r.email}</span> },
          { key: "role", header: "Role", render: (r) => r.role_label || roleLabel(r.role) },
          {
            key: "status",
            header: "Status",
            render: (r) => <Badge status={r.disabled ? "DISABLED" : "ACTIVE"}>{r.disabled ? "Disabled" : "Active"}</Badge>,
          },
          {
            key: "login",
            header: "Last sign-in",
            className: "whitespace-nowrap",
            render: (r) => <span className="text-xs">{r.last_login ? formatAdminDateTime(r.last_login) : "Never"}</span>,
          },
          ...(canWrite
            ? [
                {
                  key: "actions",
                  header: "",
                  render: (r: AdminUserRow) =>
                    canManageAdmin(myRole, r.role) || String(r.id) === String(userId) ? (
                      <button type="button" className="text-xs font-medium text-[var(--clicks-blue)]" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                    ) : (
                      <span className="text-[11px] text-[var(--clicks-muted)]">Only a super admin can edit this account</span>
                    ),
                },
              ]
            : []),
        ]}
      />
      <Pagination
        page={list.page}
        pageSize={ADMIN_LIST_PAGE_SIZE}
        total={data?.count ?? 0}
        onPageChange={(p) => list.set({ page: String(p) })}
      />

      <AdminModal open={createOpen} onClose={() => setCreateOpen(false)} title="New staff account">
        <div className="space-y-3">
          <FormField label="Full name" htmlFor="ad-name" required error={errors.full_name}>
            <input
              id="ad-name"
              className={adminInputClass}
              value={createForm.full_name}
              onChange={(e) => setCreate("full_name", e.target.value)}
            />
          </FormField>
          <FormField label="E-mail" htmlFor="ad-email" required hint="They sign in with this address." error={errors.email}>
            <input
              id="ad-email"
              type="email"
              autoComplete="off"
              className={adminInputClass}
              value={createForm.email}
              onChange={(e) => setCreate("email", e.target.value)}
            />
          </FormField>
          <PasswordField
            id="ad-pass"
            label="Password"
            required
            value={createForm.password}
            email={createForm.email}
            error={errors.password}
            onChange={(v) => setCreate("password", v)}
          />
          <RoleSelect
            id="ad-role"
            value={createForm.role}
            options={roles}
            allowed={roles}
            hint={myRole === "SUPER_ADMIN" ? "Pick the smallest role that lets them do their job." : "Only a super admin can create Admin or Super admin accounts."}
            error={errors.role}
            onChange={(v) => setCreate("role", v)}
          />
          <FormField label="Job title" htmlFor="ad-title" hint="Optional, e.g. “Support lead”." error={errors.title}>
            <input id="ad-title" className={adminInputClass} value={createForm.title} onChange={(e) => setCreate("title", e.target.value)} />
          </FormField>
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || !createReady}
              onClick={() => void create()}
              className="admin-btn admin-btn-primary disabled:opacity-60"
            >
              {pending ? "Creating…" : "Create account"}
            </button>
          </div>
        </div>
      </AdminModal>

      <AdminModal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.email}` : ""}
        description={editing ? `Last sign-in: ${editing.last_login ? formatAdminDateTime(editing.last_login) : "never"}` : undefined}
      >
        {editing ? (
          <div className="space-y-3">
            <FormField label="Full name" htmlFor="ed-name" error={errors.full_name}>
              <input id="ed-name" className={adminInputClass} value={editForm.full_name} onChange={(e) => setEdit("full_name", e.target.value)} />
            </FormField>
            <FormField label="Job title" htmlFor="ed-title" error={errors.title}>
              <input id="ed-title" className={adminInputClass} value={editForm.title} onChange={(e) => setEdit("title", e.target.value)} />
            </FormField>
            <RoleSelect
              id="ed-role"
              value={editForm.role}
              options={editRoleOptions}
              allowed={roles}
              disabled={isSelf}
              hint={isSelf ? "You cannot change your own role." : "They are signed out and must sign in again with the new role."}
              error={errors.role}
              onChange={(v) => setEdit("role", v)}
            />
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  disabled={isSelf}
                  checked={editForm.disabled}
                  onChange={(e) => setEdit("disabled", e.target.checked)}
                />
                Account disabled
              </label>
              <p className="ps-6 text-[11px] text-[var(--clicks-muted)]">
                {isSelf ? "You cannot disable your own account." : "Disabled staff are signed out at once and cannot sign in."}
              </p>
              {errors.disabled ? <p className="ps-6 text-[11px] text-[var(--clicks-error)]">{errors.disabled}</p> : null}
            </div>
            <PasswordField
              id="ed-pass"
              label="Set a new password"
              value={editForm.password}
              email={editing.email}
              optionalHint="Leave empty to keep the current password. A new password signs them out everywhere."
              error={errors.password}
              onChange={(v) => setEdit("password", v)}
            />
            {formError ? <Notice tone="error">{formError}</Notice> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || !editPasswordOk}
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
          pendingBody.role ? `New role: ${roleLabel(pendingBody.role)}. ${privilegedRoleWarning(pendingBody.role)}` : "",
          pendingBody.disabled === true ? "The account will be disabled and signed out at once." : "",
          pendingBody.disabled === false ? "The account will be able to sign in again." : "",
          pendingBody.password ? "The password will be replaced and every session signed out." : "",
          pendingBody.role && !pendingBody.password && pendingBody.disabled === undefined
            ? "They will be signed out and must sign in again."
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        danger={pendingBody.disabled === true || Boolean(privilegedRoleWarning(pendingBody.role))}
        pending={pending}
        confirmLabel="Apply changes"
        cancelLabel="Go back"
        onCancel={() => setConfirmEdit(false)}
        onConfirm={() => void saveEdit()}
      />
    </div>
  );
}
