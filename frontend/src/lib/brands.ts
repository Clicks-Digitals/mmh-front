import type { Locale, Product } from "@/types";

export interface BrandSummary {
  name: string;
  nameAr: string;
  count: number;
}

/** Brands present in the live catalog with their product counts. */
export function brandsFromProducts(products: Product[]): BrandSummary[] {
  const map = new Map<string, BrandSummary>();
  for (const product of products) {
    const name = product.brand.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else {
      const sameAsPlatform = product.digitalOptions.platformLabel.trim().toLowerCase() === key;
      map.set(key, { name, nameAr: sameAsPlatform ? product.digitalOptions.platformLabelAr || name : name, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Plural form key: EN one/other; AR one/two/few (3–10)/other. */
export function brandCountKey(count: number, locale: Locale): string {
  if (count === 1) return "brands.count.one";
  if (locale === "ar") {
    if (count === 2) return "brands.count.two";
    if (count >= 3 && count <= 10) return "brands.count.few";
  }
  return "brands.count.other";
}
