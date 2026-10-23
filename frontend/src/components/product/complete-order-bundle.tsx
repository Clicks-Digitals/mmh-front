"use client";

import { ProductCover } from "@/components/product/product-artwork";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/ui/price";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { defaultRegionId, denominationsForRegion } from "@/lib/digital-options";
import { formatJod } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { CartDigitalMeta, DigitalDenomination, Product } from "@/types";
import Link from "next/link";
import { useMemo, useState } from "react";

/** A suggestion can be added in one tap only if it needs no customer fields and has a default in-stock option. */
function defaultOption(product: Product): DigitalDenomination | undefined {
  const options = product.digitalOptions;
  if (options.requiredCustomerFields.length > 0 || !product.inStock) return undefined;
  const region = defaultRegionId(options.regions);
  return denominationsForRegion(product, region).find((item) => item.inStock !== false && item.priceJod > 0);
}

function digitalFor(product: Product, denomination: DigitalDenomination, locale: "en" | "ar"): CartDigitalMeta {
  const options = product.digitalOptions;
  const region = options.regions.find((item) => item.id === denomination.regionId) ?? options.regions[0];
  return {
    regionId: region?.id ?? denomination.regionId ?? "global",
    regionName: region ? (locale === "ar" ? region.nameAr : region.name) : "",
    denominationId: denomination.id,
    denominationLabel: locale === "ar" ? denomination.labelAr : denomination.label,
    deliveryMethod: "account",
    platform: locale === "ar" ? options.platformLabelAr : options.platformLabel,
    customerFields: {},
  };
}

export function CompleteOrderBundle({
  product,
  suggestions,
  mainDigital,
  mainQuantity,
}: {
  product: Product;
  suggestions: Product[];
  /** The main product's current selection, or null when options/fields are not complete yet. */
  mainDigital: CartDigitalMeta | null;
  mainQuantity: number;
}) {
  const { t, locale } = useLanguage();
  const { addItem } = useCart();
  const { setCartOpen } = useUi();

  const extras = useMemo(
    () =>
      suggestions
        .filter((item) => item.id !== product.id)
        .map((item) => ({ product: item, option: defaultOption(item) }))
        .filter((entry): entry is { product: Product; option: DigitalDenomination } => Boolean(entry.option))
        .slice(0, 3),
    [product.id, suggestions],
  );

  // Unchecked ids (everything starts selected); no effect needed when the list changes.
  const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});

  if (extras.length === 0) return null;

  const mainDenomination = mainDigital
    ? product.digitalOptions.denominations.find((item) => item.id === mainDigital.denominationId)
    : undefined;
  const mainSelected = Boolean(mainDenomination) && !unchecked[product.id];
  const selectedExtras = extras.filter((entry) => !unchecked[entry.product.id]);
  const total =
    Math.round(
      ((mainSelected && mainDenomination ? mainDenomination.priceJod * mainQuantity : 0) +
        selectedExtras.reduce((sum, entry) => sum + entry.option.priceJod, 0)) *
        1000,
    ) / 1000;
  const canBuy = total > 0 && (mainSelected || selectedExtras.length > 0);

  const toggle = (id: string) => setUnchecked((current) => ({ ...current, [id]: !current[id] }));

  const buyTogether = () => {
    if (!canBuy) return;
    if (mainSelected && mainDigital) addItem({ productId: product.id, quantity: mainQuantity, digital: mainDigital });
    for (const entry of selectedExtras) {
      addItem({ productId: entry.product.id, quantity: 1, digital: digitalFor(entry.product, entry.option, locale) });
    }
    setCartOpen(true);
  };

  const rows = [
    {
      id: product.id,
      product,
      price: mainDenomination ? mainDenomination.priceJod * mainQuantity : null,
      label: mainDigital ? mainDigital.denominationLabel : "",
      main: true,
    },
    ...extras.map((entry) => ({
      id: entry.product.id,
      product: entry.product,
      price: entry.option.priceJod,
      label: locale === "ar" ? entry.option.labelAr : entry.option.label,
      main: false,
    })),
  ];

  return (
    <section className="mt-6 overflow-hidden rounded-2xl bg-brand-deep text-white">
      <div className="px-4 pb-2 pt-4 sm:px-5 sm:pt-5">
        <h2 className="text-lg font-bold tracking-tight sm:text-xl">{t("product.completeOrder")}</h2>
        <p className="mt-1 text-sm text-white/70">{t("product.completeOrderHint")}</p>
      </div>

      <ul className="px-4 sm:px-5">
        {rows.map((row, index) => {
          const disabled = row.main && !mainDenomination;
          const checked = !disabled && !unchecked[row.id];
          const name = locale === "ar" ? row.product.nameAr : row.product.name;
          return (
            <li key={row.id} className={cn("flex items-center gap-3 py-3", index < rows.length - 1 && "border-b border-white/10")}>
              <label className={cn("flex min-w-0 flex-1 items-center gap-3", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-[#F7C037]"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(row.id)}
                  aria-label={name}
                />
                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[#17182b]">
                  <ProductCover product={row.product} shot="cover" compact label={name} className="aspect-square h-full w-full p-0 [&_img]:p-0.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/product/${row.product.slug}`}
                    className="line-clamp-2 text-sm font-medium leading-5 text-white hover:text-gold"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {name}
                    {row.main ? <span className="ms-1 text-xs font-normal text-white/55">({t("product.completeOrderThis")})</span> : null}
                  </Link>
                  <span className="block text-xs text-white/55">
                    {disabled ? t("product.bundleNeedsOptions") : `${row.label}${row.main && mainQuantity > 1 ? ` × ${mainQuantity}` : ""}`}
                  </span>
                </span>
              </label>
              {row.price != null ? (
                <Price amount={row.price} locale={locale} size="sm" className="shrink-0 [&>span:first-child]:text-white" />
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="p-4 sm:p-5">
        <Button variant="gold" className="w-full" disabled={!canBuy} onClick={buyTogether}>
          {canBuy ? `${t("product.bundleTotal")} · ${formatJod(total, locale)}` : t("product.bundleNone")}
        </Button>
      </div>
    </section>
  );
}
