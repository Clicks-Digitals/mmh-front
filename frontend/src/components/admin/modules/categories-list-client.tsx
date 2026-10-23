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
import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, adminFieldErrors } from "@/components/admin/lib/errors";
import { useAdminResource } from "@/hooks/use-admin-resource";
import {
  asList,
  createCategory,
  deleteCategory,
  fetchAllPages,
  listCategories,
  updateCategory,
  type AdminCategory,
} from "@/lib/api/admin";
import { useState } from "react";

const emptyForm = {
  name_en: "",
  name_ar: "",
  slug: "",
  description_en: "",
  description_ar: "",
  parent: "",
  artwork_key: "",
  sort_order: "0",
  status: "PUBLISHED",
};

/** Ids of `rootId` and all of its descendants (cannot be chosen as its parent). */
function blockedParentIds(all: AdminCategory[], rootId: string): Set<string> {
  const blocked = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) {
      if (c.parent != null && blocked.has(String(c.parent)) && !blocked.has(String(c.id))) {
        blocked.add(String(c.id));
        grew = true;
      }
    }
  }
  return blocked;
}

export function CategoriesListClient() {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("catalog.write");
  const { token, page, setPage, search, setSearch, items, count, loading, error, reload } =
    useAdminResource<AdminCategory>(async (tok, p, s) => {
      const data = await listCategories(tok, { page: p, page_size: ADMIN_LIST_PAGE_SIZE, search: s || undefined });
      return asList(data);
    });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [allCategories, setAllCategories] = useState<AdminCategory[]>([]);
  const [pending, setPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);

  async function loadParents() {
    if (!token) return;
    try {
      setAllCategories(await fetchAllPages((params) => listCategories(token, params)));
    } catch (err) {
      toast.push(adminErrorMessage(err, "Could not load categories"), "error");
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setErrors({});
    setModalOpen(true);
    void loadParents();
  }

  function openEdit(row: AdminCategory) {
    setEditing(row);
    setForm({
      name_en: row.name_en,
      name_ar: row.name_ar ?? "",
      slug: row.slug,
      description_en: row.description_en ?? "",
      description_ar: row.description_ar ?? "",
      parent: row.parent != null ? String(row.parent) : "",
      artwork_key: row.artwork_key ?? "",
      sort_order: String(row.sort_order ?? 0),
      status: row.status,
    });
    setErrors({});
    setModalOpen(true);
    void loadParents();
  }

  async function save() {
    if (!token) return;
    const local: Record<string, string> = {};
    if (!form.name_en.trim()) local.name_en = "Required";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim())) local.slug = "Lowercase letters, numbers and dashes";
    setErrors(local);
    if (Object.keys(local).length) return;
    setPending(true);
    try {
      const body = {
        name_en: form.name_en.trim(),
        name_ar: form.name_ar.trim(),
        slug: form.slug.trim(),
        description_en: form.description_en.trim(),
        description_ar: form.description_ar.trim(),
        parent: form.parent ? Number(form.parent) : null,
        artwork_key: form.artwork_key.trim(),
        sort_order: Number(form.sort_order) || 0,
        status: form.status,
      };
      if (editing) {
        await updateCategory(token, editing.id, body);
        toast.push("Category updated", "success");
      } else {
        await createCategory(token, body);
        toast.push("Category created", "success");
      }
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
    if (!token || !deleteTarget) return;
    setPending(true);
    try {
      await deleteCategory(token, deleteTarget.id);
      toast.push("Category deleted", "success");
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.push(adminErrorMessage(err, "Delete failed"), "error");
    } finally {
      setPending(false);
    }
  }

  const blocked = editing ? blockedParentIds(allCategories, String(editing.id)) : new Set<string>();
  const parentOptions = allCategories.filter((c) => !blocked.has(String(c.id)));

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Store navigation groups. Only published categories (and their products) appear on the store."
        actions={
          canWrite ? (
            <button type="button" onClick={openCreate} className="admin-btn admin-btn-primary">
              New category
            </button>
          ) : null
        }
      />
      <Filters search={search} onSearchChange={setSearch} searchPlaceholder="Search categories…" />
      <DataTable
        columns={[
          {
            key: "name",
            header: "Name",
            render: (r) => (
              <div>
                <p className="font-medium">{r.name_en}</p>
                {r.name_ar ? (
                  <p className="text-xs text-[var(--clicks-muted)]" dir="rtl">
                    {r.name_ar}
                  </p>
                ) : null}
              </div>
            ),
          },
          { key: "slug", header: "Slug", render: (r) => <span className="font-mono text-xs">{r.slug}</span> },
          { key: "parent", header: "Parent", render: (r) => r.parent_slug || "—" },
          { key: "products", header: "Products", className: "tabular-nums", render: (r) => r.products_count ?? "—" },
          { key: "status", header: "Status", render: (r) => <Badge status={r.status} /> },
          { key: "sort", header: "Sort", className: "tabular-nums", render: (r) => r.sort_order ?? 0 },
          ...(canWrite
            ? [
                {
                  key: "actions",
                  header: "",
                  render: (r: AdminCategory) => (
                    <div className="flex justify-end gap-3">
                      <button type="button" className="text-xs font-medium text-[var(--clicks-blue)]" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--clicks-error)]"
                        onClick={() => setDeleteTarget(r)}
                      >
                        Delete
                      </button>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="No categories" />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={setPage} />

      <AdminModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit category" : "New category"} wide>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Name (EN)" htmlFor="cat-name-en" required error={errors.name_en}>
              <input
                id="cat-name-en"
                className={adminInputClass}
                value={form.name_en}
                onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))}
              />
            </FormField>
            <FormField label="Name (AR)" htmlFor="cat-name-ar" error={errors.name_ar}>
              <input
                id="cat-name-ar"
                dir="rtl"
                className={adminInputClass}
                value={form.name_ar}
                onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))}
              />
            </FormField>
            <FormField label="Slug" htmlFor="cat-slug" required hint="URL: /category/<slug>. Changing it breaks old links." error={errors.slug}>
              <input
                id="cat-slug"
                className={`${adminInputClass} font-mono`}
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              />
            </FormField>
            <FormField label="Parent category" htmlFor="cat-parent" hint="Leave empty for a top-level category." error={errors.parent}>
              <select
                id="cat-parent"
                className={adminInputClass}
                value={form.parent}
                onChange={(e) => setForm((f) => ({ ...f, parent: e.target.value }))}
              >
                <option value="">— None (top level) —</option>
                {parentOptions.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {c.name_en} ({c.slug})
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label="Artwork key"
              htmlFor="cat-art"
              hint="Name of the built-in artwork/icon used on category tiles (e.g. playstation)."
              error={errors.artwork_key}
            >
              <input
                id="cat-art"
                className={`${adminInputClass} font-mono`}
                value={form.artwork_key}
                onChange={(e) => setForm((f) => ({ ...f, artwork_key: e.target.value }))}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Sort order" htmlFor="cat-sort" hint="Lower shows first." error={errors.sort_order}>
                <input
                  id="cat-sort"
                  type="number"
                  className={adminInputClass}
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </FormField>
              <FormField label="Status" htmlFor="cat-status" hint="Draft/archived hide it and its products." error={errors.status}>
                <select
                  id="cat-status"
                  className={adminInputClass}
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="PUBLISHED">Published</option>
                  <option value="DRAFT">Draft</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </FormField>
            </div>
          </div>
          <FormField label="Description (EN)" htmlFor="cat-desc-en" hint="Shown at the top of the category page.">
            <textarea
              id="cat-desc-en"
              className={adminTextareaClass}
              value={form.description_en}
              onChange={(e) => setForm((f) => ({ ...f, description_en: e.target.value }))}
            />
          </FormField>
          <FormField label="Description (AR)" htmlFor="cat-desc-ar">
            <textarea
              id="cat-desc-ar"
              dir="rtl"
              className={adminTextareaClass}
              value={form.description_ar}
              onChange={(e) => setForm((f) => ({ ...f, description_ar: e.target.value }))}
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button type="button" disabled={pending} onClick={() => void save()} className="admin-btn admin-btn-primary disabled:opacity-60">
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete category?"
        description={
          deleteTarget
            ? `Permanently delete “${deleteTarget.name_en}”. Categories that still have products cannot be deleted — move the products or archive the category instead.`
            : undefined
        }
        danger
        pending={pending}
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
