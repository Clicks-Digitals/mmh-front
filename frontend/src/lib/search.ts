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
 * ST-10: common spellings / transliterations that should find the same products
 * (folded form → extra search words).
 */
const ALIASES: Record<string, string[]> = {
  بلستيشن: ["playstation"],
  بلايستيشن: ["playstation"],
  بلاستيشن: ["playstation"],
  ps: ["playstation"],
  ps4: ["playstation"],
  ps5: ["playstation"],
  psn: ["playstation"],
  سوني: ["playstation"],
  ستيم: ["steam"],
  اكسبوكس: ["xbox"],
  اكس: ["xbox"],
  ببجي: ["pubg"],
  شدات: ["pubg", "uc"],
  فري: ["free"],
  فاير: ["fire"],
  روبلوكس: ["roblox"],
  فورتنايت: ["fortnite"],
  ايتونز: ["apple"],
  ابل: ["apple"],
  جوجل: ["google"],
  قوقل: ["google"],
  نينتندو: ["nintendo"],
  فالورانت: ["valorant"],
};

/** Query words, with the space-free form of the whole query and known aliases as alternatives. */
export function queryAlternatives(query: string): string[][] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const groups = tokens.map((token) => [token, ...(ALIASES[token] ?? [])]);
  const compact = tokens.join("");
  // "بلاي ستيشن" typed with a space should also match the one-word spelling (and vice versa).
  if (tokens.length > 1) groups.push([compact, ...(ALIASES[compact] ?? [])]);
  return groups;
}

function tokenMatches(token: string, text: string, compact: string, words: string[]): boolean {
  if (token.length >= 3) return text.includes(token) || compact.includes(token);
  return words.some((word) => word.startsWith(token));
}

/**
 * A product matches when every query token (or one of its aliases) appears in its searchable text
 * (as a word prefix, or anywhere for tokens of 3+ characters; spaces inside names are ignored).
 * A multi-word query also matches when the words written together appear (and vice versa).
 */
export function matchesQuery(product: Product, query: string): boolean {
  const tokens = tokenize(query);
  if (!tokens.length) return true;
  const text = productSearchText(product);
  const compact = text.replace(/\s+/g, "");
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const groups = tokens.map((token) => [token, ...(ALIASES[token] ?? [])]);
  if (groups.every((group) => group.some((token) => tokenMatches(token, text, compact, words)))) return true;
  if (tokens.length > 1) {
    const joined = tokens.join("");
    return [joined, ...(ALIASES[joined] ?? [])].some((token) => tokenMatches(token, text, compact, words));
  }
  return false;
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
  const compact = text.replace(/\s+/g, "");
  return tokens.every((token) => [token, ...(ALIASES[token] ?? [])].some((word) => text.includes(word) || compact.includes(word)));
}
