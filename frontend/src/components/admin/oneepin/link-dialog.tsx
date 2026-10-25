"use client";

import { AdminModal } from "@/components/admin/ui/admin-modal";
import { Badge } from "@/components/admin/ui/badge";
import { useAdminToast } from "@/components/admin/ui/toast";
import { formatJod } from "@/components/admin/lib/money";
import {
  createMapping,
  listCatalog,
  updateMapping,
  type CatalogItem,
  type OneEpinMapping,
} from "@/components/admin/oneepin/api";
import { describeFailure } from "@/components/admin/oneepin/errors";
import {
  catalogTypeForFulfillment,
  catalogTypeLabel,
  fulfillmentForCatalogType,
  jodText,
  supplierAmount,
} from "@/components/admin/oneepin/labels";
import { DEFAULT_DRAFT, draftFromMapping, settingsFromDraft, type MappingDraft } from "@/components/admin/oneepin/mapping-draft";
import { MappingSettingsForm, type CustomerFieldInfo } from "@/components/admin/oneepin/mapping-form";
import { useAdminToken } from "@/hooks/use-admin-token";
import { asList, getProduct, listVariants, type AdminVariant } from "@/lib/api/admin";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

/** Our product option (variant) being linked. */
export type VariantRef = {
  id: number | string;
  product: string;
  /** Slug for GET admin/products/<slug>/ (the id 404s there). */
  productSlug?: string | null;
  productName: string;
  name: string;
  sku?: string | null;
  priceFils: number | null;
  fulfillmentType: string;
};

export type LinkTarget =
  | { kind: "fromCatalog"; item: CatalogItem }
  | { kind: "fromVariant"; variant: VariantRef; fields?: CustomerFieldInfo[] }
  | { kind: "edit"; mapping: OneEpinMapping };

function variantRef(v: AdminVariant): VariantRef {
  return {
    id: v.id,
    product: String(v.product ?? ""),
    productSlug: v.product_slug ?? null,
    productName: v.product_name ?? "",
    name: v.name_en || v.sku,
    sku: v.sku,
    priceFils: v.price_fils ?? null,
    fulfillmentType: v.fulfillment_type ?? "",
  };
}

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function VariantSearch({ catalogType, onPick }: { catalogType: string; onPick: (v: VariantRef) => void }) {
  const token = useAdminToken();
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const ftype = fulfillmentForCatalogType(catalogType);
  const [state, setState] = useState<{ rows: AdminVariant[]; loading: boolean; error: string }>({ rows: [], loading: true, error: "" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled || !token) return;
      setState((s) => ({ ...s, loading: true, error: "" }));
      try {
        const data = await listVariants(token, {
          search: search || undefined,
          fulfillment_type: ftype || undefined,
          exclude_archived: true,
          page_size: 20,
        });
        // Archived products are never offered (older servers ignore exclude_archived: filter here too).
        const rows = asList(data).items.filter((v) => (v.product_status ?? "").toUpperCase() !== "ARCHIVED");
        if (!cancelled) setState({ rows, loading: false, error: "" });
      } catch (err) {
        if (!cancelled) setState({ rows: [], loading: false, error: describeFailure(err, "Could not load product options.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, search, ftype]);

  return (
    <div>
      <label className="relative block">
        <span className="sr-only">Search our products</span>
        <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--clicks-muted)]" />
        <input
          autoFocus
          type="search"
          className="admin-input admin-input--lead-icon"
          placeholder="Search by product web address, option name or SKU…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <p className="mt-1 text-[11px] text-[var(--clicks-muted)]">
        Only {ftype === "DIRECT_TOPUP" ? "direct top-up" : ftype === "CODE" ? "code" : ""} products are shown — a 1Epin{" "}
        {catalogTypeLabel(catalogType).toLowerCase()} can only be linked to that kind of product.
      </p>
      <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-[var(--clicks-border)]">
        {state.error ? (
          <p className="p-3 text-[13px] text-[var(--clicks-error)]">{state.error}</p>
        ) : state.loading ? (
          <p className="p-3 text-[13px] text-[var(--clicks-muted)]">Loading…</p>
        ) : !state.rows.length ? (
          <p className="p-3 text-[13px] text-[var(--clicks-muted)]">No matching product options.</p>
        ) : (
          <ul className="divide-y divide-[var(--clicks-border)]">
            {state.rows.map((v) => (
              <li key={String(v.id)}>
                <button
                  type="button"
                  onClick={() => onPick(variantRef(v))}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-[13px] hover:bg-[#F5F7FB]"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-[var(--clicks-navy)]">
                      {v.product_name} – {v.name_en || v.sku}
                    </span>
                    <span className="block font-mono text-[11px] text-[var(--clicks-muted)]">{v.sku}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatJod(v.price_fils)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CatalogSearch({ fulfillmentType, onPick }: { fulfillmentType: string; onPick: (item: CatalogItem) => void }) {
  const token = useAdminToken();
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const type = catalogTypeForFulfillment(fulfillmentType);
  const [state, setState] = useState<{ rows: CatalogItem[]; loading: boolean; error: string }>({ rows: [], loading: true, error: "" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled || !token) return;
      setState((s) => ({ ...s, loading: true, error: "" }));
      try {
        const data = await listCatalog(token, { search: search || undefined, type: type || undefined, page_size: 25 });
        if (!cancelled) setState({ rows: data.results ?? [], loading: false, error: "" });
      } catch (err) {
        if (!cancelled) setState({ rows: [], loading: false, error: describeFailure(err, "Could not load the 1Epin catalog.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, search, type]);

  return (
    <div>
      <label className="relative block">
        <span className="sr-only">Search the 1Epin catalog</span>
        <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--clicks-muted)]" />
        <input
          autoFocus
          type="search"
          className="admin-input admin-input--lead-icon"
          placeholder="Search 1Epin products or categories, or type a 1Epin product ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <p className="mt-1 text-[11px] text-[var(--clicks-muted)]">
        Showing only 1Epin {type ? catalogTypeLabel(type).toLowerCase() : ""} products. Not finding it? Sync the catalog on the 1Epin page.
      </p>
      <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-[var(--clicks-border)]">
        {state.error ? (
          <p className="p-3 text-[13px] text-[var(--clicks-error)]">{state.error}</p>
        ) : state.loading ? (
          <p className="p-3 text-[13px] text-[var(--clicks-muted)]">Loading…</p>
        ) : !state.rows.length ? (
          <p className="p-3 text-[13px] text-[var(--clicks-muted)]">No matching 1Epin products.</p>
        ) : (
          <ul className="divide-y divide-[var(--clicks-border)]">
            {state.rows.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-[13px] hover:bg-[#F5F7FB]"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-[var(--clicks-navy)]">{item.product_name}</span>
                    <span className="block text-[11px] text-[var(--clicks-muted)]">
                      {item.category_name} · ID {item.external_product_id}
                      {item.mapped ? " · already linked" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-end tabular-nums">
                    <span className="block">{supplierAmount(item.price, item.currency)}</span>
                    <span className="block text-[11px] text-[var(--clicks-muted)]">{jodText(item.cost_jod)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function useProductFields(productSlug: string | null | undefined, enabled: boolean, given?: CustomerFieldInfo[]) {
  const token = useAdminToken();
  const [fields, setFields] = useState<CustomerFieldInfo[] | undefined>(given);
  useEffect(() => {
    if (given || !enabled || !productSlug || !token) return;
    let cancelled = false;
    getProduct(token, productSlug)
      .then((p) => {
        if (!cancelled) setFields((p.fields ?? []).map((f) => ({ key: f.key, label: f.label_en, required: f.required })));
      })
      .catch(() => {
        if (!cancelled) setFields([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, productSlug, enabled, given]);
  return given ?? fields;
}

/**
 * One dialog for linking a 1Epin product to one of our product options (from either side)
 * and for editing an existing link's settings.
 */
export function LinkDialog({
  target,
  onClose,
  onSaved,
}: {
  target: LinkTarget | null;
  onClose: () => void;
  onSaved: (mapping: OneEpinMapping, created: boolean) => void;
}) {
  if (!target) return null;
  const key = target.kind === "edit" ? `e${target.mapping.id}` : target.kind === "fromCatalog" ? `c${target.item.id}` : `v${target.variant.id}`;
  return <LinkDialogInner key={key} target={target} onClose={onClose} onSaved={onSaved} />;
}

function LinkDialogInner({
  target,
  onClose,
  onSaved,
}: {
  target: LinkTarget;
  onClose: () => void;
  onSaved: (mapping: OneEpinMapping, created: boolean) => void;
}) {
  const token = useAdminToken();
  const toast = useAdminToast();
  const [item, setItem] = useState<CatalogItem | null>(
    target.kind === "fromCatalog" ? target.item : target.kind === "edit" ? target.mapping.catalog_item : null,
  );
  const [variant, setVariant] = useState<VariantRef | null>(
    target.kind === "fromVariant"
      ? target.variant
      : target.kind === "edit"
        ? {
            id: target.mapping.variant ?? "",
            product: target.mapping.product,
            productSlug: target.mapping.product_slug ?? null,
            productName: target.mapping.product_name ?? "",
            name: target.mapping.variant_name ?? target.mapping.variant_sku ?? "",
            sku: target.mapping.variant_sku,
            priceFils: target.mapping.sale_price_fils,
            fulfillmentType: "",
          }
        : null,
  );
  const [draft, setDraft] = useState<MappingDraft>(target.kind === "edit" ? draftFromMapping(target.mapping) : { ...DEFAULT_DRAFT });
  const [errors, setErrors] = useState<Partial<Record<keyof MappingDraft, string>>>({});
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState("");

  const kind = (item?.category_type || (target.kind === "edit" ? target.mapping.category_type : "") || "").toLowerCase();
  const fields = useProductFields(variant?.productSlug, kind === "topup", target.kind === "fromVariant" ? target.fields : undefined);
  const ready = Boolean(item && variant && variant.id !== "");

  async function save() {
    if (!token) return;
    if (target.kind !== "edit" && (!item || !variant)) return;
    const result = settingsFromDraft(draft, { kind, tiered: Boolean(item?.is_tiered || (target.kind === "edit" && target.mapping.barem)) });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setServerError("");
    setPending(true);
    try {
      if (target.kind === "edit") {
        const saved = await updateMapping(token, target.mapping.id, result.body);
        toast.push("Link saved", "success");
        onSaved(saved, false);
      } else {
        if (!item || !variant) return;
        const saved = await createMapping(token, { variant_id: variant.id, catalog_item_id: item.id, ...result.body });
        toast.push(saved.counts_as_stock ? "Linked — it counts as stock." : "Linked to 1Epin.", "success");
        onSaved(saved, true);
      }
    } catch (err) {
      setServerError(describeFailure(err, "Could not save the link."));
    } finally {
      setPending(false);
    }
  }

  const title =
    target.kind === "edit" ? "Edit 1Epin link" : target.kind === "fromCatalog" ? "Link to a product option" : "Choose the 1Epin product";

  return (
    <AdminModal open title={title} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-2 text-[13px] sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--clicks-border)] px-3 py-2">
            <p className="text-[11px] text-[var(--clicks-muted)]">1Epin product</p>
            {item ? (
              <>
                <p className="font-medium text-[var(--clicks-navy)]">{item.product_name}</p>
                <p className="text-[11px] text-[var(--clicks-muted)]">
                  {item.category_name} · ID {item.external_product_id} · {supplierAmount(item.price, item.currency)} ({jodText(item.cost_jod)})
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone="info" className="normal-case tracking-normal">
                    {catalogTypeLabel(item.category_type)}
                  </Badge>
                  {!item.active ? <Badge tone="error">No longer sold</Badge> : null}
                </div>
                {target.kind === "fromVariant" ? (
                  <button type="button" className="mt-1 text-[12px] font-semibold text-[var(--clicks-blue)]" onClick={() => setItem(null)}>
                    Change
                  </button>
                ) : null}
              </>
            ) : (
              <p className="text-[var(--clicks-muted)]">{target.kind === "edit" ? "Not in the synced catalog — sync it." : "Pick below"}</p>
            )}
          </div>
          <div className="rounded-lg border border-[var(--clicks-border)] px-3 py-2">
            <p className="text-[11px] text-[var(--clicks-muted)]">Our product option</p>
            {variant ? (
              <>
                <p className="font-medium text-[var(--clicks-navy)]">
                  {variant.productName} – {variant.name}
                </p>
                <p className="text-[11px] text-[var(--clicks-muted)]">
                  {variant.sku ? `${variant.sku} · ` : ""}
                  {variant.priceFils !== null ? formatJod(variant.priceFils) : ""}
                </p>
                {target.kind === "fromCatalog" ? (
                  <button type="button" className="mt-1 text-[12px] font-semibold text-[var(--clicks-blue)]" onClick={() => setVariant(null)}>
                    Change
                  </button>
                ) : null}
              </>
            ) : (
              <p className="text-[var(--clicks-muted)]">Pick below</p>
            )}
          </div>
        </div>

        {!variant && item ? <VariantSearch catalogType={item.category_type} onPick={setVariant} /> : null}
        {!item && variant && target.kind !== "edit" ? <CatalogSearch fulfillmentType={variant.fulfillmentType} onPick={setItem} /> : null}

        {ready || target.kind === "edit" ? (
          <MappingSettingsForm
            draft={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            errors={errors}
            kind={kind}
            tiered={Boolean(item?.is_tiered || (target.kind === "edit" && target.mapping.barem))}
            unitCostFils={item?.cost_fils ?? null}
            saleFils={variant?.priceFils ?? null}
            fields={fields}
          />
        ) : null}

        {serverError ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
            {serverError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-[var(--clicks-border)] pt-3">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-primary disabled:opacity-60"
            disabled={pending || !(ready || target.kind === "edit")}
            onClick={() => void save()}
          >
            {pending ? "Saving…" : target.kind === "edit" ? "Save" : "Link"}
          </button>
        </div>
      </div>
    </AdminModal>
  );
}
