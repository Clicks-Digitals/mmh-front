"use client";

import { MEGA_GROUPS, type MegaKey } from "@/data/navigation";
import { catalog } from "@/data/products";
import { getSnapshotCategories } from "@/lib/catalog-snapshot";
import { productsForListing } from "@/lib/listing";
import { categoryTiles, platformTiles, staticTiles, type MenuTile } from "@/lib/nav-menu";
import { useLanguage } from "@/context/language-context";
import { ProductCover } from "@/components/product/product-artwork";
import { Price } from "@/components/ui/price";
import { brandCountKey } from "@/lib/brands";
import Link from "next/link";

export type { MegaKey };

const FEATURE_SOURCE: Record<MegaKey, string> = {
  shop: "",
  topups: "game-top-ups",
  gifts: "gift-cards",
  playstation: "playstation",
  mobile: "mobile-games",
};

/** Tiles for a mega menu panel — built only from data that exists, so every tile leads to products. */
export function megaTiles(type: MegaKey): MenuTile[] {
  const products = catalog();
  const categories = getSnapshotCategories();
  const group = MEGA_GROUPS[type];
  const fixed = staticTiles(group.links, products, categories);
  const platforms = group.platformsOf ? platformTiles(group.platformsOf, products, categories) : [];
  const seen = new Set([...fixed, ...platforms].map((tile) => tile.href));
  const live = type === "shop" ? categoryTiles(categories, products, seen) : [];
  return [...platforms, ...fixed, ...live];
}

export function MegaMenu({ type, onNavigate }: { type: MegaKey; onNavigate?: () => void }) {
  const { t, locale } = useLanguage();
  const tiles = megaTiles(type);
  const products = catalog();
  const pool = FEATURE_SOURCE[type] ? productsForListing(FEATURE_SOURCE[type], products, getSnapshotCategories()) : products;
  const featured = pool.find((product) => product.featured && product.inStock) ?? pool.find((product) => product.inStock);

  if (!tiles.length) return null;

  return (
    <div className="container-mmh grid gap-6 py-6 lg:grid-cols-[1fr_260px]" role="navigation" aria-label={t("nav.shop")}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            onClick={onNavigate}
            className="rounded-[12px] border border-line bg-card p-4 transition-colors hover:bg-brand/16 hover:text-gold"
            data-mega-item
          >
            <p className="text-sm font-semibold">
              {tile.labelKey ? t(tile.labelKey) : locale === "ar" ? tile.labelAr || tile.label : tile.label}
            </p>
            {tile.count > 0 ? (
              <p className="mt-1 text-xs text-muted">
                {t(brandCountKey(tile.count, locale), { count: tile.count })}
              </p>
            ) : null}
          </Link>
        ))}
      </div>
      {featured ? (
        <Link
          href={`/product/${featured.slug}`}
          onClick={onNavigate}
          className="overflow-hidden rounded-[12px] border border-line bg-card-hover"
          data-mega-item
        >
          <ProductCover product={featured} className="aspect-[16/10] h-36 w-full" compact />
          <div className="p-3">
            <p className="text-[11px] uppercase tracking-wide text-gold">{t("nav.megaFeatured")}</p>
            <p className="mt-1 text-sm font-semibold">{locale === "ar" ? featured.nameAr : featured.name}</p>
            <Price amount={featured.priceJod} compareAt={featured.compareAtPriceJod} locale={locale} size="sm" />
          </div>
        </Link>
      ) : null}
    </div>
  );
}
