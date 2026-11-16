import type { AdminFieldOption, AdminProduct, AdminProductField, AdminVariant } from "@/lib/api/admin";
import { filsToJodInput, jodInputToFils } from "@/components/admin/lib/money";
import { friendlyValidationMessage } from "@/components/admin/lib/validation-messages";
import { FIELD_KEY_PATTERN, fieldKeyFromLabel, isValidSlug } from "@/components/admin/lib/slugify";

/* ─── Badges (D26) ─── */

/** The badges the store can show on product cards (components/product/product-card.tsx). */
export const SUPPORTED_BADGES: Array<{ value: string; label: string; hint: string }> = [
  { value: "new", label: "New", hint: "Recently added" },
  { value: "bestseller", label: "Bestseller", hint: "Popular choice" },
  { value: "limited", label: "Limited", hint: "Limited stock or time" },
  { value: "sale", label: "Sale", hint: "Discounted" },
  { value: "region_locked", label: "Region locked", hint: "Works in one region only" },
  { value: "topup", label: "Top-up", hint: "Credited straight to the account" },
];

const SUPPORTED_BADGE_VALUES = new Set(SUPPORTED_BADGES.map((b) => b.value));

export function isSupportedBadge(value: string): boolean {
  return SUPPORTED_BADGE_VALUES.has(value);
}

/** Toggle one badge, keeping the list order stable (supported badges in their display order). */
export function toggleBadge(list: string[], value: string, on: boolean): string[] {
  const set = new Set(list);
  if (on) set.add(value);
  else set.delete(value);
  const supported = SUPPORTED_BADGES.map((b) => b.value).filter((v) => set.has(v));
  const others = list.filter((v) => !SUPPORTED_BADGE_VALUES.has(v) && set.has(v));
  return [...supported, ...others];
}

/** D26: the store replaces "instant" delivery claims with its default text. */
export function claimsInstantDelivery(text: string | null | undefined): boolean {
  return /\binstant(ly)?\b|فور[يا]?|حالا|في الحال/i.test(String(text ?? ""));
}

/* ─── Kind vs fulfillment (CA-19) ─── */

export const PRODUCT_KINDS: Array<{ value: string; label: string; hint: string }> = [
  { value: "GIFT_CARD", label: "Gift card", hint: "A card with a code, e.g. PlayStation $10" },
  { value: "WALLET", label: "Wallet credit", hint: "Store/wallet balance codes" },
  { value: "GAME_CURRENCY", label: "Game currency", hint: "UC, diamonds, V-Bucks…" },
  { value: "SUBSCRIPTION", label: "Subscription", hint: "PlayStation Plus, Game Pass…" },
  { value: "DIRECT_TOPUP", label: "Direct top-up", hint: "Credited to the player's account" },
  { value: "DIGITAL_CODE", label: "Other digital code", hint: "Any other code product" },
];

/** Kinds that may use DIRECT_TOPUP fulfillment (mirrors backend TOPUP_KINDS). */
export const TOPUP_KINDS = new Set(["DIRECT_TOPUP", "GAME_CURRENCY"]);

export function kindsForFulfillment(fulfillment: string): string[] {
  return fulfillment === "DIRECT_TOPUP"
    ? PRODUCT_KINDS.filter((k) => TOPUP_KINDS.has(k.value)).map((k) => k.value)
    : PRODUCT_KINDS.filter((k) => k.value !== "DIRECT_TOPUP").map((k) => k.value);
}

/** Plain-language problem with a kind/fulfillment pair, or null when they fit. */
export function kindFulfillmentIssue(kind: string, fulfillment: string): string | null {
  if (fulfillment === "DIRECT_TOPUP" && !TOPUP_KINDS.has(kind)) {
    return "Direct top-ups can only be of kind “Direct top-up” or “Game currency”.";
  }
  if (kind === "DIRECT_TOPUP" && fulfillment !== "DIRECT_TOPUP") {
    return "A “Direct top-up” product must be delivered as a direct top-up.";
  }
  return null;
}

/**
 * Keep kind and fulfillment consistent when one of them changes: switching to a top-up
 * picks a top-up kind; picking the Direct top-up kind switches delivery to top-up;
 * picking a code-only kind switches delivery back to codes.
 */
export function reconcileKindFulfillment(
  prev: { kind: string; fulfillment_type: string },
  patch: { kind?: string; fulfillment_type?: string },
): { kind: string; fulfillment_type: string } {
  let kind = patch.kind ?? prev.kind;
  let fulfillment = patch.fulfillment_type ?? prev.fulfillment_type;
  if (patch.fulfillment_type !== undefined) {
    if (fulfillment === "DIRECT_TOPUP" && !TOPUP_KINDS.has(kind)) kind = "DIRECT_TOPUP";
    if (fulfillment === "CODE" && kind === "DIRECT_TOPUP") kind = "GAME_CURRENCY";
  } else if (patch.kind !== undefined) {
    if (kind === "DIRECT_TOPUP") fulfillment = "DIRECT_TOPUP";
    else if (!TOPUP_KINDS.has(kind) && fulfillment === "DIRECT_TOPUP") fulfillment = "CODE";
  }
  return { kind, fulfillment_type: fulfillment };
}

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
  show_in_navbar: boolean;
  refundable: boolean;
  sort_order: string;
  badges: string[];
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
  "category",
  "platform",
  "kind",
  "fulfillment_type",
  "account_currency",
  "featured",
  "bestseller",
  "trending",
  "show_in_navbar",
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
    show_in_navbar: Boolean(p.show_in_navbar),
    refundable: Boolean(p.refundable),
    sort_order: String(p.sort_order ?? 0),
    badges: [...(p.badges ?? [])],
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
  if (!form.name_en.trim()) errors.name_en = "Enter the product name in English — it is shown on the store.";
  if (!form.slug.trim()) errors.slug = "Enter a web address, e.g. playstation-plus.";
  else if (!isValidSlug(form.slug)) errors.slug = "Use only lowercase letters, numbers and dashes (no spaces), e.g. steam-card-10.";
  if (!form.category_id) errors.category_id = "Choose the category the product appears in.";
  if (!form.platform_id) errors.platform_id = "Choose the platform (PlayStation, Steam, PUBG…).";
  if (form.sort_order.trim() && !/^-?\d+$/.test(form.sort_order.trim())) errors.sort_order = "Enter a whole number, e.g. 0 or 10.";
  const issue = kindFulfillmentIssue(form.kind, form.fulfillment_type);
  if (issue) errors.kind = issue;
  if (form.badges.some((b) => b.length > 32)) errors.badges = "Each badge can have at most 32 characters.";
  if (splitList(form.tags, "comma").some((t) => t.length > 64)) errors.tags = "Each keyword can have at most 64 characters.";
  if (form.account_currency.trim() && !/^[A-Za-z]{2,8}$/.test(form.account_currency.trim()))
    errors.account_currency = "Use a short currency code, e.g. USD or SAR.";
  return errors;
}

/**
 * Payload for PATCH/POST. `image_url` is only sent when it was edited by hand: media
 * actions on the server keep it in sync, and re-sending a stale copy would overwrite
 * the primary image (D25).
 */
export function generalFormToPayload(form: GeneralForm, original?: GeneralForm) {
  const payload: Record<string, unknown> = {
    name_en: form.name_en.trim(),
    name_ar: form.name_ar.trim(),
    slug: form.slug.trim(),
    brand: form.brand.trim(),
    artwork_key: form.artwork_key.trim(),
    status: form.status,
    category_id: Number(form.category_id),
    platform_id: Number(form.platform_id),
    kind: form.kind,
    fulfillment_type: form.fulfillment_type,
    account_currency: form.account_currency.trim().toUpperCase(),
    featured: form.featured,
    bestseller: form.bestseller,
    trending: form.trending,
    show_in_navbar: form.show_in_navbar,
    refundable: form.refundable,
    sort_order: Number(form.sort_order.trim() || 0),
    badges: form.badges.map((b) => b.trim()).filter(Boolean),
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
  if (!original || form.image_url.trim() !== original.image_url.trim()) payload.image_url = form.image_url.trim();
  return payload as Record<string, unknown> & { name_en: string; slug: string; category_id: number; platform_id: number };
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

/**
 * New variant (CA-20/CA-21): published by default; SKU, face value and package fields are
 * left empty because the server fills them from the name/region when blank.
 */
export function newVariantDraft(opts: { productId?: string; index: number; currency?: string }): VariantDraft {
  return {
    key: nextKey(),
    sku: "",
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
    published: true,
    region: "",
    sort_order: opts.index,
    external_id: "",
  };
}

/** First number in a name, like the server does ("$25" -> "25", "1,000 V-Bucks" -> "1000"). */
export function numberFromName(name: string): string {
  const match = /\d[\d,]*(?:\.\d+)?/.exec(name ?? "");
  return match ? match[0].replace(/,/g, "") : "";
}

export function validateVariant(v: VariantDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (v.delete) return e;
  if (!v.name_en.trim()) e.name_en = "Enter what the customer buys, e.g. “$10 card” or “600 UC”.";
  if (v.sku.trim() && !/^[A-Za-z0-9._-]+$/.test(v.sku.trim())) e.sku = "Use letters, numbers, dots, dashes or _ only.";
  if (v.denomination.trim() && !/^\d+(\.\d{1,2})?$/.test(v.denomination.trim()))
    e.denomination = "Enter a number such as 10 or 9.99 — or leave it empty.";
  if (v.package_currency.trim().length > 8) e.package_currency = "At most 8 characters, e.g. USD or UC.";
  const price = jodInputToFils(v.price);
  if (price == null) e.price = "Enter the selling price in JOD, e.g. 7.500.";
  else if (Number.isNaN(price)) e.price = "Enter a price like 7.5 or 7.500 (up to 3 decimals).";
  const compare = jodInputToFils(v.compare_at);
  if (compare != null && Number.isNaN(compare)) e.compare_at = "Enter an amount like 9.000 — or leave it empty.";
  else if (compare != null && price != null && !Number.isNaN(price) && compare <= price)
    e.compare_at = "The “was” price must be higher than the selling price.";
  const cost = jodInputToFils(v.cost);
  if (cost != null && Number.isNaN(cost)) e.cost = "Enter an amount like 6.250 — or leave it empty.";
  const min = Number(v.min_quantity);
  const max = Number(v.max_quantity);
  if (!Number.isInteger(min) || min < 1) e.min_quantity = "At least 1.";
  if (!Number.isInteger(max) || max < 1) e.max_quantity = "At least 1.";
  else if (Number.isInteger(min) && max < min) e.max_quantity = "Must be the same as or more than the minimum.";
  return e;
}

export function variantDraftToPayload(v: VariantDraft, index: number) {
  if (v.delete && v.id) return { id: Number(v.id), delete: true };
  const denomination = v.denomination.trim();
  return {
    ...(v.id ? { id: Number(v.id) } : {}),
    sku: v.sku.trim(),
    name_en: v.name_en.trim(),
    name_ar: v.name_ar.trim(),
    denomination: denomination ? denomination : null,
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

/** Plain stock choices per fulfillment type (CA-21). */
export function stockOptions(isCode: boolean, current: string): Array<{ value: string; label: string }> {
  const options = isCode
    ? [
        { value: "IN_STOCK", label: "Automatic — sell while codes are available" },
        { value: "OUT_OF_STOCK", label: "Stop selling (show as out of stock)" },
      ]
    : [
        { value: "IN_STOCK", label: "Available — customers can order" },
        { value: "OUT_OF_STOCK", label: "Not available — stop orders" },
      ];
  if (current === "UNKNOWN")
    options.push({ value: "UNKNOWN", label: isCode ? "Unknown (works like Automatic)" : "Unknown (can't be ordered)" });
  return options;
}

/* ─── Customer fields (D17) ─── */

/** What the customer types, as one plain choice that maps to `type` + `input_format`. */
export const FIELD_KINDS: Array<{ value: string; label: string; type: string; input_format: string; hint: string }> = [
  { value: "numeric", label: "Numbers only", type: "TEXT", input_format: "numeric", hint: "Player IDs, Zone IDs, UIDs" },
  { value: "alphanumeric", label: "Letters and numbers", type: "TEXT", input_format: "alphanumeric", hint: "Account names, codes" },
  { value: "text", label: "Any text", type: "TEXT", input_format: "text", hint: "Free text" },
  { value: "email", label: "Email address", type: "EMAIL", input_format: "email", hint: "An account e-mail" },
  { value: "phone", label: "Phone number", type: "TEL", input_format: "phone", hint: "A mobile number" },
  { value: "select", label: "Choose from a list", type: "SELECT", input_format: "text", hint: "Server, region…" },
];

export type FieldDraft = Omit<AdminProductField, "min_length" | "max_length" | "options"> & {
  key_local: string;
  delete?: boolean;
  /** true once staff typed a key by hand (stop following the label) */
  key_touched?: boolean;
  min_length: string;
  max_length: string;
  options: AdminFieldOption[];
};

export function fieldKindOf(f: Pick<FieldDraft, "type" | "input_format">): string {
  if (f.type === "SELECT") return "select";
  if (f.type === "EMAIL") return "email";
  if (f.type === "TEL") return "phone";
  const fmt = f.input_format || "text";
  return ["numeric", "alphanumeric", "email", "phone"].includes(fmt) ? fmt : "text";
}

export function applyFieldKind(kind: string): Pick<FieldDraft, "type" | "input_format"> {
  const match = FIELD_KINDS.find((k) => k.value === kind) ?? FIELD_KINDS[2];
  return { type: match.type, input_format: match.input_format };
}

export function fieldToDraft(f: AdminProductField): FieldDraft {
  return {
    ...f,
    key_local: `f-${f.id ?? f.key}`,
    key_touched: true,
    input_format: f.input_format || "text",
    min_length: f.min_length != null ? String(f.min_length) : "",
    max_length: f.max_length != null ? String(f.max_length) : "",
    options: (f.options ?? []).map((o) => ({ value: o.value ?? "", label_en: o.label_en ?? "", label_ar: o.label_ar ?? "" })),
  };
}

export function newFieldDraft(index: number): FieldDraft {
  return {
    key_local: nextKey(),
    key: "",
    key_touched: false,
    type: "TEXT",
    input_format: "numeric",
    required: true,
    sort_order: index,
    label_en: "",
    label_ar: "",
    placeholder_en: "",
    placeholder_ar: "",
    help_text_en: "",
    help_text_ar: "",
    min_length: "",
    max_length: "",
    options: [],
  };
}

/** Key the server will use: the typed key, else one made from the English label. */
export function effectiveFieldKey(f: Pick<FieldDraft, "key" | "label_en">): string {
  return (f.key ?? "").trim() || fieldKeyFromLabel(f.label_en);
}

/** Label edits keep the key in sync until staff edit the key themselves (new fields only). */
export function patchFieldLabel(f: FieldDraft, label_en: string): Partial<FieldDraft> {
  if (f.id || f.key_touched) return { label_en };
  return { label_en, key: fieldKeyFromLabel(label_en) };
}

function parseLength(value: string): number | null | typeof Number.NaN {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return Number.NaN;
  return Number(v);
}

export function validateField(f: FieldDraft, all: FieldDraft[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.delete) return e;
  if (!(f.label_en ?? "").trim()) e.label_en = "Enter the name customers see, e.g. “Player ID”.";
  const key = (f.key ?? "").trim();
  if (key && !FIELD_KEY_PATTERN.test(key)) e.key = "Start with a letter; use only letters, numbers and _ (no spaces).";
  const effective = effectiveFieldKey(f);
  if (effective && all.filter((o) => !o.delete && effectiveFieldKey(o) === effective).length > 1)
    e.key = "Two fields would have the same name. Change the label (or the key under “Advanced”).";
  const min = parseLength(f.min_length);
  const max = parseLength(f.max_length);
  if (Number.isNaN(min)) e.min_length = "Whole number, or leave empty.";
  if (Number.isNaN(max)) e.max_length = "Whole number, or leave empty.";
  else if (max === 0) e.max_length = "At least 1, or leave empty.";
  if (!e.min_length && !e.max_length && min != null && max != null && min > max)
    e.max_length = "Must be the same as or more than the minimum length.";
  if (f.type === "SELECT") {
    const opts = f.options ?? [];
    if (!opts.length) e.options = "Add at least one choice for the list.";
    else if (opts.some((o) => !o.label_en.trim())) e.options = "Every choice needs an English label.";
    else {
      const values = opts.map((o) => (o.value || fieldKeyFromLabel(o.label_en)).trim());
      if (new Set(values).size !== values.length) e.options = "Two choices are the same — make each label different.";
    }
  }
  return e;
}

export function fieldDraftToPayload(f: FieldDraft, index: number) {
  if (f.delete && f.id) return { id: Number(f.id), delete: true, key: f.key, label_en: f.label_en || f.key };
  const min = parseLength(f.min_length);
  const max = parseLength(f.max_length);
  return {
    ...(f.id ? { id: Number(f.id) } : {}),
    key: (f.key ?? "").trim(),
    type: f.type || "TEXT",
    input_format: f.input_format || "text",
    required: Boolean(f.required),
    sort_order: index,
    label_en: (f.label_en ?? "").trim(),
    label_ar: (f.label_ar ?? "").trim(),
    placeholder_en: f.placeholder_en ?? "",
    placeholder_ar: f.placeholder_ar ?? "",
    help_text_en: f.help_text_en ?? "",
    help_text_ar: f.help_text_ar ?? "",
    min_length: Number.isNaN(min) ? null : min,
    max_length: Number.isNaN(max) ? null : max,
    options:
      f.type === "SELECT"
        ? (f.options ?? []).map((o) => ({
            value: (o.value ?? "").trim(),
            label_en: o.label_en.trim(),
            label_ar: (o.label_ar ?? "").trim(),
          }))
        : [],
  };
}

/** Which tab a backend validation key belongs to. */
export function tabForErrorKey(key: string): "general" | "variants" | "fields" {
  if (key === "variants" || key.startsWith("variants")) return "variants";
  if (key === "fields" || key.startsWith("fields")) return "fields";
  return "general";
}

/* ─── Dirty tracking / discard (CA-03, CA-04) ─── */

export type EditorDraft = { general: GeneralForm; variants: VariantDraft[]; fields: FieldDraft[] };

/** Stable comparison value of the editable parts of a draft (ignores read-only stock info). */
export function draftSignature(d: EditorDraft): string {
  return JSON.stringify({
    general: d.general,
    variants: d.variants.map((v) => ({ ...v, available_codes: undefined, effective_stock_status: undefined, codes_reserved: undefined, codes_delivered: undefined })),
    fields: d.fields.map((f) => ({ ...f, key_touched: undefined })),
  });
}

export function isDraftDirty(initial: EditorDraft, current: EditorDraft): boolean {
  return draftSignature(initial) !== draftSignature(current);
}

export function productToDraft(product: AdminProduct): EditorDraft {
  return {
    general: productToGeneralForm(product),
    variants: [...(product.variants ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(variantToDraft),
    fields: [...(product.fields ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map(fieldToDraft),
  };
}

/* ─── Publish warnings (CA-20) ─── */

export const PRODUCT_WARNING_MESSAGES: Record<string, string> = {
  no_published_variants: "This product is published but has no published variants, so customers can't buy it.",
  no_variants: "This product has no variants yet — add at least one with a price.",
  no_stock: "None of the published variants has codes in stock, so the product shows as out of stock.",
  category_hidden: "Its category is not published, so the product is hidden from the store.",
  platform_hidden: "Its platform is not published, so the product is hidden from the store.",
};

export function warningMessage(code: string): string {
  return PRODUCT_WARNING_MESSAGES[code] ?? code.replaceAll("_", " ");
}

/** Problems to point out before publishing (or saving a published product). */
export function publishWarnings(
  draft: EditorDraft,
  lookups?: { categoryStatus?: string | null; platformStatus?: string | null },
): string[] {
  if (draft.general.status !== "PUBLISHED") return [];
  const out: string[] = [];
  const visible = draft.variants.filter((v) => !v.delete);
  const published = visible.filter((v) => v.published);
  if (!visible.length) out.push("no_variants");
  else if (!published.length) out.push("no_published_variants");
  else if (
    draft.general.fulfillment_type === "CODE" &&
    published.every((v) => v.id && (v.effective_stock_status ?? "") === "OUT_OF_STOCK")
  )
    out.push("no_stock");
  if (lookups?.categoryStatus && lookups.categoryStatus !== "PUBLISHED") out.push("category_hidden");
  if (lookups?.platformStatus && lookups.platformStatus !== "PUBLISHED") out.push("platform_hidden");
  return out;
}

/* ─── Server validation errors (CA-26) ─── */

function firstMessage(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return friendlyValidationMessage(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const msg = firstMessage(item);
      if (msg) return msg;
    }
    return undefined;
  }
  if (typeof value === "object") {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      const msg = firstMessage(inner);
      if (msg) return msg;
    }
  }
  return undefined;
}

/** The `{field: messages}` map of a DRF error body (`{detail: {...}, code}` or bare). */
export function validationSource(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  if (record.detail && typeof record.detail === "object" && !Array.isArray(record.detail)) {
    return record.detail as Record<string, unknown>;
  }
  if (typeof record.detail === "string") return {};
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== "code"));
}

/**
 * Errors of a nested list field (`variants`, `fields`): per-row field messages by index,
 * plus a general message when the server returned a plain string for the whole list.
 */
export function nestedListErrors(body: unknown, key: string): { rows: Record<number, Record<string, string>>; message?: string } {
  const value = validationSource(body)[key];
  const rows: Record<number, Record<string, string>> = {};
  if (value == null) return { rows };
  if (typeof value === "string") return { rows, message: friendlyValidationMessage(value) };
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) return { rows, message: firstMessage(value) };
    value.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const out: Record<string, string> = {};
      for (const [field, msgs] of Object.entries(item as Record<string, unknown>)) {
        const msg = firstMessage(msgs);
        if (msg) out[field === "price_fils" ? "price" : field === "compare_at_price_fils" ? "compare_at" : field === "cost_fils" ? "cost" : field] = msg;
      }
      if (Object.keys(out).length) rows[index] = out;
    });
    return { rows };
  }
  if (typeof value === "object") return { rows, message: firstMessage(value) };
  return { rows };
}

/** Field errors for the General tab, keyed like the form (category -> category_id). */
export function generalServerErrors(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(validationSource(body))) {
    if (key === "variants" || key === "fields" || key === "code") continue;
    const msg = firstMessage(value);
    if (!msg) continue;
    const mapped = key === "category" ? "category_id" : key === "platform" ? "platform_id" : key;
    out[mapped] = msg;
  }
  return out;
}

/** Plain-language names for General tab fields (error summary). */
export const GENERAL_FIELD_LABELS: Record<string, string> = {
  id: "Product ID",
  name_en: "Name (English)",
  name_ar: "Name (Arabic)",
  slug: "Web address (slug)",
  brand: "Brand",
  status: "Status",
  sort_order: "Sort order",
  category_id: "Category",
  platform_id: "Platform",
  kind: "Kind",
  fulfillment_type: "How is it delivered?",
  account_currency: "Card / wallet currency",
  badges: "Badges",
  tags: "Search keywords",
  artwork_key: "Built-in artwork",
  image_url: "External picture link",
  delivery_estimate_en: "Delivery time (English)",
  delivery_estimate_ar: "Delivery time (Arabic)",
  non_field_errors: "",
};
