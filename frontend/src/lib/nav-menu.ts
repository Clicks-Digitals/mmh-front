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

/** One entry of the admin-managed menu (D20). */
export interface MenuEntry {
  slug: string;
  href: string;
  label: string;
  labelAr: string;
  artworkKey: string;
  artworkUrl?: string;
  children: MenuEntry[];
}

function bySort(a: Category, b: Category) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);
}

function entryOf(category: Category, children: MenuEntry[] = []): MenuEntry {
  return {
    slug: category.slug,
    href: category.href || `/category/${category.slug}`,
    label: category.name,
    labelAr: category.nameAr || category.name,
    artworkKey: category.artworkKey,
    ...(category.artworkUrl ? { artworkUrl: category.artworkUrl } : {}),
    children,
  };
}

/**
 * D20: header / mega menu / mobile menu / home tiles from the categories flagged "show in menu"
 * (API order: sort_order, name). Top level = menu categories without a menu parent; children are
 * their published sub-categories. Entries that lead to no products are dropped (unless a child
 * has products). An empty result means "use the built-in navigation".
 */
export function buildMenu(menuCategories: Category[], allCategories: Category[], products: Product[]): MenuEntry[] {
  const menu = menuCategories.filter((category) => category.showInMenu !== false);
  const menuSlugs = new Set(menu.map((category) => category.slug));
  const pool = new Map<string, Category>();
  for (const category of [...allCategories, ...menu]) pool.set(category.slug, category);
  const categories = [...pool.values()];
  const hasProducts = (category: Category) =>
    products.length === 0 || hrefHasProducts(category.href || `/category/${category.slug}`, products, categories);
  const seen = new Set<string>();
  const top = menu.filter((category) => !category.parent || !menuSlugs.has(category.parent)).sort(bySort);
  const entries: MenuEntry[] = [];
  for (const category of top) {
    const children = categories
      .filter((child) => child.parent === category.slug)
      .sort(bySort)
      .filter(hasProducts)
      .map((child) => entryOf(child))
      .filter((child) => {
        if (seen.has(child.href)) return false;
        seen.add(child.href);
        return true;
      });
    const href = category.href || `/category/${category.slug}`;
    if (seen.has(href)) continue;
    if (!hasProducts(category) && !children.length) continue;
    seen.add(href);
    entries.push(entryOf(category, children));
  }
  return entries;
}

export interface FooterColumn {
  titleKey: string;
  links: Array<{ href: string; label: string }>;
}

/** ST-24 / D19: each href appears once across the footer; extra (CMS) links go into `extraColumn`. */
export function dedupeFooterColumns(
  columns: FooterColumn[],
  extra: Array<{ href: string; label: string }> = [],
  extraColumn = "",
): FooterColumn[] {
  const seen = new Set<string>();
  const result = columns.map((column) => ({
    titleKey: column.titleKey,
    links: column.links.filter((link) => {
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    }),
  }));
  const target = result.find((column) => column.titleKey === extraColumn) ?? result.at(-1);
  if (target) {
    for (const link of extra) {
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      target.links.push(link);
    }
  }
  return result.filter((column) => column.links.length);
}

/** De-duplicate links by href, keeping the first (ST-24). */
export function uniqueByHref<T extends { href: string }>(links: T[]): T[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.href)) return false;
    seen.add(link.href);
    return true;
  });
}
