"use client";

import { CATEGORIES } from "@/data/categories";
import { PRODUCTS, matchesCategoryGroup } from "@/data/products";
import { getSnapshotCategories, getSnapshotProducts } from "@/lib/catalog-snapshot";
import { useLanguage } from "@/context/language-context";
import { ProductArtwork } from "@/components/product/product-artwork";
import { Price } from "@/components/ui/price";
import Link from "next/link";

export type MegaKey = "shop" | "topups" | "gifts" | "playstation" | "mobile";

const MEGA: Record<MegaKey, { slugs: string[]; featured?: string }> = {
  shop: {
    slugs: [
      "game-top-ups",
      "gift-cards",
      "playstation",
      "steam",
      "mobile-games",
      "subscriptions",
      "best-sellers",
      "new-products",
      "special-offers",
    ],
    featured: "psn-store",
  },
  topups: {
    slugs: ["pubg-mobile", "free-fire", "mobile-legends", "roblox", "valorant", "fortnite", "ea-sports-fc"],
    featured: "pubg-uc",
  },
  gifts: {
    slugs: ["playstation", "steam", "xbox", "nintendo", "apple", "google-play", "razer-gold"],
    featured: "steam-wallet",
  },
  playstation: {
    slugs: ["playstation", "subscriptions", "gift-cards"],
    featured: "psn-store",
  },
  mobile: {
    slugs: ["pubg-mobile", "free-fire", "mobile-legends", "roblox"],
    featured: "roblox-card",
  },
};

export function MegaMenu({ type, onNavigate }: { type: MegaKey; onNavigate?: () => void }) {
  const { t, locale } = useLanguage();
  const config = MEGA[type];
  const categorySource = getSnapshotCategories();
  const productSource = getSnapshotProducts();
  const cats = (categorySource.length ? categorySource : CATEGORIES).filter((category) => config.slugs.includes(category.slug));
  const products = productSource.length ? productSource : PRODUCTS;
  // A product ticked "Featured" in the panel wins; the configured product is the fallback.
  const featured =
    products.find(
      (product) =>
        product.featured &&
        config.slugs.some(
          (slug) => product.category === slug || product.platform === slug || matchesCategoryGroup(slug, product),
        ),
    ) ?? products.find((product) => product.id === config.featured);

  return (
    <div className="container-mmh grid gap-6 py-6 lg:grid-cols-[1fr_260px]" role="navigation" aria-label={t("nav.shop")}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cats.map((category) => (
          <Link
            key={category.slug}
            href={category.href}
            onClick={onNavigate}
            className="rounded-[12px] border border-line bg-card p-4 transition-colors hover:bg-brand/16 hover:text-gold"
            data-mega-item
          >
            <p className="text-sm font-semibold">{locale === "ar" ? category.nameAr : category.name}</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              {locale === "ar" ? category.descriptionAr : category.description}
            </p>
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
          <ProductArtwork product={featured} className="h-36 aspect-[16/10]" />
          <div className="p-3">
            <p className="text-[11px] uppercase tracking-wide text-gold">{t("home.featured")}</p>
            <p className="mt-1 text-sm font-semibold">{locale === "ar" ? featured.nameAr : featured.name}</p>
            <Price amount={featured.priceJod} compareAt={featured.compareAtPriceJod} locale={locale} size="sm" />
          </div>
        </Link>
      ) : null}
    </div>
  );
}
