"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { useAdminBreadcrumbLabel } from "@/components/admin/layout/breadcrumbs";
import { supplierModeBadge } from "@/components/admin/modules/suppliers-list-client";
import { MappingStockCell } from "@/components/admin/product/mapping-tab";
import {
  deleteSupplierMapping,
  getSupplier,
  updateSupplier,
  updateSupplierMapping,
  type SupplierMappingRow,
} from "@/lib/api/admin";
import Link from "next/link";
import { useState } from "react";
import { VariantName } from "@/components/admin/ui/variant-name";

export function SupplierDetailClient({ id }: { id: string }) {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("suppliers.write");
  const { data: supplier, setData, loading, error, reload, token } = useAdminQuery((tok) => getSupplier(tok, id), [id]);
  const [editing, setEditing] = useState<SupplierMappingRow | null>(null);
  const [form, setForm] = useState({ external_product_id: "", external_name: "", ignored: false });
  const [deleteTarget, setDeleteTarget] = useState<SupplierMappingRow | null>(null);
  const [pending, setPending] = useState(false);
  useAdminBreadcrumbLabel(supplier?.name);

  if (loading) return <div className="h-40 animate-pulse rounded-xl border border-[var(--clicks-border)] bg-white" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!supplier) return <EmptyState title="Supplier not found" />;

  const mappings = supplier.mappings ?? [];

  function setMappings(next: SupplierMappingRow[]) {
    setData((prev) => (prev ? { ...prev, mappings: next } : prev));
  }

  async function saveMapping() {
    if (!token || !editing) return;
    if (!form.external_product_id.trim()) {
      toast.push("External product ID is required", "error");
      return;
    }
    setPending(true);
    try {
      const updated = await updateSupplierMapping(token, editing.id, {
        external_product_id: form.external_product_id.trim(),
        external_name: form.external_name.trim(),
        ignored: form.ignored,
      });
      setMappings(
        mappings.map((m) =>
          String(m.id) === String(editing.id)
            ? { ...m, external_product_id: updated.external_product_id, external_name: updated.external_name, ignored: updated.ignored, counts_as_stock: updated.counts_as_stock, counts_as_stock_message: updated.counts_as_stock_message }
            : m,
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
      toast.push("Mapping deleted", "success");
      setDeleteTarget(null);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Delete failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function toggleActive() {
    if (!token || !supplier) return;
    try {
      await updateSupplier(token, supplier.id, { active: !supplier.active });
      setData((prev) => (prev ? { ...prev, active: !prev.active } : prev));
      toast.push(supplier.active ? "Supplier deactivated" : "Supplier activated", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Update failed"), "error");
    }
  }

  return (
    <div>
      <PageHeader
        title={supplier.name}
        description={supplier.slug}
        actions={
          <>
            {canWrite ? (
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => void toggleActive()}>
                {supplier.active ? "Deactivate" : "Activate"}
              </button>
            ) : null}
            <Link href="/admin/suppliers" className="text-sm font-medium text-[var(--clicks-blue)]">
              Back to suppliers
            </Link>
          </>
        }
      />
      {supplier.live_locked ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Test mode</p>
          <p className="mt-1">
            No real purchases are made from this supplier, so its mappings don&apos;t keep variants on sale. Live purchasing can
            only be switched on by your developer on the server.
          </p>
        </div>
      ) : null}
      <div className="admin-card p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          {supplierModeBadge(supplier)}
          {supplier.environment ? <Badge tone="neutral">{`Environment: ${supplier.environment}`}</Badge> : null}
          <span className="text-[var(--clicks-muted)]">Last checked {formatAdminDateTime(supplier.last_checked_at)}</span>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Cached balance</dt>
            <dd className="mt-1">{supplier.last_balance || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--clicks-muted)]">Credentials</dt>
            <dd className="mt-1">
              {[
                supplier.email_configured ? "email" : null,
                supplier.password_configured ? "password" : null,
                supplier.callback_configured ? "callback" : null,
              ]
                .filter(Boolean)
                .join(", ") || "Not configured"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="admin-card mt-4 p-4">
        <p className="text-sm font-semibold text-[var(--clicks-navy)]">Product mappings</p>
        <p className="mt-0.5 text-xs text-[var(--clicks-muted)]">
          Links between this supplier&apos;s product ids and your products. Create new mappings from a product&apos;s
          “Supplier mapping” tab. Showing up to 50.
        </p>
        {mappings.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--clicks-bg)] text-[11px] uppercase text-[var(--clicks-muted)]">
                <tr>
                  <th className="px-3 py-2 text-start">Product</th>
                  <th className="px-3 py-2 text-start">Variant</th>
                  <th className="px-3 py-2 text-start">External ID</th>
                  <th className="px-3 py-2 text-start">External name</th>
                  <th className="px-3 py-2 text-start">Counts as stock?</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={String(m.id)} className="border-t border-[var(--clicks-border)]">
                    <td className="px-3 py-2 text-xs">
                      {m.product_name || m.product}
                      {m.product_name ? <span className="block font-mono text-[11px] text-[var(--clicks-muted)]">{m.product}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {m.variant == null ? (
                        <span className="text-xs">Product-level</span>
                      ) : (
                        <VariantName productName={m.product_name} variantName={m.variant_name} sku={m.variant_sku ?? String(m.variant)} />
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{m.external_product_id}</td>
                    <td className="px-3 py-2 text-xs">{m.external_name || "—"}</td>
                    <td className="px-3 py-2">
                      <MappingStockCell mapping={m} />
                    </td>
                    <td className="px-3 py-2">
                      {canWrite ? (
                        <div className="flex justify-end gap-3 text-xs">
                          <button
                            type="button"
                            className="font-medium text-[var(--clicks-blue)]"
                            onClick={() => {
                              setForm({
                                external_product_id: m.external_product_id,
                                external_name: m.external_name ?? "",
                                ignored: Boolean(m.ignored),
                              });
                              setEditing(m);
                            }}
                          >
                            Edit
                          </button>
                          <button type="button" className="font-medium text-[var(--clicks-error)]" onClick={() => setDeleteTarget(m)}>
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
          <p className="mt-3 text-sm text-[var(--clicks-muted)]">No mappings yet.</p>
        )}
      </div>

      {supplier.recent_logs?.length ? (
        <div className="admin-card mt-4 p-4">
          <p className="text-sm font-semibold text-[var(--clicks-navy)]">Recent API calls</p>
          <ul className="mt-2 divide-y divide-[var(--clicks-border)] text-xs">
            {supplier.recent_logs.map((log) => (
              <li key={String(log.id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium">{log.action}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--clicks-muted)]">{log.message}</span>
                <Badge tone={log.ok ? "success" : "error"}>{log.ok ? "OK" : "Failed"}</Badge>
                <span className="text-[var(--clicks-muted)]">{formatAdminDateTime(log.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <AdminModal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit mapping">
        <div className="space-y-3">
          <FormField label="External product ID" htmlFor="map-ext" required hint="The supplier's product / SKU id.">
            <input
              id="map-ext"
              className={`${adminInputClass} font-mono`}
              value={form.external_product_id}
              onChange={(e) => setForm((f) => ({ ...f, external_product_id: e.target.value }))}
            />
          </FormField>
          <FormField label="External name" htmlFor="map-name" hint="Supplier's product name, for reference.">
            <input
              id="map-name"
              className={adminInputClass}
              value={form.external_name}
              onChange={(e) => setForm((f) => ({ ...f, external_name: e.target.value }))}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.ignored} onChange={(e) => setForm((f) => ({ ...f, ignored: e.target.checked }))} />
            Ignore this mapping (don&apos;t use it for fulfillment)
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="admin-btn admin-btn-primary" disabled={pending} onClick={() => void saveMapping()}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete mapping?"
        description={
          deleteTarget
            ? `Removes the link between ${deleteTarget.product} and supplier product ${deleteTarget.external_product_id}. The product can no longer be fulfilled through this supplier.`
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
