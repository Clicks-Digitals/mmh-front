"use client";

import { Badge } from "@/components/admin/ui/badge";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { numberFromName, stockOptions, type VariantDraft } from "@/components/admin/lib/product-form";
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
  /** product account currency (fallback for package currency) */
  accountCurrency?: string;
  onChange: (key: string, patch: Partial<VariantDraft>) => void;
  onAdd: () => void;
  onRemove: (variant: VariantDraft) => void;
  onMove: (key: string, dir: -1 | 1) => void;
};

function StockBadge({ v, isCode }: { v: VariantDraft; isCode: boolean }) {
  if (!v.id) return <Badge tone="neutral">Not saved yet</Badge>;
  if (!v.published) return <Badge tone="neutral">Hidden</Badge>;
  const status = v.effective_stock_status ?? v.stock_status;
  const label =
    status === "IN_STOCK"
      ? isCode
        ? "Selling"
        : "Available"
      : status === "OUT_OF_STOCK"
        ? "Out of stock"
        : "Can't be bought";
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Badge status={status === "UNKNOWN" ? "PENDING" : status}>{label}</Badge>
      {isCode ? (
        <span className="text-[10px] text-[var(--clicks-muted)]">
          {v.available_codes ?? 0} code{(v.available_codes ?? 0) === 1 ? "" : "s"} available
        </span>
      ) : null}
    </span>
  );
}

export function VariantsTab({
  variants,
  errors,
  disabled,
  isCodeProduct,
  regions,
  canImport,
  accountCurrency,
  onChange,
  onAdd,
  onRemove,
  onMove,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const visible = variants.filter((v) => !v.delete);

  const input = (v: VariantDraft, key: keyof VariantDraft, extra: { mono?: boolean; inputMode?: "decimal" | "numeric" } = {}) => ({
    id: `pv-${v.key}-${String(key)}`,
    disabled,
    inputMode: extra.inputMode,
    "aria-invalid": errors[v.key]?.[key as string] ? true : undefined,
    className: `${adminInputClass} ${extra.mono ? "font-mono text-xs" : ""} ${errors[v.key]?.[key as string] ? "border-[var(--clicks-error)]" : ""}`,
    value: String(v[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange(v.key, { [key]: e.target.value } as Partial<VariantDraft>),
  });

  return (
    <section className="admin-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Variants (what customers can buy)</h2>
          <p className="mt-0.5 text-xs text-[var(--clicks-muted)]">
            Each variant is one option with its own price, e.g. “$10 card” or “600 UC”. Prices are in JOD. Fields marked * are
            required — everything else is optional.
            {isCodeProduct
              ? " A code variant sells only while it has codes in stock; import codes from “More details”."
              : " Top-ups have no code stock — set them to “Not available” to pause orders."}
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
            const open = expanded === v.key || Object.keys(errs).some((k) => !["name_en", "price"].includes(k));
            const derivedFace = numberFromName(v.name_en);
            const region = regions.find((r) => String(r.id) === v.region);
            const derivedCurrency = (region?.currency || accountCurrency || "USD").toUpperCase();
            return (
              <div key={v.key} className={`rounded-lg border ${Object.keys(errs).length ? "border-red-300" : "border-[var(--clicks-border)]"}`}>
                <div className="grid items-start gap-3 p-3 md:grid-cols-[1.6fr_0.9fr_auto_auto]">
                  <FormField label="Name (English)" htmlFor={`pv-${v.key}-name_en`} required error={errs.name_en}>
                    <input {...input(v, "name_en")} placeholder={isCodeProduct ? "e.g. $10 card" : "e.g. 600 UC"} />
                  </FormField>
                  <FormField label="Price (JOD)" htmlFor={`pv-${v.key}-price`} required error={errs.price}>
                    <input {...input(v, "price", { inputMode: "decimal" })} placeholder="0.000" />
                  </FormField>
                  <div className="space-y-1.5 pt-0.5">
                    <p className="text-[12px] font-medium">Stock</p>
                    <StockBadge v={v} isCode={isCodeProduct} />
                  </div>
                  <div className="flex flex-col items-start gap-1.5 pt-5 md:items-end">
                    <label className="flex items-center gap-1.5 text-xs font-medium" title="Unpublished variants are hidden from the store">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={v.published}
                        onChange={(e) => onChange(v.key, { published: e.target.checked })}
                      />
                      Show on store
                    </label>
                    <button
                      type="button"
                      className="text-xs font-medium text-[var(--clicks-blue)]"
                      aria-expanded={open}
                      onClick={() => setExpanded(open && expanded === v.key ? null : v.key)}
                    >
                      {open ? "Hide details" : "More details"}
                    </button>
                  </div>
                </div>

                {open ? (
                  <div className="grid gap-3 border-t border-[var(--clicks-border)] bg-[#FAFBFD] p-3 sm:grid-cols-2 lg:grid-cols-4">
                    <FormField label="Name (Arabic)" htmlFor={`pv-${v.key}-name_ar`} optional error={errs.name_ar}>
                      <input {...input(v, "name_ar")} dir="rtl" />
                    </FormField>
                    <FormField
                      label="Was price (JOD)"
                      htmlFor={`pv-${v.key}-compare_at`}
                      optional
                      hint="Shown crossed out next to the price. Must be higher than the price."
                      error={errs.compare_at}
                    >
                      <input {...input(v, "compare_at", { inputMode: "decimal" })} />
                    </FormField>
                    <FormField label="Your cost (JOD)" htmlFor={`pv-${v.key}-cost`} optional hint="What you pay for it. Never shown to customers." error={errs.cost}>
                      <input {...input(v, "cost", { inputMode: "decimal" })} />
                    </FormField>
                    <FormField
                      label="Region"
                      htmlFor={`pv-${v.key}-region`}
                      optional
                      hint="Where the code works. Region-locked regions show a warning to customers."
                      error={errs.region}
                    >
                      <select {...input(v, "region")}>
                        <option value="">No region (works everywhere)</option>
                        {regions.map((r) => (
                          <option key={String(r.id)} value={String(r.id)}>
                            {r.name_en} ({r.currency})
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField
                      label={isCodeProduct ? "Selling" : "Availability"}
                      htmlFor={`pv-${v.key}-stock_status`}
                      hint={
                        isCodeProduct
                          ? "Automatic: on sale while codes are in stock, out of stock when they run out. Importing codes switches it back on."
                          : "Top-ups have no code stock, so you decide whether customers can order."
                      }
                      error={errs.stock_status}
                    >
                      <select {...input(v, "stock_status")}>
                        {stockOptions(isCodeProduct, v.stock_status).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Min. per order" htmlFor={`pv-${v.key}-min_quantity`} error={errs.min_quantity}>
                      <input {...input(v, "min_quantity", { inputMode: "numeric" })} type="number" min={1} />
                    </FormField>
                    <FormField label="Max. per order" htmlFor={`pv-${v.key}-max_quantity`} error={errs.max_quantity}>
                      <input {...input(v, "max_quantity", { inputMode: "numeric" })} type="number" min={1} />
                    </FormField>
                    <FormField
                      label="SKU (stock code)"
                      htmlFor={`pv-${v.key}-sku`}
                      optional
                      hint={v.id ? "Used in code import files." : "Empty = created automatically from the product and variant name."}
                      error={errs.sku}
                    >
                      <input {...input(v, "sku", { mono: true })} />
                    </FormField>

                    <div className="space-y-1 rounded-md border border-dashed border-[var(--clicks-border)] p-2.5 text-[11px] text-[var(--clicks-muted)] sm:col-span-2 lg:col-span-4">
                      <p className="font-medium text-[var(--clicks-text)]">Face value (optional — filled in for you)</p>
                      <p>
                        Leave these empty and they are taken from the name and region
                        {derivedFace ? ` (here: ${derivedFace} ${derivedCurrency})` : ""}. Only fill them in if the name has no
                        number, e.g. “Monthly pass”.
                      </p>
                    </div>
                    <FormField label="Face value" htmlFor={`pv-${v.key}-denomination`} optional hint="Number on the card, e.g. 10." error={errs.denomination}>
                      <input {...input(v, "denomination", { inputMode: "decimal" })} placeholder={derivedFace || "auto"} />
                    </FormField>
                    <FormField
                      label="Package amount"
                      htmlFor={`pv-${v.key}-package_value`}
                      optional
                      hint="What the customer gets, e.g. 10 or 600."
                      error={errs.package_value}
                    >
                      <input {...input(v, "package_value")} placeholder={derivedFace || "auto"} />
                    </FormField>
                    <FormField
                      label="Package unit"
                      htmlFor={`pv-${v.key}-package_currency`}
                      optional
                      hint="Currency or unit, e.g. USD, SAR, UC."
                      error={errs.package_currency}
                    >
                      <input {...input(v, "package_currency", { mono: true })} maxLength={8} placeholder={derivedCurrency} />
                    </FormField>
                    <FormField label="External id" htmlFor={`pv-${v.key}-external_id`} optional hint="Only for old storefront links." error={errs.external_id}>
                      <input {...input(v, "external_id", { mono: true })} />
                    </FormField>

                    {v.id && isCodeProduct ? (
                      <div className="space-y-1 text-xs sm:col-span-2">
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
        <EmptyState title="No variants yet" description="Add at least one variant with a price so the product can be bought." />
      )}
    </section>
  );
}
