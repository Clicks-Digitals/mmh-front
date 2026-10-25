/**
 * Plain-language versions of raw Django REST Framework validation messages
 * ("coupon with this code already exists.") shown in the panel.
 */

/** Exact "<model>|<field>" overrides for duplicate-value messages. */
const UNIQUE_OVERRIDES: Record<string, string> = {
  "coupon|code": "A coupon with this code already exists.",
  "product|slug": "Another product already uses this web address.",
  "product|id": "Another product already uses this product ID.",
  "product variant|sku": "Another product option already uses this SKU.",
  "category|slug": "Another category already uses this web address.",
  "platform|slug": "Another platform already uses this web address.",
  "region|slug": "Another region already uses this web address.",
  "content page|slug": "Another page already uses this web address.",
  "user|email": "An account with this e-mail address already exists.",
  "supplier|code": "Another supplier already uses this code.",
  "supplier|slug": "Another supplier already uses this code.",
};

/** Staff wording for model names in the generic message. */
const MODEL_WORDS: Record<string, string> = {
  "product variant": "product option",
  "content page": "page",
  "digital code": "code",
  "code import batch": "code import",
  "supplier product mapping": "supplier mapping",
  "customer profile": "customer",
  user: "account",
  faq: "FAQ",
};

/** Staff wording for field names in the generic message. */
const FIELD_WORDS: Record<string, string> = {
  slug: "web address",
  sku: "SKU",
  id: "ID",
  email: "e-mail address",
  code: "code",
  name: "name",
  "name en": "English name",
  "name ar": "Arabic name",
};

const UNIQUE_RE = /^(.+?) with this (.+?) already exists\.?$/i;
const UNIQUE_SET_RE = /^The fields (.+) must make a unique set\.?$/i;

/** Returns a friendly message, or the input unchanged when it is not a known raw message. */
export function friendlyValidationMessage(message: string): string {
  const text = (message ?? "").trim();
  const unique = UNIQUE_RE.exec(text);
  if (unique) {
    const model = unique[1]
      .trim()
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^(a|an|the|another)\s+/, "");
    const field = unique[2].trim().toLowerCase().replaceAll("_", " ");
    const override = UNIQUE_OVERRIDES[`${model}|${field}`];
    if (override) return override;
    const modelWord = MODEL_WORDS[model] ?? model;
    const fieldWord = FIELD_WORDS[field] ?? field;
    return `Another ${modelWord} already uses this ${fieldWord}.`;
  }
  if (/^SKU already exists\.?$/i.test(text)) return "Another product option already uses this SKU.";
  const set = UNIQUE_SET_RE.exec(text);
  if (set) {
    const fields = set[1]
      .split(",")
      .map((f) => f.trim().replaceAll("_", " "))
      .map((f) => FIELD_WORDS[f.toLowerCase()] ?? f)
      .filter(Boolean);
    return `This combination of ${fields.join(" and ")} is already used.`;
  }
  if (/^This field may not be blank\.?$/i.test(text) || /^This field is required\.?$/i.test(text)) {
    return "This field is required.";
  }
  if (/^This field may not be null\.?$/i.test(text)) return "This field is required.";
  const notExist = /^Invalid pk "(.+)" - object does not exist\.?$/i.exec(text);
  if (notExist) return "The selected item no longer exists. Reload the page and choose again.";
  return text || message;
}

/** Duplicate-value messages read as full sentences and need no "field:" prefix. */
export function isStandaloneMessage(message: string): boolean {
  const text = (message ?? "").trim();
  return UNIQUE_RE.test(text) || UNIQUE_SET_RE.test(text) || /^(Another\b|An? .+ with this\b)/.test(text);
}
