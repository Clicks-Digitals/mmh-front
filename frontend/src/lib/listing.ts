import type { Category, Product } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;
export const NEW_PRODUCTS_DAYS = 30;
export const NEW_PRODUCTS_MIN = 12;

/** Navigation groupings that are not stored as categories in the backend. */
const GROUPS: Record<string, (product: Product) => boolean> = {
  playstation: (product) => product.platform === "playstation",
  steam: (product) => product.platform === "steam",
  xbox: (product) => product.platform === "xbox",
  nintendo: (product) => product.platform === "nintendo",
  "mobile-games": (product) => ["pubg", "freefire", "free-fire", "mlbb", "roblox"].includes(product.platform),
  "pc-games": (product) => ["steam", "valorant", "lol", "riot", "ea", "fortnite"].includes(product.platform),
  "game-top-ups": (product) => product.fulfillmentType === "direct_topup" || product.category === "game-top-ups",
  "gift-cards": (product) =>
    product.category === "gift-cards" ||
    product.digitalOptions.kind === "gift_card" ||
    product.digitalOptions.kind === "wallet",
  "wallet-cards": (product) => product.digitalOptions.kind === "wallet",
  "game-currencies": (product) =>
    product.digitalOptions.kind === "game_currency" || product.fulfillmentType === "direct_topup",
  subscriptions: (product) => product.digitalOptions.kind === "subscription" || product.category === "subscriptions",
  entertainment: (product) => ["apple", "google", "nintendo"].includes(product.platform),
  "mobile-credit": (product) => ["google", "apple", "razer"].includes(product.platform),
  "best-sellers": (product) => Boolean(product.bestseller),
  "special-offers": (product) => Boolean(product.compareAtPriceJod && product.compareAtPriceJod > product.priceJod),
  deals: (product) => Boolean(product.compareAtPriceJod && product.compareAtPriceJod > product.priceJod),
};

export function isListingGroup(slug: string): boolean {
  return slug in GROUPS || slug === "new-products";
}

/** Newest products: everything added in the last 30 days, or at least the newest 12. */
export function newestProducts(products: Product[], now: number = Date.now()): Product[] {
  const sorted = [...products].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const cutoff = now - NEW_PRODUCTS_DAYS * DAY_MS;
  const recent = sorted.filter((product) => {
    const time = Date.parse(product.createdAt);
    return Number.isFinite(time) && time >= cutoff;
  });
  return recent.length >= NEW_PRODUCTS_MIN ? recent : sorted.slice(0, NEW_PRODUCTS_MIN);
}

function descendantsOf(slug: string, categories: Category[]): Set<string> {
  const result = new Set<string>([slug]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parent && result.has(category.parent) && !result.has(category.slug)) {
        result.add(category.slug);
        changed = true;
      }
    }
  }
  return result;
}

/** Products shown on /category/<slug> (and the equivalent top-level listing pages). */
export function productsForListing(
  slug: string,
  products: Product[],
  categories: Category[] = [],
  now: number = Date.now(),
): Product[] {
  if (!slug) return products;
  if (slug === "new-products") return newestProducts(products, now);
  const descendants = descendantsOf(slug, categories);
  const group = GROUPS[slug];
  return products.filter(
    (product) => descendants.has(product.category) || product.platform === slug || Boolean(group?.(product)),
  );
}

/** Slug of a listing href: /category/x → x, /gift-cards → gift-cards, /deals → deals, /shop → "". */
export function listingSlugFromHref(href: string): { kind: "product" | "listing" | "other"; slug: string } {
  const path = href.split(/[?#]/)[0];
  const product = path.match(/^\/product\/([^/]+)\/?$/);
  if (product) return { kind: "product", slug: decodeURIComponent(product[1]) };
  const category = path.match(/^\/category\/([^/]+)\/?$/);
  if (category) return { kind: "listing", slug: decodeURIComponent(category[1]) };
  if (path === "/gift-cards") return { kind: "listing", slug: "gift-cards" };
  if (path === "/game-top-ups") return { kind: "listing", slug: "game-top-ups" };
  if (path === "/deals") return { kind: "listing", slug: "deals" };
  if (path === "/shop") return { kind: "listing", slug: "" };
  return { kind: "other", slug: "" };
}

/** Whether a navigation link leads to a page with at least one product. Unknown pages are kept. */
export function hrefHasProducts(href: string, products: Product[], categories: Category[] = []): boolean {
  const target = listingSlugFromHref(href);
  if (target.kind === "other") return true;
  if (target.kind === "product") return products.some((product) => product.slug === target.slug);
  if (!target.slug) return products.length > 0;
  const known = isListingGroup(target.slug) || categories.some((category) => category.slug === target.slug);
  if (!known) return false;
  return productsForListing(target.slug, products, categories).length > 0;
}
