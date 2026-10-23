import type { NavLink } from "@/types";

export const NAV_LINKS: NavLink[] = [
  { href: "/shop", labelKey: "nav.shop", mega: "shop" },
  { href: "/game-top-ups", labelKey: "nav.topups", mega: "topups" },
  { href: "/gift-cards", labelKey: "nav.gifts", mega: "gifts" },
  { href: "/category/playstation", labelKey: "nav.playstation", mega: "playstation" },
  { href: "/category/steam", labelKey: "nav.steam" },
  { href: "/category/mobile-games", labelKey: "nav.mobile", mega: "mobile" },
  { href: "/category/subscriptions", labelKey: "nav.subscriptions" },
  { href: "/deals", labelKey: "nav.deals" },
];

export const ANNOUNCEMENTS = [
  { key: "announce.jordan" },
  { key: "announce.instant" },
  { key: "announce.secure" },
] as const;

export const FOOTER_COLUMNS = [
  {
    titleKey: "footer.shop",
    links: [
      { href: "/shop", labelKey: "nav.shop" },
      { href: "/game-top-ups", labelKey: "nav.topups" },
      { href: "/gift-cards", labelKey: "nav.gifts" },
      { href: "/category/playstation", labelKey: "nav.playstation" },
      { href: "/deals", labelKey: "nav.deals" },
      { href: "/brands", labelKey: "nav.brands" },
    ],
  },
  {
    titleKey: "footer.care",
    links: [
      { href: "/account", labelKey: "nav.account" },
      { href: "/account/orders", labelKey: "account.orders" },
      { href: "/account/codes", labelKey: "account.codes" },
      { href: "/account/top-ups", labelKey: "account.topups" },
      { href: "/wishlist", labelKey: "nav.wishlist" },
      { href: "/order-lookup", labelKey: "footer.orderLookup" },
      { href: "/faq", labelKey: "footer.faq" },
      { href: "/contact", labelKey: "footer.contact" },
    ],
  },
  {
    titleKey: "footer.digital",
    links: [
      { href: "/game-top-ups", labelKey: "nav.topups" },
      { href: "/gift-cards", labelKey: "nav.gifts" },
      { href: "/digital-product-policy", labelKey: "footer.digitalPolicy" },
    ],
  },
  {
    titleKey: "footer.company",
    links: [
      { href: "/about", labelKey: "footer.about" },
      { href: "/contact", labelKey: "footer.contact" },
      { href: "/privacy", labelKey: "footer.privacy" },
      { href: "/terms", labelKey: "footer.terms" },
    ],
  },
] as const;

/** Suggested searches; only those that match a live product are shown. */
export const TRENDING_SEARCHES = [
  "Roblox",
  "PUBG UC",
  "PlayStation",
  "Steam",
  "Apple Gift Card",
  "Google Play",
  "Free Fire",
  "Xbox",
  "Valorant",
  "Fortnite",
];

export type MegaKey = "shop" | "topups" | "gifts" | "playstation" | "mobile";

/** Static groupings shown in the desktop mega menu; tiles without products are hidden. */
export const MEGA_GROUPS: Record<
  MegaKey,
  { links: Array<{ href: string; labelKey: string }>; platformsOf?: "topups" | "gifts" | "mobile" | "playstation" }
> = {
  shop: {
    links: [
      { href: "/game-top-ups", labelKey: "nav.topups" },
      { href: "/gift-cards", labelKey: "nav.gifts" },
      { href: "/category/playstation", labelKey: "nav.playstation" },
      { href: "/category/steam", labelKey: "nav.steam" },
      { href: "/category/mobile-games", labelKey: "nav.mobile" },
      { href: "/category/subscriptions", labelKey: "nav.subscriptions" },
      { href: "/category/best-sellers", labelKey: "nav.bestSellers" },
      { href: "/category/new-products", labelKey: "nav.newProducts" },
      { href: "/deals", labelKey: "nav.deals" },
    ],
  },
  topups: { links: [{ href: "/game-top-ups", labelKey: "nav.viewAll" }], platformsOf: "topups" },
  gifts: { links: [{ href: "/gift-cards", labelKey: "nav.viewAll" }], platformsOf: "gifts" },
  playstation: {
    links: [
      { href: "/category/playstation", labelKey: "nav.viewAll" },
      { href: "/category/subscriptions", labelKey: "nav.subscriptions" },
    ],
    platformsOf: "playstation",
  },
  mobile: { links: [{ href: "/category/mobile-games", labelKey: "nav.viewAll" }], platformsOf: "mobile" },
};
