"use client";

import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass, adminTextareaClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { useAdminQuery } from "@/hooks/use-admin-query";
import {
  asList,
  createProductMapping,
  deleteMediaAsset,
  deleteProduct,
  deleteSupplierMapping,
  duplicateProduct,
  getProduct,
  listCategories,
  listPlatforms,
  listRegions,
  listSuppliers,
  reorderProductMedia,
  updateMediaAsset,
  updateProduct,
  uploadProductMedia,
  type AdminMediaAsset,
  type AdminProductField,
  type AdminSupplierMapping,
  type AdminVariant,
} from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import { resolveMediaUrl } from "@/lib/media";
import { formatFils, jodToFils } from "@/server/money";
import { hasPermission } from "@/server/auth/permissions";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type DraftVariant = AdminVariant & { delete?: boolean; price_jod_input?: string };
type DraftField = AdminProductField & { delete?: boolean };

const SECTIONS = [
  { id: "general", label: "General" },
  { id: "media", label: "Media" },
  { id: "variants", label: "Variants" },
  { id: "fields", label: "Required fields" },
  { id: "supplier", label: "Supplier mapping" },
] as const;

function filsFromJodInput(value: string): number {
  const cleaned = value.trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) throw new Error("Invalid price");
  return jodToFils(n);
}

export function ProductDetailClient({ id }: { id: string }) {
  const toast = useAdminToast();
  const router = useRouter();
  const session = useSession();
  const canWrite = hasPermission(session.data?.user?.permissions, "catalog.write", session.data?.user?.role);
  const canMap = hasPermission(session.data?.user?.permissions, "suppliers.write", session.data?.user?.role);
  const canImport = hasPermission(session.data?.user?.permissions, "codes.manage", session.data?.user?.role);

  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("general");
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [fields, setFields] = useState<DraftField[]>([]);
  const [media, setMedia] = useState<AdminMediaAsset[]>([]);
  const [mappings, setMappings] = useState<AdminSupplierMapping[]>([]);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [mappingForm, setMappingForm] = useState({
    supplier_id: "",
    variant_id: "",
    external_product_id: "",
    external_name: "",
  });

  const { data, setData, loading, error, reload, token } = useAdminQuery(async (tok) => {
    const [prod, cats, plats, regs, sups] = await Promise.all([
      getProduct(tok, id),
      listCategories(tok, { page_size: 200 }),
      listPlatforms(tok, { page_size: 200 }),
      listRegions(tok, { page_size: 200 }),
      listSuppliers(tok, { page_size: 100 }),
    ]);
    return {
      product: prod,
      categories: asList(cats).items,
      platforms: asList(plats).items,
      regions: asList(regs).items,
      suppliers: asList(sups).items,
    };
  }, [id]);

  const product = data?.product ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!product) return;
      await Promise.resolve();
      if (cancelled) return;
      setVariants(
        (product.variants ?? []).map((v) => ({
          ...v,
          price_jod_input: formatFils(v.price_fils),
        })),
      );
      setFields([...(product.fields ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
      setMedia([...(product.media ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
      setMappings([...(product.supplier_mappings ?? [])]);
      setDirty(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [product]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const categories = data?.categories ?? [];
  const platforms = data?.platforms ?? [];
  const regions = data?.regions ?? [];
  const suppliers = data?.suppliers ?? [];

  const activeVariants = useMemo(() => variants.filter((v) => !v.delete), [variants]);

  if (loading) {
    return <div className="admin-card h-48 animate-pulse" />;
  }
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!product) return <EmptyState title="Product not found" />;

  function markDirty() {
    setDirty(true);
  }

  async function saveGeneral(form: HTMLFormElement) {
    if (!token) return;
    setPending(true);
    const fd = new FormData(form);
    try {
      const variantPayload = variants.map((v, idx) => {
        if (v.delete && v.id) return { id: Number(v.id), delete: true, sku: v.sku, price_fils: v.price_fils };
        let price_fils = v.price_fils;
        try {
          price_fils = filsFromJodInput(v.price_jod_input ?? formatFils(v.price_fils));
        } catch {
          throw new Error(`Invalid price on variant ${v.sku || idx + 1}`);
        }
        return {
          id: v.id ? Number(v.id) : undefined,
          sku: v.sku,
          name_en: v.name_en || v.sku,
          name_ar: v.name_ar || "",
          denomination: v.denomination ?? 0,
          package_value: v.package_value || String(v.denomination ?? ""),
          package_currency: v.package_currency || "USD",
          price_fils,
          cost_fils: v.cost_fils ?? 0,
          compare_at_price_fils: v.compare_at_price_fils ?? null,
          published: Boolean(v.published),
          sort_order: v.sort_order ?? idx,
          region: v.region ?? null,
          stock_status: v.stock_status || "IN_STOCK",
          external_id: v.external_id || "",
        };
      });

      const fieldPayload = fields.map((f, idx) => {
        if (f.delete && f.id) return { id: Number(f.id), delete: true, key: f.key, label_en: f.label_en || f.key, type: f.type, required: f.required };
        return {
          id: f.id ? Number(f.id) : undefined,
          key: f.key,
          type: f.type || "TEXT",
          required: Boolean(f.required),
          sort_order: f.sort_order ?? idx,
          label_en: f.label_en || f.key,
          label_ar: f.label_ar || "",
          placeholder_en: f.placeholder_en || "",
          placeholder_ar: f.placeholder_ar || "",
          help_text_en: f.help_text_en || "",
          help_text_ar: f.help_text_ar || "",
        };
      });

      const updated = await updateProduct(token, product!.slug, {
        name_en: String(fd.get("name_en") ?? ""),
        name_ar: String(fd.get("name_ar") ?? ""),
        brand: String(fd.get("brand") ?? ""),
        artwork_key: String(fd.get("artwork_key") ?? product!.artwork_key ?? ""),
        category_id: Number(fd.get("category_id")),
        platform_id: Number(fd.get("platform_id")),
        kind: String(fd.get("kind") ?? product!.kind),
        fulfillment_type: String(fd.get("fulfillment_type") ?? product!.fulfillment_type ?? "CODE"),
        status: String(fd.get("status") ?? product!.status),
        featured: Boolean(fd.get("featured")),
        bestseller: Boolean(fd.get("bestseller")),
        trending: Boolean(fd.get("trending")),
        short_description_en: String(fd.get("short_description_en") ?? ""),
        description_en: String(fd.get("description_en") ?? ""),
        slug: String(fd.get("slug") ?? product!.slug),
        variants: variantPayload as never,
        fields: fieldPayload as never,
      });
      setData((prev) => (prev ? { ...prev, product: updated } : prev));
      setDirty(false);
      toast.push("Product saved", "success");
      if (updated.slug !== product!.slug) {
        router.replace(`/admin/products/${updated.slug}`);
      }
    } catch (err) {
      toast.push(err instanceof ApiError || err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={product.name_en}
        description={product.slug}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/product/${product.slug}`}
              target="_blank"
              rel="noreferrer"
              className="admin-btn admin-btn-secondary"
            >
              View on storefront
            </a>
            {canWrite ? (
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={async () => {
                  if (!token) return;
                  try {
                    const copy = await duplicateProduct(token, product.slug, false);
                    toast.push("Product duplicated as draft", "success");
                    router.push(`/admin/products/${copy.slug}`);
                  } catch (err) {
                    toast.push(err instanceof ApiError ? err.message : "Duplicate failed", "error");
                  }
                }}
              >
                Duplicate
              </button>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="admin-btn admin-btn-secondary text-amber-800"
                onClick={() => setConfirmArchive(true)}
              >
                Archive
              </button>
            ) : null}
            <Link href="/admin/products" className="text-sm font-medium text-[var(--clicks-blue)]">
              Back
            </Link>
          </div>
        }
      />

      <div className="admin-card mb-4 flex flex-wrap gap-1 p-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`h-8 rounded-[var(--admin-radius-sm)] px-3 text-[12px] font-semibold transition ${
              section === s.id
                ? "bg-[var(--clicks-blue)] text-white shadow-sm"
                : "text-[var(--clicks-muted)] hover:bg-[#F3F5F9] hover:text-[var(--clicks-navy)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canWrite) return;
          void saveGeneral(e.currentTarget);
        }}
        onChange={() => markDirty()}
      >
        {section === "general" ? (
          <section className="admin-card p-4">
            <h2 className="mb-4 text-sm font-semibold text-[var(--clicks-navy)]">General</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Name (EN)" htmlFor="name_en" required>
                <input id="name_en" name="name_en" required className={adminInputClass} defaultValue={product.name_en} disabled={!canWrite} />
              </FormField>
              <FormField label="Name (AR)" htmlFor="name_ar">
                <input id="name_ar" name="name_ar" className={adminInputClass} defaultValue={product.name_ar ?? ""} dir="rtl" disabled={!canWrite} />
              </FormField>
              <FormField label="Slug" htmlFor="slug" required>
                <input id="slug" name="slug" required className={adminInputClass} defaultValue={product.slug} disabled={!canWrite} />
              </FormField>
              <FormField label="Brand" htmlFor="brand" required>
                <input id="brand" name="brand" required className={adminInputClass} defaultValue={product.brand ?? ""} disabled={!canWrite} />
              </FormField>
              <FormField label="Artwork key" htmlFor="artwork_key">
                <input id="artwork_key" name="artwork_key" className={adminInputClass} defaultValue={product.artwork_key ?? ""} disabled={!canWrite} />
              </FormField>
              <FormField label="Status" htmlFor="status">
                <select id="status" name="status" className={adminInputClass} defaultValue={product.status} disabled={!canWrite}>
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </FormField>
              <FormField label="Category" htmlFor="category_id" required>
                <select id="category_id" name="category_id" required className={adminInputClass} defaultValue={String(product.category_id ?? product.category?.id ?? "")} disabled={!canWrite}>
                  {categories.map((c) => (
                    <option key={String(c.id)} value={String(c.id)}>
                      {c.name_en}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Platform" htmlFor="platform_id" required>
                <select id="platform_id" name="platform_id" required className={adminInputClass} defaultValue={String(product.platform_id ?? product.platform?.id ?? "")} disabled={!canWrite}>
                  {platforms.map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>
                      {p.name_en}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Kind" htmlFor="kind">
                <select id="kind" name="kind" className={adminInputClass} defaultValue={product.kind} disabled={!canWrite}>
                  <option value="GIFT_CARD">Gift card</option>
                  <option value="WALLET">Wallet</option>
                  <option value="GAME_CURRENCY">Game currency</option>
                  <option value="SUBSCRIPTION">Subscription</option>
                  <option value="DIRECT_TOPUP">Direct top-up</option>
                  <option value="DIGITAL_CODE">Digital code</option>
                </select>
              </FormField>
              <FormField label="Fulfillment" htmlFor="fulfillment_type">
                <select id="fulfillment_type" name="fulfillment_type" className={adminInputClass} defaultValue={product.fulfillment_type ?? "CODE"} disabled={!canWrite}>
                  <option value="CODE">Code</option>
                  <option value="DIRECT_TOPUP">Direct top-up</option>
                </select>
              </FormField>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input name="featured" type="checkbox" defaultChecked={Boolean(product.featured)} disabled={!canWrite} />
                Featured
              </label>
              <label className="flex items-center gap-2">
                <input name="bestseller" type="checkbox" defaultChecked={Boolean(product.bestseller)} disabled={!canWrite} />
                Bestseller
              </label>
              <label className="flex items-center gap-2">
                <input name="trending" type="checkbox" defaultChecked={Boolean(product.trending)} disabled={!canWrite} />
                Trending
              </label>
            </div>
            <FormField label="Short description (EN)" htmlFor="short_description_en" className="mt-4">
              <textarea id="short_description_en" name="short_description_en" className={adminTextareaClass} defaultValue={product.short_description_en ?? ""} disabled={!canWrite} />
            </FormField>
            <FormField label="Description (EN)" htmlFor="description_en" className="mt-4">
              <textarea id="description_en" name="description_en" className={adminTextareaClass} defaultValue={product.description_en ?? ""} disabled={!canWrite} />
            </FormField>
          </section>
        ) : null}

        {section === "media" ? (
          <section className="admin-card p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Media gallery</h2>
              {canWrite ? (
                <label className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-[var(--clicks-blue)] px-3 text-sm font-semibold text-white">
                  Add images
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      if (!token || !e.target.files?.length) return;
                      setPending(true);
                      try {
                        for (const file of Array.from(e.target.files)) {
                          const asset = await uploadProductMedia(token, product.slug, file, {
                            is_primary: media.length === 0,
                          });
                          setMedia((prev) => [...prev, asset]);
                        }
                        markDirty();
                        await reload();
                        toast.push("Images uploaded", "success");
                      } catch (err) {
                        toast.push(err instanceof ApiError ? err.message : "Upload failed", "error");
                      } finally {
                        setPending(false);
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
              ) : null}
            </div>
            {media.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {media.map((asset, idx) => (
                  <div key={String(asset.id)} className="overflow-hidden rounded-xl border border-[var(--clicks-border)]">
                    <div className="relative aspect-square bg-[var(--clicks-bg)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={resolveMediaUrl(asset.url)} alt={asset.alt || ""} className="h-full w-full object-cover" />
                      {asset.is_primary ? (
                        <span className="absolute start-2 top-2 rounded bg-[var(--clicks-navy)] px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                          Primary
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-2 p-3">
                      <input
                        className={adminInputClass}
                        placeholder="Alt text"
                        defaultValue={asset.alt || ""}
                        disabled={!canWrite}
                        onBlur={async (e) => {
                          if (!token || !canWrite) return;
                          const alt = e.target.value;
                          try {
                            const updated = await updateMediaAsset(token, asset.id, { alt });
                            setMedia((prev) => prev.map((m) => (String(m.id) === String(asset.id) ? updated : m)));
                          } catch (err) {
                            toast.push(err instanceof ApiError ? err.message : "Could not update alt", "error");
                          }
                        }}
                      />
                      <div className="flex flex-wrap gap-2 text-xs">
                        {canWrite && !asset.is_primary ? (
                          <button
                            type="button"
                            className="font-medium text-[var(--clicks-blue)]"
                            onClick={async () => {
                              if (!token) return;
                              const updated = await updateMediaAsset(token, asset.id, { is_primary: true });
                              setMedia((prev) =>
                                prev.map((m) => ({
                                  ...m,
                                  is_primary: String(m.id) === String(updated.id),
                                })),
                              );
                              toast.push("Primary image set", "success");
                            }}
                          >
                            Set primary
                          </button>
                        ) : null}
                        {canWrite ? (
                          <button
                            type="button"
                            className="font-medium"
                            disabled={idx === 0}
                            onClick={async () => {
                              if (!token || idx === 0) return;
                              const ids = media.map((m) => m.id);
                              const next = [...ids];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              const ordered = await reorderProductMedia(token, product.slug, next);
                              setMedia(ordered);
                            }}
                          >
                            ←
                          </button>
                        ) : null}
                        {canWrite ? (
                          <button
                            type="button"
                            className="font-medium"
                            disabled={idx === media.length - 1}
                            onClick={async () => {
                              if (!token || idx >= media.length - 1) return;
                              const ids = media.map((m) => m.id);
                              const next = [...ids];
                              [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                              const ordered = await reorderProductMedia(token, product.slug, next);
                              setMedia(ordered);
                            }}
                          >
                            →
                          </button>
                        ) : null}
                        {canWrite ? (
                          <button
                            type="button"
                            className="font-medium text-red-600"
                            onClick={async () => {
                              if (!token) return;
                              await deleteMediaAsset(token, asset.id);
                              setMedia((prev) => prev.filter((m) => String(m.id) !== String(asset.id)));
                              toast.push("Image removed", "success");
                            }}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No images yet" description="Upload a primary product image to start the gallery." />
            )}
          </section>
        ) : null}

        {section === "variants" ? (
          <section className="admin-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">
                Variants
              </h2>
              {canWrite ? (
                <button
                  type="button"
                  className="h-9 rounded-lg border border-[var(--clicks-border)] px-3 text-sm font-medium"
                  onClick={() => {
                    const sku = `${product.id}-v${variants.length + 1}`;
                    setVariants((prev) => [
                      ...prev,
                      {
                        sku,
                        name_en: "New variant",
                        price_fils: 0,
                        price_jod_input: "0",
                        published: true,
                        package_value: "1",
                        package_currency: "USD",
                        denomination: "1",
                        sort_order: prev.length,
                      } as DraftVariant,
                    ]);
                    markDirty();
                  }}
                >
                  Add variant
                </button>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[var(--clicks-bg)] text-[11px] uppercase tracking-wide text-[var(--clicks-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-start">SKU</th>
                    <th className="px-3 py-2 text-start">Name</th>
                    <th className="px-3 py-2 text-start">Price (JOD)</th>
                    <th className="px-3 py-2 text-start">Region</th>
                    <th className="px-3 py-2 text-start">Available</th>
                    <th className="px-3 py-2 text-start">Reserved</th>
                    <th className="px-3 py-2 text-start">Delivered</th>
                    <th className="px-3 py-2 text-start">Low</th>
                    <th className="px-3 py-2 text-start">Active</th>
                    <th className="px-3 py-2 text-start"></th>
                  </tr>
                </thead>
                <tbody>
                  {activeVariants.map((v) => {
                    const idx = variants.findIndex((row) => row === v || (v.id && row.id === v.id));
                    return (
                      <tr key={String(v.id ?? v.sku)} className="border-t border-[var(--clicks-border)]">
                        <td className="px-3 py-2">
                          <input
                            className={`${adminInputClass} min-w-[120px] font-mono text-xs`}
                            value={v.sku}
                            disabled={!canWrite}
                            onChange={(e) => {
                              const sku = e.target.value;
                              setVariants((prev) => prev.map((row, i) => (i === idx ? { ...row, sku } : row)));
                              markDirty();
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={adminInputClass}
                            value={v.name_en || ""}
                            disabled={!canWrite}
                            onChange={(e) => {
                              const name_en = e.target.value;
                              setVariants((prev) => prev.map((row, i) => (i === idx ? { ...row, name_en } : row)));
                              markDirty();
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={`${adminInputClass} max-w-[110px]`}
                            value={v.price_jod_input ?? formatFils(v.price_fils)}
                            disabled={!canWrite}
                            onChange={(e) => {
                              const price_jod_input = e.target.value;
                              setVariants((prev) => prev.map((row, i) => (i === idx ? { ...row, price_jod_input } : row)));
                              markDirty();
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className={adminInputClass}
                            value={v.region ?? ""}
                            disabled={!canWrite}
                            onChange={(e) => {
                              const region = e.target.value ? Number(e.target.value) : null;
                              setVariants((prev) => prev.map((row, i) => (i === idx ? { ...row, region } : row)));
                              markDirty();
                            }}
                          >
                            <option value="">—</option>
                            {regions.map((r) => (
                              <option key={String(r.id)} value={String(r.id)}>
                                {r.name_en}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{v.codes_available ?? 0}</td>
                        <td className="px-3 py-2 tabular-nums">{v.codes_reserved ?? 0}</td>
                        <td className="px-3 py-2 tabular-nums">{v.codes_delivered ?? 0}</td>
                        <td className="px-3 py-2">{v.low_stock ? "Yes" : "No"}</td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(v.published)}
                            disabled={!canWrite}
                            onChange={(e) => {
                              const published = e.target.checked;
                              setVariants((prev) => prev.map((row, i) => (i === idx ? { ...row, published } : row)));
                              markDirty();
                            }}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {canImport && v.id ? (
                              <Link
                                href={`/admin/codes/import?variant=${encodeURIComponent(String(v.id))}`}
                                className="text-xs font-medium text-[var(--clicks-blue)]"
                              >
                                Import codes
                              </Link>
                            ) : null}
                            {v.id ? (
                              <Link
                                href={`/admin/codes?variant=${encodeURIComponent(String(v.id))}`}
                                className="text-xs text-[var(--clicks-muted)]"
                              >
                                View codes
                              </Link>
                            ) : null}
                            {canWrite ? (
                              <button
                                type="button"
                                className="text-xs text-red-600"
                                onClick={() => {
                                  setVariants((prev) =>
                                    prev.map((row, i) => (i === idx ? { ...row, delete: true, published: false } : row)),
                                  );
                                  markDirty();
                                }}
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!activeVariants.length ? <EmptyState title="No variants" description="Add a selling variant with SKU and price." /> : null}
          </section>
        ) : null}

        {section === "fields" ? (
          <section className="admin-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Required customer fields</h2>
              {canWrite ? (
                <button
                  type="button"
                  className="h-9 rounded-lg border border-[var(--clicks-border)] px-3 text-sm font-medium"
                  onClick={() => {
                    setFields((prev) => [
                      ...prev,
                      {
                        key: `field_${prev.length + 1}`,
                        type: "TEXT",
                        required: true,
                        label_en: "New field",
                        sort_order: prev.length,
                      },
                    ]);
                    markDirty();
                  }}
                >
                  Add field
                </button>
              ) : null}
            </div>
            <div className="space-y-3">
              {fields
                .filter((f) => !f.delete)
                .map((f) => {
                  const idx = fields.findIndex((row) => row === f || (f.id && row.id === f.id));
                  return (
                    <div key={String(f.id ?? f.key)} className="grid gap-3 rounded-lg border border-[var(--clicks-border)] p-3 sm:grid-cols-6">
                      <FormField label="Key" htmlFor={`fkey-${idx}`}>
                        <input
                          id={`fkey-${idx}`}
                          className={adminInputClass}
                          value={f.key}
                          disabled={!canWrite}
                          onChange={(e) => {
                            const key = e.target.value;
                            setFields((prev) => prev.map((row, i) => (i === idx ? { ...row, key } : row)));
                            markDirty();
                          }}
                        />
                      </FormField>
                      <FormField label="Label" htmlFor={`flabel-${idx}`}>
                        <input
                          id={`flabel-${idx}`}
                          className={adminInputClass}
                          value={f.label_en || ""}
                          disabled={!canWrite}
                          onChange={(e) => {
                            const label_en = e.target.value;
                            setFields((prev) => prev.map((row, i) => (i === idx ? { ...row, label_en } : row)));
                            markDirty();
                          }}
                        />
                      </FormField>
                      <FormField label="Type" htmlFor={`ftype-${idx}`}>
                        <select
                          id={`ftype-${idx}`}
                          className={adminInputClass}
                          value={f.type}
                          disabled={!canWrite}
                          onChange={(e) => {
                            const type = e.target.value;
                            setFields((prev) => prev.map((row, i) => (i === idx ? { ...row, type } : row)));
                            markDirty();
                          }}
                        >
                          <option value="TEXT">Text</option>
                          <option value="EMAIL">Email</option>
                          <option value="TEL">Tel</option>
                          <option value="SELECT">Select</option>
                        </select>
                      </FormField>
                      <FormField label="Placeholder" htmlFor={`fph-${idx}`}>
                        <input
                          id={`fph-${idx}`}
                          className={adminInputClass}
                          value={f.placeholder_en || ""}
                          disabled={!canWrite}
                          onChange={(e) => {
                            const placeholder_en = e.target.value;
                            setFields((prev) => prev.map((row, i) => (i === idx ? { ...row, placeholder_en } : row)));
                            markDirty();
                          }}
                        />
                      </FormField>
                      <label className="flex items-end gap-2 pb-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(f.required)}
                          disabled={!canWrite}
                          onChange={(e) => {
                            const required = e.target.checked;
                            setFields((prev) => prev.map((row, i) => (i === idx ? { ...row, required } : row)));
                            markDirty();
                          }}
                        />
                        Required
                      </label>
                      <div className="flex items-end gap-2 pb-2">
                        <button
                          type="button"
                          className="text-xs"
                          disabled={!canWrite || idx === 0}
                          onClick={() => {
                            setFields((prev) => {
                              const next = [...prev];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              return next.map((row, i) => ({ ...row, sort_order: i }));
                            });
                            markDirty();
                          }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="text-xs"
                          disabled={!canWrite || idx >= fields.filter((x) => !x.delete).length - 1}
                          onClick={() => {
                            setFields((prev) => {
                              const next = [...prev];
                              [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                              return next.map((row, i) => ({ ...row, sort_order: i }));
                            });
                            markDirty();
                          }}
                        >
                          ↓
                        </button>
                        {canWrite ? (
                          <button
                            type="button"
                            className="text-xs text-red-600"
                            onClick={() => {
                              setFields((prev) => prev.map((row, i) => (i === idx ? { ...row, delete: true } : row)));
                              markDirty();
                            }}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
            </div>
            {!fields.filter((f) => !f.delete).length ? (
              <EmptyState title="No customer fields" description="Add Player ID, Server, UID, etc. when checkout needs them." />
            ) : null}
          </section>
        ) : null}

        {section === "supplier" ? (
          <section className="admin-card p-4">
            <h2 className="mb-2 text-sm font-semibold text-[var(--clicks-navy)]">Supplier mapping</h2>
            <p className="mb-4 text-sm text-[var(--clicks-muted)]">
              Configuration only — OneEpin live purchasing stays locked. Credentials are never shown here.
            </p>
            {mappings.length ? (
              <div className="mb-4 overflow-hidden rounded-xl border border-[var(--clicks-border)]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--clicks-bg)] text-[11px] uppercase text-[var(--clicks-muted)]">
                    <tr>
                      <th className="px-3 py-2 text-start">Supplier</th>
                      <th className="px-3 py-2 text-start">Variant</th>
                      <th className="px-3 py-2 text-start">External ID</th>
                      <th className="px-3 py-2 text-start">Status</th>
                      <th className="px-3 py-2 text-start"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={String(m.id)} className="border-t border-[var(--clicks-border)]">
                        <td className="px-3 py-2">{m.supplier_name || m.supplier_slug}</td>
                        <td className="px-3 py-2 font-mono text-xs">{m.variant_sku || "Product-level"}</td>
                        <td className="px-3 py-2 font-mono text-xs">{m.external_product_id}</td>
                        <td className="px-3 py-2">
                          <Badge status={m.ignored ? "ARCHIVED" : "PUBLISHED"} />
                        </td>
                        <td className="px-3 py-2">
                          {canMap ? (
                            <button
                              type="button"
                              className="text-xs text-red-600"
                              onClick={async () => {
                                if (!token) return;
                                await deleteSupplierMapping(token, m.id);
                                setMappings((prev) => prev.filter((row) => String(row.id) !== String(m.id)));
                                toast.push("Mapping removed", "success");
                              }}
                            >
                              Remove
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No mappings" description="Map a supplier external product id to this product or a variant." />
            )}
            {canMap ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <FormField label="Supplier" htmlFor="map-supplier">
                  <select
                    id="map-supplier"
                    className={adminInputClass}
                    value={mappingForm.supplier_id}
                    onChange={(e) => setMappingForm((s) => ({ ...s, supplier_id: e.target.value }))}
                  >
                    <option value="">Select…</option>
                    {suppliers.map((s) => (
                      <option key={String(s.id)} value={String(s.id)}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Variant (optional)" htmlFor="map-variant">
                  <select
                    id="map-variant"
                    className={adminInputClass}
                    value={mappingForm.variant_id}
                    onChange={(e) => setMappingForm((s) => ({ ...s, variant_id: e.target.value }))}
                  >
                    <option value="">Product-level</option>
                    {activeVariants
                      .filter((v) => v.id)
                      .map((v) => (
                        <option key={String(v.id)} value={String(v.id)}>
                          {v.sku}
                        </option>
                      ))}
                  </select>
                </FormField>
                <FormField label="External product ID" htmlFor="map-ext">
                  <input
                    id="map-ext"
                    className={adminInputClass}
                    value={mappingForm.external_product_id}
                    onChange={(e) => setMappingForm((s) => ({ ...s, external_product_id: e.target.value }))}
                  />
                </FormField>
                <div className="flex items-end">
                  <button
                    type="button"
                    className="h-10 rounded-lg bg-[var(--clicks-blue)] px-4 text-sm font-semibold text-white"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        const created = await createProductMapping(token, product.slug, {
                          supplier_id: mappingForm.supplier_id,
                          external_product_id: mappingForm.external_product_id,
                          variant_id: mappingForm.variant_id || null,
                          external_name: mappingForm.external_name,
                        });
                        setMappings((prev) => [...prev, created]);
                        setMappingForm({ supplier_id: "", variant_id: "", external_product_id: "", external_name: "" });
                        toast.push("Mapping created", "success");
                      } catch (err) {
                        toast.push(err instanceof ApiError ? err.message : "Mapping failed", "error");
                      }
                    }}
                  >
                    Map
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--clicks-muted)]">Requires suppliers.write to edit mappings.</p>
            )}
          </section>
        ) : null}

        {canWrite && section !== "media" && section !== "supplier" ? (
          <button
            type="submit"
            disabled={pending}
            className="h-10 rounded-lg bg-[var(--clicks-blue)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : dirty ? "Save changes" : "Save product"}
          </button>
        ) : null}
      </form>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive this product?"
        description="Products with order or code history are archived instead of hard-deleted."
        confirmLabel="Archive"
        pending={pending}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          void (async () => {
            if (!token) return;
            setPending(true);
            try {
              await deleteProduct(token, product.slug);
              toast.push("Product archived or deleted", "success");
              router.push("/admin/products");
            } catch (err) {
              toast.push(err instanceof ApiError ? err.message : "Could not archive", "error");
            } finally {
              setPending(false);
              setConfirmArchive(false);
            }
          })();
        }}
      />
    </div>
  );
}
