"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { ArtworkPicker } from "@/components/admin/ui/artwork-picker";
import { EntityImageField } from "@/components/admin/ui/entity-image-field";
import { EntityThumb } from "@/components/admin/ui/entity-thumb";
import { Filters } from "@/components/admin/ui/filters";
import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, adminFieldErrors } from "@/components/admin/lib/errors";
import { slugify } from "@/components/admin/lib/slugify";
import { useAdminUrlResource } from "@/hooks/use-admin-url-resource";
import {
  asList,
  createCategory,
  deleteCategory,
  deleteCategoryImage,
  fetchAllPages,
  listCategories,
  updateCategory,
  uploadCategoryImage,
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
  show_in_menu: false as boolean,
};

const STATUS_LABEL: Record<string, string> = { PUBLISHED: "Published", DRAFT: "Draft", ARCHIVED: "Archived" };

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
  const { state, set, reset, page, hasFilters, token, items, count, loading, error, reload } = useAdminUrlResource<
    AdminCategory,
    { search: string; ordering: string; menu: string }
  >({ search: "", ordering: "", menu: "" }, async (tok, s) =>
    asList(
      await listCategories(tok, {
        page: Number(s.page) || 1,
        page_size: ADMIN_LIST_PAGE_SIZE,
        search: s.search || undefined,
        ordering: s.ordering || "sort_order,name_en",
        show_in_menu: s.menu || undefined,
      }),
    ),
  );
  const [slugTouched, setSlugTouched] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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
    setSlugTouched(false);
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
      show_in_menu: Boolean(row.show_in_menu),
    });
    setSlugTouched(true);
    setErrors({});
    setModalOpen(true);
    void loadParents();
  }

  async function save() {
    if (!token) return;
    const local: Record<string, string> = {};
    if (!form.name_en.trim()) local.name_en = "Enter the category name in English.";
    if (editing && !form.slug.trim()) local.slug = "Enter a web address, e.g. gift-cards.";
    else if (form.slug.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim()))
      local.slug = "Use only lowercase letters, numbers and dashes (no spaces), e.g. gift-cards.";
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
        show_in_menu: form.show_in_menu,
      };
      if (editing) {
        await updateCategory(token, editing.id, body);
        toast.push("Category saved", "success");
        setModalOpen(false);
      } else {
        // Stay open on the new category so its picture can be uploaded right away.
        const created = await createCategory(token, body);
        setEditing(created);
        setSlugTouched(true);
        setForm((f) => ({ ...f, slug: created.slug || f.slug }));
        toast.push("Category created — you can now upload its picture", "success");
      }
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
    setDeleteError("");
    try {
      await deleteCategory(token, deleteTarget.id);
      toast.push("Category deleted", "success");
      setDeleteTarget(null);
      reload();
    } catch (err) {
      // D20: 409 has_children -> "Move or delete its sub-categories first: A, B."
      setDeleteError(adminErrorMessage(err, "Delete failed"));
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
        description="Groups of products on the store. Only published categories (and their products) are visible. Tick “Show in the store's top menu” for the categories that should appear in the header menu; lower sort numbers come first."
        actions={
          canWrite ? (
            <button type="button" onClick={openCreate} className="admin-btn admin-btn-primary">
              New category
            </button>
          ) : null
        }
      />
      <Filters
        search={state.search}
        onSearchChange={(v) => set({ search: v })}
        searchPlaceholder="Search categories…"
        onClear={reset}
        filters={[
          {
            key: "menu",
            label: "Top menu",
            value: state.menu,
            onChange: (v) => set({ menu: v }),
            options: [
              { value: "", label: "In menu or not" },
              { value: "true", label: "In the top menu" },
              { value: "false", label: "Not in the menu" },
            ],
          },
        ]}
      />
      <DataTable
        columns={[
          {
            key: "name",
            header: "Name",
            sortKey: "name_en",
            mobilePrimary: true,
            render: (r) => (
              <div className="flex items-center gap-3">
                <EntityThumb imageUrl={r.image_url} artworkKey={r.artwork_key} slug={r.slug} />
                <div>
                  <p className="font-medium">{r.name_en}</p>
                  {r.name_ar ? (
                    <p className="text-xs text-[var(--clicks-muted)]" dir="rtl">
                      {r.name_ar}
                    </p>
                  ) : null}
                </div>
              </div>
            ),
          },
          { key: "slug", header: "Web address", sortKey: "slug", render: (r) => <span className="font-mono text-xs">/category/{r.slug}</span> },
          {
            key: "parent",
            header: "Parent",
            render: (r) => {
              const parentName = items.find((c) => String(c.id) === String(r.parent))?.name_en;
              return parentName || r.parent_slug || <span className="text-[var(--clicks-muted)]">Top level</span>;
            },
          },
          {
            key: "menu",
            header: "Top menu",
            render: (r) => (r.show_in_menu ? <Badge tone="success">In menu</Badge> : <span className="text-[var(--clicks-muted)]">—</span>),
          },
          {
            key: "products",
            header: "Products",
            className: "tabular-nums",
            render: (r) => (
              <span>
                {r.products_count ?? "—"}
                {r.children?.length ? (
                  <span className="block text-[11px] text-[var(--clicks-muted)]">
                    {r.children.length} sub-categor{r.children.length === 1 ? "y" : "ies"}
                  </span>
                ) : null}
              </span>
            ),
          },
          { key: "status", header: "Status", render: (r) => <Badge status={r.status}>{STATUS_LABEL[r.status] ?? r.status}</Badge> },
          { key: "sort", header: "Sort", sortKey: "sort_order", className: "tabular-nums", render: (r) => r.sort_order ?? 0 },
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
                        onClick={() => {
                          setDeleteError("");
                          setDeleteTarget(r);
                        }}
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
        ordering={state.ordering}
        defaultOrdering="sort_order"
        onOrderingChange={(next) => set({ ordering: next === "sort_order" ? "" : next })}
        empty={<EmptyState title={hasFilters ? "No categories match these filters" : "No categories yet"} />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={(p) => set({ page: String(p) })} />

      <AdminModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit category" : "New category"} wide>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Name (English)" htmlFor="cat-name-en" required error={errors.name_en}>
              <input
                id="cat-name-en"
                className={adminInputClass}
                value={form.name_en}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({ ...f, name_en: name, slug: slugTouched ? f.slug : slugify(name) }));
                }}
              />
            </FormField>
            <FormField label="Name (Arabic)" htmlFor="cat-name-ar" optional error={errors.name_ar}>
              <input
                id="cat-name-ar"
                dir="rtl"
                className={adminInputClass}
                value={form.name_ar}
                onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))}
              />
            </FormField>
            <FormField
              label="Web address (slug)"
              htmlFor="cat-slug"
              hint={`Filled in from the English name. The page is /category/${form.slug || "…"}${editing ? " — changing it breaks old links." : "."}`}
              error={errors.slug}
            >
              <input
                id="cat-slug"
                className={`${adminInputClass} font-mono`}
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }));
                }}
              />
            </FormField>
            <FormField label="Parent category" htmlFor="cat-parent" hint="Choose a parent to make this a sub-category. Empty = top-level category." error={errors.parent}>
              <select
                id="cat-parent"
                className={adminInputClass}
                value={form.parent}
                onChange={(e) => setForm((f) => ({ ...f, parent: e.target.value }))}
              >
                <option value="">— None (top level) —</option>
                {parentOptions.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {c.parent != null ? "— " : ""}
                    {c.name_en}
                  </option>
                ))}
              </select>
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
              <FormField label="Status" htmlFor="cat-status" hint="Draft or archived hides it and its products." error={errors.status}>
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
          <EntityImageField
            label="Category picture"
            recommended="square, 512 × 512 px"
            imageUrl={editing?.image_url}
            fallback={{ artworkKey: form.artwork_key, slug: form.slug }}
            canWrite={canWrite}
            disabledReason={editing ? undefined : "Save the category first, then upload its picture."}
            onUpload={async (file) => {
              if (!token || !editing) return;
              setEditing(await uploadCategoryImage(token, editing.id, file));
              toast.push("Picture uploaded", "success");
              reload();
            }}
            onRemove={async () => {
              if (!token || !editing) return;
              setEditing(await deleteCategoryImage(token, editing.id));
              toast.push("Picture removed", "success");
              reload();
            }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ArtworkPicker
              id="cat-art"
              value={form.artwork_key}
              slug={form.slug}
              onChange={(key) => setForm((f) => ({ ...f, artwork_key: key }))}
            />
          </div>
          {errors.artwork_key ? <p className="text-[11px] text-[var(--clicks-error)]">{errors.artwork_key}</p> : null}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.show_in_menu}
              onChange={(e) => setForm((f) => ({ ...f, show_in_menu: e.target.checked }))}
            />
            <span>
              <span className="font-medium">Show in the store&apos;s top menu</span>
              <span className="block text-[11px] text-[var(--clicks-muted)]">
                Adds the category to the header menu, the mobile menu and the home page category tiles (only while it is published and has products).
              </span>
            </span>
          </label>
          <FormField
            label="Description (English)"
            htmlFor="cat-desc-en"
            optional
            hint="A short intro shown at the top of the category page on the store."
          >
            <textarea
              id="cat-desc-en"
              className={adminTextareaClass}
              value={form.description_en}
              onChange={(e) => setForm((f) => ({ ...f, description_en: e.target.value }))}
            />
          </FormField>
          <FormField label="Description (Arabic)" htmlFor="cat-desc-ar" optional>
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
              {editing ? "Close" : "Cancel"}
            </button>
            <button type="button" disabled={pending} onClick={() => void save()} className="admin-btn admin-btn-primary disabled:opacity-60">
              {pending ? "Saving…" : editing ? "Save" : "Create category"}
            </button>
          </div>
        </div>
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete category?"
        description={
          deleteTarget
            ? `Permanently delete “${deleteTarget.name_en}”. Categories that still have products or sub-categories can't be deleted — move them first, or archive the category instead.`
            : undefined
        }
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
