"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, adminFieldErrors } from "@/components/admin/lib/errors";
import { useAdminResource } from "@/hooks/use-admin-resource";
import type { PermissionKey } from "@/server/auth/permissions";
import { useState } from "react";

export type CrudField = {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "checkbox" | "select" | "datetime-local" | "url";
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  hint?: string;
  rtl?: boolean;
  mono?: boolean;
  full?: boolean;
  placeholder?: string;
  maxLength?: number;
};

export type CrudValues = Record<string, string | boolean>;

/**
 * Small list + modal editor used by Platforms, Regions, FAQs and Pages.
 * Create/edit/delete buttons are hidden without `writePermission`.
 */
export function SimpleCrudPage<T extends { id: number | string }>({
  title,
  description,
  noun,
  writePermission,
  searchPlaceholder,
  columns,
  fields,
  emptyValues,
  toValues,
  toPayload,
  validate,
  list,
  create,
  update,
  remove,
  deleteDescription,
  extraRowActions,
  wide,
}: {
  title: string;
  description: string;
  noun: string;
  writePermission: PermissionKey;
  searchPlaceholder?: string;
  columns: DataTableColumn<T>[];
  fields: CrudField[];
  emptyValues: CrudValues;
  toValues: (row: T) => CrudValues;
  toPayload: (values: CrudValues) => Record<string, unknown>;
  validate?: (values: CrudValues) => Partial<Record<string, string>>;
  list: (token: string, page: number, search: string) => Promise<{ items: T[]; count: number }>;
  create: (token: string, body: Record<string, unknown>) => Promise<unknown>;
  update: (token: string, row: T, body: Record<string, unknown>) => Promise<unknown>;
  remove?: (token: string, row: T) => Promise<unknown>;
  deleteDescription?: (row: T) => string;
  extraRowActions?: (row: T, helpers: { token?: string; reload: () => void }) => React.ReactNode;
  wide?: boolean;
}) {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can(writePermission);
  const { token, page, setPage, search, setSearch, items, count, loading, error, reload } = useAdminResource<T>(list);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [values, setValues] = useState<CrudValues>(emptyValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);

  function open(row: T | null) {
    setEditing(row);
    setValues(row ? toValues(row) : emptyValues);
    setErrors({});
    setModalOpen(true);
  }

  async function save() {
    if (!token) return;
    const local: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && f.type !== "checkbox" && !String(values[f.name] ?? "").trim()) local[f.name] = "Required";
    }
    for (const [k, msg] of Object.entries(validate?.(values) ?? {})) if (msg) local[k] = msg;
    setErrors(local);
    if (Object.keys(local).length) return;
    setPending(true);
    try {
      const body = toPayload(values);
      if (editing) await update(token, editing, body);
      else await create(token, body);
      toast.push(editing ? `${noun} updated` : `${noun} created`, "success");
      setModalOpen(false);
      reload();
    } catch (err) {
      setErrors(adminFieldErrors(err));
      toast.push(adminErrorMessage(err, "Save failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function confirmDelete() {
    if (!token || !deleteTarget || !remove) return;
    setPending(true);
    try {
      await remove(token, deleteTarget);
      toast.push(`${noun} deleted`, "success");
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.push(adminErrorMessage(err, "Delete failed"), "error");
    } finally {
      setPending(false);
    }
  }

  const allColumns: DataTableColumn<T>[] = [
    ...columns,
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            render: (r: T) => (
              <div className="flex justify-end gap-3">
                {extraRowActions?.(r, { token, reload })}
                <button type="button" className="text-xs font-medium text-[var(--clicks-blue)]" onClick={() => open(r)}>
                  Edit
                </button>
                {remove ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-[var(--clicks-error)]"
                    onClick={() => setDeleteTarget(r)}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          canWrite ? (
            <button type="button" onClick={() => open(null)} className="admin-btn admin-btn-primary">
              New {noun.toLowerCase()}
            </button>
          ) : null
        }
      />
      <Filters search={search} onSearchChange={setSearch} searchPlaceholder={searchPlaceholder ?? "Search…"} />
      <DataTable
        columns={allColumns}
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title={`No ${title.toLowerCase()}`} />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={setPage} />

      <AdminModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${noun.toLowerCase()}` : `New ${noun.toLowerCase()}`}
        wide={wide}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => {
            const id = `crud-${f.name}`;
            const value = values[f.name];
            if (f.type === "checkbox") {
              return (
                <div key={f.name} className="space-y-1 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))}
                    />
                    {f.label}
                  </label>
                  {f.hint ? <p className="ps-6 text-[11px] text-[var(--clicks-muted)]">{f.hint}</p> : null}
                </div>
              );
            }
            const common = {
              id,
              dir: f.rtl ? "rtl" : undefined,
              value: String(value ?? ""),
              placeholder: f.placeholder,
              maxLength: f.maxLength,
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                setValues((v) => ({ ...v, [f.name]: e.target.value })),
            };
            return (
              <FormField
                key={f.name}
                label={f.label}
                htmlFor={id}
                required={f.required}
                hint={f.hint}
                error={errors[f.name]}
                className={f.full || f.type === "textarea" ? "sm:col-span-2" : undefined}
              >
                {f.type === "textarea" ? (
                  <textarea {...common} className={`${adminTextareaClass} min-h-[140px]`} />
                ) : f.type === "select" ? (
                  <select {...common} className={adminInputClass}>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    type={f.type ?? "text"}
                    className={`${adminInputClass} ${f.mono ? "font-mono" : ""}`}
                  />
                )}
              </FormField>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setModalOpen(false)}>
            Cancel
          </button>
          <button type="button" disabled={pending} onClick={() => void save()} className="admin-btn admin-btn-primary disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${noun.toLowerCase()}?`}
        description={deleteTarget ? (deleteDescription?.(deleteTarget) ?? "This cannot be undone.") : undefined}
        danger
        pending={pending}
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function str(values: CrudValues, key: string): string {
  return String(values[key] ?? "").trim();
}
