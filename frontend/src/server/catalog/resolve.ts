import { CATEGORIES } from "@/data/categories";
import { PRODUCTS } from "@/data/products";
import { allowStaticCatalogFallback } from "@/lib/catalog-fallback";
import { ApiError } from "@/lib/api/client";
import { fetchApiCategories, fetchApiProduct, fetchApiProducts } from "@/server/catalog/from-api";
import type { Category, Product } from "@/types";

/** Load published products from Django API; the static catalog is only a development fallback. */
export async function resolveStorefrontProducts(): Promise<Product[]> {
  try {
    const rows = await fetchApiProducts();
    if (rows.length || !allowStaticCatalogFallback()) return rows;
  } catch {
    /* fall through */
  }
  return allowStaticCatalogFallback() ? PRODUCTS : [];
}

export async function resolveStorefrontCategories(): Promise<Category[]> {
  try {
    const rows = await fetchApiCategories();
    if (rows.length || !allowStaticCatalogFallback()) return rows;
  } catch {
    /* fall through */
  }
  return allowStaticCatalogFallback() ? CATEGORIES : [];
}

export async function resolveStorefrontProduct(slug: string): Promise<Product | undefined> {
  try {
    const row = await fetchApiProduct(slug);
    if (row) return row;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      if (!allowStaticCatalogFallback()) throw error;
    }
  }
  if (!allowStaticCatalogFallback()) return undefined;
  return PRODUCTS.find((product) => product.slug === slug);
}

export function isStaticCatalogFallbackEnabled(): boolean {
  return allowStaticCatalogFallback();
}
