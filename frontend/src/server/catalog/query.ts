import { applyFilters } from "@/lib/catalog";
import { productsForListing } from "@/lib/listing";
import { resolveStorefrontCategories, resolveStorefrontProducts } from "@/server/catalog/resolve";
import type { FilterState } from "@/types";

export async function queryPublishedProducts(filters: FilterState, lockedCategory?: string) {
  const [productsAll, categories] = await Promise.all([resolveStorefrontProducts(), resolveStorefrontCategories()]);
  const requestedCategory = lockedCategory || filters.category;
  const products = requestedCategory ? productsForListing(requestedCategory, productsAll, categories) : productsAll;
  const sortableFilters =
    filters.sort === "rating" && !products.some((product) => product.reviewCount > 0)
      ? { ...filters, sort: "featured" as const }
      : filters;
  return applyFilters(products, { ...sortableFilters, category: "" });
}
