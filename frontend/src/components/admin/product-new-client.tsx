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
import { ChoiceCards, EditorSection } from "@/components/admin/product/editor-ui";
import { FormErrorSummary, FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { ArrowLeft, KeyRound, Zap } from "lucide-react";
import { useAdminToast } from "@/components/admin/ui/toast";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { createProduct, fetchAllPages, listCategories, listPlatforms } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { categoryTreeOptions } from "@/components/admin/lib/category-tree";

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
    <div className="mx-auto max-w-3xl pb-6">
      <Link
        href="/admin/products"
        className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--clicks-muted)] hover:text-[var(--clicks-navy)]"
      >
        <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        Products
      </Link>
      <div className="mb-5">
        <h1 className="text-[1.25rem] font-semibold tracking-tight text-[var(--clicks-navy)]">New product</h1>
        <p className="mt-1 text-[13px] text-[var(--clicks-muted)]">
          Just the basics. Prices, photos and codes come on the next screen. It stays hidden until you make it Live.
        </p>
      </div>

      <form id="new-product-form" onSubmit={onSubmit} noValidate className="space-y-5">
        <FormErrorSummary errors={errors} labels={{ ...GENERAL_FIELD_LABELS, id: "Web address" }} idFor={(k) => FIELD_IDS[k]} />
        {formError ? (
          <div role="alert" className="rounded-[var(--admin-radius)] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-800">
            {formError}
          </div>
        ) : null}

        <EditorSection title="1. What are you selling?">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
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
              <FormField label="Name (Arabic)" htmlFor="np-name_ar" optional hint="You can add it later.">
                <input
                  id="np-name_ar"
                  className={adminInputClass}
                  dir="rtl"
                  placeholder="الاسم بالعربية"
                  value={form.name_ar}
                  onChange={(e) => set({ name_ar: e.target.value })}
                />
              </FormField>
            </div>
            <div className="space-y-1.5">
              <p className="text-[12px] font-medium text-[var(--clicks-text)]">How does the customer receive it?</p>
              <ChoiceCards
                name="np-fulfillment_type"
                value={form.fulfillment_type as "CODE" | "DIRECT_TOPUP"}
                onChange={(fulfillment_type) => set(reconcileKindFulfillment(form, { fulfillment_type }))}
                options={[
                  {
                    value: "CODE",
                    label: "A code",
                    hint: "Gift cards and game codes, sent from your code stock.",
                    icon: <KeyRound className="h-3.5 w-3.5" aria-hidden />,
                  },
                  {
                    value: "DIRECT_TOPUP",
                    label: "A top-up",
                    hint: "Credited to their game account using the Player ID they enter.",
                    icon: <Zap className="h-3.5 w-3.5" aria-hidden />,
                  },
                ]}
              />
            </div>
          </div>
        </EditorSection>

        <EditorSection title="2. Where does it appear?">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Category" htmlFor="np-category_id" required error={errors.category_id}>
              <select
                id="np-category_id"
                className={adminInputClass}
                value={form.category_id}
                disabled={metaLoading}
                onChange={(e) => set({ category_id: e.target.value })}
              >
                <option value="">{metaLoading ? "Loading…" : "Choose a category…"}</option>
                {categoryTreeOptions(categories).map(({ category: c, label }) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {label}
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
            <FormField label="Type" htmlFor="np-kind" hint="Used by the store's filters." error={errors.kind}>
              <select id="np-kind" className={adminInputClass} value={form.kind} onChange={(e) => set(reconcileKindFulfillment(form, { kind: e.target.value }))}>
                {PRODUCT_KINDS.filter((k) => allowedKinds.has(k.value)).map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Brand" htmlFor="np-brand" optional hint="Shown above the name. Empty = the platform name." error={errors.brand}>
              <input
                id="np-brand"
                placeholder={platform?.name_en || "PlayStation, Steam, …"}
                className={adminInputClass}
                value={form.brand}
                onChange={(e) => set({ brand: e.target.value })}
              />
            </FormField>
          </div>
          <details className="mt-4 rounded-lg border border-dashed border-[var(--clicks-border)] px-3 py-2" open={Boolean(errors.slug)}>
            <summary className="cursor-pointer text-[12px] font-medium text-[var(--clicks-navy)]">
              Web address: <span className="font-mono font-normal text-[var(--clicks-muted)]">/product/{slug || "…"}</span>
            </summary>
            <div className="mt-2">
              <FormField label="Web address" htmlFor="np-slug" optional hint="Filled in from the English name. Change it only if needed." error={errors.slug}>
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
          </details>
        </EditorSection>

        <div className="rounded-xl border border-[var(--clicks-border)] bg-[#F8F9FC] px-5 py-4">
          <p className="text-[12px] font-semibold text-[var(--clicks-navy)]">Next, on the product page</p>
          <ol className="mt-1.5 grid gap-1 text-[12px] text-[var(--clicks-muted)] sm:grid-cols-2">
            <li>① Add options with prices (e.g. $10, $25)</li>
            <li>② Upload a photo</li>
            <li>③ {form.fulfillment_type === "CODE" ? "Import codes for each option" : "Add the Player ID checkout detail"}</li>
            <li>④ Switch Visibility to Live</li>
          </ol>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Link href="/admin/products" className="admin-btn admin-btn-secondary">
            Cancel
          </Link>
          <button type="submit" disabled={pending || metaLoading} className="admin-btn admin-btn-primary">
            {pending ? "Creating…" : "Create product"}
          </button>
        </div>
      </form>
    </div>
  );
}
