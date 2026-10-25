import { listingSlugFromHref, productsForListing } from "@/lib/listing";
import { ARTWORK_KEY_IMAGES, keywordCatalogImage } from "@/lib/static-images";
import type { Category, Product } from "@/types";

export type CategoryImageSource = Pick<Category, "slug" | "href" | "artworkKey" | "artworkUrl"> &
  Partial<Pick<Category, "name" | "nameAr">>;

/**
 * ST-30 / D20: real pictures for a category tile, best first — the category's own artwork, the image
 * of the product it links to / of a product in it, bundled artwork matching its artwork key or name.
 * The tile tries them in order and only shows the drawn placeholder when none loads.
 */
export function categoryImageCandidates(
  category: CategoryImageSource,
  products: Product[],
  categories: Category[] = [],
): string[] {
  const candidates: string[] = [];
  if (category.artworkUrl) candidates.push(category.artworkUrl);
  const target = listingSlugFromHref(category.href || `/category/${category.slug}`);
  if (target.kind === "product") {
    const linked = products.find((product) => product.slug === target.slug || product.id === target.slug);
    if (linked?.images[0]) candidates.push(linked.images[0]);
  }
  const listed = productsForListing(category.slug, products, categories).find((product) => product.images[0]);
  if (listed) candidates.push(listed.images[0]);
  const byKey = ARTWORK_KEY_IMAGES[category.artworkKey];
  if (byKey) candidates.push(byKey);
  const byName = keywordCatalogImage(category.slug, category.name, category.nameAr);
  if (byName) candidates.push(byName);
  return [...new Set(candidates.filter(Boolean))];
}

export interface HomeCategoryTile {
  id: string;
  href: string;
  /** Visible label (menu categories); static tiles carry `labelKey` instead. */
  label?: string;
  labelAr?: string;
  labelKey?: string;
  images: string[];
  artworkKey: string;
}

/**
 * D20: home category tiles from the menu categories (GET catalog/categories/?menu=1, already sorted
 * and filtered to those with products by `buildMenu`); the built-in tiles only when there are none.
 */
export function homeCategoryTiles(
  menu: ReadonlyArray<{ slug: string; href: string; label: string; labelAr: string; artworkKey: string; artworkUrl?: string }>,
  fallback: ReadonlyArray<{ id: string; href: string; image: string; artworkKey: string; labelKey: string }>,
  products: Product[],
  categories: Category[] = [],
): { source: "menu" | "static"; tiles: HomeCategoryTile[] } {
  if (menu.length) {
    return {
      source: "menu",
      tiles: menu.map((entry) => ({
        id: entry.slug,
        href: entry.href,
        label: entry.label,
        labelAr: entry.labelAr,
        artworkKey: entry.artworkKey,
        images: categoryImageCandidates(
          { slug: entry.slug, href: entry.href, artworkKey: entry.artworkKey, artworkUrl: entry.artworkUrl, name: entry.label, nameAr: entry.labelAr },
          products,
          categories,
        ),
      })),
    };
  }
  return {
    source: "static",
    tiles: fallback.map((tile) => ({ id: tile.id, href: tile.href, labelKey: tile.labelKey, artworkKey: tile.artworkKey, images: [tile.image] })),
  };
}
