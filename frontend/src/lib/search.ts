import type { Product } from "@/types";

/**
 * Fold text for matching: lower-case, strip Latin diacritics and Arabic tashkeel/tatweel,
 * unify common Arabic letter variants (أ/إ/آ → ا, ى → ي, ة → ه), Arabic-Indic digits → 0-9.
 */
export function foldText(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase();
}

/** Split a query into folded tokens. Punctuation separates tokens; "$10" → ["10"], "v-bucks" → ["v", "bucks"]. */
export function tokenize(value: string): string[] {
  return foldText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Every searchable string of a product. */
export function productSearchText(product: Product): string {
  const options = product.digitalOptions;
  return foldText(
    [
      product.name,
      product.nameAr,
      product.brand,
      product.platform,
      product.category,
      product.slug.replace(/-/g, " "),
      options.platformLabel,
      options.platformLabelAr,
      options.kind.replace(/_/g, " "),
      product.fulfillmentType === "direct_topup" ? "top up topup شحن" : "code card كود بطاقة",
      ...product.tags,
      ...options.regions.flatMap((region) => [region.id, region.name, region.nameAr, region.currency ?? ""]),
      ...options.denominations.flatMap((item) => [item.label, item.labelAr, item.currency, String(item.value)]),
    ].join(" "),
  );
}

/**
 * A product matches when every query token appears in its searchable text
 * (as a word prefix, or anywhere for tokens of 3+ characters).
 */
export function matchesQuery(product: Product, query: string): boolean {
  const tokens = tokenize(query);
  if (!tokens.length) return true;
  const text = productSearchText(product);
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.every((token) =>
    token.length >= 3 ? text.includes(token) : words.some((word) => word.startsWith(token)),
  );
}

/** Rank: name matches first, then brand/platform, then everything else. */
export function searchCatalog(products: Product[], query: string): Product[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const scored = products
    .filter((product) => matchesQuery(product, query))
    .map((product) => {
      const name = foldText(`${product.name} ${product.nameAr}`);
      const brand = foldText(`${product.brand} ${product.digitalOptions.platformLabel}`);
      const score = tokens.reduce(
        (sum, token) => sum + (name.includes(token) ? 3 : 0) + (brand.includes(token) ? 2 : 0),
        0,
      );
      return { product, score };
    });
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.product);
}

export function categoryMatchesQuery(category: { name: string; nameAr: string; slug: string }, query: string): boolean {
  const tokens = tokenize(query);
  if (!tokens.length) return false;
  const text = foldText(`${category.name} ${category.nameAr} ${category.slug.replace(/-/g, " ")}`);
  return tokens.every((token) => text.includes(token));
}
