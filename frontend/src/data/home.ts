/** Homepage section config — routes and artwork only; copy lives in translations. */

export const HOME_PLATFORM_LINKS = [
  { id: "playstation", href: "/category/playstation", image: "/catalog/psn-store.webp", artworkKey: "card-psn", labelKey: "home.platform.playstation" },
  { id: "steam", href: "/category/steam", image: "/catalog/steam-wallet.webp", artworkKey: "card-steam", labelKey: "home.platform.steam" },
  { id: "xbox", href: "/product/xbox-gift-card", image: "/catalog/xbox-gift.webp", artworkKey: "card-xbox", labelKey: "home.platform.xbox" },
  { id: "pubg", href: "/product/pubg-mobile-uc", image: "/catalog/pubg-uc.webp", artworkKey: "card-pubg", labelKey: "home.platform.pubg" },
  { id: "roblox", href: "/product/roblox-gift-card", image: "/catalog/roblox-card.webp", artworkKey: "card-roblox", labelKey: "home.platform.roblox" },
  { id: "apple", href: "/product/apple-gift-card", image: "/catalog/apple-gift.webp", artworkKey: "card-apple", labelKey: "home.platform.apple" },
  { id: "google", href: "/product/google-play-gift-card", image: "/catalog/google-play.webp", artworkKey: "card-google", labelKey: "home.platform.google" },
  { id: "psplus", href: "/product/playstation-plus", image: "/catalog/ps-plus.webp", artworkKey: "card-psplus", labelKey: "home.platform.psplus" },
] as const;

/** Homepage category marquee — tap opens a full-page subcategory modal. */
export const HOME_CATEGORY_SWIPER = [
  {
    id: "game-currencies",
    labelKey: "home.cat.currencies",
    image: "/catalog/fortnite-vbucks.webp",
    artworkKey: "card-fortnite",
    children: [
      { labelKey: "home.cat.child.pubg", href: "/product/pubg-mobile-uc", image: "/catalog/pubg-uc.webp", artworkKey: "card-pubg" },
      { labelKey: "home.cat.child.freefire", href: "/product/free-fire-diamonds", image: "/catalog/free-fire.webp", artworkKey: "card-ff" },
      { labelKey: "home.cat.child.mlbb", href: "/product/mobile-legends-diamonds", image: "/catalog/mlbb-diamonds.webp", artworkKey: "card-mlbb" },
      { labelKey: "home.cat.child.valorant", href: "/product/valorant-points", image: "/catalog/valorant-points.webp", artworkKey: "card-valorant" },
      { labelKey: "home.cat.child.fortnite", href: "/product/fortnite-v-bucks", image: "/catalog/fortnite-vbucks.webp", artworkKey: "card-fortnite" },
      { labelKey: "home.cat.child.ea", href: "/product/ea-sports-fc-points", image: "/catalog/ea-fc-points.webp", artworkKey: "card-ea" },
    ],
  },
  {
    id: "gift-cards",
    labelKey: "home.cat.gifts",
    image: "/catalog/google-play.webp",
    artworkKey: "gift",
    children: [
      { labelKey: "home.cat.child.apple", href: "/product/apple-gift-card", image: "/catalog/apple-gift.webp", artworkKey: "card-apple" },
      { labelKey: "home.cat.child.google", href: "/product/google-play-gift-card", image: "/catalog/google-play.webp", artworkKey: "card-google" },
      { labelKey: "home.cat.child.razer", href: "/product/razer-gold", image: "/catalog/razer-gold.webp", artworkKey: "card-razer" },
      { labelKey: "home.cat.child.roblox", href: "/product/roblox-gift-card", image: "/catalog/roblox-card.webp", artworkKey: "card-roblox" },
      { labelKey: "home.cat.child.allGifts", href: "/gift-cards", image: "/catalog/google-play.webp", artworkKey: "gift" },
    ],
  },
  {
    id: "wallets",
    labelKey: "home.cat.wallets",
    image: "/catalog/steam-wallet.webp",
    artworkKey: "digital",
    children: [
      { labelKey: "home.cat.child.psn", href: "/product/playstation-store-wallet", image: "/catalog/psn-store.webp", artworkKey: "card-psn" },
      { labelKey: "home.cat.child.steam", href: "/product/steam-wallet", image: "/catalog/steam-wallet.webp", artworkKey: "card-steam" },
      { labelKey: "home.cat.child.xbox", href: "/product/xbox-gift-card", image: "/catalog/xbox-gift.webp", artworkKey: "card-xbox" },
      { labelKey: "home.cat.child.nintendo", href: "/product/nintendo-eshop-card", image: "/catalog/nintendo-eshop.webp", artworkKey: "card-nintendo" },
      { labelKey: "home.cat.child.allWallets", href: "/category/wallet-cards", image: "/catalog/steam-wallet.webp", artworkKey: "digital" },
    ],
  },
  {
    id: "top-ups",
    labelKey: "home.cat.topups",
    image: "/catalog/pubg-uc.webp",
    artworkKey: "card-pubg",
    children: [
      { labelKey: "home.cat.child.pubg", href: "/product/pubg-mobile-uc", image: "/catalog/pubg-uc.webp", artworkKey: "card-pubg" },
      { labelKey: "home.cat.child.freefire", href: "/product/free-fire-diamonds", image: "/catalog/free-fire.webp", artworkKey: "card-ff" },
      { labelKey: "home.cat.child.mlbb", href: "/product/mobile-legends-diamonds", image: "/catalog/mlbb-diamonds.webp", artworkKey: "card-mlbb" },
      { labelKey: "home.cat.child.allTopups", href: "/game-top-ups", image: "/catalog/pubg-uc.webp", artworkKey: "card-pubg" },
    ],
  },
  {
    id: "subscriptions",
    labelKey: "home.cat.subscriptions",
    image: "/catalog/ps-plus.webp",
    artworkKey: "card-psplus",
    children: [
      { labelKey: "home.cat.child.psplus", href: "/product/playstation-plus", image: "/catalog/ps-plus.webp", artworkKey: "card-psplus" },
      { labelKey: "home.cat.child.allSubs", href: "/category/subscriptions", image: "/catalog/ps-plus.webp", artworkKey: "card-psplus" },
    ],
  },
  {
    id: "pc-games",
    labelKey: "home.cat.pc",
    image: "/catalog/steam-wallet.webp",
    artworkKey: "card-steam",
    children: [
      { labelKey: "home.cat.child.steam", href: "/product/steam-wallet", image: "/catalog/steam-wallet.webp", artworkKey: "card-steam" },
      { labelKey: "home.cat.child.valorant", href: "/product/valorant-points", image: "/catalog/valorant-points.webp", artworkKey: "card-valorant" },
      { labelKey: "home.cat.child.lol", href: "/product/league-of-legends-card", image: "/catalog/lol-card.webp", artworkKey: "card-lol" },
      { labelKey: "home.cat.child.allPc", href: "/category/pc-games", image: "/catalog/steam-wallet.webp", artworkKey: "card-steam" },
    ],
  },
  {
    id: "mobile-games",
    labelKey: "home.cat.mobile",
    image: "/catalog/free-fire.webp",
    artworkKey: "card-ff",
    children: [
      { labelKey: "home.cat.child.pubg", href: "/product/pubg-mobile-uc", image: "/catalog/pubg-uc.webp", artworkKey: "card-pubg" },
      { labelKey: "home.cat.child.freefire", href: "/product/free-fire-diamonds", image: "/catalog/free-fire.webp", artworkKey: "card-ff" },
      { labelKey: "home.cat.child.mlbb", href: "/product/mobile-legends-diamonds", image: "/catalog/mlbb-diamonds.webp", artworkKey: "card-mlbb" },
      { labelKey: "home.cat.child.roblox", href: "/product/roblox-gift-card", image: "/catalog/roblox-card.webp", artworkKey: "card-roblox" },
      { labelKey: "home.cat.child.allMobile", href: "/category/mobile-games", image: "/catalog/free-fire.webp", artworkKey: "card-ff" },
    ],
  },
  {
    id: "deals",
    labelKey: "home.cat.deals",
    image: "/catalog/razer-gold.webp",
    artworkKey: "deal",
    children: [
      { labelKey: "home.cat.child.allDeals", href: "/deals", image: "/catalog/razer-gold.webp", artworkKey: "deal" },
      { labelKey: "home.cat.child.bestsellers", href: "/category/best-sellers", image: "/catalog/psn-store.webp", artworkKey: "deal" },
    ],
  },
] as const;

export const HOME_SERVICE_TILES = [
  { id: "gift-cards", href: "/gift-cards", image: "/catalog/google-play.webp", artworkKey: "gift", labelKey: "home.service.gifts" },
  { id: "top-ups", href: "/game-top-ups", image: "/catalog/pubg-uc.webp", artworkKey: "card-pubg", labelKey: "home.service.topups" },
  { id: "subscriptions", href: "/category/subscriptions", image: "/catalog/ps-plus.webp", artworkKey: "card-psplus", labelKey: "home.service.subscriptions" },
  { id: "wallets", href: "/category/wallet-cards", image: "/catalog/steam-wallet.webp", artworkKey: "digital", labelKey: "home.service.wallets" },
  { id: "deals", href: "/deals", image: "/catalog/razer-gold.webp", artworkKey: "deal", labelKey: "home.service.deals" },
  { id: "mobile", href: "/category/mobile-games", image: "/catalog/free-fire.webp", artworkKey: "card-ff", labelKey: "home.service.mobile" },
  { id: "entertainment", href: "/category/entertainment", image: "/catalog/apple-gift.webp", artworkKey: "card-apple", labelKey: "home.service.entertainment" },
  { id: "best-sellers", href: "/category/best-sellers", image: "/catalog/psn-store.webp", artworkKey: "deal", labelKey: "home.service.bestsellers" },
] as const;

export const HOME_SUGGEST_TILES = [
  { id: "psn", href: "/product/playstation-store-wallet", image: "/catalog/psn-store.webp", artworkKey: "card-psn", labelKey: "home.suggest.psn" },
  { id: "steam", href: "/product/steam-wallet", image: "/catalog/steam-wallet.webp", artworkKey: "card-steam", labelKey: "home.suggest.steam" },
  { id: "pubg", href: "/product/pubg-mobile-uc", image: "/catalog/pubg-uc.webp", artworkKey: "card-pubg", labelKey: "home.suggest.pubg" },
  { id: "roblox", href: "/product/roblox-gift-card", image: "/catalog/roblox-card.webp", artworkKey: "card-roblox", labelKey: "home.suggest.roblox" },
  { id: "freefire", href: "/product/free-fire-diamonds", image: "/catalog/free-fire.webp", artworkKey: "card-ff", labelKey: "home.suggest.freefire" },
  { id: "mlbb", href: "/product/mobile-legends-diamonds", image: "/catalog/mlbb-diamonds.webp", artworkKey: "card-mlbb", labelKey: "home.suggest.mlbb" },
  { id: "valorant", href: "/product/valorant-points", image: "/catalog/valorant-points.webp", artworkKey: "card-valorant", labelKey: "home.suggest.valorant" },
  { id: "ea", href: "/product/ea-sports-fc-points", image: "/catalog/ea-fc-points.webp", artworkKey: "card-ea", labelKey: "home.suggest.ea" },
  { id: "psplus", href: "/product/playstation-plus", image: "/catalog/ps-plus.webp", artworkKey: "card-psplus", labelKey: "home.suggest.psplus" },
  { id: "xbox", href: "/product/xbox-gift-card", image: "/catalog/xbox-gift.webp", artworkKey: "card-xbox", labelKey: "home.suggest.xbox" },
  { id: "apple", href: "/product/apple-gift-card", image: "/catalog/apple-gift.webp", artworkKey: "card-apple", labelKey: "home.suggest.apple" },
  { id: "google", href: "/product/google-play-gift-card", image: "/catalog/google-play.webp", artworkKey: "card-google", labelKey: "home.suggest.google" },
] as const;

export const HOME_TESTIMONIALS = [
  { id: "t1", nameKey: "home.testimonial1Name", bodyKey: "home.testimonial1Body" },
  { id: "t2", nameKey: "home.testimonial2Name", bodyKey: "home.testimonial2Body" },
  { id: "t3", nameKey: "home.testimonial3Name", bodyKey: "home.testimonial3Body" },
] as const;
