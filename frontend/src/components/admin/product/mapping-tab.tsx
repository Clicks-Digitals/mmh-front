"use client";

import { AdminModal } from "@/components/admin/ui/admin-modal";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import {
  createProductMapping,
  deleteSupplierMapping,
  updateSupplierMapping,
  type AdminSupplierMapping,
  type AdminVariant,
  type Supplier,
} from "@/lib/api/admin";
import { useState } from "react";

const emptyForm = { supplier_id: "", variant_id: "", external_product_id: "", external_name: "", ignored: false };

export function MappingTab({
  token,
  slug,
  mappings,
  setMappings,
  suppliers,
  variants,
  canMap,
}: {
  token?: string;
  slug: string;
  mappings: AdminSupplierMapping[];
  setMappings: (next: AdminSupplierMapping[]) => void;
  suppliers: Supplier[];
  variants: AdminVariant[];
  canMap: boolean;
}) {
  const toast = useAdminToast();
  const [createForm, setCreateForm] = useState(emptyForm);
  const [editing, setEditing] = useState<AdminSupplierMapping | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<AdminSupplierMapping | null>(null);
  const [pending, setPending] = useState(false);

  const variantSku = (id: number | string | null | undefined) =>
    id == null ? null : (variants.find((v) => String(v.id) === String(id))?.sku ?? String(id));

  async function create() {
    if (!token) return;
    if (!createForm.supplier_id || !createForm.external_product_id.trim()) {
      toast.push("Choose a supplier and enter the supplier's product id", "error");
      return;
    }
    setPending(true);
    try {
      const created = await createProductMapping(token, slug, {
        supplier_id: createForm.supplier_id,
        external_product_id: createForm.external_product_id.trim(),
        variant_id: createForm.variant_id || null,
        external_name: createForm.external_name.trim(),
      });
      setMappings([...mappings, created]);
      setCreateForm(emptyForm);
      toast.push("Mapping created", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Mapping failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function saveEdit() {
    if (!token || !editing) return;
    setPending(true);
    try {
      const updated = await updateSupplierMapping(token, editing.id, {
        external_product_id: editForm.external_product_id.trim(),
        external_name: editForm.external_name.trim(),
        ignored: editForm.ignored,
        variant_id: editForm.variant_id || null,
      });
      setMappings(
        mappings.map((m) =>
          String(m.id) === String(editing.id) ? { ...m, ...updated, variant_sku: variantSku(updated.variant) } : m,
        ),
      );
      toast.push("Mapping updated", "success");
      setEditing(null);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Update failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function confirmDelete() {
    if (!token || !deleteTarget) return;
    setPending(true);
    try {
      await deleteSupplierMapping(token, deleteTarget.id);
      setMappings(mappings.filter((m) => String(m.id) !== String(deleteTarget.id)));
      toast.push("Mapping removed", "success");
      setDeleteTarget(null);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Delete failed"), "error");
    } finally {
      setPending(false);
    }
  }

  const savedVariants = variants.filter((v) => v.id);

  return (
    <section className="admin-card p-4">
      <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Supplier mapping</h2>
      <p className="mb-4 mt-0.5 text-xs text-[var(--clicks-muted)]">
        Links this product (or one variant) to a supplier&apos;s product id so it can be fulfilled by the supplier. A
        mapped CODE variant counts as in stock. Live purchasing stays locked. Changes save immediately.
      </p>
      {mappings.length ? (
        <div className="mb-4 overflow-x-auto rounded-xl border border-[var(--clicks-border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--clicks-bg)] text-[11px] uppercase text-[var(--clicks-muted)]">
              <tr>
                <th className="px-3 py-2 text-start">Supplier</th>
                <th className="px-3 py-2 text-start">Variant</th>
                <th className="px-3 py-2 text-start">External ID</th>
                <th className="px-3 py-2 text-start">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={String(m.id)} className="border-t border-[var(--clicks-border)]">
                  <td className="px-3 py-2">{m.supplier_name || m.supplier_slug}</td>
                  <td className="px-3 py-2 font-mono text-xs">{m.variant_sku || variantSku(m.variant) || "Product-level"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {m.external_product_id}
                    {m.external_name ? <span className="block font-sans text-[11px] text-[var(--clicks-muted)]">{m.external_name}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={m.ignored ? "neutral" : "success"}>{m.ignored ? "Ignored" : "Active"}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {canMap ? (
                      <div className="flex justify-end gap-3 text-xs">
                        <button
                          type="button"
                          className="font-medium text-[var(--clicks-blue)]"
                          onClick={() => {
                            setEditForm({
                              supplier_id: String(m.supplier_id),
                              variant_id: m.variant != null ? String(m.variant) : "",
                              external_product_id: m.external_product_id,
                              external_name: m.external_name ?? "",
                              ignored: Boolean(m.ignored),
                            });
                            setEditing(m);
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="font-medium text-red-600" onClick={() => setDeleteTarget(m)}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No mappings" description="Map a supplier product id to this product or a variant." />
      )}
      {canMap ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <FormField label="Supplier" htmlFor="map-supplier">
            <select
              id="map-supplier"
              className={adminInputClass}
              value={createForm.supplier_id}
              onChange={(e) => setCreateForm((s) => ({ ...s, supplier_id: e.target.value }))}
            >
              <option value="">Select…</option>
              {suppliers.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Variant" htmlFor="map-variant" hint="Empty = whole product.">
            <select
              id="map-variant"
              className={adminInputClass}
              value={createForm.variant_id}
              onChange={(e) => setCreateForm((s) => ({ ...s, variant_id: e.target.value }))}
            >
              <option value="">Product-level</option>
              {savedVariants.map((v) => (
                <option key={String(v.id)} value={String(v.id)}>
                  {v.sku}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="External product ID" htmlFor="map-ext" hint="The supplier's id / SKU.">
            <input
              id="map-ext"
              className={`${adminInputClass} font-mono`}
              value={createForm.external_product_id}
              onChange={(e) => setCreateForm((s) => ({ ...s, external_product_id: e.target.value }))}
            />
          </FormField>
          <FormField label="External name" htmlFor="map-name" hint="Optional, for reference.">
            <input
              id="map-name"
              className={adminInputClass}
              value={createForm.external_name}
              onChange={(e) => setCreateForm((s) => ({ ...s, external_name: e.target.value }))}
            />
          </FormField>
          <div className="flex items-start pt-6">
            <button type="button" disabled={pending} className="admin-btn admin-btn-primary" onClick={() => void create()}>
              Add mapping
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--clicks-muted)]">Editing mappings requires the suppliers.write permission.</p>
      )}

      <AdminModal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit mapping">
        <div className="space-y-3">
          <FormField label="Variant" htmlFor="map-edit-variant" hint="Empty = whole product.">
            <select
              id="map-edit-variant"
              className={adminInputClass}
              value={editForm.variant_id}
              onChange={(e) => setEditForm((s) => ({ ...s, variant_id: e.target.value }))}
            >
              <option value="">Product-level</option>
              {savedVariants.map((v) => (
                <option key={String(v.id)} value={String(v.id)}>
                  {v.sku}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="External product ID" htmlFor="map-edit-ext" required>
            <input
              id="map-edit-ext"
              className={`${adminInputClass} font-mono`}
              value={editForm.external_product_id}
              onChange={(e) => setEditForm((s) => ({ ...s, external_product_id: e.target.value }))}
            />
          </FormField>
          <FormField label="External name" htmlFor="map-edit-name">
            <input
              id="map-edit-name"
              className={adminInputClass}
              value={editForm.external_name}
              onChange={(e) => setEditForm((s) => ({ ...s, external_name: e.target.value }))}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editForm.ignored} onChange={(e) => setEditForm((s) => ({ ...s, ignored: e.target.checked }))} />
            Ignore (keep the record but don&apos;t use it)
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={pending || !editForm.external_product_id.trim()}
              onClick={() => void saveEdit()}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete mapping?"
        description={deleteTarget ? `Remove the link to supplier product ${deleteTarget.external_product_id}.` : undefined}
        danger
        pending={pending}
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
