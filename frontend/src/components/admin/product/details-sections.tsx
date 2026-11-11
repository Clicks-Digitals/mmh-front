"use client";

import { categoryTreeOptions } from "@/components/admin/lib/category-tree";
import {
  PRODUCT_KINDS,
  SUPPORTED_BADGES,
  claimsInstantDelivery,
  isSupportedBadge,
  kindsForFulfillment,
  reconcileKindFulfillment,
  toggleBadge,
  type GeneralForm,
} from "@/components/admin/lib/product-form";
import { ChoiceCards, CountPill, EditorSection, ErrorPill, LangSwitch, Toggle, type Lang } from "@/components/admin/product/editor-ui";
import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import type { AdminCategory, AdminPlatform } from "@/lib/api/admin";
import { cn } from "@/lib/cn";
import { CheckCircle2, Circle, AlertTriangle, KeyRound, Zap } from "lucide-react";
import { useState } from "react";

type Patch = (patch: Partial<GeneralForm>) => void;
type Errors = Record<string, string>;

const INSTANT_WARNING =
  "Avoid promising “instant” delivery — the store then shows its standard delivery text instead. Use e.g. “Usually within 10 minutes”.";

/** Shared props for a text input / textarea bound to one GeneralForm key. */
function bind(form: GeneralForm, errors: Errors, disabled: boolean, onChange: Patch) {
  const input = (key: keyof GeneralForm, opts: { rtl?: boolean; mono?: boolean } = {}) => ({
    id: `pg-${key}`,
    name: key,
    disabled,
    dir: opts.rtl ? "rtl" : undefined,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `pg-${key}-error` : undefined,
    className: cn(adminInputClass, opts.mono && "font-mono text-[13px]", errors[key] && "border-[var(--clicks-error)]"),
    value: String(form[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ [key]: e.target.value } as Partial<GeneralForm>),
  });
  const area = (key: keyof GeneralForm, rtl = false, rows = 3) => ({
    id: `pg-${key}`,
    disabled,
    rows,
    dir: rtl ? "rtl" : undefined,
    className: cn(adminTextareaClass, "min-h-0", errors[key] && "border-[var(--clicks-error)]"),
    value: String(form[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange({ [key]: e.target.value } as Partial<GeneralForm>),
  });
  return { input, area };
}

/**
 * Keeps an English/Arabic switch on the language that has an error: when the set of errors
 * changes and only the other language has problems, switch to it (adjusting state while
 * rendering, as React recommends, instead of an effect).
 */
function useLangWithErrors(errors: Errors, keys: string[]) {
  const [lang, setLang] = useState<Lang>("en");
  const has = {
    en: keys.some((k) => errors[`${k}_en`]),
    ar: keys.some((k) => errors[`${k}_ar`]),
  };
  const signature = `${has.en}|${has.ar}`;
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    if (!has[lang] && (has.en || has.ar)) setLang(has.en ? "en" : "ar");
  }
  return { lang, setLang, has };
}

/* ─── Main column ─── */

export function BasicsSection({
  form,
  errors,
  disabled,
  onChange,
}: {
  form: GeneralForm;
  errors: Errors;
  disabled: boolean;
  onChange: Patch;
}) {
  const { input, area } = bind(form, errors, disabled, onChange);
  const { lang, setLang, has } = useLangWithErrors(errors, ["short_description"]);
  const problems = ["name_en", "name_ar", "short_description_en", "short_description_ar"].filter((k) => errors[k]).length;
  return (
    <EditorSection id="section-basics" title="Name & summary" badge={<ErrorPill count={problems} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name (English)" htmlFor="pg-name_en" required error={errors.name_en}>
          <input {...input("name_en")} placeholder="e.g. PlayStation Store Gift Card" />
        </FormField>
        <FormField label="Name (Arabic)" htmlFor="pg-name_ar" optional hint="Empty = the English name is used." error={errors.name_ar}>
          <input {...input("name_ar", { rtl: true })} placeholder="الاسم بالعربية" />
        </FormField>
      </div>
      <div className="mt-5">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label htmlFor={`pg-short_description_${lang}`} className="text-[12px] font-medium text-[var(--clicks-text)]">
            Short summary <span className="font-normal text-[var(--clicks-muted)]">(one or two lines under the name)</span>
          </label>
          <LangSwitch value={lang} onChange={setLang} errors={has} />
        </div>
        {lang === "en" ? (
          <textarea {...area("short_description_en", false, 2)} placeholder="e.g. Add money to your PlayStation wallet. Works on PS4 and PS5." />
        ) : (
          <textarea {...area("short_description_ar", true, 2)} placeholder="وصف قصير يظهر تحت الاسم" />
        )}
        {errors[`short_description_${lang}`] ? (
          <p className="mt-1 text-[11px] text-[var(--clicks-error)]">{errors[`short_description_${lang}`]}</p>
        ) : null}
      </div>
    </EditorSection>
  );
}

const CONTENT_GROUPS: Array<{
  title: string;
  fields: Array<{ key: string; label: string; hint?: string; placeholder?: string; rows?: number; single?: boolean }>;
}> = [
  {
    title: "About the product",
    fields: [
      { key: "description", label: "Full description", rows: 4, placeholder: "Everything a customer should know before buying." },
    ],
  },
  {
    title: "How to use it",
    fields: [
      { key: "instructions", label: "How to redeem", rows: 3, hint: "A short paragraph shown on the product page." },
      { key: "how_to_use", label: "Steps", rows: 4, hint: "One step per line — shown as a numbered list.", placeholder: "Sign in to PlayStation Store\nChoose Redeem code\nEnter the code" },
    ],
  },
  {
    title: "Delivery, region & refunds",
    fields: [
      { key: "delivery_estimate", label: "Delivery time", single: true, hint: "e.g. “Usually within 10 minutes”. Empty = the store's standard text." },
      { key: "region_warning", label: "Region warning", rows: 2, hint: "Short warning, e.g. “US accounts only”." },
      { key: "region_restrictions", label: "Region details", rows: 3, hint: "Longer explanation of where it works." },
      { key: "refund_policy", label: "Refund note", rows: 2, hint: "Only for this product. Empty = the store's refund policy." },
    ],
  },
];
const CONTENT_KEYS = CONTENT_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

/** Product page text, one language at a time. */
export function ContentSection({
  form,
  errors,
  disabled,
  onChange,
}: {
  form: GeneralForm;
  errors: Errors;
  disabled: boolean;
  onChange: Patch;
}) {
  const { input, area } = bind(form, errors, disabled, onChange);
  const { lang, setLang, has } = useLangWithErrors(errors, CONTENT_KEYS);
  const value = (key: string, l: Lang) => String(form[`${key}_${l}` as keyof GeneralForm] ?? "").trim();
  const filled = (l: Lang) => CONTENT_KEYS.filter((k) => value(k, l)).length;
  const problems = CONTENT_KEYS.flatMap((k) => [`${k}_en`, `${k}_ar`]).filter((k) => errors[k]).length;
  return (
    <EditorSection
      id="section-content"
      title="Product page text"
      description={`What shoppers read on the product page. English ${filled("en")}/${CONTENT_KEYS.length} filled · Arabic ${filled("ar")}/${CONTENT_KEYS.length} filled. Everything here is optional.`}
      collapsible
      defaultOpen={false}
      forceOpen={problems > 0}
      badge={<ErrorPill count={problems} />}
      action={<LangSwitch value={lang} onChange={setLang} errors={has} />}
    >
      <div className="space-y-6">
        {CONTENT_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--clicks-muted)]">
              {group.title}
            </h3>
            <div className="space-y-4">
              {group.fields.map((f) => {
                const key = `${f.key}_${lang}` as keyof GeneralForm;
                const instant = f.key === "delivery_estimate" && claimsInstantDelivery(String(form[key] ?? ""));
                return (
                  <FormField
                    key={key}
                    label={`${f.label}${lang === "ar" ? " (Arabic)" : ""}`}
                    htmlFor={`pg-${key}`}
                    hint={f.hint}
                    warning={instant ? INSTANT_WARNING : undefined}
                    error={errors[key]}
                  >
                    {f.single ? (
                      <input {...input(key, { rtl: lang === "ar" })} maxLength={255} />
                    ) : (
                      <textarea {...area(key, lang === "ar", f.rows)} placeholder={lang === "en" ? f.placeholder : undefined} />
                    )}
                  </FormField>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </EditorSection>
  );
}

/* ─── Sidebar ─── */

export type ReadinessItem = { label: string; ok: boolean; optional?: boolean; action?: { label: string; target: string } };

function jump(target: string) {
  const el = document.getElementById(target);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function StatusCard({
  form,
  disabled,
  onChange,
  savedStatus,
  readiness,
  idPrefix = "pg-status",
}: {
  /** unique per copy (the card is shown twice: top on phones, sidebar on desktop) */
  idPrefix?: string;
  form: GeneralForm;
  disabled: boolean;
  onChange: Patch;
  /** status currently saved on the server */
  savedStatus: string;
  readiness: ReadinessItem[];
}) {
  const archived = form.status === "ARCHIVED";
  const required = readiness.filter((r) => !r.optional);
  const done = required.filter((r) => r.ok).length;
  return (
    <EditorSection title="Visibility">
      {archived ? (
        <p className="rounded-lg border border-[var(--clicks-border)] bg-[#F6F7FA] px-3 py-2.5 text-[12px] leading-5 text-[var(--clicks-text)]">
          <span className="font-semibold">Archived.</span> Hidden from the store and kept with its orders. Use{" "}
          <span className="font-semibold">More → Unarchive</span> to bring it back as a draft.
        </p>
      ) : (
        <ChoiceCards
          name={idPrefix}
          value={form.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT"}
          disabled={disabled}
          onChange={(status) => onChange({ status })}
          options={[
            { value: "DRAFT", label: "Hidden", hint: "Draft — only staff see it" },
            { value: "PUBLISHED", label: "Live", hint: "Visible and can be bought" },
          ]}
        />
      )}
      {!archived && form.status !== savedStatus ? (
        <p className="mt-2 text-[11px] font-medium text-amber-700">Press Save to {form.status === "PUBLISHED" ? "publish" : "hide"} the product.</p>
      ) : null}

      <div className="mt-4 border-t border-[var(--clicks-border)] pt-4">
        <p className="mb-2 flex items-center justify-between text-[12px] font-semibold text-[var(--clicks-navy)]">
          Ready to sell?
          <span className={cn("text-[11px] font-medium", done === required.length ? "text-emerald-700" : "text-[var(--clicks-muted)]")}>
            {done}/{required.length}
          </span>
        </p>
        <ul className="space-y-1.5">
          {readiness.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-[12px] leading-5">
              {item.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              ) : item.optional ? (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[#B6BDCB]" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              )}
              <span className={cn("min-w-0 flex-1", item.ok ? "text-[var(--clicks-muted)]" : "text-[var(--clicks-text)]")}>
                {item.label}
                {item.optional && !item.ok ? <span className="text-[var(--clicks-muted)]"> (recommended)</span> : null}
                <span className="sr-only">{item.ok ? " — done" : " — not done"}</span>
              </span>
              {!item.ok && item.action ? (
                <button type="button" className="shrink-0 text-[11px] font-semibold text-[var(--clicks-blue)]" onClick={() => jump(item.action!.target)}>
                  {item.action.label}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </EditorSection>
  );
}

export function OrganizeCard({
  form,
  errors,
  disabled,
  onChange,
  categories,
  platforms,
  hasVariants,
  savedFulfillment,
}: {
  form: GeneralForm;
  errors: Errors;
  disabled: boolean;
  onChange: Patch;
  categories: AdminCategory[];
  platforms: AdminPlatform[];
  hasVariants?: boolean;
  /** delivery type currently saved (warn only when it is being changed) */
  savedFulfillment?: string;
}) {
  const { input } = bind(form, errors, disabled, onChange);
  const allowedKinds = new Set(kindsForFulfillment(form.fulfillment_type));
  const category = categories.find((c) => String(c.id) === form.category_id);
  const platform = platforms.find((p) => String(p.id) === form.platform_id);
  const problems = ["category_id", "platform_id", "kind", "fulfillment_type", "brand"].filter((k) => errors[k]).length;
  return (
    <EditorSection id="section-organize" title="Organisation" badge={<ErrorPill count={problems} />}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-[12px] font-medium text-[var(--clicks-text)]">How is it delivered?</p>
          <ChoiceCards
            name="pg-fulfillment_type"
            value={form.fulfillment_type as "CODE" | "DIRECT_TOPUP"}
            disabled={disabled}
            onChange={(fulfillment_type) => onChange(reconcileKindFulfillment(form, { fulfillment_type }))}
            options={[
              { value: "CODE", label: "Code", hint: "Customer gets a code", icon: <KeyRound className="h-3.5 w-3.5" aria-hidden /> },
              { value: "DIRECT_TOPUP", label: "Top-up", hint: "Sent to their game account", icon: <Zap className="h-3.5 w-3.5" aria-hidden /> },
            ]}
          />
          {hasVariants && savedFulfillment && savedFulfillment !== form.fulfillment_type ? (
            <p className="text-[11px] text-amber-700">Changing this on a product that is already selling changes how its options are delivered.</p>
          ) : null}
        </div>
        <FormField
          label="Category"
          htmlFor="pg-category_id"
          required
          error={errors.category_id}
          warning={category && category.status !== "PUBLISHED" ? "This category is hidden, so the product is hidden too." : undefined}
        >
          <select {...input("category_id")}>
            <option value="">Choose a category…</option>
            {categoryTreeOptions(categories).map(({ category: c, label }) => (
              <option key={String(c.id)} value={String(c.id)}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label="Platform"
          htmlFor="pg-platform_id"
          required
          error={errors.platform_id}
          warning={platform && platform.status !== "PUBLISHED" ? "This platform is hidden, so the product is hidden too." : undefined}
        >
          <select {...input("platform_id")}>
            <option value="">Choose a platform…</option>
            {platforms.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name_en}
                {p.status !== "PUBLISHED" ? ` (${p.status.toLowerCase()})` : ""}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Type" htmlFor="pg-kind" hint="Used by the store's filters." error={errors.kind}>
          <select {...input("kind")} onChange={(e) => onChange(reconcileKindFulfillment(form, { kind: e.target.value }))}>
            {PRODUCT_KINDS.filter((k) => allowedKinds.has(k.value) || k.value === form.kind).map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Brand" htmlFor="pg-brand" optional hint="Shown above the name on the store." error={errors.brand}>
          <input {...input("brand")} placeholder={platform?.name_en || "Same as the platform"} />
        </FormField>
      </div>
    </EditorSection>
  );
}

export function PromoteCard({
  form,
  errors,
  disabled,
  onChange,
}: {
  form: GeneralForm;
  errors: Errors;
  disabled: boolean;
  onChange: Patch;
}) {
  const { input } = bind(form, errors, disabled, onChange);
  const unsupported = form.badges.filter((b) => !isSupportedBadge(b));
  const active = [form.trending, form.bestseller, form.featured].filter(Boolean).length;
  const problems = ["badges", "tags"].filter((k) => errors[k]).length;
  return (
    <EditorSection
      id="section-promote"
      title="Promotion"
      collapsible
      defaultOpen={active > 0 || form.badges.length > 0}
      forceOpen={problems > 0}
      description="Trending, bestseller, featured, badges and search words."
      badge={problems ? <ErrorPill count={problems} /> : active ? <CountPill>{active} on</CountPill> : null}
    >
      <div className="space-y-3.5">
        <Toggle id="pg-trending" label="Trending" hint="Home page “Trending now” row." checked={form.trending} disabled={disabled} onChange={(trending) => onChange({ trending })} />
        <Toggle id="pg-bestseller" label="Bestseller" hint="Listed on the Best Sellers page." checked={form.bestseller} disabled={disabled} onChange={(bestseller) => onChange({ bestseller })} />
        <Toggle id="pg-featured" label="Featured" hint="Shown first in the shop and in the menu." checked={form.featured} disabled={disabled} onChange={(featured) => onChange({ featured })} />
        <Toggle
          id="pg-refundable"
          label="Refundable"
          hint="Off = customers accept the no-refund policy at checkout."
          checked={form.refundable}
          disabled={disabled}
          onChange={(refundable) => onChange({ refundable })}
        />
      </div>
      <fieldset id="pg-badges" className="mt-5 border-t border-[var(--clicks-border)] pt-4">
        <legend className="sr-only">Badges</legend>
        <p className="text-[12px] font-medium text-[var(--clicks-text)]">Badges on the product card</p>
        <p className="mb-2 text-[11px] text-[var(--clicks-muted)]">Cards show at most two.</p>
        <div className="flex flex-wrap gap-1.5">
          {SUPPORTED_BADGES.map((b) => {
            const on = form.badges.includes(b.value);
            return (
              <button
                key={b.value}
                type="button"
                aria-pressed={on}
                title={b.hint}
                disabled={disabled}
                onClick={() => onChange({ badges: toggleBadge(form.badges, b.value, !on) })}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-[12px] font-medium transition disabled:opacity-60",
                  on
                    ? "border-[var(--clicks-blue)] bg-[var(--clicks-blue)] text-white"
                    : "border-[var(--clicks-border)] bg-white text-[var(--clicks-text)] hover:border-[var(--clicks-border-strong)]",
                )}
              >
                {on ? "✓ " : ""}
                {b.label}
              </button>
            );
          })}
        </div>
        {unsupported.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-amber-800">
            <span>Not shown by the store:</span>
            {unsupported.map((b) => (
              <button
                key={b}
                type="button"
                disabled={disabled}
                className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5"
                onClick={() => onChange({ badges: toggleBadge(form.badges, b, false) })}
                title="Remove this badge"
              >
                {b} ✕
              </button>
            ))}
          </div>
        ) : null}
        {errors.badges ? <p className="mt-1 text-[11px] text-[var(--clicks-error)]">{errors.badges}</p> : null}
      </fieldset>
      <div className="mt-4 border-t border-[var(--clicks-border)] pt-4">
        <FormField label="Search keywords" htmlFor="pg-tags" optional hint="Comma separated, not shown. e.g. psn, بلايستيشن" error={errors.tags}>
          <input {...input("tags")} />
        </FormField>
      </div>
    </EditorSection>
  );
}

export function AdvancedCard({
  form,
  errors,
  disabled,
  onChange,
  productId,
  isNew,
}: {
  form: GeneralForm;
  errors: Errors;
  disabled: boolean;
  onChange: Patch;
  productId?: string;
  isNew?: boolean;
}) {
  const { input } = bind(form, errors, disabled, onChange);
  const problems = ["slug", "sort_order", "account_currency"].filter((k) => errors[k]).length;
  return (
    <EditorSection
      id="section-advanced"
      title="Advanced"
      description="Rarely needed. Safe to leave as is."
      collapsible
      defaultOpen={false}
      forceOpen={problems > 0}
      badge={<ErrorPill count={problems} />}
    >
      <div className="space-y-4">
        <FormField
          label="Web address"
          htmlFor="pg-slug"
          required
          hint={
            <>
              <span className="font-mono">/product/{form.slug || "…"}</span>
              {isNew ? null : " · Changing it breaks links people already shared."}
            </>
          }
          error={errors.slug}
        >
          <input {...input("slug", { mono: true })} />
        </FormField>
        <FormField label="Sort order" htmlFor="pg-sort_order" hint="Lower numbers are listed first." error={errors.sort_order}>
          <input {...input("sort_order")} type="number" inputMode="numeric" />
        </FormField>
        <FormField
          label="Card / wallet currency"
          htmlFor="pg-account_currency"
          optional
          hint="e.g. USD. Used when an option has no region."
          error={errors.account_currency}
        >
          <input {...input("account_currency", { mono: true })} maxLength={8} placeholder="USD" />
        </FormField>
        {productId ? (
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-[var(--clicks-text)]">Product ID</p>
            <p className="break-all font-mono text-[12px] text-[var(--clicks-muted)]">{productId}</p>
            <p className="text-[11px] text-[var(--clicks-muted)]">Never changes. Used in reports and imports.</p>
          </div>
        ) : null}
      </div>
    </EditorSection>
  );
}
