"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { validationSource } from "@/components/admin/lib/product-form";
import { slugify } from "@/components/admin/lib/slugify";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { ArtworkPicker } from "@/components/admin/ui/artwork-picker";
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
import { useAdminUrlResource } from "@/hooks/use-admin-url-resource";
import { ApiError } from "@/lib/api/client";
import type { PermissionKey } from "@/server/auth/permissions";
import { useState } from "react";

export type CrudField = {
  name: string;
  label: string;
  /** "artwork": built-in picture picker (Advanced), uses the `slug` value for its automatic choice */
  type?: "text" | "number" | "textarea" | "checkbox" | "select" | "datetime-local" | "url" | "artwork";
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  /** show "(optional)" */
  optional?: boolean;
  hint?: React.ReactNode | ((values: CrudValues) => React.ReactNode);
  rtl?: boolean;
  mono?: boolean;
  full?: boolean;
  placeholder?: string;
  maxLength?: number;
};

export type CrudValues = Record<string, string | boolean>;

export type CrudListState = { search: string; ordering: string; page: string };

/** Context for the optional picture block of the editor (see `media`). */
export type CrudMediaContext<T> = {
  editing: T | null;
  values: CrudValues;
  token?: string;
  canWrite: boolean;
  /** replace the row being edited (e.g. with the upload response) */
  setEditing: (row: T) => void;
  reload: () => void;
};

function nounText(noun: string) {
  return /^[A-Z0-9]{2,}$/.test(noun) ? noun : noun.toLowerCase();
}

/**
 * Small list + modal editor used by Platforms, Regions, FAQs, Pages and Suppliers.
 * Search/sort/page are kept in the URL. Create/edit/delete need `writePermission`.
 * With `slugFrom`, the `slug` field follows that field while creating until edited by hand.
 */
export function SimpleCrudPage<T extends { id: number | string }>({
  title,
  description,
  noun,
  writePermission,
  searchPlaceholder,
  searchHint,
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
  slugFrom,
  defaultOrdering,
  emptyDescription,
  media,
}: {
  title: string;
  description: string;
  noun: string;
  writePermission: PermissionKey;
  searchPlaceholder?: string;
  searchHint?: string;
  columns: DataTableColumn<T>[];
  fields: CrudField[];
  emptyValues: CrudValues;
  toValues: (row: T) => CrudValues;
  toPayload: (values: CrudValues, editing: T | null) => Record<string, unknown>;
  validate?: (values: CrudValues, editing: T | null) => Partial<Record<string, string>>;
  list: (token: string, state: CrudListState) => Promise<{ items: T[]; count: number }>;
  create: (token: string, body: Record<string, unknown>) => Promise<unknown>;
  update: (token: string, row: T, body: Record<string, unknown>) => Promise<unknown>;
  remove?: (token: string, row: T) => Promise<unknown>;
  deleteDescription?: (row: T) => string;
  extraRowActions?: (row: T, helpers: { token?: string; reload: () => void }) => React.ReactNode;
  wide?: boolean;
  slugFrom?: string;
  /** ordering the API uses by default (marks the matching sortable column) */
  defaultOrdering?: string;
  emptyDescription?: string;
  /**
   * Picture block shown at the top of the editor. With it, creating keeps the editor open on the new
   * row (when `create` returns it) so its picture can be uploaded right away.
   */
  media?: (ctx: CrudMediaContext<T>) => React.ReactNode;
}) {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can(writePermission);
  const { state, set, reset, page, hasFilters, token, items, count, loading, error, reload } = useAdminUrlResource<T, CrudListState>(
    { search: "", ordering: "", page: "1" },
    (tok, s) => list(tok, s),
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [values, setValues] = useState<CrudValues>(emptyValues);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const noun_ = nounText(noun);

  function open(row: T | null) {
    setEditing(row);
    setValues(row ? toValues(row) : emptyValues);
    setSlugTouched(Boolean(row));
    setErrors({});
    setFormError("");
    setModalOpen(true);
  }

  function change(name: string, value: string | boolean) {
    setValues((v) => {
      const next = { ...v, [name]: value };
      if (slugFrom && name === slugFrom && !slugTouched && typeof value === "string") next.slug = slugify(value);
      return next;
    });
    if (name === "slug") setSlugTouched(true);
    setErrors((e) => {
      if (!(name in e)) return e;
      const next = { ...e };
      delete next[name];
      return next;
    });
  }

  async function save() {
    if (!token) return;
    const local: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && f.type !== "checkbox" && !String(values[f.name] ?? "").trim()) local[f.name] = `Enter ${f.label.replace(/\s*\(.*\)$/, "").toLowerCase()}.`;
    }
    for (const [k, msg] of Object.entries(validate?.(values, editing) ?? {})) if (msg) local[k] = msg;
    setErrors(local);
    setFormError("");
    if (Object.keys(local).length) return;
    setPending(true);
    try {
      const body = toPayload(values, editing);
      if (editing) {
        await update(token, editing, body);
        toast.push(`${noun} saved`, "success");
        setModalOpen(false);
      } else {
        const created = await create(token, body);
        if (media && created && typeof created === "object" && "id" in created) {
          const row = created as T;
          setEditing(row);
          setValues(toValues(row));
          setSlugTouched(true);
          toast.push(`${noun} created — you can now upload its picture`, "success");
        } else {
          toast.push(`${noun} created`, "success");
          setModalOpen(false);
        }
      }
      reload();
    } catch (err) {
      const fieldErrs = adminFieldErrors(err);
      const known = Object.fromEntries(Object.entries(fieldErrs).filter(([k]) => fields.some((f) => f.name === k)));
      setErrors(known);
      const unknown = Object.keys(validationSource(err instanceof ApiError ? err.body : null)).filter(
        (k) => !fields.some((f) => f.name === k),
      );
      setFormError(Object.keys(known).length && !unknown.length ? "Please fix the highlighted fields." : adminErrorMessage(err, "Save failed"));
    } finally {
      setPending(false);
    }
  }

  async function confirmDelete() {
    if (!token || !deleteTarget || !remove) return;
    setPending(true);
    setDeleteError("");
    try {
      await remove(token, deleteTarget);
      toast.push(`${noun} deleted`, "success");
      setDeleteTarget(null);
      reload();
    } catch (err) {
      // Keep the dialog open and explain why (e.g. 409 "Move or delete its sub-categories first: …").
      setDeleteError(adminErrorMessage(err, "Delete failed"));
    } finally {
      setPending(false);
    }
  }

  const allColumns: DataTableColumn<T>[] = [
    ...columns,
    ...(canWrite || extraRowActions
      ? [
          {
            key: "actions",
            header: "",
            render: (r: T) => (
              <div className="flex justify-end gap-3">
                {extraRowActions?.(r, { token, reload })}
                {canWrite ? (
                  <button type="button" className="text-xs font-medium text-[var(--clicks-blue)]" onClick={() => open(r)}>
                    Edit
                  </button>
                ) : null}
                {canWrite && remove ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-[var(--clicks-error)]"
                    onClick={() => {
                      setDeleteError("");
                      setDeleteTarget(r);
                    }}
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
              New {noun_}
            </button>
          ) : null
        }
      />
      <Filters
        search={state.search}
        onSearchChange={(v) => set({ search: v })}
        searchPlaceholder={searchPlaceholder ?? "Search…"}
        searchHint={searchHint}
        onClear={reset}
      />
      <DataTable
        columns={allColumns}
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        ordering={state.ordering}
        defaultOrdering={defaultOrdering}
        onOrderingChange={(next) => set({ ordering: next === defaultOrdering ? "" : next })}
        empty={
          <EmptyState
            title={hasFilters ? `No ${title.toLowerCase()} match your search` : `No ${title.toLowerCase()} yet`}
            description={hasFilters ? "Try another search." : emptyDescription}
          />
        }
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={(p) => set({ page: String(p) })} />

      <AdminModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${noun_}` : `New ${noun_}`} wide={wide}>
        {formError ? (
          <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
            {formError}
          </p>
        ) : null}
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          {media ? (
            <div className="sm:col-span-2">
              {media({ editing, values, token, canWrite, setEditing: (row) => setEditing(row), reload })}
            </div>
          ) : null}
          {fields.map((f) => {
            const id = `crud-${f.name}`;
            const value = values[f.name];
            const hint = typeof f.hint === "function" ? f.hint(values) : f.hint;
            if (f.type === "artwork") {
              return (
                <ArtworkPicker
                  key={f.name}
                  id={id}
                  value={String(value ?? "")}
                  slug={String(values.slug ?? "")}
                  onChange={(key) => change(f.name, key)}
                />
              );
            }
            if (f.type === "checkbox") {
              return (
                <div key={f.name} className="space-y-1 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={Boolean(value)} onChange={(e) => change(f.name, e.target.checked)} />
                    {f.label}
                  </label>
                  {hint ? <p className="ps-6 text-[11px] text-[var(--clicks-muted)]">{hint}</p> : null}
                  {errors[f.name] ? <p className="ps-6 text-[11px] text-[var(--clicks-error)]">{errors[f.name]}</p> : null}
                </div>
              );
            }
            const common = {
              id,
              dir: f.rtl ? "rtl" : undefined,
              value: String(value ?? ""),
              placeholder: f.placeholder,
              maxLength: f.maxLength,
              "aria-invalid": errors[f.name] ? true : undefined,
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                change(f.name, f.name === "slug" ? e.target.value.toLowerCase() : e.target.value),
            };
            const invalid = errors[f.name] ? "border-[var(--clicks-error)]" : "";
            return (
              <FormField
                key={f.name}
                label={f.label}
                htmlFor={id}
                required={f.required}
                optional={f.optional}
                hint={hint}
                error={errors[f.name]}
                className={f.full || f.type === "textarea" ? "sm:col-span-2" : undefined}
              >
                {f.type === "textarea" ? (
                  <textarea {...common} className={`${adminTextareaClass} min-h-[140px] ${invalid}`} />
                ) : f.type === "select" ? (
                  <select {...common} className={`${adminInputClass} ${invalid}`}>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input {...common} type={f.type ?? "text"} className={`${adminInputClass} ${f.mono ? "font-mono" : ""} ${invalid}`} />
                )}
              </FormField>
            );
          })}
          <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setModalOpen(false)}>
              {editing && media ? "Close" : "Cancel"}
            </button>
            <button type="submit" disabled={pending} className="admin-btn admin-btn-primary disabled:opacity-60">
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${noun_}?`}
        description={deleteTarget ? (deleteDescription?.(deleteTarget) ?? "This can't be undone.") : undefined}
        danger
        pending={pending}
        confirmLabel="Delete"
        confirmDisabled={Boolean(deleteError)}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError("");
        }}
        onConfirm={() => void confirmDelete()}
      >
        {deleteError ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
            {deleteError}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function str(values: CrudValues, key: string): string {
  return String(values[key] ?? "").trim();
}

/** Standard list loader params for SimpleCrudPage lists. */
export function crudListParams(state: CrudListState, fallbackOrdering?: string) {
  return {
    page: Number(state.page) || 1,
    page_size: ADMIN_LIST_PAGE_SIZE,
    search: state.search || undefined,
    ordering: state.ordering || fallbackOrdering || undefined,
  };
}

/** Validation for optional slugs: empty is fine (created from the name), otherwise the slug pattern. */
export function optionalSlugError(values: CrudValues): string | undefined {
  const slug = str(values, "slug");
  if (!slug) return undefined;
  return SLUG_RE.test(slug) ? undefined : "Use only lowercase letters, numbers and dashes (no spaces), e.g. play-station.";
}
