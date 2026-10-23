"use client";

import { adminErrorMessage } from "@/components/admin/lib/errors";
import { AdminCard, AdminSectionHeader } from "@/components/admin/ui/card";
import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { useAdminQuery } from "@/hooks/use-admin-query";
import {
  createProduct,
  fetchAllPages,
  listCategories,
  listPlatforms,
} from "@/lib/api/admin";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function ProductNewClient() {
  const router = useRouter();
  const toast = useAdminToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [slug, setSlug] = useState("");
  const [id, setId] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [idTouched, setIdTouched] = useState(false);

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

  const derived = slugify(nameEn);
  const effectiveSlug = slugTouched ? slug : derived;
  const effectiveId = idTouched ? id : derived || "";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      setError("Missing admin session token.");
      return;
    }
    setPending(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const categoryId = String(fd.get("category_id") ?? "");
    const platformId = String(fd.get("platform_id") ?? "");
    const productId = String(fd.get("id") ?? "").trim();
    const productSlug = String(fd.get("slug") ?? "").trim();
    try {
      const product = await createProduct(token, {
        id: productId,
        slug: productSlug,
        name_en: String(fd.get("name_en") ?? ""),
        name_ar: String(fd.get("name_ar") ?? ""),
        kind: String(fd.get("kind") ?? "WALLET"),
        fulfillment_type: String(fd.get("fulfillment_type") ?? "CODE"),
        category_id: Number(categoryId),
        platform_id: Number(platformId),
        brand: String(fd.get("brand") ?? ""),
        artwork_key: String(fd.get("artwork_key") || productSlug || productId),
        status: "DRAFT",
        short_description_en: String(fd.get("short_description_en") ?? ""),
        source: "MANUAL",
      });
      toast.push("Product created", "success");
      router.push(`/admin/products/${product.slug || product.id}`);
    } catch (err) {
      setError(adminErrorMessage(err, "Failed to create product"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="New product"
        description="Add a catalog product. You can finish variants, media, and inventory on the next screen."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/products" className="admin-btn admin-btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              form="new-product-form"
              disabled={pending || metaLoading}
              className="admin-btn admin-btn-primary"
            >
              {pending ? "Creating…" : "Create product"}
            </button>
          </div>
        }
      />

      <form id="new-product-form" onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <AdminCard padding="md">
            <AdminSectionHeader
              title="Identity"
              description="Customer-facing name and stable identifiers."
            />
            <div className="space-y-3.5">
              <FormField label="Name (EN)" htmlFor="name_en" required>
                <input
                  id="name_en"
                  name="name_en"
                  required
                  autoFocus
                  placeholder="e.g. PlayStation Store Gift Card"
                  className={adminInputClass}
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                />
              </FormField>
              <FormField label="Name (AR)" htmlFor="name_ar">
                <input
                  id="name_ar"
                  name="name_ar"
                  className={adminInputClass}
                  dir="rtl"
                  placeholder="الاسم بالعربية"
                />
              </FormField>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <FormField
                  label="Product ID"
                  htmlFor="id"
                  required
                  hint="Permanent key — choose carefully"
                >
                  <input
                    id="id"
                    name="id"
                    required
                    className={`${adminInputClass} font-mono text-[13px]`}
                    value={effectiveId}
                    onChange={(e) => {
                      setIdTouched(true);
                      setId(e.target.value);
                    }}
                  />
                </FormField>
                <FormField label="Slug" htmlFor="slug" required hint="Used in storefront URLs">
                  <input
                    id="slug"
                    name="slug"
                    required
                    className={`${adminInputClass} font-mono text-[13px]`}
                    value={effectiveSlug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value);
                    }}
                  />
                </FormField>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <FormField label="Brand" htmlFor="brand" required>
                  <input
                    id="brand"
                    name="brand"
                    required
                    placeholder="PlayStation, Steam, …"
                    className={adminInputClass}
                  />
                </FormField>
                <FormField
                  label="Artwork key"
                  htmlFor="artwork_key"
                  hint="Defaults to slug if empty"
                >
                  <input
                    id="artwork_key"
                    name="artwork_key"
                    className={adminInputClass}
                    placeholder="auto from slug"
                  />
                </FormField>
              </div>
            </div>
          </AdminCard>

          <AdminCard padding="md">
            <AdminSectionHeader
              title="Classification"
              description="Where this product sits in the catalog."
            />
            <div className="grid gap-3.5 sm:grid-cols-2">
              <FormField label="Category" htmlFor="category_id" required>
                <select
                  id="category_id"
                  name="category_id"
                  required
                  className={adminInputClass}
                  defaultValue=""
                  disabled={metaLoading}
                >
                  <option value="" disabled>
                    {metaLoading ? "Loading…" : "Select category"}
                  </option>
                  {categories.map((c) => (
                    <option key={String(c.id)} value={String(c.id)}>
                      {c.name_en}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Platform" htmlFor="platform_id" required>
                <select
                  id="platform_id"
                  name="platform_id"
                  required
                  className={adminInputClass}
                  defaultValue=""
                  disabled={metaLoading}
                >
                  <option value="" disabled>
                    {metaLoading ? "Loading…" : "Select platform"}
                  </option>
                  {platforms.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>
                      {p.name_en}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Kind" htmlFor="kind">
                <select id="kind" name="kind" className={adminInputClass} defaultValue="WALLET">
                  <option value="GIFT_CARD">Gift card</option>
                  <option value="WALLET">Wallet</option>
                  <option value="GAME_CURRENCY">Game currency</option>
                  <option value="SUBSCRIPTION">Subscription</option>
                  <option value="DIRECT_TOPUP">Direct top-up</option>
                  <option value="DIGITAL_CODE">Digital code</option>
                </select>
              </FormField>
              <FormField label="Fulfillment" htmlFor="fulfillment_type">
                <select
                  id="fulfillment_type"
                  name="fulfillment_type"
                  className={adminInputClass}
                  defaultValue="CODE"
                >
                  <option value="CODE">Code delivery</option>
                  <option value="DIRECT_TOPUP">Direct top-up</option>
                </select>
              </FormField>
            </div>
          </AdminCard>

          <AdminCard padding="md">
            <AdminSectionHeader
              title="Description"
              description="Short copy shown on listing and product pages."
            />
            <FormField label="Short description (EN)" htmlFor="short_description_en">
              <textarea
                id="short_description_en"
                name="short_description_en"
                rows={4}
                placeholder="Brief product summary for customers…"
                className={adminTextareaClass}
              />
            </FormField>
          </AdminCard>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          <AdminCard padding="md">
            <AdminSectionHeader title="After create" />
            <ul className="space-y-2 text-[12px] leading-relaxed text-[var(--clicks-muted)]">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--clicks-blue)]" />
                Add variants and pricing
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--clicks-blue)]" />
                Upload product media
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--clicks-blue)]" />
                Import or map digital codes
              </li>
            </ul>
          </AdminCard>

          {error ? (
            <div className="rounded-[var(--admin-radius)] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-800">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <button
              type="submit"
              disabled={pending || metaLoading}
              className="admin-btn admin-btn-primary w-full"
            >
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
