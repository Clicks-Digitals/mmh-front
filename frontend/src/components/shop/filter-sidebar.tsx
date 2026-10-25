"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { choiceClass } from "@/components/ui/control";
import { CATEGORIES } from "@/data/categories";
import { getSnapshotCategories, getSnapshotProducts } from "@/lib/catalog-snapshot";
import { uniqueBrands, uniqueKinds, uniquePlatformOptions, uniqueRegions, priceRange } from "@/data/products";
import { emptyFilters, normalizePriceRange } from "@/lib/catalog";
import { useState } from "react";
import { useLanguage } from "@/context/language-context";
import type { FilterState, FulfillmentType, ProductKind } from "@/types";
import { cn } from "@/lib/cn";

interface FiltersProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  lockedCategory?: string;
  showReset?: boolean;
  /** ST-26: shown when the price bounds were corrected (negative / swapped). */
  priceNote?: string;
}

const KINDS: ProductKind[] = ["gift_card", "wallet", "game_currency", "subscription", "direct_topup", "digital_code"];

export function FilterSidebar(props: FiltersProps) {
  // Remount when the applied bounds change so the price inputs show the corrected values.
  return <FilterSidebarInner key={`${props.value.min ?? ""}|${props.value.max ?? ""}`} {...props} />;
}

function FilterSidebarInner({ value, onChange, lockedCategory, showReset = true, priceNote }: FiltersProps) {
  const { t, locale } = useLanguage();
  const range = priceRange();
  const databaseCategories = getSnapshotCategories();
  const categories = databaseCategories.length ? databaseCategories : CATEGORIES;
  const hasReviews = getSnapshotProducts().some((product) => product.reviewCount > 0);
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const [minText, setMinText] = useState(value.min != null ? String(value.min) : "");
  const [maxText, setMaxText] = useState(value.max != null ? String(value.max) : "");
  const applyPrice = () => {
    const parse = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) ? undefined : Number(text));
    const min = parse(minText);
    const max = parse(maxText);
    const range = normalizePriceRange(min, max);
    if (range.adjusted || min !== value.min || max !== value.max) set({ min, max });
  };

  return (
    <aside className="space-y-6">
      <Field
        label={t("nav.search")}
        value={value.q ?? ""}
        onChange={(event) => set({ q: event.target.value })}
        placeholder={t("common.searchPlaceholder")}
      />
      <SelectField
        label={t("filter.category")}
        value={value.category ?? ""}
        disabled={Boolean(lockedCategory)}
        onChange={(event) => set({ category: event.target.value })}
      >
        <option value="">{t("common.viewAll")}</option>
        {categories.map((category) => (
          <option key={category.slug} value={category.slug}>
            {locale === "ar" ? category.nameAr : category.name}
          </option>
        ))}
      </SelectField>
      <SelectField label={t("filter.brand")} value={value.brand ?? ""} onChange={(event) => set({ brand: event.target.value })}>
        <option value="">{t("common.viewAll")}</option>
        {uniqueBrands().map((brand) => (
          <option key={brand} value={brand}>
            {brand}
          </option>
        ))}
      </SelectField>
      <div>
        <p className="mb-2 text-sm font-medium">{t("filter.type")}</p>
        <div className="flex flex-wrap gap-2">
          {(["", "code", "direct_topup"] as const).map((type) => (
            <button
              key={type || "all"}
              type="button"
              onClick={() => set({ type: type as FulfillmentType | "" })}
              className={choiceClass(value.type === type, "h-10")}
            >
              {type === "code" ? t("filter.code") : type === "direct_topup" ? t("filter.topup") : t("common.viewAll")}
            </button>
          ))}
        </div>
      </div>
      <SelectField
        label={t("filter.kind")}
        value={value.kind ?? ""}
        onChange={(event) => set({ kind: event.target.value as ProductKind | "" })}
      >
        <option value="">{t("common.viewAll")}</option>
        {KINDS.filter((kind) => uniqueKinds().includes(kind)).map((kind) => (
          <option key={kind} value={kind}>
            {t(`filter.kind.${kind}`)}
          </option>
        ))}
      </SelectField>
      <div>
        <div className="grid grid-cols-2 gap-2">
          <Field
            label={`${t("filter.price")} · ${t("filter.min")}`}
            type="number"
            min={0}
            max={range.max || undefined}
            inputMode="decimal"
            value={minText}
            onChange={(event) => setMinText(event.target.value)}
            onBlur={applyPrice}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyPrice();
            }}
          />
          <Field
            label={t("filter.max")}
            type="number"
            min={0}
            max={range.max || undefined}
            inputMode="decimal"
            value={maxText}
            onChange={(event) => setMaxText(event.target.value)}
            onBlur={applyPrice}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyPrice();
            }}
          />
        </div>
        {priceNote ? <p className="mt-1 text-xs text-amber" role="status">{priceNote}</p> : null}
      </div>
      <SelectField
        label={t("filter.platform")}
        value={value.platform ?? ""}
        onChange={(event) => set({ platform: event.target.value })}
      >
        <option value="">{t("common.viewAll")}</option>
        {uniquePlatformOptions().map((platform) => (
          <option key={platform.slug} value={platform.slug}>
            {locale === "ar" ? platform.nameAr : platform.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={t("filter.region")}
        value={value.region ?? ""}
        onChange={(event) => set({ region: event.target.value })}
      >
        <option value="">{t("common.viewAll")}</option>
        {uniqueRegions().map((region) => (
          <option key={region.id} value={region.id}>
            {locale === "ar" ? region.nameAr : region.name}
          </option>
        ))}
      </SelectField>
      {hasReviews ? (
        <SelectField
          label={t("filter.rating")}
          value={value.rating ? String(value.rating) : ""}
          onChange={(event) => set({ rating: event.target.value ? Number(event.target.value) : undefined })}
        >
          <option value="">{t("filter.ratingAll")}</option>
          <option value="4">4+</option>
          <option value="4.5">4.5+</option>
        </SelectField>
      ) : null}
      <label className="flex min-h-11 items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={value.availability === "in_stock"}
          onChange={(event) => set({ availability: event.target.checked ? "in_stock" : "" })}
        />
        {t("filter.inStock")}
      </label>
      <label className="flex min-h-11 items-center gap-2.5 text-sm">
        <input type="checkbox" checked={Boolean(value.discount)} onChange={(event) => set({ discount: event.target.checked })} />
        {t("filter.discount")}
      </label>
      {showReset ? (
        <Button
          variant="ghost"
          className={cn("w-full")}
          onClick={() => onChange(emptyFilters({ sort: value.sort, view: value.view, category: lockedCategory }))}
        >
          {t("common.resetFilters")}
        </Button>
      ) : null}
    </aside>
  );
}
