"use client";

import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import type { GeneralForm } from "@/components/admin/lib/product-form";
import type { AdminCategory, AdminPlatform } from "@/lib/api/admin";

type Props = {
  form: GeneralForm;
  errors: Record<string, string>;
  disabled: boolean;
  categories: AdminCategory[];
  platforms: AdminPlatform[];
  onChange: (patch: Partial<GeneralForm>) => void;
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

export function GeneralTab({ form, errors, disabled, categories, platforms, onChange }: Props) {
  const text = (key: keyof GeneralForm, opts: { rtl?: boolean; mono?: boolean } = {}) => ({
    id: `pg-${key}`,
    disabled,
    dir: opts.rtl ? "rtl" : undefined,
    className: `${adminInputClass} ${opts.mono ? "font-mono" : ""}`,
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

  return (
    <div className="space-y-4">
      <Section title="Basics">
        <FormField label="Name (EN)" htmlFor="pg-name_en" required error={errors.name_en}>
          <input {...text("name_en")} />
        </FormField>
        <FormField label="Name (AR)" htmlFor="pg-name_ar" hint="Shown on the Arabic store; falls back to English." error={errors.name_ar}>
          <input {...text("name_ar", { rtl: true })} />
        </FormField>
        <FormField label="Slug" htmlFor="pg-slug" required hint="Product URL: /product/<slug>. Changing it breaks old links." error={errors.slug}>
          <input {...text("slug", { mono: true })} />
        </FormField>
        <FormField label="Brand" htmlFor="pg-brand" required error={errors.brand}>
          <input {...text("brand")} />
        </FormField>
        <FormField label="Status" htmlFor="pg-status" hint="Only Published products are visible and purchasable." error={errors.status}>
          <select {...text("status")}>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </FormField>
        <FormField label="Sort order" htmlFor="pg-sort_order" hint="Lower numbers appear first in lists." error={errors.sort_order}>
          <input {...text("sort_order")} type="number" />
        </FormField>
        <FormField label="Category" htmlFor="pg-category_id" required error={errors.category_id}>
          <select {...text("category_id")}>
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>
                {c.name_en}
                {c.status !== "PUBLISHED" ? ` (${c.status.toLowerCase()})` : ""}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Platform" htmlFor="pg-platform_id" required hint="Products of draft/archived platforms are hidden." error={errors.platform_id}>
          <select {...text("platform_id")}>
            <option value="">Select…</option>
            {platforms.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name_en}
                {p.status !== "PUBLISHED" ? ` (${p.status.toLowerCase()})` : ""}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Kind" htmlFor="pg-kind" hint="Groups the product in store filters." error={errors.kind}>
          <select {...text("kind")}>
            <option value="GIFT_CARD">Gift card</option>
            <option value="WALLET">Wallet</option>
            <option value="GAME_CURRENCY">Game currency</option>
            <option value="SUBSCRIPTION">Subscription</option>
            <option value="DIRECT_TOPUP">Direct top-up</option>
            <option value="DIGITAL_CODE">Digital code</option>
          </select>
        </FormField>
        <FormField
          label="Fulfillment"
          htmlFor="pg-fulfillment_type"
          hint="Code = delivered from code stock. Direct top-up = staff/supplier credits the player's account (uses Required fields)."
          error={errors.fulfillment_type}
        >
          <select {...text("fulfillment_type")}>
            <option value="CODE">Code</option>
            <option value="DIRECT_TOPUP">Direct top-up</option>
          </select>
        </FormField>
        <FormField label="Account currency" htmlFor="pg-account_currency" hint="Currency of the card/wallet, e.g. USD. Optional." error={errors.account_currency}>
          <input {...text("account_currency", { mono: true })} maxLength={8} />
        </FormField>
      </Section>

      <Section title="Store placement" description="Controls where the product is promoted on the store.">
        {check("trending", "Trending", "Shown in the homepage “Trending now” rail.")}
        {check("bestseller", "Bestseller", "Listed on the Best Sellers page and shows a Bestseller badge.")}
        {check("featured", "Featured", "Shown first in the shop and as the featured card in the mega-menu.")}
        {check("refundable", "Refundable", "Shows the product as refundable; otherwise customers must accept the no-refund policy.")}
        <FormField label="Badges" htmlFor="pg-badges" hint="Comma separated short labels, e.g. new, hot, instant." error={errors.badges}>
          <input {...text("badges")} />
        </FormField>
        <FormField label="Tags" htmlFor="pg-tags" hint="Comma separated search keywords (not shown)." error={errors.tags}>
          <input {...text("tags")} />
        </FormField>
      </Section>

      <Section title="Images">
        <FormField
          label="Artwork key"
          htmlFor="pg-artwork_key"
          required
          hint="Built-in artwork used when no image is uploaded (e.g. psn, steam)."
          error={errors.artwork_key}
        >
          <input {...text("artwork_key", { mono: true })} />
        </FormField>
        <FormField
          label="Image URL"
          htmlFor="pg-image_url"
          hint="Optional external image. An uploaded primary image (Media tab) takes priority."
          error={errors.image_url}
        >
          <input {...text("image_url", { mono: true })} />
        </FormField>
      </Section>

      <Section title="Descriptions">
        <FormField label="Short description (EN)" htmlFor="pg-short_description_en" hint="One or two lines under the title." error={errors.short_description_en}>
          <textarea {...area("short_description_en")} />
        </FormField>
        <FormField label="Short description (AR)" htmlFor="pg-short_description_ar" error={errors.short_description_ar}>
          <textarea {...area("short_description_ar", true)} />
        </FormField>
        <FormField label="Full description (EN)" htmlFor="pg-description_en" error={errors.description_en}>
          <textarea {...area("description_en")} />
        </FormField>
        <FormField label="Full description (AR)" htmlFor="pg-description_ar" error={errors.description_ar}>
          <textarea {...area("description_ar", true)} />
        </FormField>
        <FormField label="Redeem instructions (EN)" htmlFor="pg-instructions_en" hint="How to redeem, shown on the product page." error={errors.instructions_en}>
          <textarea {...area("instructions_en")} />
        </FormField>
        <FormField label="Redeem instructions (AR)" htmlFor="pg-instructions_ar" error={errors.instructions_ar}>
          <textarea {...area("instructions_ar", true)} />
        </FormField>
        <FormField label="How to use — steps (EN)" htmlFor="pg-how_to_use_en" hint="One step per line." error={errors.how_to_use_en}>
          <textarea {...area("how_to_use_en")} />
        </FormField>
        <FormField label="How to use — steps (AR)" htmlFor="pg-how_to_use_ar" hint="One step per line." error={errors.how_to_use_ar}>
          <textarea {...area("how_to_use_ar", true)} />
        </FormField>
      </Section>

      <Section title="Region, delivery & refunds">
        <FormField label="Region warning (EN)" htmlFor="pg-region_warning_en" hint="Warning shown on the product page, e.g. “US accounts only”." error={errors.region_warning_en}>
          <textarea {...area("region_warning_en")} />
        </FormField>
        <FormField label="Region warning (AR)" htmlFor="pg-region_warning_ar" error={errors.region_warning_ar}>
          <textarea {...area("region_warning_ar", true)} />
        </FormField>
        <FormField label="Region restrictions (EN)" htmlFor="pg-region_restrictions_en" hint="Longer explanation on the product page." error={errors.region_restrictions_en}>
          <textarea {...area("region_restrictions_en")} />
        </FormField>
        <FormField label="Region restrictions (AR)" htmlFor="pg-region_restrictions_ar" error={errors.region_restrictions_ar}>
          <textarea {...area("region_restrictions_ar", true)} />
        </FormField>
        <FormField label="Delivery estimate (EN)" htmlFor="pg-delivery_estimate_en" hint="e.g. “Instant” or “Within 30 minutes”." error={errors.delivery_estimate_en}>
          <input {...text("delivery_estimate_en")} maxLength={255} />
        </FormField>
        <FormField label="Delivery estimate (AR)" htmlFor="pg-delivery_estimate_ar" error={errors.delivery_estimate_ar}>
          <input {...text("delivery_estimate_ar", { rtl: true })} maxLength={255} />
        </FormField>
        <FormField label="Refund policy (EN)" htmlFor="pg-refund_policy_en" hint="Product-specific refund note. Empty = store default policy." error={errors.refund_policy_en}>
          <textarea {...area("refund_policy_en")} />
        </FormField>
        <FormField label="Refund policy (AR)" htmlFor="pg-refund_policy_ar" error={errors.refund_policy_ar}>
          <textarea {...area("refund_policy_ar", true)} />
        </FormField>
      </Section>
    </div>
  );
}
