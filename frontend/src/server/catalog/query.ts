import { matchesCategoryGroup } from "@/data/products";
import { applyFilters } from "@/lib/catalog";
import { resolveStorefrontCategories, resolveStorefrontProducts } from "@/server/catalog/resolve";
import type { FilterState, Product } from "@/types";

function categoryMatches(product: Product, slug: string, descendants: Set<string>) {
  if (descendants.has(product.category) || product.platform === slug) return true;
  if (slug === "game-top-ups") return product.fulfillmentType === "direct_topup";
  if (slug === "gift-cards") return ["gift_card", "wallet"].includes(product.digitalOptions.kind);
  if (slug === "deals" || slug === "special-offers") {
    return Boolean(product.compareAtPriceJod && product.compareAtPriceJod > product.priceJod);
  }
  if (slug === "new-products") return product.badges.includes("new");
  return matchesCategoryGroup(slug, product);
}

export async function queryPublishedProducts(filters: FilterState, lockedCategory?: string) {
  const [productsAll, categories] = await Promise.all([
    resolveStorefrontProducts(),
    resolveStorefrontCategories(),
  ]);
  let products = productsAll;

  const requestedCategory = lockedCategory || filters.category;
  if (requestedCategory) {
    const root = categories.find((category) => category.slug === requestedCategory);
    // Static categories use slug parents; DB-mapped ones do too after resolve.
    const descendants = new Set<string>([requestedCategory]);
    if (root) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const category of categories) {
          const parentSlug = category.parent;
          if (parentSlug && descendants.has(parentSlug) && !descendants.has(category.slug)) {
            descendants.add(category.slug);
            changed = true;
          }
        }
      }
    }
    products = products.filter((product) => categoryMatches(product, requestedCategory, descendants));
  }

  const sortableFilters =
    filters.sort === "rating" && !products.some((product) => product.reviewCount > 0)
      ? { ...filters, sort: "featured" as const }
      : filters;
  return applyFilters(products, { ...sortableFilters, category: "" });
}
