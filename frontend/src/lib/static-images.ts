/** Product ids with bundled artwork in public/catalog (seed catalog). Others render the artwork placeholder. */
export const STATIC_CATALOG_IMAGE_IDS = new Set([
  "apple-gift",
  "ea-fc-points",
  "fortnite-vbucks",
  "free-fire",
  "google-play",
  "lol-card",
  "mlbb-diamonds",
  "nintendo-eshop",
  "ps-plus",
  "psn-store",
  "pubg-uc",
  "razer-gold",
  "roblox-card",
  "steam-wallet",
  "valorant-points",
  "xbox-gift",
]);

export function staticCatalogImage(productId: string): string {
  return STATIC_CATALOG_IMAGE_IDS.has(productId) ? `/catalog/${productId}.webp` : "";
}
