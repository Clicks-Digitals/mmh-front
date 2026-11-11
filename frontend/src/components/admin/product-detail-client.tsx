"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { useAdminBreadcrumbLabel } from "@/components/admin/layout/breadcrumbs";
import { useUnsavedChangesGuard } from "@/components/admin/layout/navigation-guard";
import { CheckoutFieldsSection } from "@/components/admin/product/checkout-fields-section";
import {
  AdvancedCard,
  BasicsSection,
  ContentSection,
  OrganizeCard,
  PromoteCard,
  StatusCard,
  type ReadinessItem,
} from "@/components/admin/product/details-sections";
import { CountPill, EditorSection } from "@/components/admin/product/editor-ui";
import { MappingTab } from "@/components/admin/product/mapping-tab";
import { OptionsSection } from "@/components/admin/product/options-section";
import { PhotosSection } from "@/components/admin/product/photos-section";
import { Badge } from "@/components/admin/ui/badge";
import { EntityThumb } from "@/components/admin/ui/entity-thumb";
import { RowActions } from "@/components/admin/ui/row-actions";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormErrorSummary } from "@/components/admin/ui/form-field";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, errorCode } from "@/components/admin/lib/errors";
import { jodInputToFils } from "@/components/admin/lib/money";
import {
  GENERAL_FIELD_LABELS,
  fieldDraftToPayload,
  generalFormToPayload,
  generalServerErrors,
  isDraftDirty,
  nestedListErrors,
  newFieldDraft,
  newVariantDraft,
  patchFieldLabel,
  productToDraft,
  publishWarnings,
  validateField,
  validateGeneral,
  validateVariant,
  variantDraftToPayload,
  warningMessage,
  type EditorDraft,
  type FieldDraft,
  type GeneralForm,
  type VariantDraft,
} from "@/components/admin/lib/product-form";
import { useAdminQuery } from "@/hooks/use-admin-query";
import {
  archiveProduct,
  deleteProduct,
  deleteVariant,
  duplicateProduct,
  fetchAllPages,
  getProduct,
  listCategories,
  listPlatforms,
  listRegions,
  listSuppliers,
  unarchiveProduct,
  updateProduct,
  updateVariant,
  type AdminCategory,
  type AdminMediaAsset,
  type AdminPlatform,
  type AdminProduct,
  type AdminRegion,
  type AdminSupplierMapping,
  type Supplier,
} from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

/** Which editor section shows a General-form field (to scroll to the first problem). */
function sectionForGeneralKey(key: string): string {
  if (["name_en", "name_ar", "short_description_en", "short_description_ar"].includes(key)) return "section-basics";
  if (["category_id", "platform_id", "kind", "fulfillment_type", "brand", "category", "platform"].includes(key)) return "section-organize";
  if (["slug", "id", "sort_order", "account_currency"].includes(key)) return "section-advanced";
  if (["badges", "tags", "featured", "bestseller", "trending", "refundable"].includes(key)) return "section-promote";
  if (["artwork_key", "image_url"].includes(key)) return "section-photos";
  if (key === "status") return "section-status";
  return "section-content";
}

function scrollToSection(id: string) {
  // After React renders the errors (collapsed sections open themselves while they have problems).
  window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}
type Lookups = {
  categories: AdminCategory[];
  platforms: AdminPlatform[];
  regions: AdminRegion[];
  suppliers: Supplier[];
};
type Confirm = "archive" | "unarchive" | "delete" | "duplicate" | "publish" | null;

function move<T>(list: T[], match: (item: T) => boolean, dir: -1 | 1, visible: (item: T) => boolean): T[] {
  const visibleIdx = list.map((item, i) => (visible(item) ? i : -1)).filter((i) => i >= 0);
  const pos = visibleIdx.findIndex((i) => match(list[i]));
  const swapWith = visibleIdx[pos + dir];
  if (pos < 0 || swapWith === undefined) return list;
  const next = [...list];
  [next[visibleIdx[pos]], next[swapWith]] = [next[swapWith], next[visibleIdx[pos]]];
  return next;
}

function sortedMedia(product: AdminProduct): AdminMediaAsset[] {
  return [...(product.media ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function ProductEditor({
  product,
  lookups,
  token,
  focusSupplier,
  onSaved,
}: {
  product: AdminProduct;
  lookups: Lookups;
  token?: string;
  /** opened from a 1Epin page (?tab=supplier): jump to the supplier section */
  focusSupplier?: boolean;
  onSaved: (p: AdminProduct) => void;
}) {
  const toast = useAdminToast();
  const router = useRouter();
  const { can } = useAdminAccess();
  const canWrite = can("catalog.write");
  const canMap = can("suppliers.write");
  const canImport = can("codes.manage");

  const [initial, setInitial] = useState<EditorDraft>(() => productToDraft(product));
  const [draft, setDraft] = useState<EditorDraft>(initial);
  const [media, setMedia] = useState<AdminMediaAsset[]>(() => sortedMedia(product));
  const [mappings, setMappings] = useState<AdminSupplierMapping[]>(() => [...(product.supplier_mappings ?? [])]);
  const [generalErrors, setGeneralErrors] = useState<Record<string, string>>({});
  const [variantErrors, setVariantErrors] = useState<Record<string, Record<string, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, Record<string, string>>>({});
  const [serverTabErrors, setServerTabErrors] = useState<Record<string, string>>({});
  const [serverWarnings, setServerWarnings] = useState<string[]>(() => product.warnings ?? []);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [variantToDelete, setVariantToDelete] = useState<VariantDraft | null>(null);
  const [variantConflict, setVariantConflict] = useState<{ variant: VariantDraft; message: string } | null>(null);

  const { general, variants, fields } = draft;
  const dirty = useMemo(() => isDraftDirty(initial, draft), [initial, draft]);
  useUnsavedChangesGuard("product-editor", dirty);
  useAdminBreadcrumbLabel(product.name_en || product.slug);

  const category = lookups.categories.find((c) => String(c.id) === general.category_id);
  const platform = lookups.platforms.find((p) => String(p.id) === general.platform_id);
  const pendingWarnings = publishWarnings(draft, { categoryStatus: category?.status, platformStatus: platform?.status });

  useEffect(() => {
    if (focusSupplier) scrollToSection("section-supplier");
  }, [focusSupplier]);

  function clearErrors() {
    setGeneralErrors({});
    setVariantErrors({});
    setFieldErrors({});
    setServerTabErrors({});
  }

  function resetTo(next: EditorDraft) {
    setInitial(next);
    setDraft(next);
    clearErrors();
  }

  function patchGeneral(patch: Partial<GeneralForm>) {
    setDraft((d) => ({ ...d, general: { ...d.general, ...patch } }));
    setGeneralErrors((errs) => {
      const keys = Object.keys(patch).filter((k) => k in errs);
      if (!keys.length) return errs;
      const next = { ...errs };
      keys.forEach((k) => delete next[k]);
      return next;
    });
  }
  function patchVariant(key: string, patch: Partial<VariantDraft>) {
    setDraft((d) => ({ ...d, variants: d.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));
  }
  function patchField(key: string, patch: Partial<FieldDraft>) {
    setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.key_local === key ? { ...f, ...patch } : f)) }));
  }

  function discard() {
    setDraft(initial);
    clearErrors();
    toast.push("Changes discarded", "info");
  }

  /** Validate locally; returns false (and shows the problems) when something must be fixed. */
  function validateAll(): boolean {
    const gErr = validateGeneral(general);
    const vErr: Record<string, Record<string, string>> = {};
    variants.forEach((v) => {
      const e = validateVariant(v);
      if (Object.keys(e).length) vErr[v.key] = e;
    });
    const fErr: Record<string, Record<string, string>> = {};
    fields.forEach((f) => {
      const e = validateField(f, fields);
      if (Object.keys(e).length) fErr[f.key_local] = e;
    });
    setGeneralErrors(gErr);
    setVariantErrors(vErr);
    setFieldErrors(fErr);
    setServerTabErrors({});
    const first = Object.keys(gErr).length
      ? sectionForGeneralKey(Object.keys(gErr)[0])
      : Object.keys(vErr).length
        ? "section-options"
        : Object.keys(fErr).length
          ? "section-fields"
          : null;
    if (first) {
      toast.push("Please fix the fields marked in red.", "error");
      scrollToSection(first);
      return false;
    }
    return true;
  }

  function requestSave() {
    if (!token || !validateAll()) return;
    const publishing = general.status === "PUBLISHED" && (initial.general.status !== "PUBLISHED" || pendingWarnings.length > 0);
    if (publishing && pendingWarnings.length) {
      setConfirm("publish");
      return;
    }
    void save();
  }

  async function save() {
    if (!token) return;
    setPending(true);
    setConfirm(null);
    const visibleVariants = variants.filter((v) => !v.delete);
    const visibleFields = fields.filter((f) => !f.delete);
    try {
      const updated = await updateProduct(token, product.slug, {
        ...generalFormToPayload(general, initial.general),
        variants: visibleVariants.map((v, i) => variantDraftToPayload(v, i)),
        fields: [
          ...visibleFields.map((f, i) => fieldDraftToPayload(f, i)),
          ...fields.filter((f) => f.delete && f.id).map((f, i) => fieldDraftToPayload(f, i)),
        ],
      });
      const warnings = updated.warnings ?? [];
      setServerWarnings(warnings);
      toast.push(
        warnings.length ? `Product saved. ${warningMessage(warnings[0])}` : "Product saved",
        warnings.length ? "warning" : "success",
      );
      resetTo(productToDraft(updated));
      setMedia(sortedMedia(updated));
      setMappings([...(updated.supplier_mappings ?? mappings)]);
      onSaved(updated);
      if (updated.slug !== product.slug) router.replace(`/admin/products/${updated.slug}`);
    } catch (err) {
      const body = err instanceof ApiError ? err.body : null;
      const gen = generalServerErrors(body);
      const vList = nestedListErrors(body, "variants");
      const fList = nestedListErrors(body, "fields");
      const vErr: Record<string, Record<string, string>> = {};
      Object.entries(vList.rows).forEach(([i, e]) => {
        const v = visibleVariants[Number(i)];
        if (v) vErr[v.key] = e;
      });
      const fErr: Record<string, Record<string, string>> = {};
      Object.entries(fList.rows).forEach(([i, e]) => {
        const f = visibleFields[Number(i)];
        if (f) fErr[f.key_local] = e;
      });
      const byTab: Record<string, string> = {};
      if (vList.message) byTab.variants = vList.message;
      if (fList.message) byTab.fields = fList.message;
      setGeneralErrors(gen);
      setVariantErrors(vErr);
      setFieldErrors(fErr);
      setServerTabErrors(byTab);
      const firstBad = Object.keys(gen).length
        ? sectionForGeneralKey(Object.keys(gen)[0])
        : Object.keys(vErr).length || byTab.variants
          ? "section-options"
          : Object.keys(fErr).length || byTab.fields
            ? "section-fields"
            : null;
      if (firstBad) scrollToSection(firstBad);
      toast.push(firstBad ? "The product was not saved — please fix the fields marked in red." : adminErrorMessage(err, "Save failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function runStatus(kind: "archive" | "unarchive" | "delete") {
    if (!token) return;
    setPending(true);
    try {
      if (kind === "delete") {
        await deleteProduct(token, product.slug);
        toast.push("Product deleted permanently", "success");
        resetTo(initial);
        router.push("/admin/products");
        return;
      }
      const next = kind === "archive" ? await archiveProduct(token, product.slug) : await unarchiveProduct(token, product.slug);
      toast.push(kind === "archive" ? "Product archived — hidden from the store" : "Product restored as a draft", "success");
      resetTo(productToDraft(next));
      onSaved(next);
    } catch (err) {
      toast.push(adminErrorMessage(err, errorCode(err) === "conflict" ? "This product can't be deleted" : "Action failed"), "error");
    } finally {
      setPending(false);
      setConfirm(null);
    }
  }

  async function duplicate() {
    if (!token) return;
    setPending(true);
    try {
      const copy = await duplicateProduct(token, product.slug, false);
      toast.push("Draft copy created — you are now editing the copy", "success");
      setConfirm(null);
      resetTo(initial);
      router.push(`/admin/products/${copy.slug}`);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Duplicate failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function confirmVariantDelete() {
    if (!token || !variantToDelete?.id) return;
    const target = variantToDelete;
    setPending(true);
    try {
      await deleteVariant(token, target.id!);
      const drop = (list: VariantDraft[]) => list.filter((v) => v.key !== target.key);
      setInitial((d) => ({ ...d, variants: drop(d.variants) }));
      setDraft((d) => ({ ...d, variants: drop(d.variants) }));
      toast.push("Variant deleted", "success");
      setVariantToDelete(null);
    } catch (err) {
      setVariantToDelete(null);
      if (err instanceof ApiError && err.status === 409) {
        setVariantConflict({ variant: target, message: adminErrorMessage(err) });
      } else {
        toast.push(adminErrorMessage(err, "Delete failed"), "error");
      }
    } finally {
      setPending(false);
    }
  }

  async function unpublishVariant(v: VariantDraft) {
    if (!token || !v.id) return;
    setPending(true);
    try {
      await updateVariant(token, v.id, { published: false });
      const hide = (list: VariantDraft[]) => list.map((x) => (x.key === v.key ? { ...x, published: false } : x));
      setInitial((d) => ({ ...d, variants: hide(d.variants) }));
      setDraft((d) => ({ ...d, variants: hide(d.variants) }));
      toast.push("Variant hidden from the store", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Update failed"), "error");
    } finally {
      setPending(false);
      setVariantConflict(null);
    }
  }

  const isArchived = product.status === "ARCHIVED";
  const variantRows = variants
    .filter((v) => !v.delete && v.id)
    .map((v) => {
      // The saved price is what customers pay now (unsaved edits are not live yet).
      const saved = initial.variants.find((x) => x.id === v.id);
      return { id: v.id!, sku: v.sku, name_en: v.name_en, price_fils: jodInputToFils(saved?.price ?? v.price) ?? 0 };
    });
  const unsavedNote = dirty ? " Your unsaved changes will be discarded." : "";
  const isCode = general.fulfillment_type === "CODE";
  const liveVariants = variants.filter((v) => !v.delete);
  const primary = media.find((m) => m.is_primary) ?? media[0];

  const readiness: ReadinessItem[] = [
    {
      label: "Name, category and platform",
      ok: Boolean(general.name_en.trim() && general.category_id && general.platform_id),
      action: { label: "Fix", target: general.name_en.trim() ? "section-organize" : "section-basics" },
    },
    {
      label: "An option with a price, shown on the store",
      ok: liveVariants.some((v) => v.published && (jodInputToFils(v.price) ?? 0) > 0),
      action: { label: "Add", target: "section-options" },
    },
    isCode
      ? {
          label: "Codes in stock (or a supplier link)",
          ok: liveVariants.some((v) => v.id && v.published && (v.effective_stock_status ?? v.stock_status) === "IN_STOCK"),
          action: { label: "Options", target: "section-options" },
        }
      : {
          label: "A checkout detail, e.g. Player ID",
          ok: fields.some((f) => !f.delete),
          action: { label: "Add", target: "section-fields" },
        },
    {
      label: "Category and platform are visible",
      ok: (!category || category.status === "PUBLISHED") && (!platform || platform.status === "PUBLISHED"),
    },
    { label: "A photo", ok: media.length > 0, optional: true, action: { label: "Upload", target: "section-photos" } },
    { label: "Arabic name", ok: Boolean(general.name_ar.trim()), optional: true, action: { label: "Add", target: "section-basics" } },
  ];

  const moreActions = canWrite
    ? [
        { label: "Duplicate", onClick: () => setConfirm("duplicate"), disabled: pending },
        { label: isArchived ? "Unarchive" : "Archive", onClick: () => setConfirm(isArchived ? "unarchive" : "archive"), disabled: pending },
        { label: "Delete permanently", onClick: () => setConfirm("delete"), tone: "danger" as const, disabled: pending },
      ]
    : [];

  return (
    <div className="pb-4">
      <Link
        href="/admin/products"
        className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--clicks-muted)] hover:text-[var(--clicks-navy)]"
      >
        <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        Products
      </Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <EntityThumb
            imageUrl={primary?.url || general.image_url}
            artworkKey={general.artwork_key}
            slug={product.slug}
            className="h-12 w-12 rounded-lg"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[1.25rem] font-semibold tracking-tight text-[var(--clicks-navy)]">{product.name_en}</h1>
              <Badge status={product.status}>
                {product.status === "PUBLISHED" ? "Live" : product.status === "ARCHIVED" ? "Archived" : "Hidden"}
              </Badge>
            </div>
            <p className="mt-0.5 text-[12px] text-[var(--clicks-muted)]">
              {product.fulfillment_type === "DIRECT_TOPUP" ? "Top-up product" : "Code product"}
              {category ? ` · ${category.name_en}` : ""}
              {platform ? ` · ${platform.name_en}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {product.status === "PUBLISHED" ? (
            <a href={`/product/${product.slug}`} target="_blank" rel="noreferrer" className="admin-btn admin-btn-secondary gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              View on store
            </a>
          ) : null}
          <RowActions label="More" actions={moreActions} />
          {canWrite ? (
            <button type="button" disabled={pending || !dirty} onClick={requestSave} className="admin-btn admin-btn-primary disabled:opacity-60">
              {pending ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          ) : null}
        </div>
      </div>

      {serverWarnings.length ? (
        <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-950">
          {serverWarnings.map((w) => (
            <p key={w}>
              <span className="font-semibold">Heads up:</span> {warningMessage(w)}
              {w === "no_published_variants" || w === "no_variants" || w === "no_stock" ? (
                <button type="button" className="ms-2 font-medium underline" onClick={() => scrollToSection("section-options")}>
                  Go to options
                </button>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}

      <FormErrorSummary
        className="mb-4"
        errors={generalErrors}
        labels={GENERAL_FIELD_LABELS}
        idFor={(key) => (key === "badges" ? "pg-badges" : key === "status" ? "section-status" : `pg-${key}`)}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <div className="lg:hidden">
            <StatusCard
              idPrefix="pg-status-mobile"
              form={general}
              disabled={!canWrite}
              onChange={patchGeneral}
              savedStatus={initial.general.status}
              readiness={readiness}
            />
          </div>
          <BasicsSection form={general} errors={generalErrors} disabled={!canWrite} onChange={patchGeneral} />
          <PhotosSection
            token={token}
            slug={product.slug}
            media={media}
            setMedia={setMedia}
            canWrite={canWrite}
            form={general}
            onChange={patchGeneral}
          />
          <OptionsSection
            variants={variants}
            errors={variantErrors}
            listError={serverTabErrors.variants}
            disabled={!canWrite}
            isCodeProduct={isCode}
            regions={lookups.regions}
            canImport={canImport}
            accountCurrency={general.account_currency}
            onChange={patchVariant}
            onAdd={(region) => {
              const next = { ...newVariantDraft({ productId: product.id, index: variants.length, currency: "" }), region: region ?? "" };
              setDraft((d) => ({ ...d, variants: [...d.variants, next] }));
              return next.key;
            }}
            onRemove={(v) => {
              if (v.id) setVariantToDelete(v);
              else setDraft((d) => ({ ...d, variants: d.variants.filter((x) => x.key !== v.key) }));
            }}
            onSwap={(a, b) =>
              setDraft((d) => {
                const list = [...d.variants];
                const i = list.findIndex((v) => v.key === a);
                const j = list.findIndex((v) => v.key === b);
                if (i < 0 || j < 0) return d;
                [list[i], list[j]] = [list[j], list[i]];
                return { ...d, variants: list };
              })
            }
          />
          <CheckoutFieldsSection
            fields={fields}
            errors={fieldErrors}
            listError={serverTabErrors.fields}
            disabled={!canWrite}
            isTopup={general.fulfillment_type === "DIRECT_TOPUP"}
            onChange={patchField}
            onAdd={(preset) => {
              const base = newFieldDraft(fields.length);
              const next = preset ? { ...base, ...preset, ...patchFieldLabel(base, String(preset.label_en ?? "")) } : base;
              setDraft((d) => ({ ...d, fields: [...d.fields, next] }));
              return next.key_local;
            }}
            onRemove={(key) =>
              setDraft((d) => ({
                ...d,
                fields: d.fields.flatMap((f) => (f.key_local !== key ? [f] : f.id ? [{ ...f, delete: true }] : [])),
              }))
            }
            onMove={(key, dir) => setDraft((d) => ({ ...d, fields: move(d.fields, (f) => f.key_local === key, dir, (f) => !f.delete) }))}
          />
          <ContentSection form={general} errors={generalErrors} disabled={!canWrite} onChange={patchGeneral} />
          <EditorSection
            id="section-supplier"
            title="Supplier (1Epin)"
            description="Optional — let 1Epin deliver an option automatically when a customer pays."
            collapsible
            defaultOpen={Boolean(focusSupplier) || mappings.length > 0}
            badge={mappings.length ? <CountPill>{mappings.length} linked</CountPill> : null}
          >
            <MappingTab
              embedded
              token={token}
              slug={product.slug}
              mappings={mappings}
              setMappings={setMappings}
              suppliers={lookups.suppliers}
              variants={variantRows}
              canMap={canMap}
              productName={product.name_en}
              fulfillmentType={product.fulfillment_type}
              customerFields={product.fields}
            />
          </EditorSection>
        </div>

        <aside className="min-w-0 space-y-5">
          <div id="section-status" className="hidden lg:block">
            <StatusCard form={general} disabled={!canWrite} onChange={patchGeneral} savedStatus={initial.general.status} readiness={readiness} />
          </div>
          <OrganizeCard
            form={general}
            errors={generalErrors}
            disabled={!canWrite}
            onChange={patchGeneral}
            categories={lookups.categories}
            platforms={lookups.platforms}
            hasVariants={variants.some((v) => v.id)}
            savedFulfillment={initial.general.fulfillment_type}
          />
          <PromoteCard form={general} errors={generalErrors} disabled={!canWrite} onChange={patchGeneral} />
          <AdvancedCard form={general} errors={generalErrors} disabled={!canWrite} onChange={patchGeneral} productId={product.id} />
        </aside>
      </div>

      {canWrite && dirty ? (
        <div className="sticky bottom-3 z-20 mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-[var(--clicks-navy)] px-4 py-3 text-white shadow-[0_10px_30px_rgba(16,24,40,0.25)]">
          <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
          <p className="text-[13px] font-medium">Unsaved changes</p>
          <p className="hidden text-[12px] text-white/60 sm:block">Photos and supplier links save on their own.</p>
          <div className="ms-auto flex gap-2">
            <button
              type="button"
              className="h-9 rounded-lg px-3 text-[13px] font-medium text-white/80 hover:bg-white/10 hover:text-white"
              disabled={pending}
              onClick={discard}
            >
              Discard
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={requestSave}
              className={cn("h-9 rounded-lg bg-white px-4 text-[13px] font-semibold text-[var(--clicks-navy)] hover:bg-white/90", pending && "opacity-70")}
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "publish"}
        title="Publish with these problems?"
        description="The product will be visible on the store, but:"
        confirmLabel="Save anyway"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void save()}
      >
        <ul className="list-disc space-y-1 ps-5 text-[13px] text-[var(--clicks-text)]">
          {pendingWarnings.map((w) => (
            <li key={w}>{warningMessage(w)}</li>
          ))}
        </ul>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "duplicate"}
        title="Duplicate this product?"
        description={`Creates a hidden draft copy named “${product.name_en} (Copy)” with the same details, variants and required details. Codes, photos and supplier mappings are not copied, and the copy's variants start out of stock.${unsavedNote}`}
        confirmLabel="Create copy"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void duplicate()}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        title="Archive this product?"
        description={`Archived products are hidden from the store but keep their orders and codes. You can unarchive later (it returns as a draft).${unsavedNote}`}
        confirmLabel="Archive"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runStatus("archive")}
      />
      <ConfirmDialog
        open={confirm === "unarchive"}
        title="Unarchive this product?"
        description={`The product returns as a Draft. Make it Live from Visibility when ready.${unsavedNote}`}
        confirmLabel="Unarchive"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runStatus("unarchive")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title="Delete this product permanently?"
        description="This removes the product, its variants and photos for good. Products with orders or codes can't be deleted — archive them instead."
        confirmLabel="Delete permanently"
        danger
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runStatus("delete")}
      />
      <ConfirmDialog
        open={Boolean(variantToDelete)}
        title="Delete variant?"
        description={variantToDelete ? `Delete “${variantToDelete.name_en || variantToDelete.sku}” now. This can't be undone.` : undefined}
        confirmLabel="Delete variant"
        danger
        pending={pending}
        onCancel={() => setVariantToDelete(null)}
        onConfirm={() => void confirmVariantDelete()}
      />
      <ConfirmDialog
        open={Boolean(variantConflict)}
        title="This variant can't be deleted"
        description={
          variantConflict
            ? `${variantConflict.message} It has orders or codes — hide it from the store instead.`
            : undefined
        }
        confirmLabel="Hide from store"
        pending={pending}
        onCancel={() => setVariantConflict(null)}
        onConfirm={() => variantConflict && void unpublishVariant(variantConflict.variant)}
      />
    </div>
  );
}

export function ProductDetailClient({ id }: { id: string }) {
  // ?tab=supplier deep link (1Epin pages link here). Only read on the client; the first
  // render is the loading skeleton, so there is no hydration difference.
  const [focusSupplier] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "supplier",
  );
  const { can } = useAdminAccess();
  const canSuppliers = can("suppliers.read") || can("catalog.read");
  const { data, setData, loading, error, reload, token } = useAdminQuery(
    async (tok) => {
      const [product, categories, platforms, regions, suppliers] = await Promise.all([
        getProduct(tok, id),
        fetchAllPages((p) => listCategories(tok, p)),
        fetchAllPages((p) => listPlatforms(tok, p)),
        fetchAllPages((p) => listRegions(tok, p)),
        canSuppliers ? fetchAllPages((p) => listSuppliers(tok, p)).catch(() => [] as Supplier[]) : Promise.resolve([] as Supplier[]),
      ]);
      return { product, lookups: { categories, platforms, regions, suppliers } };
    },
    [id, canSuppliers],
  );

  if (loading && !data) return <div className="admin-card h-48 animate-pulse" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data?.product) return <EmptyState title="Product not found" />;

  const { product, lookups } = data;
  return (
    <ProductEditor
      key={product.slug}
      product={product}
      lookups={lookups}
      token={token}
      focusSupplier={focusSupplier}
      onSaved={(p) => setData((prev) => (prev ? { ...prev, product: p } : prev))}
    />
  );
}
