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

/** Bundled artwork per artwork key (seed catalog), used before falling back to the SVG placeholder. */
export const ARTWORK_KEY_IMAGES: Record<string, string> = {
  "card-psn": "/catalog/psn-store.webp",
  "card-psplus": "/catalog/ps-plus.webp",
  "card-steam": "/catalog/steam-wallet.webp",
  "card-xbox": "/catalog/xbox-gift.webp",
  "card-nintendo": "/catalog/nintendo-eshop.webp",
  "card-apple": "/catalog/apple-gift.webp",
  "card-google": "/catalog/google-play.webp",
  "card-razer": "/catalog/razer-gold.webp",
  "card-roblox": "/catalog/roblox-card.webp",
  "card-pubg": "/catalog/pubg-uc.webp",
  "card-ff": "/catalog/free-fire.webp",
  "card-mlbb": "/catalog/mlbb-diamonds.webp",
  "card-valorant": "/catalog/valorant-points.webp",
  "card-fortnite": "/catalog/fortnite-vbucks.webp",
  "card-ea": "/catalog/ea-fc-points.webp",
  "card-lol": "/catalog/lol-card.webp",
};

/** Keyword (in a category slug / name) → bundled artwork. First match wins, so specific words go first. */
const KEYWORD_IMAGES: Array<[RegExp, string]> = [
  [/pubg|ببجي/, "/catalog/pubg-uc.webp"],
  [/free[\s-]?fire|فري فاير/, "/catalog/free-fire.webp"],
  [/mobile[\s-]?legends|mlbb|موبايل ليجندز/, "/catalog/mlbb-diamonds.webp"],
  [/roblox|روبلوكس/, "/catalog/roblox-card.webp"],
  [/valorant|فالورانت/, "/catalog/valorant-points.webp"],
  [/fortnite|فورتنايت/, "/catalog/fortnite-vbucks.webp"],
  [/league|\blol\b/, "/catalog/lol-card.webp"],
  [/\bea\b|ea[\s-]?(sports|fc)|fc[\s-]?points/, "/catalog/ea-fc-points.webp"],
  [/ps[\s-]?plus|playstation[\s-]?plus|subscription|اشتراك/, "/catalog/ps-plus.webp"],
  [/playstation|\bpsn\b|بلايستيشن/, "/catalog/psn-store.webp"],
  [/steam|ستيم/, "/catalog/steam-wallet.webp"],
  [/xbox|إكس ?بوكس/, "/catalog/xbox-gift.webp"],
  [/nintendo|نينتندو/, "/catalog/nintendo-eshop.webp"],
  [/apple|itunes|آبل|ابل/, "/catalog/apple-gift.webp"],
  [/google|جوجل/, "/catalog/google-play.webp"],
  [/razer|ريزر/, "/catalog/razer-gold.webp"],
];

/** Bundled artwork matching a category's slug / names (e.g. "pubg-mobile" → PUBG UC art), or "". */
export function keywordCatalogImage(...texts: Array<string | null | undefined>): string {
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  if (!haystack) return "";
  return KEYWORD_IMAGES.find(([pattern]) => pattern.test(haystack))?.[1] ?? "";
}
