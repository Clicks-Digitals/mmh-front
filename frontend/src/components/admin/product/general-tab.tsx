"use client";

import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
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
import type { AdminCategory, AdminPlatform } from "@/lib/api/admin";
import { categoryTreeOptions } from "@/components/admin/lib/category-tree";

type Props = {
  form: GeneralForm;
  errors: Record<string, string>;
  disabled: boolean;
  categories: AdminCategory[];
  platforms: AdminPlatform[];
  onChange: (patch: Partial<GeneralForm>) => void;
  /** permanent product id (shown read-only) */
  productId?: string;
  /** product already has variants/orders, so changing delivery type is risky */
  hasVariants?: boolean;
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="admin-card p-4">
      <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-[var(--clicks-muted)]">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

const INSTANT_WARNING =
  "Avoid promising “instant” delivery — the store then shows its standard delivery text instead. Use e.g. “Usually within 10 minutes”.";

export function GeneralTab({ form, errors, disabled, categories, platforms, onChange, productId, hasVariants }: Props) {
  const text = (key: keyof GeneralForm, opts: { rtl?: boolean; mono?: boolean } = {}) => ({
    id: `pg-${key}`,
    name: key,
    disabled,
    dir: opts.rtl ? "rtl" : undefined,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `pg-${key}-error` : undefined,
    className: `${adminInputClass} ${opts.mono ? "font-mono" : ""} ${errors[key] ? "border-[var(--clicks-error)]" : ""}`,
    value: String(form[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ [key]: e.target.value } as Partial<GeneralForm>),
  });
  const area = (key: keyof GeneralForm, rtl = false) => ({
    id: `pg-${key}`,
    disabled,
    dir: rtl ? "rtl" : undefined,
    className: adminTextareaClass,
    value: String(form[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange({ [key]: e.target.value } as Partial<GeneralForm>),
  });
  const check = (key: "featured" | "bestseller" | "trending" | "refundable", label: string, hint: string) => (
    <div className="space-y-0.5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          disabled={disabled}
          checked={form[key]}
          onChange={(e) => onChange({ [key]: e.target.checked } as Partial<GeneralForm>)}
        />
        {label}
      </label>
      <p className="ps-6 text-[11px] text-[var(--clicks-muted)]">{hint}</p>
    </div>
  );

  const allowedKinds = new Set(kindsForFulfillment(form.fulfillment_type));
  const unsupportedBadges = form.badges.filter((b) => !isSupportedBadge(b));
  const category = categories.find((c) => String(c.id) === form.category_id);
  const platform = platforms.find((p) => String(p.id) === form.platform_id);

  return (
    <div className="space-y-4">
      <Section title="Basics" description="Fields marked * are required.">
        <FormField label="Name (English)" htmlFor="pg-name_en" required error={errors.name_en}>
          <input {...text("name_en")} />
        </FormField>
        <FormField label="Name (Arabic)" htmlFor="pg-name_ar" optional hint="Shown on the Arabic store. Falls back to English." error={errors.name_ar}>
          <input {...text("name_ar", { rtl: true })} />
        </FormField>
        <FormField
          label="Web address (slug)"
          htmlFor="pg-slug"
          required
          hint={
            <>
              The product page is <span className="font-mono">/product/{form.slug || "…"}</span>. Changing it breaks links
              people already shared.
            </>
          }
          error={errors.slug}
        >
          <input {...text("slug", { mono: true })} />
        </FormField>
        <FormField
          label="Brand"
          htmlFor="pg-brand"
          optional
          hint={`Shown above the name. Empty = the platform name${platform ? ` (${platform.name_en})` : ""}.`}
          error={errors.brand}
        >
          <input {...text("brand")} />
        </FormField>
        <FormField
          label="Status"
          htmlFor="pg-status"
          hint="Only Published products are visible and can be bought. Archived = hidden but kept with its orders."
          error={errors.status}
        >
          <select {...text("status")}>
            <option value="DRAFT">Draft — hidden, still being prepared</option>
            <option value="PUBLISHED">Published — visible on the store</option>
            <option value="ARCHIVED">Archived — hidden, kept for history</option>
          </select>
        </FormField>
        <FormField label="Sort order" htmlFor="pg-sort_order" hint="Lower numbers appear first in lists." error={errors.sort_order}>
          <input {...text("sort_order")} type="number" inputMode="numeric" />
        </FormField>
        <FormField
          label="Category"
          htmlFor="pg-category_id"
          required
          error={errors.category_id}
          warning={category && category.status !== "PUBLISHED" ? "This category is not published, so the product stays hidden." : undefined}
        >
          <select {...text("category_id")}>
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
          hint="PlayStation, Steam, PUBG… Products of hidden platforms are hidden too."
          error={errors.platform_id}
          warning={platform && platform.status !== "PUBLISHED" ? "This platform is not published, so the product stays hidden." : undefined}
        >
          <select {...text("platform_id")}>
            <option value="">Choose a platform…</option>
            {platforms.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name_en}
                {p.status !== "PUBLISHED" ? ` (${p.status.toLowerCase()})` : ""}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label="How is it delivered?"
          htmlFor="pg-fulfillment_type"
          hint={
            form.fulfillment_type === "CODE"
              ? "Codes: the customer receives a code from your code stock."
              : "Direct top-up: you (or a supplier) credit the player's account using the details the customer enters (see Required fields)."
          }
          warning={hasVariants ? "Changing this on a product that is already selling affects how existing variants are delivered." : undefined}
          error={errors.fulfillment_type}
        >
          <select
            {...text("fulfillment_type")}
            onChange={(e) => onChange(reconcileKindFulfillment(form, { fulfillment_type: e.target.value }))}
          >
            <option value="CODE">Code delivery</option>
            <option value="DIRECT_TOPUP">Direct top-up to the player&apos;s account</option>
          </select>
        </FormField>
        <FormField label="Kind" htmlFor="pg-kind" hint="Groups the product in store filters." error={errors.kind}>
          <select {...text("kind")} onChange={(e) => onChange(reconcileKindFulfillment(form, { kind: e.target.value }))}>
            {PRODUCT_KINDS.map((k) => (
              <option key={k.value} value={k.value} disabled={!allowedKinds.has(k.value) && k.value !== form.kind}>
                {k.label} — {k.hint}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label="Card / wallet currency"
          htmlFor="pg-account_currency"
          optional
          hint="Currency of the card value, e.g. USD. Used when a variant has no region."
          error={errors.account_currency}
        >
          <input {...text("account_currency", { mono: true })} maxLength={8} placeholder="USD" />
        </FormField>
        {productId ? (
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-[var(--clicks-text)]">Product ID</p>
            <p className="font-mono text-[12px] text-[var(--clicks-muted)]">{productId}</p>
            <p className="text-[11px] text-[var(--clicks-muted)]">Created automatically and never changes. Used in reports and imports.</p>
          </div>
        ) : null}
      </Section>

      <Section title="Store placement" description="Where the product is promoted on the store.">
        {check("trending", "Trending", "Shown in the homepage “Trending now” rail.")}
        {check("bestseller", "Bestseller", "Listed on the Best Sellers page.")}
        {check("featured", "Featured", "Shown first in the shop and as the featured card in the menu.")}
        {check("refundable", "Refundable", "Shows the product as refundable; otherwise customers must accept the no-refund policy.")}
        <fieldset className="space-y-1.5 sm:col-span-2" id="pg-badges">
          <legend className="text-[12px] font-medium text-[var(--clicks-text)]">Badges on the product card</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SUPPORTED_BADGES.map((b) => (
              <label key={b.value} className="flex items-center gap-2 text-sm" title={b.hint}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={form.badges.includes(b.value)}
                  onChange={(e) => onChange({ badges: toggleBadge(form.badges, b.value, e.target.checked) })}
                />
                {b.label}
                <span className="text-[11px] text-[var(--clicks-muted)]">({b.hint})</span>
              </label>
            ))}
          </div>
          {unsupportedBadges.length ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-800">
              <span>Not shown by the store:</span>
              {unsupportedBadges.map((b) => (
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
          <p className="text-[11px] text-[var(--clicks-muted)]">Cards show at most two badges.</p>
          {errors.badges ? <p className="text-[11px] text-[var(--clicks-error)]">{errors.badges}</p> : null}
        </fieldset>
        <FormField
          label="Search keywords"
          htmlFor="pg-tags"
          optional
          hint="Comma separated words customers might search for (not shown), e.g. psn, playstation, بلايستيشن."
          error={errors.tags}
        >
          <input {...text("tags")} />
        </FormField>
      </Section>

      <Section title="Photos" description="Upload photos in the “Photos” tab — the main (primary) photo is used on product cards.">
        <FormField
          label="Built-in artwork (optional)"
          htmlFor="pg-artwork_key"
          optional
          hint="Name of a built-in store picture (e.g. psn, steam), used only when the product has no uploaded photo. Leave empty if unsure."
          error={errors.artwork_key}
        >
          <input {...text("artwork_key", { mono: true })} />
        </FormField>
        <FormField
          label="External picture link (optional)"
          htmlFor="pg-image_url"
          optional
          hint="Only if the picture is hosted elsewhere. Uploaded photos (Photos tab) always take priority."
          error={errors.image_url}
        >
          <input {...text("image_url", { mono: true })} />
        </FormField>
      </Section>

      <Section title="Descriptions">
        <FormField label="Short description (English)" htmlFor="pg-short_description_en" hint="One or two lines under the title." error={errors.short_description_en}>
          <textarea {...area("short_description_en")} />
        </FormField>
        <FormField label="Short description (Arabic)" htmlFor="pg-short_description_ar" error={errors.short_description_ar}>
          <textarea {...area("short_description_ar", true)} />
        </FormField>
        <FormField label="Full description (English)" htmlFor="pg-description_en" error={errors.description_en}>
          <textarea {...area("description_en")} />
        </FormField>
        <FormField label="Full description (Arabic)" htmlFor="pg-description_ar" error={errors.description_ar}>
          <textarea {...area("description_ar", true)} />
        </FormField>
        <FormField label="How to redeem (English)" htmlFor="pg-instructions_en" hint="Shown on the product page." error={errors.instructions_en}>
          <textarea {...area("instructions_en")} />
        </FormField>
        <FormField label="How to redeem (Arabic)" htmlFor="pg-instructions_ar" error={errors.instructions_ar}>
          <textarea {...area("instructions_ar", true)} />
        </FormField>
        <FormField label="Steps (English)" htmlFor="pg-how_to_use_en" hint="One step per line." error={errors.how_to_use_en}>
          <textarea {...area("how_to_use_en")} />
        </FormField>
        <FormField label="Steps (Arabic)" htmlFor="pg-how_to_use_ar" hint="One step per line." error={errors.how_to_use_ar}>
          <textarea {...area("how_to_use_ar", true)} />
        </FormField>
      </Section>

      <Section title="Region, delivery & refunds">
        <FormField label="Region warning (English)" htmlFor="pg-region_warning_en" hint="Short warning on the product page, e.g. “US accounts only”." error={errors.region_warning_en}>
          <textarea {...area("region_warning_en")} />
        </FormField>
        <FormField label="Region warning (Arabic)" htmlFor="pg-region_warning_ar" error={errors.region_warning_ar}>
          <textarea {...area("region_warning_ar", true)} />
        </FormField>
        <FormField label="Region details (English)" htmlFor="pg-region_restrictions_en" hint="Longer explanation on the product page." error={errors.region_restrictions_en}>
          <textarea {...area("region_restrictions_en")} />
        </FormField>
        <FormField label="Region details (Arabic)" htmlFor="pg-region_restrictions_ar" error={errors.region_restrictions_ar}>
          <textarea {...area("region_restrictions_ar", true)} />
        </FormField>
        <FormField
          label="Delivery time (English)"
          htmlFor="pg-delivery_estimate_en"
          optional
          hint="e.g. “Usually within 10 minutes”. Empty = the store's standard text."
          warning={claimsInstantDelivery(form.delivery_estimate_en) ? INSTANT_WARNING : undefined}
          error={errors.delivery_estimate_en}
        >
          <input {...text("delivery_estimate_en")} maxLength={255} />
        </FormField>
        <FormField
          label="Delivery time (Arabic)"
          htmlFor="pg-delivery_estimate_ar"
          optional
          warning={claimsInstantDelivery(form.delivery_estimate_ar) ? INSTANT_WARNING : undefined}
          error={errors.delivery_estimate_ar}
        >
          <input {...text("delivery_estimate_ar", { rtl: true })} maxLength={255} />
        </FormField>
        <FormField label="Refund note (English)" htmlFor="pg-refund_policy_en" hint="Product-specific refund note. Empty = store default policy." error={errors.refund_policy_en}>
          <textarea {...area("refund_policy_en")} />
        </FormField>
        <FormField label="Refund note (Arabic)" htmlFor="pg-refund_policy_ar" error={errors.refund_policy_ar}>
          <textarea {...area("refund_policy_ar", true)} />
        </FormField>
      </Section>
    </div>
  );
}
