"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { FieldsTab } from "@/components/admin/product/fields-tab";
import { GeneralTab } from "@/components/admin/product/general-tab";
import { MappingTab } from "@/components/admin/product/mapping-tab";
import { MediaTab } from "@/components/admin/product/media-tab";
import { VariantsTab } from "@/components/admin/product/variants-tab";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, adminFieldErrors, errorCode } from "@/components/admin/lib/errors";
import {
  fieldDraftToPayload,
  fieldToDraft,
  generalFormToPayload,
  newFieldDraft,
  newVariantDraft,
  productToGeneralForm,
  tabForErrorKey,
  validateField,
  validateGeneral,
  validateVariant,
  variantDraftToPayload,
  variantToDraft,
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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const TABS = [
  { id: "general", label: "General" },
  { id: "variants", label: "Variants" },
  { id: "fields", label: "Required fields" },
  { id: "media", label: "Media" },
  { id: "supplier", label: "Supplier mapping" },
] as const;

type TabId = (typeof TABS)[number]["id"];
type Lookups = {
  categories: AdminCategory[];
  platforms: AdminPlatform[];
  regions: AdminRegion[];
  suppliers: Supplier[];
};

function move<T>(list: T[], match: (item: T) => boolean, dir: -1 | 1, visible: (item: T) => boolean): T[] {
  const visibleIdx = list.map((item, i) => (visible(item) ? i : -1)).filter((i) => i >= 0);
  const pos = visibleIdx.findIndex((i) => match(list[i]));
  const swapWith = visibleIdx[pos + dir];
  if (pos < 0 || swapWith === undefined) return list;
  const next = [...list];
  [next[visibleIdx[pos]], next[swapWith]] = [next[swapWith], next[visibleIdx[pos]]];
  return next;
}

function ProductEditor({
  product,
  lookups,
  token,
  tab,
  setTab,
  onSaved,
  onReload,
}: {
  product: AdminProduct;
  lookups: Lookups;
  token?: string;
  tab: TabId;
  setTab: (tab: TabId) => void;
  onSaved: (p: AdminProduct) => void;
  onReload: () => void;
}) {
  const toast = useAdminToast();
  const router = useRouter();
  const { can } = useAdminAccess();
  const canWrite = can("catalog.write");
  const canMap = can("suppliers.write");
  const canImport = can("codes.manage");

  const [general, setGeneral] = useState<GeneralForm>(() => productToGeneralForm(product));
  const [variants, setVariants] = useState<VariantDraft[]>(() =>
    [...(product.variants ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(variantToDraft),
  );
  const [fields, setFields] = useState<FieldDraft[]>(() =>
    [...(product.fields ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(fieldToDraft),
  );
  const [media, setMedia] = useState<AdminMediaAsset[]>(() =>
    [...(product.media ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
  );
  const [mappings, setMappings] = useState<AdminSupplierMapping[]>(() => [...(product.supplier_mappings ?? [])]);
  const [generalErrors, setGeneralErrors] = useState<Record<string, string>>({});
  const [variantErrors, setVariantErrors] = useState<Record<string, Record<string, string>>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, Record<string, string>>>({});
  const [serverTabErrors, setServerTabErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<"archive" | "unarchive" | "delete" | null>(null);
  const [variantToDelete, setVariantToDelete] = useState<VariantDraft | null>(null);
  const [variantConflict, setVariantConflict] = useState<{ variant: VariantDraft; message: string } | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const tabErrorCount: Record<TabId, number> = {
    general: Object.keys(generalErrors).length + (serverTabErrors.general ? 1 : 0),
    variants: Object.keys(variantErrors).length + (serverTabErrors.variants ? 1 : 0),
    fields: Object.keys(fieldErrors).length + (serverTabErrors.fields ? 1 : 0),
    media: 0,
    supplier: 0,
  };

  function patchGeneral(patch: Partial<GeneralForm>) {
    setGeneral((g) => ({ ...g, ...patch }));
    setDirty(true);
  }
  function patchVariant(key: string, patch: Partial<VariantDraft>) {
    setVariants((list) => list.map((v) => (v.key === key ? { ...v, ...patch } : v)));
    setDirty(true);
  }
  function patchField(key: string, patch: Partial<FieldDraft>) {
    setFields((list) => list.map((f) => (f.key_local === key ? { ...f, ...patch } : f)));
    setDirty(true);
  }

  async function save() {
    if (!token) return;
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
      toast.push(`Fix the highlighted fields on: ${bad.map((t) => TABS.find((x) => x.id === t)?.label).join(", ")}`, "error");
      if (!bad.includes(tab)) setTab(bad[0]);
      return;
    }
    setPending(true);
    try {
      const visibleVariants = variants.filter((v) => !v.delete);
      const visibleFields = fields.filter((f) => !f.delete);
      const updated = await updateProduct(token, product.slug, {
        ...generalFormToPayload(general),
        variants: visibleVariants.map((v, i) => variantDraftToPayload(v, i)),
        fields: [
          ...visibleFields.map((f, i) => fieldDraftToPayload(f, i)),
          ...fields.filter((f) => f.delete && f.id).map((f, i) => fieldDraftToPayload(f, i)),
        ],
      });
      toast.push("Product saved", "success");
      setDirty(false);
      if (updated.slug !== product.slug) router.replace(`/admin/products/${updated.slug}`);
      onSaved(updated);
    } catch (err) {
      const fieldErrs = adminFieldErrors(err);
      const general: Record<string, string> = {};
      const byTab: Record<string, string> = {};
      for (const [key, msg] of Object.entries(fieldErrs)) {
        const t = tabForErrorKey(key);
        if (t === "general") general[key === "category" ? "category_id" : key === "platform" ? "platform_id" : key] = msg;
        else byTab[t] = msg;
      }
      if (Object.keys(general).length) byTab.general = Object.values(general)[0];
      setGeneralErrors(general);
      setServerTabErrors(byTab);
      const first = (Object.keys(byTab)[0] as TabId | undefined) ?? null;
      if (first && first !== tab) setTab(first);
      toast.push(adminErrorMessage(err, "Save failed"), "error");
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
        router.push("/admin/products");
        return;
      }
      const next = kind === "archive" ? await archiveProduct(token, product.slug) : await unarchiveProduct(token, product.slug);
      toast.push(kind === "archive" ? "Product archived — hidden from the store" : "Product restored as a draft", "success");
      onSaved(next);
    } catch (err) {
      if (kind === "delete" && errorCode(err) === "conflict") {
        toast.push(`${adminErrorMessage(err)}`, "error");
      } else {
        toast.push(adminErrorMessage(err, "Action failed"), "error");
      }
    } finally {
      setPending(false);
      setConfirm(null);
    }
  }

  async function confirmVariantDelete() {
    if (!token || !variantToDelete?.id) return;
    const target = variantToDelete;
    setPending(true);
    try {
      await deleteVariant(token, target.id!);
      setVariants((list) => list.filter((v) => v.key !== target.key));
      toast.push("Variant deleted", "success");
      setVariantToDelete(null);
    } catch (err) {
      setVariantToDelete(null);
      if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 409) {
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
      setVariants((list) => list.map((x) => (x.key === v.key ? { ...x, published: false } : x)));
      toast.push("Variant unpublished — hidden from the store", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Update failed"), "error");
    } finally {
      setPending(false);
      setVariantConflict(null);
    }
  }

  const isArchived = product.status === "ARCHIVED";
  const showSave = canWrite && (tab === "general" || tab === "variants" || tab === "fields");
  const variantRows = variants.filter((v) => !v.delete).map((v) => ({ id: v.id, sku: v.sku })) as AdminProduct["variants"];

  return (
    <div>
      <PageHeader
        title={product.name_en}
        description={`${product.slug} · ${product.fulfillment_type === "DIRECT_TOPUP" ? "Direct top-up" : "Code"} product`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={product.status} />
            {product.status === "PUBLISHED" ? (
              <a href={`/product/${product.slug}`} target="_blank" rel="noreferrer" className="admin-btn admin-btn-secondary">
                View on store
              </a>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={pending}
                onClick={async () => {
                  if (!token) return;
                  try {
                    const copy = await duplicateProduct(token, product.slug, false);
                    toast.push("Product duplicated as draft", "success");
                    router.push(`/admin/products/${copy.slug}`);
                  } catch (err) {
                    toast.push(adminErrorMessage(err, "Duplicate failed"), "error");
                  }
                }}
              >
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
              Back
            </Link>
          </div>
        }
      />

      <div className="admin-card mb-4 flex flex-wrap items-center gap-1 p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex h-8 items-center gap-1.5 rounded-[var(--admin-radius-sm)] px-3 text-[12px] font-semibold transition ${
              tab === t.id
                ? "bg-[var(--clicks-blue)] text-white shadow-sm"
                : "text-[var(--clicks-muted)] hover:bg-[#F3F5F9] hover:text-[var(--clicks-navy)]"
            }`}
          >
            {t.label}
            {tabErrorCount[t.id] ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] text-white">
                !
              </span>
            ) : null}
          </button>
        ))}
        {dirty ? <span className="ms-auto pe-2 text-[11px] font-medium text-amber-700">Unsaved changes</span> : null}
      </div>

      {serverTabErrors[tab] && tab !== "general" ? (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{serverTabErrors[tab]}</p>
      ) : null}

      {tab === "general" ? (
        <GeneralTab
          form={general}
          errors={generalErrors}
          disabled={!canWrite}
          categories={lookups.categories}
          platforms={lookups.platforms}
          onChange={patchGeneral}
        />
      ) : null}
      {tab === "variants" ? (
        <VariantsTab
          variants={variants}
          errors={variantErrors}
          disabled={!canWrite}
          isCodeProduct={general.fulfillment_type === "CODE"}
          regions={lookups.regions}
          canImport={canImport}
          onChange={patchVariant}
          onAdd={() => {
            setVariants((list) => [
              ...list,
              newVariantDraft({ productId: product.id, index: list.length, currency: general.account_currency }),
            ]);
            setDirty(true);
          }}
          onRemove={(v) => {
            if (v.id) setVariantToDelete(v);
            else setVariants((list) => list.filter((x) => x.key !== v.key));
          }}
          onMove={(key, dir) => {
            setVariants((list) => move(list, (v) => v.key === key, dir, (v) => !v.delete));
            setDirty(true);
          }}
        />
      ) : null}
      {tab === "fields" ? (
        <FieldsTab
          fields={fields}
          errors={fieldErrors}
          disabled={!canWrite}
          onChange={patchField}
          onAdd={() => {
            setFields((list) => [...list, newFieldDraft(list.length)]);
            setDirty(true);
          }}
          onRemove={(key) => {
            setFields((list) =>
              list.flatMap((f) => (f.key_local !== key ? [f] : f.id ? [{ ...f, delete: true }] : [])),
            );
            setDirty(true);
          }}
          onMove={(key, dir) => {
            setFields((list) => move(list, (f) => f.key_local === key, dir, (f) => !f.delete));
            setDirty(true);
          }}
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
          variants={(variantRows ?? []) as NonNullable<AdminProduct["variants"]>}
          canMap={canMap}
        />
      ) : null}

      {showSave ? (
        <div className="sticky bottom-0 mt-4 flex items-center gap-3 border-t border-[var(--clicks-border)] bg-[var(--clicks-bg)]/95 py-3 backdrop-blur">
          <button type="button" disabled={pending} onClick={() => void save()} className="admin-btn admin-btn-primary disabled:opacity-60">
            {pending ? "Saving…" : "Save product"}
          </button>
          <p className="text-[11px] text-[var(--clicks-muted)]">Saves General, Variants and Required fields together.</p>
          {dirty ? (
            <button type="button" className="admin-btn admin-btn-ghost ms-auto text-xs" onClick={onReload}>
              Discard changes
            </button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "archive"}
        title="Archive this product?"
        description="Archived products are hidden from the store but keep their orders and codes. You can unarchive later (it returns as a draft)."
        confirmLabel="Archive"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runStatus("archive")}
      />
      <ConfirmDialog
        open={confirm === "unarchive"}
        title="Unarchive this product?"
        description="The product returns as a Draft. Publish it from the General tab when ready."
        confirmLabel="Unarchive"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runStatus("unarchive")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title="Delete this product permanently?"
        description="This removes the product, its variants and media for good. Products with order or code history cannot be deleted — archive them instead."
        confirmLabel="Delete permanently"
        danger
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void runStatus("delete")}
      />
      <ConfirmDialog
        open={Boolean(variantToDelete)}
        title="Delete variant?"
        description={variantToDelete ? `Delete ${variantToDelete.sku} now. This cannot be undone.` : undefined}
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
            ? `${variantConflict.message} It has orders or codes — unpublish it instead so it's hidden from the store.`
            : undefined
        }
        confirmLabel="Unpublish variant"
        pending={pending}
        onCancel={() => setVariantConflict(null)}
        onConfirm={() => variantConflict && void unpublishVariant(variantConflict.variant)}
      />
    </div>
  );
}

export function ProductDetailClient({ id }: { id: string }) {
  const [tab, setTab] = useState<TabId>("general");
  const { data, setData, loading, error, reload, token } = useAdminQuery(async (tok) => {
    const [product, categories, platforms, regions, suppliers] = await Promise.all([
      getProduct(tok, id),
      fetchAllPages((p) => listCategories(tok, p)),
      fetchAllPages((p) => listPlatforms(tok, p)),
      fetchAllPages((p) => listRegions(tok, p)),
      fetchAllPages((p) => listSuppliers(tok, p)).catch(() => [] as Supplier[]),
    ]);
    return { product, lookups: { categories, platforms, regions, suppliers } };
  }, [id]);

  if (loading && !data) return <div className="admin-card h-48 animate-pulse" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data?.product) return <EmptyState title="Product not found" />;

  const { product, lookups } = data;
  return (
    <ProductEditor
      key={`${product.slug}:${product.updated_at ?? ""}:${product.status}`}
      product={product}
      lookups={lookups}
      token={token}
      tab={tab}
      setTab={setTab}
      onSaved={(p) => setData((prev) => (prev ? { ...prev, product: p } : prev))}
      onReload={reload}
    />
  );
}
