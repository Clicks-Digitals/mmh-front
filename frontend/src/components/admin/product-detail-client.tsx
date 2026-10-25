"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { useAdminBreadcrumbLabel } from "@/components/admin/layout/breadcrumbs";
import { useUnsavedChangesGuard } from "@/components/admin/layout/navigation-guard";
import { FieldsTab } from "@/components/admin/product/fields-tab";
import { GeneralTab } from "@/components/admin/product/general-tab";
import { MappingTab } from "@/components/admin/product/mapping-tab";
import { MediaTab } from "@/components/admin/product/media-tab";
import { VariantsTab } from "@/components/admin/product/variants-tab";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormErrorSummary } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, errorCode } from "@/components/admin/lib/errors";
import {
  GENERAL_FIELD_LABELS,
  fieldDraftToPayload,
  generalFormToPayload,
  generalServerErrors,
  isDraftDirty,
  nestedListErrors,
  newFieldDraft,
  newVariantDraft,
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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const TABS = [
  { id: "general", label: "General" },
  { id: "variants", label: "Variants" },
  { id: "fields", label: "Required details" },
  { id: "media", label: "Photos" },
  { id: "supplier", label: "Supplier mapping" },
] as const;

type TabId = (typeof TABS)[number]["id"];
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
  tab,
  setTab,
  onSaved,
}: {
  product: AdminProduct;
  lookups: Lookups;
  token?: string;
  tab: TabId;
  setTab: (tab: TabId) => void;
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

  const tabErrorCount: Record<TabId, number> = {
    general: Object.keys(generalErrors).length + (serverTabErrors.general ? 1 : 0),
    variants: Object.keys(variantErrors).length + (serverTabErrors.variants ? 1 : 0),
    fields: Object.keys(fieldErrors).length + (serverTabErrors.fields ? 1 : 0),
    media: 0,
    supplier: 0,
  };

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
    const bad: TabId[] = [];
    if (Object.keys(gErr).length) bad.push("general");
    if (Object.keys(vErr).length) bad.push("variants");
    if (Object.keys(fErr).length) bad.push("fields");
    if (bad.length) {
      toast.push(`Please fix the highlighted fields on: ${bad.map((t) => TABS.find((x) => x.id === t)?.label).join(", ")}.`, "error");
      if (!bad.includes(tab)) setTab(bad[0]);
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
      const order: TabId[] = ["general", "variants", "fields"];
      const firstBad = order.find((t) =>
        t === "general" ? Object.keys(gen).length : t === "variants" ? Object.keys(vErr).length || byTab.variants : Object.keys(fErr).length || byTab.fields,
      );
      if (firstBad && firstBad !== tab) setTab(firstBad);
      toast.push(firstBad ? "The product was not saved — please fix the highlighted fields." : adminErrorMessage(err, "Save failed"), "error");
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
  const showSave = canWrite && (tab === "general" || tab === "variants" || tab === "fields");
  const variantRows = variants
    .filter((v) => !v.delete && v.id)
    .map((v) => ({ id: v.id!, sku: v.sku, name_en: v.name_en, price_fils: 0 }));
  const unsavedNote = dirty ? " Your unsaved changes will be discarded." : "";

  return (
    <div>
      <PageHeader
        title={product.name_en}
        description={`${product.fulfillment_type === "DIRECT_TOPUP" ? "Direct top-up" : "Code"} product · /product/${product.slug}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={product.status}>
              {product.status === "PUBLISHED" ? "Published" : product.status === "ARCHIVED" ? "Archived" : "Draft"}
            </Badge>
            {product.status === "PUBLISHED" ? (
              <a href={`/product/${product.slug}`} target="_blank" rel="noreferrer" className="admin-btn admin-btn-secondary">
                View on store
              </a>
            ) : null}
            {canWrite ? (
              <button type="button" className="admin-btn admin-btn-secondary" disabled={pending} onClick={() => setConfirm("duplicate")}>
                Duplicate
              </button>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={pending}
                onClick={() => setConfirm(isArchived ? "unarchive" : "archive")}
              >
                {isArchived ? "Unarchive" : "Archive"}
              </button>
            ) : null}
            {canWrite ? (
              <button type="button" className="admin-btn admin-btn-danger" disabled={pending} onClick={() => setConfirm("delete")}>
                Delete permanently
              </button>
            ) : null}
            <Link href="/admin/products" className="text-sm font-medium text-[var(--clicks-blue)]">
              Back to products
            </Link>
          </div>
        }
      />

      {serverWarnings.length ? (
        <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-950">
          {serverWarnings.map((w) => (
            <p key={w}>
              <span className="font-semibold">Heads up:</span> {warningMessage(w)}
              {w === "no_published_variants" ? (
                <button type="button" className="ms-2 font-medium underline" onClick={() => setTab("variants")}>
                  Go to variants
                </button>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}

      <div className="admin-card mb-4 flex flex-wrap items-center gap-1 p-1.5" role="tablist" aria-label="Product sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex h-8 items-center gap-1.5 rounded-[var(--admin-radius-sm)] px-3 text-[12px] font-semibold transition ${
              tab === t.id
                ? "bg-[var(--clicks-blue)] text-white shadow-sm"
                : "text-[var(--clicks-muted)] hover:bg-[#F3F5F9] hover:text-[var(--clicks-navy)]"
            }`}
          >
            {t.label}
            {tabErrorCount[t.id] ? (
              <span
                className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] text-white"
                aria-label="has errors"
              >
                !
              </span>
            ) : null}
          </button>
        ))}
        {dirty ? <span className="ms-auto pe-2 text-[11px] font-medium text-amber-700">Unsaved changes</span> : null}
      </div>

      {serverTabErrors[tab] && tab !== "general" ? (
        <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          {serverTabErrors[tab]}
        </p>
      ) : null}

      {tab === "general" ? (
        <>
          <FormErrorSummary
            className="mb-3"
            errors={generalErrors}
            labels={GENERAL_FIELD_LABELS}
            idFor={(key) => (key === "badges" ? "pg-badges" : `pg-${key}`)}
          />
          <GeneralTab
            form={general}
            errors={generalErrors}
            disabled={!canWrite}
            categories={lookups.categories}
            platforms={lookups.platforms}
            onChange={patchGeneral}
            productId={product.id}
            hasVariants={variants.some((v) => v.id)}
          />
        </>
      ) : null}
      {tab === "variants" ? (
        <VariantsTab
          variants={variants}
          errors={variantErrors}
          disabled={!canWrite}
          isCodeProduct={general.fulfillment_type === "CODE"}
          regions={lookups.regions}
          canImport={canImport}
          accountCurrency={general.account_currency}
          onChange={patchVariant}
          onAdd={() =>
            setDraft((d) => ({
              ...d,
              variants: [...d.variants, newVariantDraft({ productId: product.id, index: d.variants.length, currency: "" })],
            }))
          }
          onRemove={(v) => {
            if (v.id) setVariantToDelete(v);
            else setDraft((d) => ({ ...d, variants: d.variants.filter((x) => x.key !== v.key) }));
          }}
          onMove={(key, dir) => setDraft((d) => ({ ...d, variants: move(d.variants, (v) => v.key === key, dir, (v) => !v.delete) }))}
        />
      ) : null}
      {tab === "fields" ? (
        <FieldsTab
          fields={fields}
          errors={fieldErrors}
          disabled={!canWrite}
          isTopup={general.fulfillment_type === "DIRECT_TOPUP"}
          onChange={patchField}
          onAdd={() => setDraft((d) => ({ ...d, fields: [...d.fields, newFieldDraft(d.fields.length)] }))}
          onRemove={(key) =>
            setDraft((d) => ({
              ...d,
              fields: d.fields.flatMap((f) => (f.key_local !== key ? [f] : f.id ? [{ ...f, delete: true }] : [])),
            }))
          }
          onMove={(key, dir) => setDraft((d) => ({ ...d, fields: move(d.fields, (f) => f.key_local === key, dir, (f) => !f.delete) }))}
        />
      ) : null}
      {tab === "media" ? <MediaTab token={token} slug={product.slug} media={media} setMedia={setMedia} canWrite={canWrite} /> : null}
      {tab === "supplier" ? (
        <MappingTab
          token={token}
          slug={product.slug}
          mappings={mappings}
          setMappings={setMappings}
          suppliers={lookups.suppliers}
          variants={variantRows}
          canMap={canMap}
        />
      ) : null}

      {showSave ? (
        <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--clicks-border)] bg-[var(--clicks-bg)]/95 py-3 backdrop-blur">
          <button type="button" disabled={pending || !dirty} onClick={requestSave} className="admin-btn admin-btn-primary disabled:opacity-60">
            {pending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
          <p className="text-[11px] text-[var(--clicks-muted)]">
            {dirty ? "Saves General, Variants and Required details together." : "No unsaved changes. Photos and supplier mappings save on their own."}
          </p>
          {dirty ? (
            <button type="button" className="admin-btn admin-btn-ghost ms-auto text-xs" disabled={pending} onClick={discard}>
              Discard changes
            </button>
          ) : null}
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
        description={`The product returns as a Draft. Publish it from the General tab when ready.${unsavedNote}`}
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
  const [tab, setTab] = useState<TabId>("general");
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
      tab={tab}
      setTab={setTab}
      onSaved={(p) => setData((prev) => (prev ? { ...prev, product: p } : prev))}
    />
  );
}
