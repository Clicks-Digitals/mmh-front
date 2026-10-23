"use client";

import { Badge } from "@/components/admin/ui/badge";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import type { VariantDraft } from "@/components/admin/lib/product-form";
import type { AdminRegion } from "@/lib/api/admin";
import Link from "next/link";
import { useState } from "react";

type Props = {
  variants: VariantDraft[];
  errors: Record<string, Record<string, string>>;
  disabled: boolean;
  isCodeProduct: boolean;
  regions: AdminRegion[];
  canImport: boolean;
  onChange: (key: string, patch: Partial<VariantDraft>) => void;
  onAdd: () => void;
  onRemove: (variant: VariantDraft) => void;
  onMove: (key: string, dir: -1 | 1) => void;
};

function StockBadge({ v, isCode }: { v: VariantDraft; isCode: boolean }) {
  if (!v.id) return <Badge tone="neutral">Unsaved</Badge>;
  const status = v.effective_stock_status ?? v.stock_status;
  const label = status === "IN_STOCK" ? "In stock" : status === "OUT_OF_STOCK" ? "Out of stock" : "Unknown";
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Badge status={status}>{label}</Badge>
      {isCode ? <span className="text-[10px] text-[var(--clicks-muted)]">{v.available_codes ?? 0} codes available</span> : null}
    </span>
  );
}

export function VariantsTab({ variants, errors, disabled, isCodeProduct, regions, canImport, onChange, onAdd, onRemove, onMove }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const visible = variants.filter((v) => !v.delete);

  const input = (v: VariantDraft, key: keyof VariantDraft, extra: { mono?: boolean; inputMode?: "decimal" | "numeric" } = {}) => ({
    id: `pv-${v.key}-${String(key)}`,
    disabled,
    inputMode: extra.inputMode,
    className: `${adminInputClass} ${extra.mono ? "font-mono text-xs" : ""} ${errors[v.key]?.[key as string] ? "border-[var(--clicks-error)]" : ""}`,
    value: String(v[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange(v.key, { [key]: e.target.value } as Partial<VariantDraft>),
  });

  return (
    <section className="admin-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Variants</h2>
          <p className="mt-0.5 text-xs text-[var(--clicks-muted)]">
            Each variant is one purchasable option (e.g. “$10 US card”). Prices are in JOD.
            {isCodeProduct ? " Code variants are only in stock while codes are available (or a supplier mapping exists)." : ""}
          </p>
        </div>
        {!disabled ? (
          <button type="button" className="admin-btn admin-btn-secondary" onClick={onAdd}>
            Add variant
          </button>
        ) : null}
      </div>

      {visible.length ? (
        <div className="space-y-2">
          {visible.map((v, idx) => {
            const errs = errors[v.key] ?? {};
            const open = expanded === v.key || Object.keys(errs).some((k) => !["sku", "name_en", "price"].includes(k));
            return (
              <div key={v.key} className={`rounded-lg border ${Object.keys(errs).length ? "border-red-300" : "border-[var(--clicks-border)]"}`}>
                <div className="grid items-start gap-3 p-3 md:grid-cols-[1.1fr_1.4fr_0.8fr_auto_auto]">
                  <FormField label="SKU" htmlFor={`pv-${v.key}-sku`} error={errs.sku}>
                    <input {...input(v, "sku", { mono: true })} />
                  </FormField>
                  <FormField label="Name (EN)" htmlFor={`pv-${v.key}-name_en`} error={errs.name_en}>
                    <input {...input(v, "name_en")} placeholder="e.g. 10 USD" />
                  </FormField>
                  <FormField label="Price (JOD)" htmlFor={`pv-${v.key}-price`} error={errs.price}>
                    <input {...input(v, "price", { inputMode: "decimal" })} placeholder="0.000" />
                  </FormField>
                  <div className="space-y-1.5 pt-0.5">
                    <p className="text-[12px] font-medium">Stock</p>
                    <StockBadge v={v} isCode={isCodeProduct} />
                  </div>
                  <div className="flex flex-col items-end gap-1.5 pt-5">
                    <label className="flex items-center gap-1.5 text-xs font-medium">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={v.published}
                        onChange={(e) => onChange(v.key, { published: e.target.checked })}
                      />
                      Published
                    </label>
                    <button
                      type="button"
                      className="text-xs font-medium text-[var(--clicks-blue)]"
                      onClick={() => setExpanded(open && expanded === v.key ? null : v.key)}
                    >
                      {open ? "Hide details" : "More details"}
                    </button>
                  </div>
                </div>

                {open ? (
                  <div className="grid gap-3 border-t border-[var(--clicks-border)] bg-[#FAFBFD] p-3 sm:grid-cols-2 lg:grid-cols-4">
                    <FormField label="Name (AR)" htmlFor={`pv-${v.key}-name_ar`} error={errs.name_ar}>
                      <input {...input(v, "name_ar")} dir="rtl" />
                    </FormField>
                    <FormField label="Denomination" htmlFor={`pv-${v.key}-denomination`} hint="Face value as a number, e.g. 10." error={errs.denomination}>
                      <input {...input(v, "denomination", { inputMode: "decimal" })} />
                    </FormField>
                    <FormField label="Package value" htmlFor={`pv-${v.key}-package_value`} hint="What the customer gets, e.g. 10 or 600 UC." error={errs.package_value}>
                      <input {...input(v, "package_value")} />
                    </FormField>
                    <FormField label="Package currency" htmlFor={`pv-${v.key}-package_currency`} hint="e.g. USD, SAR, UC." error={errs.package_currency}>
                      <input {...input(v, "package_currency", { mono: true })} maxLength={8} />
                    </FormField>
                    <FormField
                      label="Compare-at price (JOD)"
                      htmlFor={`pv-${v.key}-compare_at`}
                      hint="Optional “was” price shown struck through. Must be above the price."
                      error={errs.compare_at}
                    >
                      <input {...input(v, "compare_at", { inputMode: "decimal" })} />
                    </FormField>
                    <FormField label="Cost (JOD)" htmlFor={`pv-${v.key}-cost`} hint="Your purchase cost. Internal only." error={errs.cost}>
                      <input {...input(v, "cost", { inputMode: "decimal" })} />
                    </FormField>
                    <FormField label="Min quantity" htmlFor={`pv-${v.key}-min_quantity`} hint="Per order." error={errs.min_quantity}>
                      <input {...input(v, "min_quantity", { inputMode: "numeric" })} type="number" min={1} />
                    </FormField>
                    <FormField label="Max quantity" htmlFor={`pv-${v.key}-max_quantity`} hint="Per order." error={errs.max_quantity}>
                      <input {...input(v, "max_quantity", { inputMode: "numeric" })} type="number" min={1} />
                    </FormField>
                    <FormField label="Region" htmlFor={`pv-${v.key}-region`} hint="Where the code works. Its currency is shown on the product page." error={errs.region}>
                      <select {...input(v, "region")}>
                        <option value="">— No region —</option>
                        {regions.map((r) => (
                          <option key={String(r.id)} value={String(r.id)}>
                            {r.name_en} ({r.currency})
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField
                      label="Stock status (manual)"
                      htmlFor={`pv-${v.key}-stock_status`}
                      hint={
                        isCodeProduct
                          ? "“Out of stock” always hides it. “In stock” still needs available codes for CODE variants."
                          : "Set “Out of stock” to stop sales of this top-up."
                      }
                      error={errs.stock_status}
                    >
                      <select {...input(v, "stock_status")}>
                        <option value="IN_STOCK">In stock</option>
                        <option value="OUT_OF_STOCK">Out of stock</option>
                        <option value="UNKNOWN">Unknown</option>
                      </select>
                    </FormField>
                    <FormField label="External id" htmlFor={`pv-${v.key}-external_id`} hint="Optional storefront/legacy denomination id." error={errs.external_id}>
                      <input {...input(v, "external_id", { mono: true })} />
                    </FormField>
                    {v.id && isCodeProduct ? (
                      <div className="space-y-1 text-xs">
                        <p className="font-medium">Codes</p>
                        <p className="text-[var(--clicks-muted)]">
                          {v.available_codes ?? 0} available · {v.codes_reserved ?? 0} reserved · {v.codes_delivered ?? 0} delivered
                        </p>
                        <div className="flex gap-3">
                          <Link href={`/admin/codes?variant=${encodeURIComponent(String(v.id))}`} className="font-medium text-[var(--clicks-blue)]">
                            View codes
                          </Link>
                          {canImport ? (
                            <Link
                              href={`/admin/codes/import?variant=${encodeURIComponent(String(v.id))}`}
                              className="font-medium text-[var(--clicks-blue)]"
                            >
                              Import codes
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {!disabled ? (
                      <div className="flex items-end justify-end gap-2 sm:col-span-2 lg:col-span-4">
                        <button type="button" className="admin-btn admin-btn-ghost h-8 text-xs" disabled={idx === 0} onClick={() => onMove(v.key, -1)}>
                          Move up
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn-ghost h-8 text-xs"
                          disabled={idx === visible.length - 1}
                          onClick={() => onMove(v.key, 1)}
                        >
                          Move down
                        </button>
                        <button type="button" className="admin-btn admin-btn-danger h-8 text-xs" onClick={() => onRemove(v)}>
                          {v.id ? "Delete variant" : "Remove"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No variants" description="Add at least one variant with a price so the product can be bought." />
      )}
    </section>
  );
}
