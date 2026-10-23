import type { Category } from "@/types";

function category(
  slug: string,
  name: string,
  nameAr: string,
  description: string,
  descriptionAr: string,
  artworkKey: string,
  href?: string,
  parent?: string,
): Category {
  return {
    slug,
    name,
    nameAr,
    description,
    descriptionAr,
    artworkKey,
    href: href ?? `/category/${slug}`,
    parent,
  };
}

export const CATEGORIES: Category[] = [
  category("game-top-ups", "Game Top-Ups", "شحن الألعاب", "Direct account top-ups for mobile and PC games.", "شحن مباشر لحسابات ألعاب الموبايل والكمبيوتر.", "card-pubg", "/game-top-ups"),
  category("gift-cards", "Gift Cards", "بطاقات الهدايا", "Store and wallet cards delivered as digital codes.", "بطاقات المتاجر والمحافظ تُسلّم كأكواد رقمية.", "gift", "/gift-cards"),
  category("wallet-cards", "Wallet Cards", "بطاقات المحفظة", "PlayStation, Steam, Xbox, Nintendo, and Razer Gold credit.", "رصيد بلايستيشن وستيم وإكس بوكس ونينتندو وريزر جولد.", "digital"),
  category("playstation", "PlayStation", "بلايستيشن", "PlayStation Store cards and Plus membership codes.", "بطاقات بلايستيشن ستور وأكواد عضوية بلس.", "card-psn"),
  category("xbox", "Xbox", "إكس بوكس", "Xbox and Microsoft Store gift cards.", "بطاقات هدايا إكس بوكس ومتجر مايكروسوفت.", "card-xbox"),
  category("steam", "Steam", "ستيم", "Steam Wallet codes for matching account currencies.", "أكواد محفظة ستيم بعملات الحساب المطابقة.", "card-steam"),
  category("nintendo", "Nintendo", "نينتندو", "Nintendo eShop cards for matching accounts.", "بطاقات نينتندو إي شوب للحسابات المطابقة.", "card-nintendo"),
  category("mobile-games", "Mobile Games", "ألعاب الموبايل", "PUBG, Free Fire, Mobile Legends, and Roblox.", "ببجي وفري فاير وموبايل ليجندز وروبلوكس.", "card-pubg"),
  category("pc-games", "PC Games", "ألعاب الكمبيوتر", "Steam, Valorant, League of Legends, and more.", "ستيم وفالورانت وليغ أوف ليجندز والمزيد.", "card-steam"),
  category("subscriptions", "Subscriptions", "الاشتراكات", "Digital membership codes such as PlayStation Plus.", "أكواد عضوية رقمية مثل بلايستيشن بلس.", "card-psplus"),
  category("entertainment", "Entertainment", "الترفيه", "Apple, Google Play, and Nintendo digital credit.", "رصيد آبل وجوجل بلاي ونينتندو.", "card-apple"),
  category("mobile-credit", "Mobile Credit", "رصيد الجوال", "App store cards for phones and tablets.", "بطاقات متاجر التطبيقات للهواتف والأجهزة اللوحية.", "card-google"),
  category("game-currencies", "Game Currencies", "عملات الألعاب", "UC, diamonds, V-Bucks, VP, and FC Points.", "شدات وماس وفي-بكس ونقاط فالورانت وFC.", "card-fortnite"),
  category("best-sellers", "Best Sellers", "الأكثر مبيعاً", "The digital products Jordan players buy most.", "المنتجات الرقمية الأكثر شراءً لدى اللاعبين في الأردن.", "deal"),
  category("new-products", "New Products", "منتجات جديدة", "Recently added digital codes and top-ups.", "أكواد رقمية وشحن مباشر مضاف حديثاً.", "digital"),
  category("special-offers", "Special Offers", "عروض خاصة", "Discounted denominations and timed digital deals.", "فئات مخفضة وعروض رقمية محددة.", "deal", "/deals"),
  category("pubg-mobile", "PUBG Mobile UC", "شدات ببجي موبايل", "Direct UC top-up with Player ID.", "شحن UC مباشر بمعرّف اللاعب.", "card-pubg", "/product/pubg-mobile-uc", "game-top-ups"),
  category("free-fire", "Free Fire Diamonds", "جواهر فري فاير", "Direct diamond top-up for Free Fire.", "شحن جواهر مباشر لفري فاير.", "card-ff", "/product/free-fire-diamonds", "game-top-ups"),
  category("mobile-legends", "Mobile Legends", "موبايل ليجندز", "Diamonds using User ID and Zone ID.", "ماس بمعرّف المستخدم ومعرّف المنطقة.", "card-mlbb", "/product/mobile-legends-diamonds", "game-top-ups"),
  category("roblox", "Roblox Robux", "روبوكس روبلوكس", "Roblox gift cards for matching account currency.", "بطاقات روبلوكس بعملة الحساب المطابقة.", "card-roblox", "/product/roblox-gift-card", "game-top-ups"),
  category("valorant", "Valorant Points", "نقاط فالورانت", "Valorant Points codes for Riot accounts.", "أكواد نقاط فالورانت لحسابات رايوت.", "card-valorant", "/product/valorant-points", "game-top-ups"),
  category("fortnite", "Fortnite V-Bucks", "فورتنايت في-بكس", "V-Bucks codes for Epic accounts.", "أكواد في-بكس لحسابات Epic.", "card-fortnite", "/product/fortnite-v-bucks", "game-top-ups"),
  category("ea-sports-fc", "EA Sports FC Points", "نقاط EA Sports FC", "FC Points for Ultimate Team.", "نقاط FC للفريق النهائي.", "card-ea", "/product/ea-sports-fc-points", "game-top-ups"),
  category("apple", "Apple Gift Card", "بطاقة هدايا آبل", "App Store credit for matching Apple IDs.", "رصيد آب ستور لحسابات آبل المطابقة.", "card-apple", "/product/apple-gift-card", "gift-cards"),
  category("google-play", "Google Play", "جوجل بلاي", "Google Play gift cards by region.", "بطاقات جوجل بلاي حسب المنطقة.", "card-google", "/product/google-play-gift-card", "gift-cards"),
  category("razer-gold", "Razer Gold", "ريزر جولد", "Razer Gold PINs for supported wallets.", "أرقام ريزر جولد للمحافظ المدعومة.", "card-razer", "/product/razer-gold", "gift-cards"),
  category("league-of-legends", "League of Legends", "ليغ أوف ليجندز", "Riot prepaid cards for League of Legends.", "بطاقات رايوت المدفوعة مسبقاً.", "card-lol", "/product/league-of-legends-card", "pc-games"),
  category("deals", "Deals", "العروض", "Discounted digital codes and top-up packages.", "أكواد رقمية وباقات شحن مخفضة.", "deal", "/deals"),
];

export const HOME_CATEGORIES = [
  "playstation",
  "steam",
  "pubg-mobile",
  "roblox",
  "gift-cards",
  "subscriptions",
] as const;

/** Catalog artwork for homepage category tiles (supplier category images). */
export const HOME_CATEGORY_IMAGES: Record<(typeof HOME_CATEGORIES)[number], string> = {
  playstation: "/catalog/psn-store.webp",
  steam: "/catalog/steam-wallet.webp",
  "pubg-mobile": "/catalog/pubg-uc.webp",
  roblox: "/catalog/roblox-card.webp",
  "gift-cards": "/catalog/google-play.webp",
  subscriptions: "/catalog/ps-plus.webp",
};

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((category) => category.slug === slug);
}

export function getChildCategories(parent: string): Category[] {
  return CATEGORIES.filter((category) => category.parent === parent);
}
