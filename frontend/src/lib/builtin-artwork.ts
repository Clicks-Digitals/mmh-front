/**
 * Built-in pictures — the ONLY fallback when staff have not uploaded a picture for an entity
 * (category, platform, home tile). Rules:
 *   1. the entity's uploaded picture (`image_url` from the API), else
 *   2. the bundled picture of the entity's own built-in key (picked in the panel under
 *      "Advanced → Built-in picture"), or of its web address (slug) when that names a known brand, else
 *   3. the drawn placeholder (`CategoryArtwork`).
 * Never another entity's photo (no "first product in the category" guessing).
 */

export interface BuiltinArtwork {
  key: string;
  label: string;
  /** Bundled picture in /public; drawn-only keys have none. */
  image?: string;
}

export const BUILTIN_ARTWORK: readonly BuiltinArtwork[] = [
  { key: "card-psn", label: "PlayStation", image: "/catalog/psn-store.webp" },
  { key: "card-psplus", label: "PlayStation Plus", image: "/catalog/ps-plus.webp" },
  { key: "card-steam", label: "Steam", image: "/catalog/steam-wallet.webp" },
  { key: "card-xbox", label: "Xbox", image: "/catalog/xbox-gift.webp" },
  { key: "card-nintendo", label: "Nintendo", image: "/catalog/nintendo-eshop.webp" },
  { key: "card-apple", label: "Apple", image: "/catalog/apple-gift.webp" },
  { key: "card-google", label: "Google Play", image: "/catalog/google-play.webp" },
  { key: "card-razer", label: "Razer Gold", image: "/catalog/razer-gold.webp" },
  { key: "card-roblox", label: "Roblox", image: "/catalog/roblox-card.webp" },
  { key: "card-pubg", label: "PUBG Mobile", image: "/catalog/pubg-uc.webp" },
  { key: "card-ff", label: "Free Fire", image: "/catalog/free-fire.webp" },
  { key: "card-mlbb", label: "Mobile Legends", image: "/catalog/mlbb-diamonds.webp" },
  { key: "card-valorant", label: "Valorant", image: "/catalog/valorant-points.webp" },
  { key: "card-fortnite", label: "Fortnite", image: "/catalog/fortnite-vbucks.webp" },
  { key: "card-ea", label: "EA Sports FC", image: "/catalog/ea-fc-points.webp" },
  { key: "card-lol", label: "League of Legends", image: "/catalog/lol-card.webp" },
  { key: "gift", label: "Gift card (drawn)" },
  { key: "digital", label: "Digital code (drawn)" },
  { key: "deal", label: "Offer (drawn)" },
];

const BY_KEY = new Map(BUILTIN_ARTWORK.map((item) => [item.key, item]));

/** Exact web addresses (slugs) that name a brand with built-in art — no fuzzy matching on names. */
const SLUG_ARTWORK: Record<string, string> = {
  playstation: "card-psn",
  psn: "card-psn",
  "playstation-store": "card-psn",
  "ps-plus": "card-psplus",
  "playstation-plus": "card-psplus",
  steam: "card-steam",
  xbox: "card-xbox",
  nintendo: "card-nintendo",
  apple: "card-apple",
  google: "card-google",
  "google-play": "card-google",
  razer: "card-razer",
  "razer-gold": "card-razer",
  roblox: "card-roblox",
  pubg: "card-pubg",
  "pubg-mobile": "card-pubg",
  "free-fire": "card-ff",
  freefire: "card-ff",
  mlbb: "card-mlbb",
  "mobile-legends": "card-mlbb",
  valorant: "card-valorant",
  fortnite: "card-fortnite",
  ea: "card-ea",
  "ea-sports-fc": "card-ea",
  riot: "card-lol",
  lol: "card-lol",
  "league-of-legends": "card-lol",
};

export interface ArtworkSource {
  /** Uploaded picture (absolute URL or /media/… path); empty when none. */
  imageUrl?: string | null;
  artworkKey?: string | null;
  slug?: string | null;
}

export function builtinArtwork(key: string | null | undefined): BuiltinArtwork | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

/** The built-in key an entity falls back to: its own key, else the one its slug names, else "". */
export function effectiveArtworkKey(source: Pick<ArtworkSource, "artworkKey" | "slug">): string {
  const own = (source.artworkKey ?? "").trim();
  if (own) return own;
  return SLUG_ARTWORK[(source.slug ?? "").trim().toLowerCase()] ?? "";
}

/** Bundled picture for an entity's built-in key ("" → drawn placeholder). */
export function builtinArtworkImage(source: Pick<ArtworkSource, "artworkKey" | "slug">): string {
  return builtinArtwork(effectiveArtworkKey(source))?.image ?? "";
}

/** Pictures to try, best first: uploaded, then the built-in one. Empty → draw the placeholder. */
export function entityImageSources(source: ArtworkSource): string[] {
  return [...new Set([source.imageUrl ?? "", builtinArtworkImage(source)].filter(Boolean))];
}

/** Key for the drawn placeholder (always something drawable). */
export function drawnArtworkKey(source: Pick<ArtworkSource, "artworkKey" | "slug">, fallback = "gift"): string {
  return effectiveArtworkKey(source) || fallback;
}
