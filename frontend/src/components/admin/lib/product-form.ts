import type { AdminProduct, AdminProductField, AdminVariant } from "@/lib/api/admin";
import { filsToJodInput, jodInputToFils } from "@/components/admin/lib/money";

/* ─── General tab ─── */

export type GeneralForm = {
  name_en: string;
  name_ar: string;
  slug: string;
  brand: string;
  artwork_key: string;
  image_url: string;
  status: string;
  category_id: string;
  platform_id: string;
  kind: string;
  fulfillment_type: string;
  account_currency: string;
  featured: boolean;
  bestseller: boolean;
  trending: boolean;
  refundable: boolean;
  sort_order: string;
  badges: string;
  tags: string;
  short_description_en: string;
  short_description_ar: string;
  description_en: string;
  description_ar: string;
  instructions_en: string;
  instructions_ar: string;
  how_to_use_en: string;
  how_to_use_ar: string;
  region_warning_en: string;
  region_warning_ar: string;
  region_restrictions_en: string;
  region_restrictions_ar: string;
  delivery_estimate_en: string;
  delivery_estimate_ar: string;
  refund_policy_en: string;
  refund_policy_ar: string;
};

export const GENERAL_FIELDS = new Set<string>([
  "name_en",
  "name_ar",
  "slug",
  "brand",
  "artwork_key",
  "image_url",
  "status",
  "category_id",
  "platform_id",
  "kind",
  "fulfillment_type",
  "account_currency",
  "featured",
  "bestseller",
  "trending",
  "refundable",
  "sort_order",
  "badges",
  "tags",
  "short_description_en",
  "short_description_ar",
  "description_en",
  "description_ar",
  "instructions_en",
  "instructions_ar",
  "how_to_use_en",
  "how_to_use_ar",
  "region_warning_en",
  "region_warning_ar",
  "region_restrictions_en",
  "region_restrictions_ar",
  "delivery_estimate_en",
  "delivery_estimate_ar",
  "refund_policy_en",
  "refund_policy_ar",
  "source",
]);

function listToText(value: string[] | null | undefined, sep: string): string {
  return (value ?? []).join(sep);
}

export function splitList(value: string, mode: "comma" | "lines"): string[] {
  const parts = mode === "comma" ? value.split(",") : value.split(/\r?\n/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function productToGeneralForm(p: AdminProduct): GeneralForm {
  return {
    name_en: p.name_en ?? "",
    name_ar: p.name_ar ?? "",
    slug: p.slug ?? "",
    brand: p.brand ?? "",
    artwork_key: p.artwork_key ?? "",
    image_url: p.image_url ?? "",
    status: p.status ?? "DRAFT",
    category_id: String(p.category_id ?? p.category?.id ?? ""),
    platform_id: String(p.platform_id ?? p.platform?.id ?? ""),
    kind: p.kind ?? "GIFT_CARD",
    fulfillment_type: p.fulfillment_type ?? "CODE",
    account_currency: p.account_currency ?? "",
    featured: Boolean(p.featured),
    bestseller: Boolean(p.bestseller),
    trending: Boolean(p.trending),
    refundable: Boolean(p.refundable),
    sort_order: String(p.sort_order ?? 0),
    badges: listToText(p.badges, ", "),
    tags: listToText(p.tags, ", "),
    short_description_en: p.short_description_en ?? "",
    short_description_ar: p.short_description_ar ?? "",
    description_en: p.description_en ?? "",
    description_ar: p.description_ar ?? "",
    instructions_en: p.instructions_en ?? "",
    instructions_ar: p.instructions_ar ?? "",
    how_to_use_en: listToText(p.how_to_use_en, "\n"),
    how_to_use_ar: listToText(p.how_to_use_ar, "\n"),
    region_warning_en: p.region_warning_en ?? "",
    region_warning_ar: p.region_warning_ar ?? "",
    region_restrictions_en: p.region_restrictions_en ?? "",
    region_restrictions_ar: p.region_restrictions_ar ?? "",
    delivery_estimate_en: p.delivery_estimate_en ?? "",
    delivery_estimate_ar: p.delivery_estimate_ar ?? "",
    refund_policy_en: p.refund_policy_en ?? "",
    refund_policy_ar: p.refund_policy_ar ?? "",
  };
}

export function validateGeneral(form: GeneralForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name_en.trim()) errors.name_en = "English name is required";
  if (!form.slug.trim()) errors.slug = "Slug is required";
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim()))
    errors.slug = "Use lowercase letters, numbers and dashes only";
  if (!form.brand.trim()) errors.brand = "Brand is required";
  if (!form.artwork_key.trim()) errors.artwork_key = "Artwork key is required";
  if (!form.category_id) errors.category_id = "Choose a category";
  if (!form.platform_id) errors.platform_id = "Choose a platform";
  if (form.sort_order.trim() && !/^-?\d+$/.test(form.sort_order.trim())) errors.sort_order = "Whole number";
  if (splitList(form.badges, "comma").some((b) => b.length > 32)) errors.badges = "Each badge max 32 characters";
  if (splitList(form.tags, "comma").some((t) => t.length > 64)) errors.tags = "Each tag max 64 characters";
  return errors;
}

export function generalFormToPayload(form: GeneralForm) {
  return {
    name_en: form.name_en.trim(),
    name_ar: form.name_ar.trim(),
    slug: form.slug.trim(),
    brand: form.brand.trim(),
    artwork_key: form.artwork_key.trim(),
    image_url: form.image_url.trim(),
    status: form.status,
    category_id: Number(form.category_id),
    platform_id: Number(form.platform_id),
    kind: form.kind,
    fulfillment_type: form.fulfillment_type,
    account_currency: form.account_currency.trim().toUpperCase(),
    featured: form.featured,
    bestseller: form.bestseller,
    trending: form.trending,
    refundable: form.refundable,
    sort_order: Number(form.sort_order.trim() || 0),
    badges: splitList(form.badges, "comma"),
    tags: splitList(form.tags, "comma"),
    short_description_en: form.short_description_en,
    short_description_ar: form.short_description_ar,
    description_en: form.description_en,
    description_ar: form.description_ar,
    instructions_en: form.instructions_en,
    instructions_ar: form.instructions_ar,
    how_to_use_en: splitList(form.how_to_use_en, "lines"),
    how_to_use_ar: splitList(form.how_to_use_ar, "lines"),
    region_warning_en: form.region_warning_en,
    region_warning_ar: form.region_warning_ar,
    region_restrictions_en: form.region_restrictions_en,
    region_restrictions_ar: form.region_restrictions_ar,
    delivery_estimate_en: form.delivery_estimate_en.trim(),
    delivery_estimate_ar: form.delivery_estimate_ar.trim(),
    refund_policy_en: form.refund_policy_en,
    refund_policy_ar: form.refund_policy_ar,
  };
}

/* ─── Variants ─── */

export type VariantDraft = {
  key: string;
  id?: number | string;
  sku: string;
  name_en: string;
  name_ar: string;
  denomination: string;
  package_value: string;
  package_currency: string;
  price: string;
  compare_at: string;
  cost: string;
  stock_status: string;
  min_quantity: string;
  max_quantity: string;
  published: boolean;
  region: string;
  sort_order: number;
  external_id: string;
  /** read-only info from API */
  available_codes?: number;
  effective_stock_status?: string;
  codes_reserved?: number;
  codes_delivered?: number;
  delete?: boolean;
};

let draftSeq = 0;
function nextKey() {
  draftSeq += 1;
  return `new-${draftSeq}`;
}

export function variantToDraft(v: AdminVariant): VariantDraft {
  return {
    key: `v-${v.id}`,
    id: v.id,
    sku: v.sku ?? "",
    name_en: v.name_en ?? "",
    name_ar: v.name_ar ?? "",
    denomination: v.denomination != null ? String(v.denomination) : "",
    package_value: v.package_value ?? "",
    package_currency: v.package_currency ?? "",
    price: filsToJodInput(v.price_fils),
    compare_at: filsToJodInput(v.compare_at_price_fils),
    cost: filsToJodInput(v.cost_fils ?? 0),
    stock_status: v.stock_status ?? "IN_STOCK",
    min_quantity: String(v.min_quantity ?? 1),
    max_quantity: String(v.max_quantity ?? 5),
    published: v.published ?? true,
    region: v.region != null ? String(v.region) : "",
    sort_order: v.sort_order ?? 0,
    external_id: v.external_id ?? "",
    available_codes: v.available_codes ?? v.codes_available,
    effective_stock_status: v.effective_stock_status,
    codes_reserved: v.codes_reserved,
    codes_delivered: v.codes_delivered,
  };
}

/** New variant: empty money/denomination so staff must fill them (no fake "1 USD"). */
export function newVariantDraft(opts: { productId: string; index: number; currency?: string }): VariantDraft {
  return {
    key: nextKey(),
    sku: `${opts.productId}-v${opts.index + 1}`.toUpperCase(),
    name_en: "",
    name_ar: "",
    denomination: "",
    package_value: "",
    package_currency: (opts.currency ?? "").toUpperCase(),
    price: "",
    compare_at: "",
    cost: "",
    stock_status: "IN_STOCK",
    min_quantity: "1",
    max_quantity: "5",
    published: false,
    region: "",
    sort_order: opts.index,
    external_id: "",
  };
}

export function validateVariant(v: VariantDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (v.delete) return e;
  if (!v.sku.trim()) e.sku = "SKU required";
  if (!v.name_en.trim()) e.name_en = "Name required";
  if (!v.denomination.trim()) e.denomination = "Required";
  else if (!/^\d+(\.\d{1,2})?$/.test(v.denomination.trim())) e.denomination = "Number, max 2 decimals";
  if (!v.package_value.trim()) e.package_value = "Required";
  if (!v.package_currency.trim()) e.package_currency = "Required";
  const price = jodInputToFils(v.price);
  if (price == null) e.price = "Price required";
  else if (Number.isNaN(price)) e.price = "Invalid JOD amount";
  const compare = jodInputToFils(v.compare_at);
  if (compare != null && Number.isNaN(compare)) e.compare_at = "Invalid JOD amount";
  else if (compare != null && price != null && !Number.isNaN(price) && compare <= price)
    e.compare_at = "Must be higher than the price";
  const cost = jodInputToFils(v.cost);
  if (cost != null && Number.isNaN(cost)) e.cost = "Invalid JOD amount";
  const min = Number(v.min_quantity);
  const max = Number(v.max_quantity);
  if (!Number.isInteger(min) || min < 1) e.min_quantity = "At least 1";
  if (!Number.isInteger(max) || max < 1) e.max_quantity = "At least 1";
  else if (Number.isInteger(min) && max < min) e.max_quantity = "Must be ≥ min";
  return e;
}

export function variantDraftToPayload(v: VariantDraft, index: number) {
  if (v.delete && v.id) return { id: Number(v.id), delete: true };
  return {
    ...(v.id ? { id: Number(v.id) } : {}),
    sku: v.sku.trim(),
    name_en: v.name_en.trim(),
    name_ar: v.name_ar.trim(),
    denomination: v.denomination.trim(),
    package_value: v.package_value.trim(),
    package_currency: v.package_currency.trim().toUpperCase(),
    price_fils: jodInputToFils(v.price) ?? 0,
    compare_at_price_fils: jodInputToFils(v.compare_at),
    cost_fils: jodInputToFils(v.cost) ?? 0,
    stock_status: v.stock_status,
    min_quantity: Number(v.min_quantity),
    max_quantity: Number(v.max_quantity),
    published: v.published,
    region: v.region ? Number(v.region) : null,
    sort_order: index,
    external_id: v.external_id.trim(),
  };
}

/* ─── Customer fields ─── */

export type FieldDraft = AdminProductField & { key_local: string; delete?: boolean };

export function fieldToDraft(f: AdminProductField): FieldDraft {
  return { ...f, key_local: `f-${f.id ?? f.key}` };
}

export function newFieldDraft(index: number): FieldDraft {
  return {
    key_local: nextKey(),
    key: "",
    type: "TEXT",
    required: true,
    sort_order: index,
    label_en: "",
    label_ar: "",
    placeholder_en: "",
    placeholder_ar: "",
    help_text_en: "",
    help_text_ar: "",
  };
}

export function validateField(f: FieldDraft, all: FieldDraft[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.delete) return e;
  const key = (f.key ?? "").trim();
  if (!key) e.key = "Key required";
  else if (!/^[a-z][a-z0-9_]*$/.test(key)) e.key = "lowercase_with_underscores";
  else if (all.filter((o) => !o.delete && (o.key ?? "").trim() === key).length > 1) e.key = "Duplicate key";
  if (!(f.label_en ?? "").trim()) e.label_en = "Label required";
  return e;
}

export function fieldDraftToPayload(f: FieldDraft, index: number) {
  if (f.delete && f.id) return { id: Number(f.id), delete: true, key: f.key, label_en: f.label_en || f.key };
  return {
    ...(f.id ? { id: Number(f.id) } : {}),
    key: (f.key ?? "").trim(),
    type: f.type || "TEXT",
    required: Boolean(f.required),
    sort_order: index,
    label_en: (f.label_en ?? "").trim(),
    label_ar: (f.label_ar ?? "").trim(),
    placeholder_en: f.placeholder_en ?? "",
    placeholder_ar: f.placeholder_ar ?? "",
    help_text_en: f.help_text_en ?? "",
    help_text_ar: f.help_text_ar ?? "",
  };
}

/** Which tab a backend validation key belongs to. */
export function tabForErrorKey(key: string): "general" | "variants" | "fields" {
  if (key === "variants" || key.startsWith("variants")) return "variants";
  if (key === "fields" || key.startsWith("fields")) return "fields";
  return "general";
}
