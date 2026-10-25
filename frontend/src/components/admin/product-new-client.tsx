"use client";

import { useUnsavedChangesGuard } from "@/components/admin/layout/navigation-guard";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import {
  GENERAL_FIELD_LABELS,
  PRODUCT_KINDS,
  generalServerErrors,
  kindFulfillmentIssue,
  kindsForFulfillment,
  reconcileKindFulfillment,
} from "@/components/admin/lib/product-form";
import { autoSlug, isValidSlug } from "@/components/admin/lib/slugify";
import { AdminCard, AdminSectionHeader } from "@/components/admin/ui/card";
import { FormErrorSummary, FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { createProduct, fetchAllPages, listCategories, listPlatforms } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const EMPTY = {
  name_en: "",
  name_ar: "",
  slug: "",
  brand: "",
  artwork_key: "",
  category_id: "",
  platform_id: "",
  kind: "GIFT_CARD",
  fulfillment_type: "CODE",
  short_description_en: "",
};

type Form = typeof EMPTY;

const FIELD_IDS: Record<string, string> = {
  name_en: "np-name_en",
  name_ar: "np-name_ar",
  slug: "np-slug",
  id: "np-slug",
  brand: "np-brand",
  artwork_key: "np-artwork_key",
  category_id: "np-category_id",
  platform_id: "np-platform_id",
  kind: "np-kind",
  fulfillment_type: "np-fulfillment_type",
};

export function ProductNewClient() {
  const router = useRouter();
  const toast = useAdminToast();
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [created, setCreated] = useState(false);

  const { data: meta, token, loading: metaLoading } = useAdminQuery(async (tok) => {
    try {
      const [categories, platforms] = await Promise.all([
        fetchAllPages((params) => listCategories(tok, params)),
        fetchAllPages((params) => listPlatforms(tok, params)),
      ]);
      return { categories, platforms };
    } catch {
      return { categories: [], platforms: [] };
    }
  });

  const categories = meta?.categories ?? [];
  const platforms = meta?.platforms ?? [];
  const slug = autoSlug(form.name_en, form.slug, slugTouched);
  const platform = platforms.find((p) => String(p.id) === form.platform_id);
  const allowedKinds = new Set(kindsForFulfillment(form.fulfillment_type));
  const dirty = !created && JSON.stringify(form) !== JSON.stringify(EMPTY);
  useUnsavedChangesGuard("product-new", dirty);

  function set(patch: Partial<Form>) {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const keys = Object.keys(patch).filter((k) => k in e);
      if (!keys.length) return e;
      const next = { ...e };
      keys.forEach((k) => delete next[k]);
      return next;
    });
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form.name_en.trim()) e.name_en = "Enter the product name in English — it is shown on the store.";
    if (slug && !isValidSlug(slug)) e.slug = "Use only lowercase letters, numbers and dashes, e.g. steam-card-10.";
    if (!form.category_id) e.category_id = "Choose the category the product appears in.";
    if (!form.platform_id) e.platform_id = "Choose the platform (PlayStation, Steam, PUBG…).";
    const issue = kindFulfillmentIssue(form.kind, form.fulfillment_type);
    if (issue) e.kind = issue;
    return e;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      setFormError("Your session has expired. Sign in again.");
      return;
    }
    const local = validate();
    setErrors(local);
    setFormError("");
    if (Object.keys(local).length) return;
    setPending(true);
    try {
      const product = await createProduct(token, {
        // Product ID is created by the server from the slug.
        slug: slug.trim(),
        name_en: form.name_en.trim(),
        name_ar: form.name_ar.trim(),
        kind: form.kind,
        fulfillment_type: form.fulfillment_type,
        category_id: Number(form.category_id),
        platform_id: Number(form.platform_id),
        brand: form.brand.trim(),
        artwork_key: form.artwork_key.trim(),
        status: "DRAFT",
        short_description_en: form.short_description_en,
        source: "MANUAL",
      });
      setCreated(true);
      toast.push("Product created as a draft — now add its variants and prices", "success");
      router.push(`/admin/products/${product.slug || product.id}`);
    } catch (err) {
      const fieldErrs = generalServerErrors(err instanceof ApiError ? err.body : null);
      if (fieldErrs.id && !fieldErrs.slug) {
        fieldErrs.slug = "A product with this web address already exists — choose another.";
        delete fieldErrs.id;
      }
      setErrors(fieldErrs);
      setFormError(Object.keys(fieldErrs).length ? "" : adminErrorMessage(err, "The product could not be created."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="New product"
        description="Start with the basics. On the next screen you add variants (prices), photos and codes. The product stays hidden (draft) until you publish it."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/products" className="admin-btn admin-btn-secondary">
              Cancel
            </Link>
            <button type="submit" form="new-product-form" disabled={pending || metaLoading} className="admin-btn admin-btn-primary">
              {pending ? "Creating…" : "Create product"}
            </button>
          </div>
        }
      />

      <form id="new-product-form" onSubmit={onSubmit} noValidate className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <FormErrorSummary errors={errors} labels={{ ...GENERAL_FIELD_LABELS, id: "Web address (slug)" }} idFor={(k) => FIELD_IDS[k]} />
          {formError ? (
            <div role="alert" className="rounded-[var(--admin-radius)] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-800">
              {formError}
            </div>
          ) : null}

          <AdminCard padding="md">
            <AdminSectionHeader title="Name" description="Fields marked * are required." />
            <div className="space-y-3.5">
              <FormField label="Name (English)" htmlFor="np-name_en" required error={errors.name_en}>
                <input
                  id="np-name_en"
                  autoFocus
                  placeholder="e.g. PlayStation Store Gift Card"
                  className={adminInputClass}
                  value={form.name_en}
                  onChange={(e) => set({ name_en: e.target.value })}
                />
              </FormField>
              <FormField label="Name (Arabic)" htmlFor="np-name_ar" optional hint="Shown on the Arabic store. Falls back to English.">
                <input
                  id="np-name_ar"
                  className={adminInputClass}
                  dir="rtl"
                  placeholder="الاسم بالعربية"
                  value={form.name_ar}
                  onChange={(e) => set({ name_ar: e.target.value })}
                />
              </FormField>
              <FormField
                label="Web address (slug)"
                htmlFor="np-slug"
                optional
                hint={
                  <>
                    Filled in from the English name. The page will be{" "}
                    <span className="font-mono">/product/{slug || "…"}</span>
                    {!slug ? " (created automatically when you save)" : ""}.
                  </>
                }
                error={errors.slug}
              >
                <input
                  id="np-slug"
                  className={`${adminInputClass} font-mono text-[13px]`}
                  value={slug}
                  placeholder="auto"
                  onChange={(e) => {
                    setSlugTouched(true);
                    set({ slug: e.target.value.toLowerCase() });
                  }}
                />
              </FormField>
            </div>
          </AdminCard>

          <AdminCard padding="md">
            <AdminSectionHeader title="Where it appears" description="Category and platform decide where shoppers find it." />
            <div className="grid gap-3.5 sm:grid-cols-2">
              <FormField label="Category" htmlFor="np-category_id" required error={errors.category_id}>
                <select
                  id="np-category_id"
                  className={adminInputClass}
                  value={form.category_id}
                  disabled={metaLoading}
                  onChange={(e) => set({ category_id: e.target.value })}
                >
                  <option value="">{metaLoading ? "Loading…" : "Choose a category…"}</option>
                  {categories.map((c) => (
                    <option key={String(c.id)} value={String(c.id)}>
                      {c.name_en}
                      {c.status !== "PUBLISHED" ? ` (${c.status.toLowerCase()})` : ""}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Platform" htmlFor="np-platform_id" required error={errors.platform_id}>
                <select
                  id="np-platform_id"
                  className={adminInputClass}
                  value={form.platform_id}
                  disabled={metaLoading}
                  onChange={(e) => set({ platform_id: e.target.value })}
                >
                  <option value="">{metaLoading ? "Loading…" : "Choose a platform…"}</option>
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
                htmlFor="np-fulfillment_type"
                hint={
                  form.fulfillment_type === "CODE"
                    ? "The customer receives a code from your code stock (gift cards, game codes)."
                    : "You or a supplier credit the player's account with the ID the customer enters."
                }
                error={errors.fulfillment_type}
              >
                <select
                  id="np-fulfillment_type"
                  className={adminInputClass}
                  value={form.fulfillment_type}
                  onChange={(e) => set(reconcileKindFulfillment(form, { fulfillment_type: e.target.value }))}
                >
                  <option value="CODE">Code delivery</option>
                  <option value="DIRECT_TOPUP">Direct top-up to the player&apos;s account</option>
                </select>
              </FormField>
              <FormField label="Kind" htmlFor="np-kind" hint="Groups the product in store filters." error={errors.kind}>
                <select
                  id="np-kind"
                  className={adminInputClass}
                  value={form.kind}
                  onChange={(e) => set(reconcileKindFulfillment(form, { kind: e.target.value }))}
                >
                  {PRODUCT_KINDS.filter((k) => allowedKinds.has(k.value)).map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label} — {k.hint}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                label="Brand"
                htmlFor="np-brand"
                optional
                hint={`Shown above the name. Empty = the platform name${platform ? ` (${platform.name_en})` : ""}.`}
                error={errors.brand}
              >
                <input
                  id="np-brand"
                  placeholder={platform?.name_en || "PlayStation, Steam, …"}
                  className={adminInputClass}
                  value={form.brand}
                  onChange={(e) => set({ brand: e.target.value })}
                />
              </FormField>
              <FormField
                label="Built-in artwork"
                htmlFor="np-artwork_key"
                optional
                hint="Only used until you upload a photo. Leave empty if unsure — you can upload photos on the next screen."
                error={errors.artwork_key}
              >
                <input
                  id="np-artwork_key"
                  className={`${adminInputClass} font-mono`}
                  placeholder="e.g. psn"
                  value={form.artwork_key}
                  onChange={(e) => set({ artwork_key: e.target.value })}
                />
              </FormField>
            </div>
          </AdminCard>

          <AdminCard padding="md">
            <AdminSectionHeader title="Short description" description="One or two lines shown under the title." />
            <FormField label="Short description (English)" htmlFor="np-short_description_en" optional>
              <textarea
                id="np-short_description_en"
                rows={4}
                placeholder="Brief product summary for customers…"
                className={adminTextareaClass}
                value={form.short_description_en}
                onChange={(e) => set({ short_description_en: e.target.value })}
              />
            </FormField>
          </AdminCard>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          <AdminCard padding="md">
            <AdminSectionHeader title="Next steps" />
            <ol className="list-decimal space-y-2 ps-4 text-[12px] leading-relaxed text-[var(--clicks-muted)]">
              <li>Add variants with prices (e.g. $10, $25).</li>
              <li>Upload a photo.</li>
              <li>{form.fulfillment_type === "CODE" ? "Import codes for each variant." : "Add the required customer details (Player ID…)."}</li>
              <li>Set the status to Published.</li>
            </ol>
          </AdminCard>

          <div className="flex flex-col gap-2">
            <button type="submit" disabled={pending || metaLoading} className="admin-btn admin-btn-primary w-full">
              {pending ? "Creating…" : "Create product"}
            </button>
            <Link href="/admin/products" className="admin-btn admin-btn-secondary w-full">
              Cancel
            </Link>
          </div>
        </aside>
      </form>
    </div>
  );
}
