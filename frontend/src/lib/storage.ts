export const STORAGE_KEYS = {
  cart: "mmh-cart",
  coupon: "mmh-cart-coupon",
  wishlist: "mmh-wishlist",
  locale: "mmh-locale",
  recentSearches: "mmh-recent-searches",
  recentlyViewed: "mmh-recently-viewed",
  user: "mmh-user",
  checkout: "mmh-checkout-draft",
} as const;

export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}
