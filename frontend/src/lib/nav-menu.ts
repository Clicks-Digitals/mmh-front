import { hrefHasProducts, productsForListing } from "@/lib/listing";
import type { Category, Product } from "@/types";

export interface MenuTile {
  href: string;
  labelKey?: string;
  label?: string;
  labelAr?: string;
  count: number;
}

const PLATFORM_SOURCE: Record<string, string> = {
  topups: "game-top-ups",
  gifts: "gift-cards",
  mobile: "mobile-games",
  playstation: "playstation",
};

/** One tile per platform that has products in the given listing (→ /category/<platform>). */
export function platformTiles(listing: string, products: Product[], categories: Category[] = []): MenuTile[] {
  const source = productsForListing(PLATFORM_SOURCE[listing] ?? listing, products, categories);
  const byPlatform = new Map<string, MenuTile>();
  for (const product of source) {
    const slug = product.platform;
    if (!slug) continue;
    const existing = byPlatform.get(slug);
    if (existing) existing.count += 1;
    else
      byPlatform.set(slug, {
        href: `/category/${slug}`,
        label: product.digitalOptions.platformLabel || product.brand,
        labelAr: product.digitalOptions.platformLabelAr || product.digitalOptions.platformLabel || product.brand,
        count: 1,
      });
  }
  return [...byPlatform.values()].sort((a, b) => b.count - a.count);
}

export function staticTiles(
  links: Array<{ href: string; labelKey: string }>,
  products: Product[],
  categories: Category[] = [],
): MenuTile[] {
  return links
    .filter((link) => hrefHasProducts(link.href, products, categories))
    .map((link) => ({ href: link.href, labelKey: link.labelKey, count: 0 }));
}

/** Live top-level categories with products that are not already linked. */
export function categoryTiles(categories: Category[], products: Product[], exclude: Set<string>): MenuTile[] {
  return categories
    .filter((category) => !category.parent && !exclude.has(category.href))
    .map((category) => ({
      href: category.href,
      label: category.name,
      labelAr: category.nameAr,
      count: productsForListing(category.slug, products, categories).length,
    }))
    .filter((tile) => tile.count > 0);
}
