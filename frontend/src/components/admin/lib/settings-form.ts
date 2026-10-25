/** Client-side checks for the Settings page (CA-25), mirroring backend rules. */

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** Arabic-Indic / Persian digits -> ASCII. */
export function toAsciiDigits(value: string): string {
  return value.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));
}

/** Backend `normalize_whatsapp`: digits only (8-15) after dropping +, 00, spaces and dashes. "" stays "". */
export function normalizeWhatsapp(value: string): string | null {
  let compact = toAsciiDigits(String(value ?? "").trim()).replace(/[\s\-().]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) compact = compact.slice(1);
  else if (compact.startsWith("00")) compact = compact.slice(2);
  return /^\d{8,15}$/.test(compact) ? compact : null;
}

function isUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateSettingsForm(form: Record<string, string | boolean>): Record<string, string> {
  const e: Record<string, string> = {};
  const text = (k: string) => String(form[k] ?? "").trim();
  if (!text("store_name")) e.store_name = "Enter the store name.";
  if (text("support_email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text("support_email")))
    e.support_email = "Enter an e-mail address like support@yourshop.com.";
  if (text("whatsapp_number") && normalizeWhatsapp(text("whatsapp_number")) === null)
    e.whatsapp_number = "Use digits only with the country code, e.g. 962791234567 (8–15 digits).";
  for (const key of ["telegram_url", "instagram_url", "facebook_url", "tiktok_url", "youtube_url"]) {
    if (text(key) && !isUrl(text(key))) e[key] = "Paste the full link, starting with https://";
  }
  const threshold = text("low_stock_threshold");
  if (threshold && !/^\d+$/.test(threshold)) e.low_stock_threshold = "Enter a whole number, 0 or more.";
  return e;
}
