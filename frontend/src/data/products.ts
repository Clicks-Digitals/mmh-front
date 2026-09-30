import type {
  DigitalDenomination,
  DigitalProductOptions,
  DigitalRegion,
  FulfillmentType,
  Product,
  ProductBadge,
  ProductKind,
  RequiredCustomerField,
} from "@/types";
import { getSnapshotProducts } from "@/lib/catalog-snapshot";

const REFUND_EN =
  "Digital products are generally not refundable after a code is revealed or a top-up is submitted. Placeholder policy — requires final business and legal review.";
const REFUND_AR =
  "المنتجات الرقمية غير قابلة للاسترجاع عادة بعد كشف الكود أو إرسال الشحن. نص تجريبي — يحتاج مراجعة قانونية وتجارية نهائية.";

function playerIdField(): RequiredCustomerField {
  return {
    id: "playerId",
    label: "Player ID",
    labelAr: "معرّف اللاعب",
    placeholder: "Enter Player ID",
    placeholderAr: "أدخل معرّف اللاعب",
    type: "text",
    required: true,
    helpText: "Open your in-game profile to find the Player ID.",
    helpTextAr: "افتح ملفك داخل اللعبة لإيجاد معرّف اللاعب.",
  };
}

function userIdField(): RequiredCustomerField {
  return {
    id: "userId",
    label: "User ID",
    labelAr: "معرّف المستخدم",
    placeholder: "Enter User ID",
    placeholderAr: "أدخل معرّف المستخدم",
    type: "text",
    required: true,
    helpText: "Shown on your profile screen, usually next to your avatar.",
    helpTextAr: "يظهر في شاشة الملف الشخصي عادة بجانب الصورة.",
  };
}

function zoneIdField(): RequiredCustomerField {
  return {
    id: "zoneId",
    label: "Zone ID",
    labelAr: "معرّف المنطقة",
    placeholder: "Enter Zone ID",
    placeholderAr: "أدخل معرّف المنطقة",
    type: "text",
    required: true,
    helpText: "Mobile Legends shows Zone ID in parentheses after your User ID.",
    helpTextAr: "موبايل ليجندز يعرض معرّف المنطقة بين قوسين بعد معرّف المستخدم.",
  };
}

function walletRegions(locked = true): DigitalRegion[] {
  return [
    { id: "us", name: "United States", nameAr: "الولايات المتحدة", locked, currency: "USD" },
    { id: "uae", name: "UAE / MENA", nameAr: "الإمارات / الشرق الأوسط", locked, currency: "USD" },
    { id: "eu", name: "Europe", nameAr: "أوروبا", locked, currency: "EUR" },
    { id: "uk", name: "United Kingdom", nameAr: "المملكة المتحدة", locked, currency: "GBP" },
    { id: "tr", name: "Türkiye", nameAr: "تركيا", locked, currency: "TRY" },
  ];
}

function globalRegion(): DigitalRegion[] {
  return [{ id: "global", name: "In-game account", nameAr: "حساب داخل اللعبة", locked: false }];
}

function codeOptions(input: {
  platform: string;
  platformLabel: string;
  platformLabelAr: string;
  kind: ProductKind;
  denominations: DigitalDenomination[];
  regions?: DigitalRegion[];
  regionWarning?: string;
  regionWarningAr?: string;
  accountCurrency?: string;
  howToUse: string[];
  howToUseAr: string[];
  instructions?: string;
  instructionsAr?: string;
}): DigitalProductOptions {
  return {
    platform: input.platform,
    platformLabel: input.platformLabel,
    platformLabelAr: input.platformLabelAr,
    kind: input.kind,
    regions: input.regions ?? walletRegions(),
    denominations: input.denominations.map((item) => ({
      ...item,
      inStock: item.inStock ?? true,
      deliveryEstimate: item.deliveryEstimate ?? "Issued after payment is confirmed. Live PIN delivery is not enabled in this environment.",
    })),
    deliveryMethods: ["account", "email", "sms"],
    deliveryEstimate: "Issued after payment is confirmed. Live PIN delivery is not enabled in this environment.",
    deliveryEstimateAr: "يُصدر بعد تأكيد الدفع. تسليم الأرقام الحية غير مفعّل في هذه البيئة.",
    instructions:
      input.instructions ??
      "Redeem the PIN in the official store of the selected platform. Match the region and currency to the receiving account. MMH does not generate a live code in this environment.",
    instructionsAr:
      input.instructionsAr ??
      "استرد الرقم السري في المتجر الرسمي للمنصة المختارة. طابق المنطقة والعملة مع الحساب المستلم. إم إم إتش لا يولّد كوداً حياً في هذا العرض.",
    howToUse: input.howToUse,
    howToUseAr: input.howToUseAr,
    regionRestrictions:
      "Region-locked cards cannot be redeemed on accounts from a different store country.",
    regionRestrictionsAr: "البطاقات المقيدة بالمنطقة لا يمكن استردادها على حسابات من دولة متجر مختلفة.",
    regionWarning: input.regionWarning,
    regionWarningAr: input.regionWarningAr,
    accountCurrency: input.accountCurrency,
    refundEligible: false,
    refundPolicyText: REFUND_EN,
    refundPolicyTextAr: REFUND_AR,
    instantCode: true,
    requiredCustomerFields: [],
  };
}

function topupOptions(input: {
  platform: string;
  platformLabel: string;
  platformLabelAr: string;
  kind?: ProductKind;
  denominations: DigitalDenomination[];
  regions?: DigitalRegion[];
  fields: RequiredCustomerField[];
  regionWarning?: string;
  regionWarningAr?: string;
  howToUse: string[];
  howToUseAr: string[];
}): DigitalProductOptions {
  return {
    platform: input.platform,
    platformLabel: input.platformLabel,
    platformLabelAr: input.platformLabelAr,
    kind: input.kind ?? "direct_topup",
    regions: input.regions ?? globalRegion(),
    denominations: input.denominations.map((item) => ({
      ...item,
      inStock: item.inStock ?? true,
      deliveryEstimate: item.deliveryEstimate ?? "Submitted for processing after checkout",
    })),
    deliveryMethods: ["account"],
    deliveryEstimate: "Submitted for processing after checkout",
    deliveryEstimateAr: "يُرسل للمعالجة بعد إتمام الطلب",
    instructions:
      "Enter only the fields required for this game. A wrong Player ID or server cannot be reversed after submission.",
    instructionsAr: "أدخل الحقول المطلوبة لهذه اللعبة فقط. لا يمكن التراجع عن معرّف لاعب أو خادم خاطئ بعد الإرسال.",
    howToUse: input.howToUse,
    howToUseAr: input.howToUseAr,
    regionRestrictions: "The account must belong to the selected game region.",
    regionRestrictionsAr: "يجب أن ينتمي الحساب إلى منطقة اللعبة المختارة.",
    regionWarning: input.regionWarning,
    regionWarningAr: input.regionWarningAr,
    refundEligible: false,
    refundPolicyText: REFUND_EN,
    refundPolicyTextAr: REFUND_AR,
    instantCode: false,
    requiredCustomerFields: input.fields,
  };
}

function digital(
  input: Omit<Product, "type" | "fulfillmentType" | "images" | "inStock" | "digitalOptions"> & {
    fulfillmentType: FulfillmentType;
    digitalOptions: DigitalProductOptions;
    images?: string[];
    badges?: ProductBadge[];
    inStock?: boolean;
  },
): Product {
  const first = input.digitalOptions.denominations[0];
  return {
    type: "digital",
    inStock: input.inStock ?? true,
    ...input,
    images: input.images ?? [`/catalog/${input.id}.webp`, `/catalog/${input.id}.svg`],
    priceJod: input.priceJod || first?.priceJod || 0,
    rating: 0,
    reviewCount: 0,
    badges: Array.from(
      new Set<ProductBadge>([
        "digital",
        input.fulfillmentType === "direct_topup" ? "topup" : "instant",
        ...(input.badges ?? []),
      ]),
    ),
  };
}

export const PRODUCTS: Product[] = [
  digital({
    id: "psn-store",
    slug: "playstation-store-wallet",
    fulfillmentType: "code",
    name: "PlayStation Store Wallet Card",
    nameAr: "بطاقة محفظة بلايستيشن ستور",
    shortDescription: "PlayStation Store credit for supported account regions.",
    shortDescriptionAr: "رصيد بلايستيشن ستور لمناطق الحساب المدعومة.",
    description:
      "PlayStation Store wallet cards sold by MMH. Confirm the store country of the PlayStation account before buying. MMH is a retailer and is not affiliated with Sony Interactive Entertainment.",
    descriptionAr:
      "بطاقات محفظة بلايستيشن ستور تُباع عبر إم إم إتش. أكّد دولة متجر حساب بلايستيشن قبل الشراء. إم إم إتش متجر تجزئة وغير مرتبط بسوني.",
    brand: "PlayStation",
    category: "playstation",
    artworkKey: "card-psn",
    priceJod: 8.9,
    compareAtPriceJod: 10.5,
    rating: 4.8,
    reviewCount: 412,
    badges: ["bestseller", "sale", "region_locked"],
    featured: true,
    trending: true,
    bestseller: true,
    createdAt: "2026-01-10",
    tags: ["playstation", "psn", "wallet", "gift card", "us", "usd"],
    platform: "playstation",
    digitalOptions: codeOptions({
      platform: "playstation",
      platformLabel: "PlayStation",
      platformLabelAr: "بلايستيشن",
      kind: "wallet",
      accountCurrency: "USD",
      regionWarning: "This PlayStation card works only with the selected store region.",
      regionWarningAr: "هذه البطاقة تعمل فقط مع منطقة المتجر المختارة.",
      howToUse: [
        "Sign in to the PlayStation account that matches the selected region.",
        "Open PlayStation Store on the console or playstation.com.",
        "Choose Redeem Codes and enter the PIN.",
        "Use the added wallet credit on eligible store purchases.",
      ],
      howToUseAr: [
        "سجّل الدخول إلى حساب بلايستيشن المطابق للمنطقة المختارة.",
        "افتح بلايستيشن ستور على الجهاز أو playstation.com.",
        "اختر استرداد الأكواد وأدخل الرقم السري.",
        "استخدم الرصيد المضاف على المشتريات المؤهلة.",
      ],
      denominations: [
        { id: "10", label: "$10", labelAr: "١٠ دولار", value: 10, currency: "USD", priceJod: 8.9, compareAtPriceJod: 10.5 },
        { id: "25", label: "$25", labelAr: "٢٥ دولار", value: 25, currency: "USD", priceJod: 21.5, compareAtPriceJod: 24 },
        { id: "50", label: "$50", labelAr: "٥٠ دولار", value: 50, currency: "USD", priceJod: 39.9, compareAtPriceJod: 45 },
        { id: "75", label: "$75", labelAr: "٧٥ دولار", value: 75, currency: "USD", priceJod: 58.9 },
      ],
    }),
  }),
  digital({
    id: "steam-wallet",
    slug: "steam-wallet",
    fulfillmentType: "code",
    name: "Steam Wallet Card",
    nameAr: "بطاقة محفظة ستيم",
    shortDescription: "Steam Wallet credit for the matching store currency.",
    shortDescriptionAr: "رصيد محفظة ستيم بعملة المتجر المطابقة.",
    description:
      "Steam Wallet cards sold by MMH. Confirm your Steam account region and wallet currency before purchase. MMH is not affiliated with Valve.",
    descriptionAr:
      "بطاقات محفظة ستيم تُباع عبر إم إم إتش. أكّد منطقة حساب ستيم وعملة المحفظة قبل الشراء. إم إم إتش غير مرتبط بفالو.",
    brand: "Steam",
    category: "steam",
    artworkKey: "card-steam",
    priceJod: 8.5,
    compareAtPriceJod: 9.9,
    rating: 4.7,
    reviewCount: 388,
    badges: ["bestseller", "sale", "region_locked"],
    featured: true,
    trending: true,
    bestseller: true,
    createdAt: "2026-01-12",
    tags: ["steam", "wallet", "pc", "usd", "gift card"],
    platform: "steam",
    digitalOptions: codeOptions({
      platform: "steam",
      platformLabel: "Steam",
      platformLabelAr: "ستيم",
      kind: "wallet",
      accountCurrency: "USD",
      regionWarning: "Confirm your Steam account region before purchasing.",
      regionWarningAr: "أكّد منطقة حساب ستيم قبل الشراء.",
      howToUse: [
        "Sign in to Steam in a browser or the Steam client.",
        "Open the Steam Wallet redeem page.",
        "Enter the purchased wallet code.",
        "Spend the credit on eligible Steam purchases.",
      ],
      howToUseAr: [
        "سجّل الدخول إلى ستيم عبر المتصفح أو العميل.",
        "افتح صفحة استرداد محفظة ستيم.",
        "أدخل كود المحفظة المشترى.",
        "استخدم الرصيد على مشتريات ستيم المؤهلة.",
      ],
      denominations: [
        { id: "10", label: "$10", labelAr: "١٠ دولار", value: 10, currency: "USD", priceJod: 8.5, compareAtPriceJod: 9.9 },
        { id: "20", label: "$20", labelAr: "٢٠ دولار", value: 20, currency: "USD", priceJod: 16.5 },
        { id: "50", label: "$50", labelAr: "٥٠ دولار", value: 50, currency: "USD", priceJod: 39.5, compareAtPriceJod: 44 },
      ],
    }),
  }),
  digital({
    id: "xbox-gift",
    slug: "xbox-gift-card",
    fulfillmentType: "code",
    name: "Xbox Gift Card",
    nameAr: "بطاقة هدايا إكس بوكس",
    shortDescription: "Xbox and Microsoft Store credit for matching regions.",
    shortDescriptionAr: "رصيد إكس بوكس ومتجر مايكروسوفت للمناطق المطابقة.",
    description:
      "Xbox gift cards sold by MMH. Redeem on an account whose Microsoft store region matches the selected card. MMH is not affiliated with Microsoft.",
    descriptionAr:
      "بطاقات هدايا إكس بوكس تُباع عبر إم إم إتش. تُسترد على حساب تطابق منطقته البطاقة المختارة. إم إم إتش غير مرتبط بمايكروسوفت.",
    brand: "Xbox",
    category: "xbox",
    artworkKey: "card-xbox",
    priceJod: 8.9,
    rating: 4.5,
    reviewCount: 164,
    badges: ["region_locked"],
    createdAt: "2026-01-16",
    tags: ["xbox", "gift card", "microsoft", "wallet"],
    platform: "xbox",
    digitalOptions: codeOptions({
      platform: "xbox",
      platformLabel: "Xbox",
      platformLabelAr: "إكس بوكس",
      kind: "gift_card",
      regionWarning: "This Xbox card works only with the selected Microsoft store region.",
      regionWarningAr: "هذه البطاقة تعمل فقط مع منطقة متجر مايكروسوفت المختارة.",
      howToUse: [
        "Sign in to the matching Microsoft / Xbox account.",
        "Open Redeem on Xbox or microsoft.com/redeem.",
        "Enter the 25-character code.",
        "Use the credit in Microsoft Store.",
      ],
      howToUseAr: [
        "سجّل الدخول إلى حساب مايكروسوفت / إكس بوكس المطابق.",
        "افتح الاسترداد على إكس بوكس أو microsoft.com/redeem.",
        "أدخل الكود المكوّن من ٢٥ حرفاً.",
        "استخدم الرصيد في متجر مايكروسوفت.",
      ],
      denominations: [
        { id: "10", label: "$10", labelAr: "١٠ دولار", value: 10, currency: "USD", priceJod: 8.9 },
        { id: "25", label: "$25", labelAr: "٢٥ دولار", value: 25, currency: "USD", priceJod: 21.9 },
        { id: "50", label: "$50", labelAr: "٥٠ دولار", value: 50, currency: "USD", priceJod: 42.9 },
      ],
    }),
  }),
  digital({
    id: "nintendo-eshop",
    slug: "nintendo-eshop-card",
    fulfillmentType: "code",
    name: "Nintendo eShop Card",
    nameAr: "بطاقة نينتندو إي شوب",
    shortDescription: "Nintendo eShop credit for matching account regions.",
    shortDescriptionAr: "رصيد نينتندو إي شوب لمناطق الحساب المطابقة.",
    description:
      "Nintendo eShop cards sold by MMH. Confirm the Nintendo Account country before buying. MMH is not affiliated with Nintendo.",
    descriptionAr:
      "بطاقات نينتندو إي شوب تُباع عبر إم إم إتش. أكّد دولة حساب نينتندو قبل الشراء. إم إم إتش غير مرتبط بنينتندو.",
    brand: "Nintendo",
    category: "nintendo",
    artworkKey: "card-nintendo",
    priceJod: 9.2,
    rating: 4.4,
    reviewCount: 91,
    badges: ["region_locked"],
    createdAt: "2026-01-20",
    tags: ["nintendo", "eshop", "gift card", "switch"],
    platform: "nintendo",
    digitalOptions: codeOptions({
      platform: "nintendo",
      platformLabel: "Nintendo",
      platformLabelAr: "نينتندو",
      kind: "gift_card",
      regionWarning: "Nintendo eShop cards must match the Nintendo Account country.",
      regionWarningAr: "بطاقات نينتندو إي شوب يجب أن تطابق دولة حساب نينتندو.",
      howToUse: [
        "Sign in on a Nintendo Switch or Nintendo Account page.",
        "Open eShop Redeem Code.",
        "Enter the 16-digit code.",
        "Spend the credit on eShop titles and DLC.",
      ],
      howToUseAr: [
        "سجّل الدخول على نينتندو سويتش أو صفحة الحساب.",
        "افتح استرداد كود إي شوب.",
        "أدخل الكود المكوّن من ١٦ رقماً.",
        "استخدم الرصيد على الألعاب والمحتوى الإضافي.",
      ],
      denominations: [
        { id: "10", label: "$10", labelAr: "١٠ دولار", value: 10, currency: "USD", priceJod: 9.2 },
        { id: "20", label: "$20", labelAr: "٢٠ دولار", value: 20, currency: "USD", priceJod: 17.9 },
        { id: "35", label: "$35", labelAr: "٣٥ دولار", value: 35, currency: "USD", priceJod: 30.9 },
      ],
    }),
  }),
  digital({
    id: "apple-gift",
    slug: "apple-gift-card",
    fulfillmentType: "code",
    name: "Apple Gift Card",
    nameAr: "بطاقة هدايا آبل",
    shortDescription: "App Store and iTunes credit for matching Apple IDs.",
    shortDescriptionAr: "رصيد آب ستور وآي تيونز لحسابات آبل المطابقة.",
    description:
      "Apple gift cards sold by MMH. Redeem in the App Store country that matches the selected region. MMH is not affiliated with Apple.",
    descriptionAr:
      "بطاقات آبل تُباع عبر إم إم إتش. تُسترد في دولة آب ستور المطابقة للمنطقة. إم إم إتش غير مرتبط بآبل.",
    brand: "Apple",
    category: "apple",
    artworkKey: "card-apple",
    priceJod: 21.9,
    rating: 4.4,
    reviewCount: 55,
    badges: ["region_locked"],
    createdAt: "2026-02-09",
    tags: ["apple", "gift card", "app store", "itunes"],
    platform: "apple",
    digitalOptions: codeOptions({
      platform: "apple",
      platformLabel: "Apple",
      platformLabelAr: "آبل",
      kind: "gift_card",
      regionWarning: "Redeem only on an Apple ID whose country matches the selected region.",
      regionWarningAr: "استرد فقط على Apple ID تطابق دولته المنطقة المختارة.",
      howToUse: [
        "Sign in with the matching Apple ID.",
        "Open App Store and choose Redeem Gift Card.",
        "Enter or camera-scan the code.",
        "Use the balance on eligible Apple media and apps.",
      ],
      howToUseAr: [
        "سجّل الدخول بـ Apple ID المطابق.",
        "افتح آب ستور واختر استرداد بطاقة الهدايا.",
        "أدخل الكود أو امسحه بالكاميرا.",
        "استخدم الرصيد على تطبيقات ووسائط آبل المؤهلة.",
      ],
      denominations: [
        { id: "25", label: "$25", labelAr: "٢٥ دولار", value: 25, currency: "USD", priceJod: 21.9 },
        { id: "50", label: "$50", labelAr: "٥٠ دولار", value: 50, currency: "USD", priceJod: 43 },
      ],
    }),
  }),
  digital({
    id: "google-play",
    slug: "google-play-gift-card",
    fulfillmentType: "code",
    name: "Google Play Gift Card",
    nameAr: "بطاقة جوجل بلاي",
    shortDescription: "Play Store credit for apps, games, and in-app items.",
    shortDescriptionAr: "رصيد بلاي ستور للتطبيقات والألعاب والمشتريات داخلها.",
    description:
      "Google Play gift cards sold by MMH. Region locked to the Google account country. MMH is not affiliated with Google.",
    descriptionAr:
      "بطاقات جوجل بلاي تُباع عبر إم إم إتش. مقيدة بدولة حساب جوجل. إم إم إتش غير مرتبط بجوجل.",
    brand: "Google",
    category: "google-play",
    artworkKey: "card-google",
    priceJod: 21.5,
    rating: 4.5,
    reviewCount: 76,
    badges: ["region_locked"],
    createdAt: "2026-02-05",
    tags: ["google play", "gift card", "android"],
    platform: "google",
    digitalOptions: codeOptions({
      platform: "google",
      platformLabel: "Google Play",
      platformLabelAr: "جوجل بلاي",
      kind: "gift_card",
      regionWarning: "Google Play cards redeem only on an account from the selected country.",
      regionWarningAr: "بطاقات جوجل بلاي تُسترد فقط على حساب من الدولة المختارة.",
      howToUse: [
        "Open Google Play on a device signed into the matching account.",
        "Choose Redeem.",
        "Enter the gift-card code.",
        "Spend the balance in Play Store.",
      ],
      howToUseAr: [
        "افتح جوجل بلاي على جهاز مسجّل بالحساب المطابق.",
        "اختر استرداد.",
        "أدخل كود بطاقة الهدايا.",
        "استخدم الرصيد في بلاي ستور.",
      ],
      denominations: [
        { id: "10", label: "$10", labelAr: "١٠ دولار", value: 10, currency: "USD", priceJod: 8.9 },
        { id: "25", label: "$25", labelAr: "٢٥ دولار", value: 25, currency: "USD", priceJod: 21.5 },
        { id: "50", label: "$50", labelAr: "٥٠ دولار", value: 50, currency: "USD", priceJod: 42.5 },
      ],
    }),
  }),
  digital({
    id: "razer-gold",
    slug: "razer-gold",
    fulfillmentType: "code",
    name: "Razer Gold",
    nameAr: "ريزر جولد",
    shortDescription: "Razer Gold PIN for games and entertainment on Gold.",
    shortDescriptionAr: "رقم ريزر جولد للألعاب والترفيه على المنصة.",
    description:
      "Razer Gold PINs sold by MMH. Confirm the Gold wallet region before buying. MMH is not affiliated with Razer.",
    descriptionAr:
      "أرقام ريزر جولد تُباع عبر إم إم إتش. أكّد منطقة محفظة جولد قبل الشراء. إم إم إتش غير مرتبط بريزر.",
    brand: "Razer",
    category: "razer-gold",
    artworkKey: "card-razer",
    priceJod: 9.5,
    compareAtPriceJod: 11,
    rating: 4.3,
    reviewCount: 64,
    badges: ["sale", "region_locked"],
    trending: true,
    createdAt: "2026-02-18",
    tags: ["razer gold", "wallet", "pin"],
    platform: "razer",
    digitalOptions: codeOptions({
      platform: "razer",
      platformLabel: "Razer Gold",
      platformLabelAr: "ريزر جولد",
      kind: "wallet",
      regionWarning: "Razer Gold PINs must match the Gold wallet region.",
      regionWarningAr: "أرقام ريزر جولد يجب أن تطابق منطقة محفظة جولد.",
      howToUse: [
        "Sign in at gold.razer.com with the matching region wallet.",
        "Open Redeem PIN.",
        "Enter the purchased PIN.",
        "Pay with Gold on supported games and services.",
      ],
      howToUseAr: [
        "سجّل الدخول في gold.razer.com بمحفظة المنطقة المطابقة.",
        "افتح استرداد الرقم السري.",
        "أدخل الرقم المشترى.",
        "ادفع بجولد في الألعاب والخدمات المدعومة.",
      ],
      denominations: [
        { id: "10", label: "$10", labelAr: "١٠ دولار", value: 10, currency: "USD", priceJod: 9.5, compareAtPriceJod: 11 },
        { id: "20", label: "$20", labelAr: "٢٠ دولار", value: 20, currency: "USD", priceJod: 18.5 },
        { id: "50", label: "$50", labelAr: "٥٠ دولار", value: 50, currency: "USD", priceJod: 44.9 },
      ],
    }),
  }),
  digital({
    id: "roblox-card",
    slug: "roblox-gift-card",
    fulfillmentType: "code",
    name: "Roblox Gift Card",
    nameAr: "بطاقة هدايا روبلوكس",
    shortDescription: "Roblox gift-card PIN for Robux and eligible Roblox purchases. This is a redeemable code, not a direct Robux top-up.",
    shortDescriptionAr: "رقم بطاقة هدايا روبلوكس لروبوكس والمشتريات المؤهلة. هذا كود قابل للاسترداد وليس شحن روبوكس مباشراً.",
    description:
      "Roblox gift cards sold by MMH as redeemable PIN codes. This is not a direct Robux account top-up. Confirm that the gift-card currency matches the Roblox account before purchasing. MMH is not affiliated with Roblox Corporation.",
    descriptionAr:
      "بطاقات روبلوكس تُباع عبر إم إم إتش كأكواد PIN قابلة للاسترداد. هذا ليس شحن روبوكس مباشراً إلى الحساب. تأكد أن عملة البطاقة تطابق حساب روبلوكس قبل الشراء. إم إم إتش غير مرتبط بروبلوكس.",
    brand: "Roblox",
    category: "roblox",
    artworkKey: "card-roblox",
    priceJod: 8.9,
    compareAtPriceJod: 10.5,
    rating: 4.6,
    reviewCount: 210,
    badges: ["bestseller", "sale"],
    featured: true,
    trending: true,
    bestseller: true,
    createdAt: "2026-01-25",
    tags: ["roblox", "robux", "gift card", "100 robux"],
    platform: "roblox",
    digitalOptions: codeOptions({
      platform: "roblox",
      platformLabel: "Roblox",
      platformLabelAr: "روبلوكس",
      kind: "gift_card",
      regions: [
        { id: "us", name: "USD account", nameAr: "حساب بالدولار", locked: true, currency: "USD" },
        { id: "eu", name: "EUR account", nameAr: "حساب باليورو", locked: true, currency: "EUR" },
      ],
      accountCurrency: "USD",
      regionWarning: "Your Roblox account currency must match the selected card currency.",
      regionWarningAr: "يجب أن تطابق عملة حساب روبلوكس عملة البطاقة المختارة.",
      howToUse: [
        "Sign in to your Roblox account through a web browser.",
        "Open the official Roblox gift-card redemption page.",
        "Enter the purchased PIN code.",
        "Select Redeem.",
        "Use the added balance for eligible Roblox purchases.",
      ],
      howToUseAr: [
        "سجّل الدخول إلى حساب روبلوكس عبر متصفح الويب.",
        "افتح صفحة استرداد بطاقة هدايا روبلوكس الرسمية.",
        "أدخل الرقم السري المشترى.",
        "اختر استرداد.",
        "استخدم الرصيد المضاف على مشتريات روبلوكس المؤهلة.",
      ],
      denominations: [
        { id: "10", label: "$10 / Robux", labelAr: "١٠ دولار / روبوكس", value: 10, currency: "USD", priceJod: 8.9, compareAtPriceJod: 10.5 },
        { id: "25", label: "$25 / Robux", labelAr: "٢٥ دولار / روبوكس", value: 25, currency: "USD", priceJod: 21, compareAtPriceJod: 24 },
        { id: "50", label: "$50 / Robux", labelAr: "٥٠ دولار / روبوكس", value: 50, currency: "USD", priceJod: 41.5 },
      ],
    }),
  }),
  digital({
    id: "pubg-uc",
    slug: "pubg-mobile-uc",
    fulfillmentType: "direct_topup",
    name: "PUBG Mobile UC",
    nameAr: "شدات ببجي موبايل",
    shortDescription: "Direct UC packages credited to a PUBG Mobile Player ID.",
    shortDescriptionAr: "باقات UC تُشحن مباشرة إلى معرّف لاعب ببجي موبايل.",
    description:
      "PUBG Mobile UC sold by MMH as a direct Player ID top-up, not a redeemable UC code. Enter the correct Player ID. Account region is determined by the game account, not by the customer's country of purchase. MMH is not affiliated with PUBG or Krafton.",
    descriptionAr:
      "شدات ببجي موبايل تُباع عبر إم إم إتش كشحن مباشر إلى معرّف اللاعب، وليست كود UC قابل للاسترداد. أدخل معرّف اللاعب الصحيح. منطقة الحساب تُحدد من حساب اللعبة وليس من بلد الشراء. إم إم إتش غير مرتبط بببجي.",
    brand: "PUBG",
    category: "pubg-mobile",
    artworkKey: "card-pubg",
    priceJod: 8.5,
    compareAtPriceJod: 9.9,
    rating: 4.7,
    reviewCount: 510,
    badges: ["bestseller", "sale", "topup"],
    featured: true,
    trending: true,
    bestseller: true,
    createdAt: "2026-01-08",
    tags: ["pubg", "uc", "mobile", "top-up", "player id"],
    platform: "pubg",
    digitalOptions: topupOptions({
      platform: "pubg",
      platformLabel: "PUBG Mobile",
      platformLabelAr: "ببجي موبايل",
      fields: [playerIdField()],
      regionWarning: "The entered Player ID must belong to the selected game region.",
      regionWarningAr: "يجب أن ينتمي معرّف اللاعب المدخل إلى منطقة اللعبة المختارة.",
      howToUse: [
        "Select the UC package.",
        "Enter your PUBG Mobile Player ID.",
        "Confirm the ID in your profile screen.",
        "Complete checkout. Top-up status appears in Top-Up Orders.",
      ],
      howToUseAr: [
        "اختر باقة الشدات.",
        "أدخل معرّف لاعب ببجي موبايل.",
        "أكّد المعرّف من شاشة الملف الشخصي.",
        "أكمل الطلب. تظهر حالة الشحن في طلبات الشحن.",
      ],
      denominations: [
        { id: "60", label: "60 UC", labelAr: "٦٠ شدة", value: 60, currency: "UC", priceJod: 1.5 },
        { id: "325", label: "325 UC", labelAr: "٣٢٥ شدة", value: 325, currency: "UC", priceJod: 4.9 },
        { id: "660", label: "660 UC", labelAr: "٦٦٠ شدة", value: 660, currency: "UC", priceJod: 8.5, compareAtPriceJod: 9.9 },
        { id: "1800", label: "1,800 UC", labelAr: "١٨٠٠ شدة", value: 1800, currency: "UC", priceJod: 22.9 },
        { id: "3850", label: "3,850 UC", labelAr: "٣٨٥٠ شدة", value: 3850, currency: "UC", priceJod: 45.9 },
      ],
    }),
  }),
  digital({
    id: "free-fire",
    slug: "free-fire-diamonds",
    fulfillmentType: "direct_topup",
    name: "Free Fire Diamonds",
    nameAr: "جواهر فري فاير",
    shortDescription: "Direct diamond packages for a Free Fire Player ID.",
    shortDescriptionAr: "باقات جواهر تُشحن مباشرة إلى معرّف لاعب فري فاير.",
    description:
      "Free Fire Diamonds sold by MMH as a direct top-up. Confirm the Player ID before checkout. MMH is not affiliated with Garena.",
    descriptionAr:
      "جواهر فري فاير تُباع عبر إم إم إتش كشحن مباشر. أكّد معرّف اللاعب قبل الدفع. إم إم إتش غير مرتبط بغارينا.",
    brand: "Garena",
    category: "free-fire",
    artworkKey: "card-ff",
    priceJod: 4.5,
    rating: 4.6,
    reviewCount: 276,
    badges: ["topup", "bestseller"],
    trending: true,
    bestseller: true,
    createdAt: "2026-01-14",
    tags: ["free fire", "diamonds", "garena", "top-up"],
    platform: "freefire",
    digitalOptions: topupOptions({
      platform: "freefire",
      platformLabel: "Free Fire",
      platformLabelAr: "فري فاير",
      fields: [playerIdField()],
      regionWarning: "The Player ID must belong to the Free Fire account you want to top up.",
      regionWarningAr: "يجب أن ينتمي معرّف اللاعب إلى حساب فري فاير المراد شحنه.",
      howToUse: [
        "Choose a diamond package.",
        "Enter the Free Fire Player ID.",
        "Complete checkout.",
        "Track status under Top-Up Orders.",
      ],
      howToUseAr: [
        "اختر باقة الجواهر.",
        "أدخل معرّف لاعب فري فاير.",
        "أكمل الطلب.",
        "تابع الحالة من طلبات الشحن.",
      ],
      denominations: [
        { id: "100", label: "100 Diamonds", labelAr: "١٠٠ جوهرة", value: 100, currency: "DM", priceJod: 1.9 },
        { id: "310", label: "310 Diamonds", labelAr: "٣١٠ جواهر", value: 310, currency: "DM", priceJod: 4.5 },
        { id: "520", label: "520 Diamonds", labelAr: "٥٢٠ جوهرة", value: 520, currency: "DM", priceJod: 7.5 },
        { id: "1080", label: "1,080 Diamonds", labelAr: "١٠٨٠ جوهرة", value: 1080, currency: "DM", priceJod: 14.9 },
      ],
    }),
  }),
  digital({
    id: "mlbb-diamonds",
    slug: "mobile-legends-diamonds",
    fulfillmentType: "direct_topup",
    name: "Mobile Legends Diamonds",
    nameAr: "ماس موبايل ليجندز",
    shortDescription: "Direct diamonds using User ID and Zone ID.",
    shortDescriptionAr: "ماس مباشر باستخدام معرّف المستخدم ومعرّف المنطقة.",
    description:
      "Mobile Legends diamonds sold by MMH. Both User ID and Zone ID are required. MMH is not affiliated with Moonton.",
    descriptionAr:
      "ماس موبايل ليجندز يُباع عبر إم إم إتش. معرّف المستخدم ومعرّف المنطقة مطلوبان. إم إم إتش غير مرتبط بموونتون.",
    brand: "Moonton",
    category: "mobile-legends",
    artworkKey: "card-mlbb",
    priceJod: 3.9,
    rating: 4.5,
    reviewCount: 198,
    badges: ["topup"],
    trending: true,
    createdAt: "2026-01-22",
    tags: ["mobile legends", "mlbb", "diamonds", "zone id", "top-up"],
    platform: "mlbb",
    digitalOptions: topupOptions({
      platform: "mlbb",
      platformLabel: "Mobile Legends",
      platformLabelAr: "موبايل ليجندز",
      fields: [userIdField(), zoneIdField()],
      regionWarning: "User ID and Zone ID must belong to the same Mobile Legends account.",
      regionWarningAr: "يجب أن ينتمي معرّف المستخدم ومعرّف المنطقة إلى نفس حساب موبايل ليجندز.",
      howToUse: [
        "Open your Mobile Legends profile.",
        "Copy User ID and the Zone ID in parentheses.",
        "Select a diamond package and paste both IDs.",
        "Submit checkout and wait for top-up status.",
      ],
      howToUseAr: [
        "افتح ملفك في موبايل ليجندز.",
        "انسخ معرّف المستخدم ومعرّف المنطقة بين القوسين.",
        "اختر باقة الماس والصق المعرّفين.",
        "أكمل الطلب وانتظر حالة الشحن.",
      ],
      denominations: [
        { id: "86", label: "86 Diamonds", labelAr: "٨٦ ماسة", value: 86, currency: "DM", priceJod: 1.9 },
        { id: "172", label: "172 Diamonds", labelAr: "١٧٢ ماسة", value: 172, currency: "DM", priceJod: 3.9 },
        { id: "257", label: "257 Diamonds", labelAr: "٢٥٧ ماسة", value: 257, currency: "DM", priceJod: 5.5 },
        { id: "706", label: "706 Diamonds", labelAr: "٧٠٦ ماسات", value: 706, currency: "DM", priceJod: 14.5 },
      ],
    }),
  }),
  digital({
    id: "valorant-points",
    slug: "valorant-points",
    fulfillmentType: "code",
    name: "Valorant Points",
    nameAr: "نقاط فالورانت",
    shortDescription: "Valorant Points codes for Riot accounts in matching regions.",
    shortDescriptionAr: "أكواد نقاط فالورانت لحسابات رايوت في المناطق المطابقة.",
    description:
      "Valorant Points sold by MMH as redeemable codes. Match the Riot account region. MMH is not affiliated with Riot Games.",
    descriptionAr:
      "نقاط فالورانت تُباع عبر إم إم إتش كأكواد استرداد. طابق منطقة حساب رايوت. إم إم إتش غير مرتبط برايوت.",
    brand: "Riot",
    category: "valorant",
    artworkKey: "card-valorant",
    priceJod: 9.9,
    rating: 4.5,
    reviewCount: 142,
    badges: ["region_locked", "new"],
    createdAt: "2026-03-01",
    tags: ["valorant", "vp", "riot", "pc"],
    platform: "valorant",
    digitalOptions: codeOptions({
      platform: "valorant",
      platformLabel: "Valorant",
      platformLabelAr: "فالورانت",
      kind: "game_currency",
      regionWarning: "Redeem only on a Riot account from the selected Valorant region.",
      regionWarningAr: "استرد فقط على حساب رايوت من منطقة فالورانت المختارة.",
      howToUse: [
        "Sign in at the Riot Access / Valorant store.",
        "Open Redeem Code.",
        "Enter the purchased PIN.",
        "Valorant Points appear on the matching account.",
      ],
      howToUseAr: [
        "سجّل الدخول في متجر رايوت / فالورانت.",
        "افتح استرداد الكود.",
        "أدخل الرقم المشترى.",
        "تظهر نقاط فالورانت على الحساب المطابق.",
      ],
      denominations: [
        { id: "475", label: "475 VP", labelAr: "٤٧٥ نقطة", value: 475, currency: "VP", priceJod: 4.9 },
        { id: "1000", label: "1,000 VP", labelAr: "١٠٠٠ نقطة", value: 1000, currency: "VP", priceJod: 9.9 },
        { id: "2050", label: "2,050 VP", labelAr: "٢٠٥٠ نقطة", value: 2050, currency: "VP", priceJod: 18.9 },
        { id: "3650", label: "3,650 VP", labelAr: "٣٦٥٠ نقطة", value: 3650, currency: "VP", priceJod: 32.9 },
      ],
    }),
  }),
  digital({
    id: "fortnite-vbucks",
    slug: "fortnite-v-bucks",
    fulfillmentType: "code",
    name: "Fortnite V-Bucks",
    nameAr: "فورتنايت في-بكس",
    shortDescription: "V-Bucks codes for skins and the Battle Pass.",
    shortDescriptionAr: "أكواد في-بكس للملابس وبطاقة المعركة.",
    description:
      "Fortnite V-Bucks cards sold by MMH. Match the Epic account region and platform. MMH is not affiliated with Epic Games.",
    descriptionAr:
      "بطاقات فورتنايت في-بكس تُباع عبر إم إم إتش. طابق منطقة حساب Epic والمنصة. إم إم إتش غير مرتبط بإبك.",
    brand: "Epic",
    category: "fortnite",
    artworkKey: "card-fortnite",
    priceJod: 8.9,
    rating: 4.5,
    reviewCount: 132,
    badges: ["region_locked"],
    createdAt: "2026-01-18",
    tags: ["fortnite", "v-bucks", "epic"],
    platform: "fortnite",
    digitalOptions: codeOptions({
      platform: "fortnite",
      platformLabel: "Fortnite",
      platformLabelAr: "فورتنايت",
      kind: "game_currency",
      regionWarning: "Match the Epic Games account region before purchasing V-Bucks.",
      regionWarningAr: "طابق منطقة حساب Epic قبل شراء في-بكس.",
      howToUse: [
        "Sign in to the Epic Games account that owns Fortnite.",
        "Open Redeem on epicgames.com.",
        "Enter the V-Bucks code.",
        "Launch Fortnite to spend the credit.",
      ],
      howToUseAr: [
        "سجّل الدخول إلى حساب Epic الذي يملك فورتنايت.",
        "افتح الاسترداد على epicgames.com.",
        "أدخل كود في-بكس.",
        "شغّل فورتنايت لاستخدام الرصيد.",
      ],
      denominations: [
        { id: "1000", label: "1,000 V-Bucks", labelAr: "١٠٠٠ في-بكس", value: 1000, currency: "VB", priceJod: 8.9 },
        { id: "2800", label: "2,800 V-Bucks", labelAr: "٢٨٠٠ في-بكس", value: 2800, currency: "VB", priceJod: 21.9 },
        { id: "5000", label: "5,000 V-Bucks", labelAr: "٥٠٠٠ في-بكس", value: 5000, currency: "VB", priceJod: 34.9 },
      ],
    }),
  }),
  digital({
    id: "ea-fc-points",
    slug: "ea-sports-fc-points",
    fulfillmentType: "code",
    name: "EA Sports FC Points",
    nameAr: "نقاط EA Sports FC",
    shortDescription: "FC Points for Ultimate Team on selected platforms.",
    shortDescriptionAr: "نقاط FC للفريق النهائي على منصات محددة.",
    description:
      "EA Sports FC points sold by MMH. Confirm console or PC platform and region before checkout. MMH is not affiliated with EA.",
    descriptionAr:
      "نقاط EA Sports FC تُباع عبر إم إم إتش. أكّد المنصة والمنطقة قبل الدفع. إم إم إتش غير مرتبط بإي إيه.",
    brand: "EA",
    category: "ea-sports-fc",
    artworkKey: "card-ea",
    priceJod: 9.9,
    rating: 4.4,
    reviewCount: 156,
    badges: ["region_locked"],
    trending: true,
    createdAt: "2026-02-01",
    tags: ["ea", "fc", "fifa", "points", "ultimate team"],
    platform: "ea",
    digitalOptions: codeOptions({
      platform: "ea",
      platformLabel: "EA Sports FC",
      platformLabelAr: "إي إيه سبورتس إف سي",
      kind: "game_currency",
      regionWarning: "FC Points must match the platform and region of your EA account.",
      regionWarningAr: "يجب أن تطابق نقاط FC منصة ومنطقة حساب EA.",
      howToUse: [
        "Sign in to the EA account used for FC Ultimate Team.",
        "Open Redeem on the matching platform.",
        "Enter the points code.",
        "Launch FC to spend the points.",
      ],
      howToUseAr: [
        "سجّل الدخول إلى حساب EA المستخدم في الفريق النهائي.",
        "افتح الاسترداد على المنصة المطابقة.",
        "أدخل كود النقاط.",
        "شغّل اللعبة لاستخدام النقاط.",
      ],
      denominations: [
        { id: "1200", label: "1,200 Points", labelAr: "١٢٠٠ نقطة", value: 1200, currency: "PTS", priceJod: 9.9 },
        { id: "5900", label: "5,900 Points", labelAr: "٥٩٠٠ نقطة", value: 5900, currency: "PTS", priceJod: 39.9 },
        { id: "12000", label: "12,000 Points", labelAr: "١٢٠٠٠ نقطة", value: 12000, currency: "PTS", priceJod: 74.9 },
      ],
    }),
  }),
  digital({
    id: "lol-card",
    slug: "league-of-legends-card",
    fulfillmentType: "code",
    name: "League of Legends Card",
    nameAr: "بطاقة ليغ أوف ليجندز",
    shortDescription: "Riot prepaid codes for League of Legends.",
    shortDescriptionAr: "أكواد رايوت المدفوعة مسبقاً لليغ أوف ليجندز.",
    description:
      "League of Legends prepaid cards sold by MMH. Redeem on the matching Riot region. MMH is not affiliated with Riot Games.",
    descriptionAr:
      "بطاقات ليغ أوف ليجندز تُباع عبر إم إم إتش. تُسترد على منطقة رايوت المطابقة. إم إم إتش غير مرتبط برايوت.",
    brand: "Riot",
    category: "league-of-legends",
    artworkKey: "card-lol",
    priceJod: 9.5,
    rating: 4.3,
    reviewCount: 48,
    badges: ["region_locked", "new"],
    createdAt: "2026-03-08",
    tags: ["league of legends", "lol", "rp", "riot"],
    platform: "lol",
    digitalOptions: codeOptions({
      platform: "lol",
      platformLabel: "League of Legends",
      platformLabelAr: "ليغ أوف ليجندز",
      kind: "digital_code",
      regionWarning: "Redeem only on a League of Legends account from the selected region.",
      regionWarningAr: "استرد فقط على حساب ليغ أوف ليجندز من المنطقة المختارة.",
      howToUse: [
        "Sign in to the Riot client on the matching region.",
        "Open Store → Redeem Code.",
        "Enter the prepaid PIN.",
        "RP credit appears on that account.",
      ],
      howToUseAr: [
        "سجّل الدخول إلى عميل رايوت في المنطقة المطابقة.",
        "افتح المتجر ثم استرداد الكود.",
        "أدخل الرقم المدفوع مسبقاً.",
        "يظهر رصيد RP على ذلك الحساب.",
      ],
      denominations: [
        { id: "10", label: "$10 RP", labelAr: "١٠ دولار RP", value: 10, currency: "USD", priceJod: 9.5 },
        { id: "25", label: "$25 RP", labelAr: "٢٥ دولار RP", value: 25, currency: "USD", priceJod: 22.5 },
      ],
    }),
  }),
  digital({
    id: "ps-plus",
    slug: "playstation-plus",
    fulfillmentType: "code",
    name: "PlayStation Plus Membership",
    nameAr: "عضوية بلايستيشن بلس",
    shortDescription: "Digital PlayStation Plus membership codes for matching regions.",
    shortDescriptionAr: "أكواد عضوية بلايستيشن بلس الرقمية للمناطق المطابقة.",
    description:
      "PlayStation Plus membership codes sold by MMH. Confirm the PlayStation account region. MMH is not affiliated with Sony.",
    descriptionAr:
      "أكواد عضوية بلايستيشن بلس تُباع عبر إم إم إتش. أكّد منطقة حساب بلايستيشن. إم إم إتش غير مرتبط بسوني.",
    brand: "PlayStation",
    category: "subscriptions",
    artworkKey: "card-psplus",
    priceJod: 19.9,
    compareAtPriceJod: 24.9,
    rating: 4.6,
    reviewCount: 88,
    badges: ["sale", "region_locked"],
    featured: true,
    createdAt: "2026-02-22",
    tags: ["playstation plus", "subscription", "membership", "psn"],
    platform: "playstation",
    digitalOptions: codeOptions({
      platform: "playstation",
      platformLabel: "PlayStation",
      platformLabelAr: "بلايستيشن",
      kind: "subscription",
      regionWarning: "PlayStation Plus codes work only on the selected account region.",
      regionWarningAr: "أكواد بلايستيشن بلس تعمل فقط على منطقة الحساب المختارة.",
      howToUse: [
        "Sign in to the matching PlayStation account.",
        "Open Redeem Codes.",
        "Enter the membership PIN.",
        "Confirm the Plus plan on the account.",
      ],
      howToUseAr: [
        "سجّل الدخول إلى حساب بلايستيشن المطابق.",
        "افتح استرداد الأكواد.",
        "أدخل رقم العضوية.",
        "أكّد خطة بلس على الحساب.",
      ],
      denominations: [
        { id: "essential-3m", label: "Essential 3 months", labelAr: "Essential ٣ أشهر", value: 3, currency: "MO", priceJod: 19.9, compareAtPriceJod: 24.9 },
        { id: "extra-12m", label: "Extra 12 months", labelAr: "Extra ١٢ شهراً", value: 12, currency: "MO", priceJod: 64.9 },
        { id: "premium-12m", label: "Premium 12 months", labelAr: "Premium ١٢ شهراً", value: 12, currency: "MO", priceJod: 89.9 },
      ],
    }),
  }),
];

function catalog(): Product[] {
  const live = getSnapshotProducts();
  return live.length > 0 ? live : PRODUCTS;
}

export function getProductBySlug(slug: string): Product | undefined {
  return catalog().find((product) => product.slug === slug);
}

export function getProductById(id: string): Product | undefined {
  return catalog().find((product) => product.id === id);
}

const CATEGORY_GROUPS: Record<string, (product: Product) => boolean> = {
  playstation: (product) => product.platform === "playstation",
  steam: (product) => product.platform === "steam",
  xbox: (product) => product.platform === "xbox",
  nintendo: (product) => product.platform === "nintendo",
  "mobile-games": (product) => ["pubg", "freefire", "free-fire", "mlbb", "roblox"].includes(product.platform),
  "pc-games": (product) => ["steam", "valorant", "lol", "riot", "ea", "fortnite"].includes(product.platform),
  "game-top-ups": (product) => product.fulfillmentType === "direct_topup",
  "gift-cards": (product) =>
    product.digitalOptions.kind === "gift_card" || product.digitalOptions.kind === "wallet",
  "wallet-cards": (product) => product.digitalOptions.kind === "wallet",
  "game-currencies": (product) =>
    product.digitalOptions.kind === "game_currency" || product.fulfillmentType === "direct_topup",
  subscriptions: (product) => product.digitalOptions.kind === "subscription",
  entertainment: (product) => ["apple", "google", "nintendo"].includes(product.platform),
  "mobile-credit": (product) => ["google", "apple", "razer"].includes(product.platform),
  "best-sellers": (product) => Boolean(product.bestseller),
  "new-products": (product) => product.badges.includes("new") || product.createdAt >= "2026-03-01",
  "special-offers": (product) => Boolean(product.compareAtPriceJod),
  deals: (product) => Boolean(product.compareAtPriceJod),
};

/** Whether a navigation grouping (e.g. "playstation", "mobile-games") includes the product. */
export function matchesCategoryGroup(slug: string, product: Product): boolean {
  return CATEGORY_GROUPS[slug]?.(product) ?? false;
}

export function isCategoryGroup(slug: string): boolean {
  return slug in CATEGORY_GROUPS;
}

export function getProductsByCategory(slug: string): Product[] {
  const group = CATEGORY_GROUPS[slug];
  if (group) return catalog().filter(group);
  return catalog().filter((product) => product.category === slug || product.platform === slug);
}

export function getRelatedProducts(product: Product, limit = 8): Product[] {
  return catalog().filter(
    (item) =>
      item.id !== product.id &&
      (item.category === product.category ||
        item.platform === product.platform ||
        item.fulfillmentType === product.fulfillmentType),
  ).slice(0, limit);
}

export function getAlsoBoughtProducts(product: Product, limit = 6): Product[] {
  const relatedIds = new Set(getRelatedProducts(product, 4).map((item) => item.id));
  const samePlatform = catalog().filter(
    (item) => item.id !== product.id && !relatedIds.has(item.id) && item.platform === product.platform,
  );
  const trending = catalog().filter(
    (item) => item.id !== product.id && !relatedIds.has(item.id) && (item.trending || item.bestseller),
  );
  const merged = [...samePlatform, ...trending];
  const seen = new Set<string>();
  return merged.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, limit);
}

export function getMayLikeProducts(product: Product, recentIds: string[], limit = 8): Product[] {
  const exclude = new Set([product.id, ...getRelatedProducts(product, 8).map((item) => item.id)]);
  const fromRecent = recentIds
    .map((id) => getProductById(id))
    .filter((item): item is Product => item != null && !exclude.has(item.id));
  if (fromRecent.length >= 3) return fromRecent.slice(0, limit);
  const fallback = catalog().filter((item) => !exclude.has(item.id) && (item.trending || item.featured));
  const merged = [...fromRecent, ...fallback];
  const seen = new Set<string>();
  return merged.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, limit);
}

export function searchProducts(query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return catalog().filter((product) => {
    const haystack = [
      product.name,
      product.nameAr,
      product.brand,
      product.category,
      product.platform,
      product.shortDescription,
      product.digitalOptions.platformLabel,
      product.digitalOptions.kind,
      product.fulfillmentType,
      ...product.tags,
      ...product.digitalOptions.regions.flatMap((region) => [region.id, region.name, region.nameAr, region.currency ?? ""]),
      ...product.digitalOptions.denominations.flatMap((item) => [
        item.label,
        item.labelAr,
        item.currency,
        String(item.value),
      ]),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function uniqueBrands(): string[] {
  return Array.from(new Set(catalog().map((product) => product.brand))).sort();
}

export function uniquePlatforms(): string[] {
  return Array.from(new Set(catalog().map((product) => product.platform)));
}

export function uniqueRegions(): { id: string; name: string; nameAr: string }[] {
  const map = new Map<string, { id: string; name: string; nameAr: string }>();
  for (const product of catalog()) {
    for (const region of product.digitalOptions.regions) {
      if (!map.has(region.id)) {
        map.set(region.id, { id: region.id, name: region.name, nameAr: region.nameAr });
      }
    }
  }
  return Array.from(map.values());
}

export function uniqueKinds(): ProductKind[] {
  return Array.from(new Set(catalog().map((product) => product.digitalOptions.kind)));
}

export function priceRange(): { min: number; max: number } {
  const prices = catalog().map((product) => product.priceJod);
  return { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) };
}

export function getActivePrice(product: Product, denominationId?: string): number {
  if (denominationId) {
    const denomination = product.digitalOptions.denominations.find((item) => item.id === denominationId);
    if (denomination) return denomination.priceJod;
  }
  return product.priceJod;
}

export function parentCategoryFor(category: string): string {
  if (["pubg-mobile", "free-fire", "mobile-legends", "roblox"].includes(category)) return "mobile-games";
  if (["playstation", "subscriptions"].includes(category)) return "playstation";
  if (category === "steam") return "steam";
  return category;
}

export function isDigitalCatalog(): boolean {
  return true;
}

export function productNeedsConfiguration(product: Product): boolean {
  return (
    product.digitalOptions.denominations.length > 1 ||
    product.digitalOptions.requiredCustomerFields.length > 0 ||
    product.digitalOptions.regions.length > 1
  );
}

export function startingDenomination(product: Product) {
  return product.digitalOptions.denominations[0];
}
