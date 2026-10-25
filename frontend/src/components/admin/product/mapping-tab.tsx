"use client";

import { AdminModal } from "@/components/admin/ui/admin-modal";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { deleteMapping, type OneEpinMapping } from "@/components/admin/oneepin/api";
import { describeFailure } from "@/components/admin/oneepin/errors";
import { filsJod, jodText } from "@/components/admin/oneepin/labels";
import { LinkDialog, type LinkTarget } from "@/components/admin/oneepin/link-dialog";
import { MarginText, StockBadge } from "@/components/admin/oneepin/ui";
import {
  createProductMapping,
  deleteSupplierMapping,
  type AdminProductField,
  type AdminSupplierMapping,
  type AdminVariant,
  type Supplier,
} from "@/lib/api/admin";
import { useState } from "react";
import { VariantName } from "@/components/admin/ui/variant-name";
import { variantOptionLabel } from "@/components/admin/lib/variants";

const ONEEPIN = "1epin";

/** D18 / CA-01: whether a mapping makes the variant sellable, and why not. */
export function MappingStockCell({ mapping }: { mapping: Pick<AdminSupplierMapping, "ignored" | "counts_as_stock" | "counts_as_stock_message"> }) {
  const counts = mapping.counts_as_stock === true;
  const label = counts ? "Yes" : mapping.ignored ? "No — ignored" : "No";
  return (
    <span className="flex max-w-xs flex-col items-start gap-0.5">
      <Badge tone={counts ? "success" : mapping.ignored ? "neutral" : "warning"}>{label}</Badge>
      {mapping.counts_as_stock_message ? (
        <span className="text-[11px] leading-snug text-[var(--clicks-muted)]">{mapping.counts_as_stock_message}</span>
      ) : null}
    </span>
  );
}

const emptyForm = { supplier_id: "", variant_id: "", external_product_id: "", external_name: "" };

function isOneEpin(m: AdminSupplierMapping): boolean {
  return (m.supplier_slug ?? "").toLowerCase() === ONEEPIN;
}

/**
 * Product editor → Supplier tab. 1Epin links are made with a catalog search picker (no
 * typing of IDs) and show cost, margin and whether they count as stock. Mappings to other
 * (manual) suppliers keep the simple ID form.
 */
export function MappingTab({
  token,
  slug,
  mappings,
  setMappings,
  suppliers,
  variants,
  canMap,
  productName,
  fulfillmentType,
  customerFields,
}: {
  token?: string;
  slug: string;
  mappings: AdminSupplierMapping[];
  setMappings: (next: AdminSupplierMapping[]) => void;
  suppliers: Supplier[];
  variants: AdminVariant[];
  canMap: boolean;
  /** Shown before the variant name in pickers ("<Product> – <Variant>"). */
  productName?: string;
  fulfillmentType?: string;
  customerFields?: AdminProductField[];
}) {
  const toast = useAdminToast();
  const [link, setLink] = useState<LinkTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminSupplierMapping | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [pending, setPending] = useState(false);

  const savedVariants = variants.filter((v) => v.id);
  const oneEpin = mappings.filter(isOneEpin) as unknown as OneEpinMapping[];
  const others = mappings.filter((m) => !isOneEpin(m));
  const linkedVariantIds = new Set(oneEpin.map((m) => String(m.variant ?? "")));
  const unlinked = savedVariants.filter((v) => !linkedVariantIds.has(String(v.id)));
  const otherSuppliers = suppliers.filter((s) => s.slug !== ONEEPIN);
  const fields = (customerFields ?? []).filter((f) => !f.delete && f.key).map((f) => ({ key: f.key, label: f.label_en, required: f.required }));
  const optionLabel = (v: AdminVariant) => variantOptionLabel({ ...v, product_name: v.product_name || productName });

  function upsert(saved: OneEpinMapping) {
    const row = saved as unknown as AdminSupplierMapping;
    const exists = mappings.some((m) => String(m.id) === String(saved.id));
    setMappings(exists ? mappings.map((m) => (String(m.id) === String(saved.id) ? row : m)) : [...mappings, row]);
  }

  async function confirmDelete() {
    if (!token || !deleteTarget) return;
    setPending(true);
    try {
      if (isOneEpin(deleteTarget)) await deleteMapping(token, deleteTarget.id);
      else await deleteSupplierMapping(token, deleteTarget.id);
      setMappings(mappings.filter((m) => String(m.id) !== String(deleteTarget.id)));
      toast.push("Link removed", "success");
      setDeleteTarget(null);
    } catch (err) {
      toast.push(describeFailure(err, "Could not remove the link."), "error");
    } finally {
      setPending(false);
    }
  }

  async function createOther() {
    if (!token) return;
    if (!createForm.supplier_id || !createForm.external_product_id.trim()) {
      toast.push("Choose a supplier and enter the supplier's product ID.", "error");
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
      setOtherOpen(false);
      toast.push("Mapping created", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Mapping failed"), "error");
    } finally {
      setPending(false);
    }
  }

  function variantRefOf(v: AdminVariant) {
    return {
      id: v.id,
      product: String(v.product ?? slug),
      productName: productName ?? v.product_name ?? "",
      name: v.name_en || v.sku,
      sku: v.sku,
      priceFils: v.price_fils ?? null,
      fulfillmentType: fulfillmentType ?? v.fulfillment_type ?? "",
    };
  }

  return (
    <section className="admin-card p-4">
      <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Supplier (1Epin)</h2>
      <p className="mb-4 mt-0.5 max-w-3xl text-xs text-[var(--clicks-muted)]">
        Link a product option to a 1Epin product so 1Epin can deliver it when a customer pays. A link only counts as stock (keeps the
        option on sale with no codes of our own) in live mode, with “Buy automatically” on and a recently synced catalog. Changes
        here are saved immediately.
      </p>

      {oneEpin.length ? (
        <div className="mb-4 overflow-x-auto rounded-xl border border-[var(--clicks-border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--clicks-bg)] text-[11px] text-[var(--clicks-muted)]">
              <tr>
                <th className="px-3 py-2 text-start">Our option</th>
                <th className="px-3 py-2 text-start">1Epin product</th>
                <th className="px-3 py-2 text-start">Cost / sale / profit</th>
                <th className="px-3 py-2 text-start">Stock</th>
                <th className="px-3 py-2 text-start">Settings</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {oneEpin.map((m) => (
                <tr key={m.id} className="border-t border-[var(--clicks-border)] align-top">
                  <td className="px-3 py-2">
                    <VariantName productName={productName} variantName={m.variant_name} sku={m.variant_sku} empty="Whole product" />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <p className="font-medium text-[var(--clicks-navy)]">{m.catalog_item?.product_name || m.external_name || "—"}</p>
                    <p className="font-mono text-[11px] text-[var(--clicks-muted)]">ID {m.external_product_id}</p>
                    {m.warnings?.length ? (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-amber-700">
                        {m.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    <p>Cost {jodText(m.cost_jod)}</p>
                    <p>Sale {jodText(m.sale_price_jod)}</p>
                    <MarginText fils={m.margin_fils} pct={m.margin_pct} />
                  </td>
                  <td className="px-3 py-2">
                    <StockBadge counts={m.counts_as_stock} reason={m.counts_as_stock_reason} />
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[var(--clicks-muted)]">
                    <p>{m.ignored ? "Paused" : m.auto_buy ? "Buys automatically" : "Manual purchase only"}</p>
                    {(m.category_type || "") !== "topup" ? <p>{m.prefer_supplier ? "1Epin first" : "Our codes first"}</p> : null}
                    {m.max_cost_fils !== null && m.max_cost_fils !== undefined ? <p>Max {filsJod(m.max_cost_fils)}</p> : null}
                    {m.quantity_per_unit > 1 ? <p>{m.quantity_per_unit} 1Epin units each</p> : null}
                    {m.user_template ? <p className="font-mono">{m.user_template}</p> : null}
                  </td>
                  <td className="px-3 py-2">
                    {canMap ? (
                      <div className="flex justify-end gap-3 text-xs">
                        <button type="button" className="font-medium text-[var(--clicks-blue)]" onClick={() => setLink({ kind: "edit", mapping: m })}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="font-medium text-red-600"
                          onClick={() => setDeleteTarget(m as unknown as AdminSupplierMapping)}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {canMap ? (
        unlinked.length ? (
          <div className="mb-4 rounded-xl border border-dashed border-[var(--clicks-border)] p-3">
            <p className="mb-2 text-[12px] font-medium text-[var(--clicks-text)]">Options not linked to 1Epin</p>
            <ul className="divide-y divide-[var(--clicks-border)]">
              {unlinked.map((v) => (
                <li key={String(v.id)} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                  <span>{optionLabel(v)}</span>
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary h-8 text-xs"
                    onClick={() => setLink({ kind: "fromVariant", variant: variantRefOf(v), fields })}
                  >
                    Link to 1Epin…
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : !savedVariants.length ? (
          <p className="mb-4 text-[13px] text-[var(--clicks-muted)]">Save at least one variant first, then link it to 1Epin.</p>
        ) : null
      ) : (
        <p className="mb-4 text-sm text-[var(--clicks-muted)]">You can view these links, but your role can&apos;t change them.</p>
      )}

      {others.length ? (
        <div className="mb-4 overflow-x-auto rounded-xl border border-[var(--clicks-border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--clicks-bg)] text-[11px] text-[var(--clicks-muted)]">
              <tr>
                <th className="px-3 py-2 text-start">Other supplier</th>
                <th className="px-3 py-2 text-start">Variant</th>
                <th className="px-3 py-2 text-start">External ID</th>
                <th className="px-3 py-2 text-start">Counts as stock?</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {others.map((m) => (
                <tr key={String(m.id)} className="border-t border-[var(--clicks-border)]">
                  <td className="px-3 py-2">{m.supplier_name || m.supplier_slug}</td>
                  <td className="px-3 py-2">
                    <VariantName productName={productName} variantName={m.variant_name} sku={m.variant_sku} empty="Product-level" />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{m.external_product_id}</td>
                  <td className="px-3 py-2">
                    <MappingStockCell mapping={m} />
                  </td>
                  <td className="px-3 py-2 text-end">
                    {canMap ? (
                      <button type="button" className="text-xs font-medium text-red-600" onClick={() => setDeleteTarget(m)}>
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {canMap && otherSuppliers.length ? (
        <button type="button" className="text-[12px] font-semibold text-[var(--clicks-blue)]" onClick={() => setOtherOpen(true)}>
          Map to another supplier by ID…
        </button>
      ) : null}

      <LinkDialog
        target={link}
        onClose={() => setLink(null)}
        onSaved={(saved) => {
          upsert(saved);
          setLink(null);
        }}
      />

      <AdminModal open={otherOpen} onClose={() => setOtherOpen(false)} title="Map to another supplier">
        <div className="space-y-3">
          <FormField label="Supplier" htmlFor="map-supplier" required>
            <select
              id="map-supplier"
              className={adminInputClass}
              value={createForm.supplier_id}
              onChange={(e) => setCreateForm((s) => ({ ...s, supplier_id: e.target.value }))}
            >
              <option value="">Select…</option>
              {otherSuppliers.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                  {!s.active ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Variant" htmlFor="map-variant">
            <select
              id="map-variant"
              className={adminInputClass}
              value={createForm.variant_id}
              onChange={(e) => setCreateForm((s) => ({ ...s, variant_id: e.target.value }))}
            >
              <option value="">Product-level</option>
              {savedVariants.map((v) => (
                <option key={String(v.id)} value={String(v.id)}>
                  {optionLabel(v)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Supplier product ID" htmlFor="map-ext" required>
            <input
              id="map-ext"
              className={`${adminInputClass} font-mono`}
              value={createForm.external_product_id}
              onChange={(e) => setCreateForm((s) => ({ ...s, external_product_id: e.target.value }))}
            />
          </FormField>
          <FormField label="Supplier product name" htmlFor="map-name" optional>
            <input
              id="map-name"
              className={adminInputClass}
              value={createForm.external_name}
              onChange={(e) => setCreateForm((s) => ({ ...s, external_name: e.target.value }))}
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setOtherOpen(false)}>
              Cancel
            </button>
            <button type="button" disabled={pending} className="admin-btn admin-btn-primary" onClick={() => void createOther()}>
              Add mapping
            </button>
          </div>
        </div>
      </AdminModal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove this link?"
        description={
          deleteTarget
            ? `The option will no longer be bought from ${deleteTarget.supplier_name || "the supplier"} (product ${deleteTarget.external_product_id}). Orders already placed are not affected.`
            : undefined
        }
        danger
        pending={pending}
        confirmLabel="Remove"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
