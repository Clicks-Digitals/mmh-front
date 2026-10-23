import type { Category, Product, ProductBadge, ProductKind, RequiredCustomerField } from "@/types";
import { ApiError, apiFetch, getApiBaseUrl } from "@/lib/api/client";
import { safeDeliveryEstimate, stripInstantClaims } from "@/lib/delivery-copy";
import { staticCatalogImage } from "@/lib/static-images";

type ApiProduct = {
  id: string;
  slug: string;
  kind: string;
  fulfillment_type: string;
  brand: string;
  artwork_key: string;
  image_url?: string;
  status: string;
  featured: boolean;
  bestseller: boolean;
  trending: boolean;
  rating: string | number;
  review_count: number;
  badges: string[];
  tags: string[];
  name_en: string;
  name_ar: string;
  short_description_en?: string;
  short_description_ar?: string;
  description_en?: string;
  description_ar?: string;
  instructions_en?: string;
  instructions_ar?: string;
  how_to_use_en?: string[];
  how_to_use_ar?: string[];
  region_restrictions_en?: string;
  region_restrictions_ar?: string;
  refund_policy_en?: string;
  refund_policy_ar?: string;
  region_warning_en?: string;
  region_warning_ar?: string;
  delivery_estimate_en?: string;
  delivery_estimate_ar?: string;
  account_currency?: string;
  price_jod?: number;
  in_stock?: boolean;
  refundable?: boolean;
  category_slug?: string;
  platform_slug?: string;
  category?: { slug: string; name_en: string; name_ar: string };
  platform?: { slug: string; name_en: string; name_ar: string };
  variants?: Array<{
    id: number;
    external_id: string;
    denomination: string | number;
    package_currency: string;
    price_jod: number;
    compare_at_price_jod?: number | null;
    stock_status: string;
    available?: boolean;
    min_quantity?: number;
    max_quantity?: number;
    region?: { slug: string; name_en: string; name_ar: string; currency?: string } | null;
    name_en: string;
    name_ar: string;
    region_slug?: string | null;
    region_name_en?: string | null;
    region_name_ar?: string | null;
    region_locked?: boolean | null;
    sort_order?: number;
  }>;
  fields?: Array<{
    key: string;
    type: string;
    required: boolean;
    sort_order?: number;
    label_en: string;
    label_ar: string;
    placeholder_en: string;
    placeholder_ar: string;
    help_text_en?: string;
    help_text_ar?: string;
  }>;
  media?: Array<{ url: string; is_primary?: boolean; sort_order?: number }>;
  primary_image_url?: string;
  created_at?: string;
};

type ApiCategory = {
  id: number;
  slug: string;
  href: string;
  parent?: string | null;
  artwork_key: string;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
};

const DEFAULT_FIELD_HELP: Record<string, { en: string; ar: string }> = {
  playerId: {
    en: "Open the game, tap your avatar or profile, and copy the numeric Player ID shown there.",
    ar: "افتح اللعبة، اضغط على صورتك أو ملفك الشخصي، وانسخ معرّف اللاعب الرقمي الظاهر هناك.",
  },
  userId: {
    en: "Open your in-game profile. The User ID is the number shown next to your avatar.",
    ar: "افتح ملفك داخل اللعبة. معرّف المستخدم هو الرقم الظاهر بجانب صورتك.",
  },
  zoneId: {
    en: "The Zone ID is the number in parentheses after your User ID on the profile screen.",
    ar: "معرّف المنطقة هو الرقم بين القوسين بعد معرّف المستخدم في شاشة الملف الشخصي.",
  },
};

function mapKind(kind: string): ProductKind {
  return kind.toLowerCase() as ProductKind;
}

function mapFulfillment(value: string): Product["fulfillmentType"] {
  return value === "DIRECT_TOPUP" ? "direct_topup" : "code";
}

export function mapApiProduct(row: ApiProduct): Product {
  const variants = [...(row.variants ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const variantAvailable = (variant: (typeof variants)[number]) =>
    variant.available ?? variant.stock_status === "IN_STOCK";
  const regionsMap = new Map<string, { id: string; name: string; nameAr: string; locked: boolean; currency?: string }>();
  for (const variant of variants) {
    const regionId = variant.region?.slug || variant.region_slug || "global";
    if (!regionsMap.has(regionId)) {
      const name =
        variant.region?.name_en || variant.region_name_en || (regionId === "global" ? "Global" : regionId.toUpperCase());
      regionsMap.set(regionId, {
        id: regionId,
        name,
        nameAr: variant.region?.name_ar || variant.region_name_ar || (regionId === "global" ? "عالمي" : name),
        locked: variant.region_locked ?? regionId !== "global",
        currency: variant.region?.currency || variant.package_currency,
      });
    }
  }
  const firstVariant = variants.find(variantAvailable) ?? variants[0];
  const firstCompareAt =
    firstVariant?.compare_at_price_jod != null && firstVariant.compare_at_price_jod > firstVariant.price_jod
      ? firstVariant.compare_at_price_jod
      : undefined;
  const fields: RequiredCustomerField[] = [...(row.fields ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((field) => ({
      id: field.key,
      label: field.label_en,
      labelAr: field.label_ar,
      placeholder: field.placeholder_en,
      placeholderAr: field.placeholder_ar,
      type: (field.type.toLowerCase() as RequiredCustomerField["type"]) || "text",
      required: field.required,
      helpText: field.help_text_en || DEFAULT_FIELD_HELP[field.key]?.en,
      helpTextAr: field.help_text_ar || DEFAULT_FIELD_HELP[field.key]?.ar,
    }));

  const primaryMedia = [...(row.media ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const primaryFromGallery = primaryMedia.find((m) => m.is_primary)?.url || primaryMedia[0]?.url;
  const image = row.primary_image_url || row.image_url || primaryFromGallery || staticCatalogImage(row.id);
  const gallery = primaryMedia.length ? primaryMedia.map((m) => m.url).filter(Boolean) : image ? [image] : [];
  const isTopup = row.fulfillment_type === "DIRECT_TOPUP";
  const platform = row.platform;
  const categorySlug = row.category_slug || row.category?.slug || "gift-cards";

  return {
    id: row.id,
    slug: row.slug,
    type: "digital",
    fulfillmentType: mapFulfillment(row.fulfillment_type),
    name: row.name_en,
    nameAr: row.name_ar,
    shortDescription: stripInstantClaims(row.short_description_en),
    shortDescriptionAr: stripInstantClaims(row.short_description_ar),
    description: stripInstantClaims(row.description_en),
    descriptionAr: stripInstantClaims(row.description_ar),
    brand: row.brand,
    category: categorySlug,
    images: gallery.length ? gallery : image ? [image] : [],
    artworkKey: row.artwork_key,
    priceJod: variants.length ? Math.min(...variants.map((variant) => variant.price_jod)) : row.price_jod ?? 0,
    compareAtPriceJod: firstCompareAt,
    rating: Number(row.rating) || 0,
    reviewCount: row.review_count || 0,
    badges: [...new Set([...(row.badges || []), ...(row.bestseller ? ["bestseller"] : [])])].filter(
      (badge) => badge !== "instant",
    ) as ProductBadge[],
    inStock: row.in_stock ?? variants.some(variantAvailable),
    featured: row.featured,
    bestseller: row.bestseller,
    trending: row.trending,
    createdAt: row.created_at ?? new Date(0).toISOString(),
    tags: row.tags || [],
    platform: row.platform_slug || platform?.slug || row.brand.toLowerCase(),
    digitalOptions: {
      platform: row.platform_slug || platform?.slug || row.brand.toLowerCase(),
      platformLabel: platform?.name_en || row.brand,
      platformLabelAr: platform?.name_ar || row.brand,
      kind: mapKind(row.kind),
      regions: [...regionsMap.values()],
      denominations: variants.map((variant) => ({
        id: String(variant.id),
        variantId: variant.id,
        regionId: variant.region?.slug || variant.region_slug || undefined,
        label: variant.name_en,
        labelAr: variant.name_ar,
        value: Number(variant.denomination),
        currency: variant.package_currency,
        priceJod: variant.price_jod,
        compareAtPriceJod: variant.compare_at_price_jod ?? undefined,
        inStock: variantAvailable(variant),
        minQuantity: variant.min_quantity,
        maxQuantity: variant.max_quantity,
      })),
      deliveryMethods: ["account"],
      deliveryEstimate: safeDeliveryEstimate(row.delivery_estimate_en, "en", isTopup),
      deliveryEstimateAr: safeDeliveryEstimate(row.delivery_estimate_ar, "ar", isTopup),
      instructions: row.instructions_en || "",
      instructionsAr: row.instructions_ar || "",
      howToUse: row.how_to_use_en || [],
      howToUseAr: row.how_to_use_ar || [],
      regionRestrictions: row.region_restrictions_en || "",
      regionRestrictionsAr: row.region_restrictions_ar || "",
      regionWarning: row.region_warning_en,
      regionWarningAr: row.region_warning_ar,
      accountCurrency: row.account_currency,
      refundEligible: Boolean(row.refundable),
      refundPolicyText: row.refund_policy_en || "",
      refundPolicyTextAr: row.refund_policy_ar || "",
      instantCode: false,
      requiredCustomerFields: fields,
    },
  };
}

export function mapApiCategory(row: ApiCategory): Category {
  return {
    slug: row.slug,
    name: row.name_en,
    nameAr: row.name_ar,
    description: row.description_en,
    descriptionAr: row.description_ar,
    href: row.href || `/category/${row.slug}`,
    artworkKey: row.artwork_key || "gift",
    ...(row.parent ? { parent: row.parent } : {}),
  };
}

type Paginated<T> = { results: T[]; count: number } | T[];

function unwrapList<T>(data: Paginated<T>): T[] {
  return Array.isArray(data) ? data : data.results;
}

export async function fetchApiProducts(): Promise<Product[]> {
  const rows: ApiProduct[] = [];
  let path: string | null = "/catalog/products/?page_size=200";
  for (let page = 0; path && page < 20; page += 1) {
    const data: Paginated<ApiProduct> & { next?: string | null } = await apiFetch(path);
    rows.push(...unwrapList(data));
    const next: string | null | undefined = Array.isArray(data) ? null : data.next;
    path = next ? next.replace(getApiBaseUrl(), "") : null;
    if (path && /^https?:/i.test(path)) {
      const url: URL = new URL(path);
      path = `${url.pathname.replace(/^.*?\/api\/v1/, "")}${url.search}`;
    }
  }
  return rows.map(mapApiProduct);
}

export async function fetchApiProduct(slug: string): Promise<Product | undefined> {
  try {
    const row = await apiFetch<ApiProduct>(`/catalog/products/${encodeURIComponent(slug)}/`);
    return mapApiProduct(row);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

export async function fetchApiCategories(): Promise<Category[]> {
  const data = await apiFetch<Paginated<ApiCategory>>("/catalog/categories/");
  return unwrapList(data).map(mapApiCategory);
}

export async function hydrateCatalogFromDb() {
  const [products, categories] = await Promise.all([fetchApiProducts(), fetchApiCategories()]);
  return { products, categories };
}

export async function loadPublishedFaqs() {
  try {
    const data = await apiFetch<
      Array<{
        id: number;
        question_en: string;
        question_ar: string;
        answer_en: string;
        answer_ar: string;
      }>
    >("/cms/faqs/");
    return (Array.isArray(data) ? data : []).map((row) => ({
      id: String(row.id),
      translations: [
        { locale: "en", question: row.question_en, answer: row.answer_en },
        { locale: "ar", question: row.question_ar || row.question_en, answer: row.answer_ar || row.answer_en },
      ],
    }));
  } catch {
    return [];
  }
}

export { getApiBaseUrl };
