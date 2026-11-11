"use client";

import { jodInputToFils } from "@/components/admin/lib/money";
import { numberFromName, type VariantDraft } from "@/components/admin/lib/product-form";
import { CountPill, EditorSection, ErrorPill, Toggle } from "@/components/admin/product/editor-ui";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import type { AdminRegion } from "@/lib/api/admin";
import { cn } from "@/lib/cn";
import { ArrowDown, ArrowUp, ChevronDown, Globe2, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type Props = {
  variants: VariantDraft[];
  errors: Record<string, Record<string, string>>;
  /** problem with the whole list (from the server) */
  listError?: string;
  disabled: boolean;
  isCodeProduct: boolean;
  regions: AdminRegion[];
  canImport: boolean;
  accountCurrency?: string;
  onChange: (key: string, patch: Partial<VariantDraft>) => void;
  /** adds an option (optionally in a region) and returns its key */
  onAdd: (region?: string) => string;
  onRemove: (variant: VariantDraft) => void;
  /** swap two options' places */
  onSwap: (key: string, otherKey: string) => void;
};

/** Fields edited right in the row (errors on others send staff to the dialog). */
const ROW_FIELDS = new Set(["name_en", "price", "region", "stock_status"]);
const NO_REGION = "";

function profitText(price: string, cost: string): string {
  const p = jodInputToFils(price);
  const c = jodInputToFils(cost);
  if (p == null || c == null || Number.isNaN(p) || Number.isNaN(c) || c <= 0 || p <= 0) return "";
  const diff = p - c;
  const pct = Math.round((diff / p) * 100);
  return `${diff < 0 ? "Loss" : "Profit"} per sale: ${(Math.abs(diff) / 1000).toFixed(3)} JOD (${pct}%)`;
}

/** What the "Selling" cell says under its switch. */
function sellingNote(v: VariantDraft, isCode: boolean): { text: string; tone: "ok" | "bad" | "muted" } {
  if (v.stock_status === "OUT_OF_STOCK") return { text: "Marked out of stock", tone: "bad" };
  if (!isCode) return { text: "Customers can order", tone: "ok" };
  if (!v.id) return { text: "Import codes after saving", tone: "muted" };
  const n = v.available_codes ?? 0;
  const effective = v.effective_stock_status ?? v.stock_status;
  if (effective === "IN_STOCK") return { text: n ? `${n} code${n === 1 ? "" : "s"} in stock` : "In stock (supplier)", tone: "ok" };
  return { text: "Sold out — 0 codes", tone: "bad" };
}

export function OptionsSection({
  variants,
  errors,
  listError,
  disabled,
  isCodeProduct,
  regions,
  canImport,
  accountCurrency,
  onChange,
  onAdd,
  onRemove,
  onSwap,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const visible = variants.filter((v) => !v.delete);
  const current = visible.find((v) => v.key === editing) ?? null;
  const problems = visible.filter((v) => Object.keys(errors[v.key] ?? {}).length).length + (listError ? 1 : 0);
  const regionOf = (id: string) => regions.find((r) => String(r.id) === id);

  // One group per region, in the order regions first appear; options without a region last.
  const groupIds: string[] = [];
  for (const v of visible) if (!groupIds.includes(v.region || NO_REGION)) groupIds.push(v.region || NO_REGION);
  groupIds.sort((a, b) => (a === NO_REGION ? 1 : b === NO_REGION ? -1 : 0));
  const groups = groupIds.map((id) => ({ id, region: regionOf(id), items: visible.filter((v) => (v.region || NO_REGION) === id) }));
  const grouped = groups.length > 1 || (groups[0] && groups[0].id !== NO_REGION);

  const input = (v: VariantDraft, key: keyof VariantDraft, extra: { mono?: boolean; inputMode?: "decimal" | "numeric" } = {}) => ({
    id: `pv-${v.key}-${String(key)}`,
    disabled,
    inputMode: extra.inputMode,
    "aria-invalid": errors[v.key]?.[key as string] ? true : undefined,
    className: cn(adminInputClass, extra.mono && "font-mono text-xs", errors[v.key]?.[key as string] && "border-[var(--clicks-error)]"),
    value: String(v[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(v.key, { [key]: e.target.value } as Partial<VariantDraft>),
  });

  const cols = "md:grid-cols-[24px_minmax(150px,1fr)_92px_144px_124px_44px_36px]";

  return (
    <EditorSection
      id="section-options"
      title="Prices & options"
      badge={problems ? <ErrorPill count={problems} /> : visible.length ? <CountPill>{visible.length}</CountPill> : null}
      description={
        isCodeProduct
          ? "Each option is one card customers can buy, e.g. “$10 card”, grouped by the region it works in."
          : "Each option is one package customers can buy, e.g. “600 UC”, grouped by region."
      }
      action={
        !disabled ? (
          <button type="button" className="admin-btn admin-btn-secondary gap-1.5" onClick={() => onAdd()}>
            <Plus className="h-4 w-4" aria-hidden />
            Add option
          </button>
        ) : null
      }
      bodyClassName="px-0 pb-0"
    >
      {listError ? (
        <p role="alert" className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          {listError}
        </p>
      ) : null}
      {visible.length ? (
        <div className="border-t border-[var(--clicks-border)]">
          <div className={cn("hidden items-center gap-3 bg-[#F8F9FC] px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--clicks-muted)] md:grid", cols)}>
            <span />
            <span>Option name</span>
            <span>Price (JOD)</span>
            <span>Region</span>
            <span>Selling</span>
            <span>Shown</span>
            <span />
          </div>
          {groups.map((group) => (
            <div key={group.id || "none"}>
              {grouped ? (
                <div className="flex items-center justify-between gap-3 border-t border-[var(--clicks-border)] bg-[#F3F6FF] px-5 py-2">
                  <p className="flex items-center gap-2 text-[12px] font-semibold text-[var(--clicks-navy)]">
                    <Globe2 className="h-3.5 w-3.5 text-[var(--clicks-blue)]" aria-hidden />
                    {group.region ? `${group.region.name_en} · ${group.region.currency}` : "Works everywhere (no region)"}
                    <CountPill>{group.items.length}</CountPill>
                  </p>
                  {!disabled ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--clicks-blue)] hover:underline"
                      onClick={() => onAdd(group.id)}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Add here
                    </button>
                  ) : null}
                </div>
              ) : null}
              <ul className="divide-y divide-[var(--clicks-border)] border-t border-[var(--clicks-border)]">
                {group.items.map((v, idx) => {
                  const errs = errors[v.key] ?? {};
                  const hidden = Object.keys(errs).filter((k) => !ROW_FIELDS.has(k));
                  const note = sellingNote(v, isCodeProduct);
                  const prev = group.items[idx - 1];
                  const next = group.items[idx + 1];
                  return (
                    <li key={v.key} className={cn("px-5 py-3", Object.keys(errs).length && "bg-red-50/40", !v.published && "bg-[#FAFAFB]")}>
                      <div className={cn("grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 md:items-center", cols)}>
                        <div className="flex flex-col items-center pt-1 md:pt-0">
                          <button
                            type="button"
                            aria-label="Move up"
                            disabled={disabled || !prev}
                            onClick={() => prev && onSwap(v.key, prev.key)}
                            className="rounded p-0.5 text-[var(--clicks-muted)] hover:bg-[#EEF1F6] disabled:opacity-25"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Move down"
                            disabled={disabled || !next}
                            onClick={() => next && onSwap(v.key, next.key)}
                            className="rounded p-0.5 text-[var(--clicks-muted)] hover:bg-[#EEF1F6] disabled:opacity-25"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="min-w-0">
                          <label htmlFor={`pv-${v.key}-name_en`} className="sr-only">
                            Option name
                          </label>
                          <input {...input(v, "name_en")} placeholder={isCodeProduct ? "e.g. $10 card" : "e.g. 600 UC"} />
                          {errs.name_en ? <p className="mt-1 text-[11px] text-[var(--clicks-error)]">{errs.name_en}</p> : null}
                          {hidden.length ? (
                            <button type="button" className="mt-1 text-[11px] font-semibold text-[var(--clicks-error)] underline" onClick={() => setEditing(v.key)}>
                              {errs[hidden[0]]} — fix it
                            </button>
                          ) : null}
                        </div>

                        <div className="col-start-2 md:col-start-auto">
                          <label htmlFor={`pv-${v.key}-price`} className="mb-1 block text-[11px] font-medium text-[var(--clicks-muted)] md:sr-only">
                            Price (JOD)
                          </label>
                          <input {...input(v, "price", { inputMode: "decimal" })} placeholder="0.000" />
                          {errs.price ? <p className="mt-1 text-[11px] text-[var(--clicks-error)]">{errs.price}</p> : null}
                        </div>

                        <div className="col-start-2 md:col-start-auto">
                          <label htmlFor={`pv-${v.key}-region`} className="mb-1 block text-[11px] font-medium text-[var(--clicks-muted)] md:sr-only">
                            Region
                          </label>
                          <select {...input(v, "region")}>
                            <option value="">Works everywhere</option>
                            {regions.map((r) => (
                              <option key={String(r.id)} value={String(r.id)}>
                                {r.name_en} ({r.currency})
                              </option>
                            ))}
                          </select>
                          {errs.region ? <p className="mt-1 text-[11px] text-[var(--clicks-error)]">{errs.region}</p> : null}
                        </div>

                        <div className="col-start-2 min-w-0 md:col-start-auto">
                          <Toggle
                            id={`pv-${v.key}-selling`}
                            label="Selling (off = out of stock)"
                            hideLabel
                            checked={v.stock_status !== "OUT_OF_STOCK"}
                            disabled={disabled}
                            onChange={(on) => onChange(v.key, { stock_status: on ? "IN_STOCK" : "OUT_OF_STOCK" })}
                          />
                          <p
                            className={cn(
                              "mt-1 text-[11px] leading-4",
                              note.tone === "ok" ? "text-emerald-700" : note.tone === "bad" ? "text-[var(--clicks-error)]" : "text-[var(--clicks-muted)]",
                            )}
                          >
                            {note.text}
                          </p>
                        </div>

                        <div className="col-start-2 flex items-center gap-2 md:col-start-auto">
                          <Toggle
                            id={`pv-${v.key}-published`}
                            label="Show on store"
                            hideLabel
                            checked={v.published}
                            disabled={disabled}
                            onChange={(published) => onChange(v.key, { published })}
                          />
                          <span className="text-[12px] text-[var(--clicks-muted)] md:sr-only">{v.published ? "Shown on store" : "Hidden"}</span>
                        </div>

                        <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                          <button
                            type="button"
                            aria-label={`More settings for ${v.name_en || "option"}`}
                            title="More settings"
                            onClick={() => setEditing(v.key)}
                            className={cn(
                              "inline-flex h-9 w-9 items-center justify-center rounded-lg border text-[var(--clicks-muted)] transition hover:text-[var(--clicks-navy)]",
                              hidden.length ? "border-red-300 text-red-600" : "border-[var(--clicks-border)] hover:border-[var(--clicks-border-strong)]",
                            )}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-t border-[var(--clicks-border)] px-5 py-8 text-center">
          <p className="text-[13px] font-semibold text-[var(--clicks-navy)]">No options yet</p>
          <p className="mt-1 text-[12px] text-[var(--clicks-muted)]">Add at least one option with a price so customers can buy this product.</p>
          {!disabled ? (
            <button type="button" className="admin-btn admin-btn-primary mt-3 gap-1.5" onClick={() => onAdd()}>
              <Plus className="h-4 w-4" aria-hidden />
              Add the first option
            </button>
          ) : null}
        </div>
      )}

      <AdminModal
        open={Boolean(current)}
        wide
        title={current?.name_en ? `“${current.name_en}” — more settings` : "More settings"}
        description="Name, price, region and stock are edited in the list. Changes here are saved with the product when you press Save."
        onClose={() => setEditing(null)}
      >
        {current ? (
          <OptionEditor
            v={current}
            errs={errors[current.key] ?? {}}
            input={input}
            disabled={disabled}
            isCodeProduct={isCodeProduct}
            regionCurrency={regionOf(current.region)?.currency}
            canImport={canImport}
            accountCurrency={accountCurrency}
            onDone={() => setEditing(null)}
            onRemove={() => {
              setEditing(null);
              onRemove(current);
            }}
          />
        ) : null}
      </AdminModal>
    </EditorSection>
  );
}

function OptionEditor({
  v,
  errs,
  input,
  disabled,
  isCodeProduct,
  regionCurrency,
  canImport,
  accountCurrency,
  onDone,
  onRemove,
}: {
  v: VariantDraft;
  errs: Record<string, string>;
  input: (v: VariantDraft, key: keyof VariantDraft, extra?: { mono?: boolean; inputMode?: "decimal" | "numeric" }) => Record<string, unknown>;
  disabled: boolean;
  isCodeProduct: boolean;
  regionCurrency?: string;
  canImport: boolean;
  accountCurrency?: string;
  onDone: () => void;
  onRemove: () => void;
}) {
  const advancedKeys = ["sku", "denomination", "package_value", "package_currency", "external_id"];
  const [advanced, setAdvanced] = useState(() => advancedKeys.some((k) => errs[k]));
  const showAdvanced = advanced || advancedKeys.some((k) => errs[k]);
  const derivedFace = numberFromName(v.name_en);
  const derivedCurrency = (regionCurrency || accountCurrency || "USD").toUpperCase();
  const profit = profitText(v.price, v.cost);
  const group = "rounded-lg border border-[var(--clicks-border)] p-4";
  const groupTitle = "mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--clicks-muted)]";

  return (
    <div className="space-y-4">
      <div className={group}>
        <h3 className={groupTitle}>Arabic name & cost</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name (Arabic)" htmlFor={`pv-${v.key}-name_ar`} optional hint="Empty = the English name." error={errs.name_ar}>
            <input {...input(v, "name_ar")} dir="rtl" />
          </FormField>
          <FormField label="Your cost (JOD)" htmlFor={`pv-${v.key}-cost`} optional hint="Never shown to customers." error={errs.cost}>
            <input {...input(v, "cost", { inputMode: "decimal" })} />
          </FormField>
        </div>
        {profit ? (
          <p className={cn("mt-2 text-[12px] font-medium", profit.startsWith("Loss") ? "text-[var(--clicks-error)]" : "text-emerald-700")}>{profit}</p>
        ) : null}
      </div>

      <div className={group}>
        <h3 className={groupTitle}>How many per order</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Minimum" htmlFor={`pv-${v.key}-min_quantity`} error={errs.min_quantity}>
            <input {...input(v, "min_quantity", { inputMode: "numeric" })} type="number" min={1} />
          </FormField>
          <FormField label="Maximum" htmlFor={`pv-${v.key}-max_quantity`} error={errs.max_quantity}>
            <input {...input(v, "max_quantity", { inputMode: "numeric" })} type="number" min={1} />
          </FormField>
        </div>
      </div>

      {isCodeProduct ? (
        <div className={cn(group, "flex flex-wrap items-center justify-between gap-3")}>
          <div>
            <h3 className={cn(groupTitle, "mb-1")}>Codes</h3>
            {v.id ? (
              <p className="text-[13px] text-[var(--clicks-text)]">
                <span className="font-semibold">{v.available_codes ?? 0}</span> available · {v.codes_reserved ?? 0} reserved ·{" "}
                {v.codes_delivered ?? 0} delivered
              </p>
            ) : (
              <p className="text-[12px] text-[var(--clicks-muted)]">Save the product first, then import codes for this option.</p>
            )}
          </div>
          {v.id ? (
            <div className="flex gap-2">
              <Link href={`/admin/codes?variant=${encodeURIComponent(String(v.id))}`} className="admin-btn admin-btn-secondary">
                View codes
              </Link>
              {canImport ? (
                <Link href={`/admin/codes/import?variant=${encodeURIComponent(String(v.id))}`} className="admin-btn admin-btn-primary">
                  Import codes
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-dashed border-[var(--clicks-border)]">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-4 py-3 text-start text-[12px] font-semibold text-[var(--clicks-navy)]"
          aria-expanded={showAdvanced}
          onClick={() => setAdvanced(!showAdvanced)}
        >
          <ChevronDown className={cn("h-4 w-4 text-[var(--clicks-muted)] transition", !showAdvanced && "-rotate-90")} aria-hidden />
          Advanced
          <span className="font-normal text-[var(--clicks-muted)]">— SKU, face value, package · filled in automatically</span>
        </button>
        {showAdvanced ? (
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
            <FormField
              label="SKU (stock code)"
              htmlFor={`pv-${v.key}-sku`}
              optional
              hint={v.id ? "Used in code import files." : "Empty = made from the names."}
              error={errs.sku}
            >
              <input {...input(v, "sku", { mono: true })} />
            </FormField>
            <FormField
              label="Face value"
              htmlFor={`pv-${v.key}-denomination`}
              optional
              hint={derivedFace ? `Empty = ${derivedFace} (from the name).` : "Number on the card, e.g. 10."}
              error={errs.denomination}
            >
              <input {...input(v, "denomination", { inputMode: "decimal" })} placeholder={derivedFace || "auto"} />
            </FormField>
            <FormField label="Package amount" htmlFor={`pv-${v.key}-package_value`} optional hint="What the customer gets, e.g. 600." error={errs.package_value}>
              <input {...input(v, "package_value")} placeholder={derivedFace || "auto"} />
            </FormField>
            <FormField label="Package unit" htmlFor={`pv-${v.key}-package_currency`} optional hint={`e.g. USD, UC. Empty = ${derivedCurrency}.`} error={errs.package_currency}>
              <input {...input(v, "package_currency", { mono: true })} maxLength={8} placeholder={derivedCurrency} />
            </FormField>
            <FormField label="External id" htmlFor={`pv-${v.key}-external_id`} optional hint="Only for old store links." error={errs.external_id}>
              <input {...input(v, "external_id", { mono: true })} />
            </FormField>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--clicks-border)] pt-4">
        {!disabled ? (
          <button type="button" className="admin-btn admin-btn-ghost !text-[var(--clicks-error)] hover:!bg-red-50" onClick={onRemove}>
            {v.id ? "Delete option…" : "Remove option"}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="admin-btn admin-btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
