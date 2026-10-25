/**
 * Plain-language texts and pure helpers for the 1Epin screens (no React, unit tested in
 * labels.test.ts). Shop staff are not technical: every code / status gets a sentence that
 * says what happened and what to do next.
 */

export type Tone = "success" | "warning" | "error" | "info" | "neutral";

/* ─── 1Epin ResultCodes ─── */

type CodeInfo = { title: string; action?: string };

const RESULT_CODES: Record<string, CodeInfo> = {
  "00": { title: "Success" },
  "01": { title: "1Epin says a required value was missing", action: "This is a technical problem — tell your developer." },
  "02": {
    title: "1Epin rejected our server's IP",
    action: "Register the outgoing IP shown on the 1Epin page on 1Epin's API Settings page, then try again.",
  },
  "03": {
    title: "Wrong 1Epin email or password",
    action: "Ask your developer to check ONEEPIN_EMAIL and ONEEPIN_PASSWORD on the server.",
  },
  "04": { title: "Not enough balance on 1Epin", action: "Top up the 1Epin wallet, then use “Retry with 1Epin”." },
  "05": { title: "1Epin could not find that category", action: "Sync the catalog to refresh the product list." },
  "06": { title: "1Epin could not find that product", action: "Sync the catalog and check the mapping." },
  "07": { title: "1Epin already has an order with this number", action: "Nothing to do — we check its status automatically." },
  "08": { title: "1Epin has no order with this number" },
  "09": {
    title: "This is a top-up: 1Epin needs the player ID",
    action: "Check the mapping's player-ID format and the customer's details.",
  },
  "10": {
    title: "1Epin's nightly service window (23:45–00:00)",
    action: "Nothing to do — it is retried automatically after midnight.",
  },
  "11": { title: "1Epin does not sell this product through the API", action: "Map another 1Epin product or deliver by hand." },
  "12": { title: "This product needs an amount (barem)", action: "Set the amount in the mapping, then retry." },
  "13": { title: "The amount (barem) is out of range", action: "Fix the amount in the mapping, then retry." },
  "14": { title: "The amount (barem) must be a whole number", action: "Fix the amount in the mapping, then retry." },
  "15": { title: "This product does not take an amount (barem)", action: "Clear the amount in the mapping, then retry." },
  "16": { title: "Too many units for one 1Epin order", action: "Deliver part by hand, or ask 1Epin about the limit." },
  "17": { title: "Too few units for a 1Epin order", action: "Check “1Epin units per unit” in the mapping." },
};

/** Our own error codes from the 1Epin admin endpoints. */
const API_CODES: Record<string, string> = {
  not_configured: "1Epin email/password are not set on the server, so nothing was sent. Ask your developer to add them.",
  disabled: "1Epin is switched off in the current mode, so nothing was sent.",
  supplier_disabled: "Buying from 1Epin is switched off in the current mode.",
  supplier_error: "1Epin did not answer properly. Try again in a minute; if it keeps failing, check the logs.",
  network_error: "Could not reach 1Epin (network problem or timeout). Try again in a minute.",
  bad_response: "1Epin sent an answer we could not read. Try again later; if it keeps happening, tell your developer.",
  test_mode: "Practice mode: there is no real 1Epin balance to show.",
  confirmation_required: "Please confirm the purchase first.",
  not_paid: "The order is not paid yet, so nothing can be bought.",
  cancelled: "The order is cancelled.",
  not_mapped: "This product option is not linked to a 1Epin product. Map it first (product → Supplier tab).",
  supplier_order_active: "A 1Epin order for this item is still open. Use “Check now” instead of buying again.",
  already_completed: "1Epin already delivered this item.",
  no_supplier_order: "There is no 1Epin order for this item yet.",
  item_complete: "This item is already fully delivered.",
  guard_failed: "The purchase was blocked by the money safety check (cost above the limit or above the sale price).",
  not_found: "Not found — it may have been removed. Reload the page.",
  variant_required: "Choose a product option to link.",
  variant_not_found: "That product option no longer exists. Reload and pick another.",
  catalog_item_not_found: "That 1Epin product is not in the synced catalog. Sync the catalog first.",
  type_mismatch: "Types don't match: 1Epin e-pins link to code products, 1Epin top-ups link to direct top-up products.",
  variant_already_mapped: "This product option is already linked to 1Epin. Edit that link instead.",
  already_resolved: "Someone already resolved this alert.",
};

/** Short meaning of a 1Epin ResultCode ("02" → "1Epin rejected our server's IP"). */
export function resultCodeTitle(code: string | null | undefined): string {
  const key = normalizeCode(code);
  if (!key) return "";
  return RESULT_CODES[key]?.title ?? `1Epin code ${key}`;
}

/** Meaning + what to do, for toasts and result boxes. */
export function resultCodeMessage(code: string | null | undefined, fallback = ""): string {
  const key = normalizeCode(code);
  if (key && RESULT_CODES[key]) {
    const info = RESULT_CODES[key];
    return info.action ? `${info.title}. ${info.action}` : `${info.title}.`;
  }
  if (code && API_CODES[code]) return API_CODES[code];
  return fallback;
}

/** "2" / 2 / "02" → "02"; non-numeric codes are returned unchanged; "" for empty. */
export function normalizeCode(code: string | number | null | undefined): string {
  if (code === null || code === undefined) return "";
  const raw = String(code).trim();
  if (!raw) return "";
  return /^\d{1,2}$/.test(raw) ? raw.padStart(2, "0") : raw;
}

export function isResultCode(code: string | null | undefined): boolean {
  return Boolean(RESULT_CODES[normalizeCode(code)]);
}

/** Plain message for a failed 1Epin admin request body ({detail, code, message}). */
export function oneEpinErrorText(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const fromCode = resultCodeMessage(code);
  if (fromCode) return fromCode;
  const detail = typeof record.detail === "string" ? record.detail : "";
  const message = typeof record.message === "string" ? record.message : "";
  return detail || message || fallback;
}

/* ─── Modes ─── */

export function modeLabel(mode: string | null | undefined): string {
  switch ((mode ?? "").toLowerCase()) {
    case "live":
      return "Live";
    case "test":
      return "Test";
    case "mock":
      return "Mock (practice)";
    default:
      return mode ? String(mode) : "Unknown";
  }
}

export function modeExplanation(mode: string | null | undefined): string {
  switch ((mode ?? "").toLowerCase()) {
    case "live":
      return "Live: real purchases are paid from your 1Epin balance and real codes are sent to customers.";
    case "test":
      return "Test: we talk to 1Epin's test server with a test account. No real money is spent and codes are not real.";
    case "mock":
      return "Mock (practice): 1Epin is simulated on our own server. Nothing leaves the shop, orders complete with fake codes. On a development computer a product linked to 1Epin counts as in stock, so you can buy it end to end without importing codes. Safe for trying things out.";
    default:
      return "The mode is set by your developer on the server (SUPPLIER_MODE).";
  }
}

export function modeTone(mode: string | null | undefined): Tone {
  const m = (mode ?? "").toLowerCase();
  return m === "live" ? "success" : m === "test" ? "info" : "neutral";
}

/* ─── Supplier order statuses ─── */

const STATUS: Record<string, { label: string; tone: Tone; help: string }> = {
  NOT_SUBMITTED: { label: "Not sent yet", tone: "neutral", help: "Waiting to be sent to 1Epin." },
  SUBMITTING: { label: "Sending to 1Epin", tone: "info", help: "We are sending the order to 1Epin right now." },
  PROCESSING: { label: "Processing at 1Epin", tone: "info", help: "1Epin accepted the order and is preparing it." },
  WAITING: {
    label: "Waiting (service window)",
    tone: "warning",
    help: "1Epin's nightly break (23:45–00:00). It is retried automatically.",
  },
  COMPLETED: { label: "Completed", tone: "success", help: "1Epin delivered. The customer has been served." },
  FAILED: { label: "Failed", tone: "error", help: "1Epin could not complete the order. See the message." },
  MANUAL_REVIEW: {
    label: "Needs review",
    tone: "warning",
    help: "Stopped for a person to look at. Read the message, fix the cause, then retry or deliver by hand.",
  },
  UNKNOWN: {
    label: "Checking with 1Epin",
    tone: "warning",
    help: "We did not get a clear answer (e.g. timeout). We keep checking — never buy again until this is clear.",
  },
};

export const SUPPLIER_ORDER_STATUSES = Object.keys(STATUS);

/** An earlier attempt when a later one exists: shown as history, never as "Needs review". */
export function supersededLabel(supersededBy: number | null | undefined): string {
  return supersededBy ? `Replaced by attempt ${supersededBy}` : "";
}

/** Attempt numbers (of one order item) that a later attempt replaced (completed ones never are). */
export function supersededAttempts(attempts: ReadonlyArray<{ attempt: number; status: string }>): Map<number, number> {
  const latest = attempts.reduce((max, a) => Math.max(max, a.attempt), 0);
  const out = new Map<number, number>();
  for (const a of attempts) if (a.attempt < latest && a.status !== "COMPLETED") out.set(a.attempt, latest);
  return out;
}

export function supplierStatusLabel(status: string | null | undefined, fallback?: string | null): string {
  if (!status) return fallback || "Not ordered from 1Epin";
  return STATUS[status.toUpperCase()]?.label ?? fallback ?? status.replaceAll("_", " ").toLowerCase();
}

export function supplierStatusTone(status: string | null | undefined): Tone {
  if (!status) return "neutral";
  return STATUS[status.toUpperCase()]?.tone ?? "neutral";
}

export function supplierStatusHelp(status: string | null | undefined): string {
  if (!status) return "";
  return STATUS[status.toUpperCase()]?.help ?? "";
}

/** checkOrder OrderStatusCode → words. */
export function orderStatusCodeLabel(code: number | null | undefined): string {
  if (code === 0) return "Processing";
  if (code === 1) return "Completed";
  if (code === 2) return "Failed";
  return "";
}

/** "PROCESSING,MANUAL_REVIEW" ⇄ ["PROCESSING", "MANUAL_REVIEW"] (unknown values dropped). */
export function parseStatusList(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const part of (value ?? "").split(",")) {
    const key = part.trim().toUpperCase();
    if (key && STATUS[key]) seen.add(key);
  }
  return SUPPLIER_ORDER_STATUSES.filter((s) => seen.has(s));
}

export function toggleStatus(value: string, status: string): string {
  const list = parseStatusList(value);
  const next = list.includes(status) ? list.filter((s) => s !== status) : [...list, status];
  return parseStatusList(next.join(",")).join(",");
}

/* ─── Alerts ─── */

export function alertKindLabel(kind: string | null | undefined, fallback?: string): string {
  switch (kind) {
    case "low_balance":
      return "Low balance";
    case "config":
      return "Setup problem";
    case "order_failed":
      return "Order failed";
    case "price_change":
      return "Price changed";
    case "duplicate_code":
      return "Duplicate code";
    case "cost_limit":
      return "Cost above limit";
    case "out_of_stock":
      return "Out of stock after payment";
    default:
      return fallback || kind || "Alert";
  }
}

export function severityTone(severity: string | null | undefined): Tone {
  return severity === "error" ? "error" : severity === "info" ? "info" : "warning";
}

/* ─── Money ─── */

/** Backend JOD strings look like "1.234 JOD"; show as "JOD 1.234". */
export function jodText(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(-?\d+(?:\.\d+)?)\s*JOD$/i.exec(value.trim());
  return m ? `JOD ${m[1]}` : value;
}

/** Fils → "JOD 1.234" (always 3 decimals, like the backend). */
export function filsJod(fils: number | null | undefined): string {
  if (fils === null || fils === undefined || !Number.isFinite(fils)) return "—";
  const sign = fils < 0 ? "-" : "";
  return `JOD ${sign}${(Math.abs(fils) / 1000).toFixed(3)}`;
}

/** Supplier-currency amount ("12.5000", "USD") → "12.50 USD". */
export function supplierAmount(value: string | number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toFixed(2) : String(value);
  return currency ? `${text} ${currency}` : text;
}

export type MarginView = { text: string; pct: string; tone: Tone; negative: boolean };

/** Margin cell: red when we sell at a loss, amber when thin (<5 %), green otherwise. */
export function marginView(marginFils: number | null | undefined, marginPct: number | null | undefined): MarginView {
  if (marginFils === null || marginFils === undefined) {
    return { text: "—", pct: "", tone: "neutral", negative: false };
  }
  const negative = marginFils < 0;
  const pct = marginPct === null || marginPct === undefined ? "" : `${marginPct > 0 ? "+" : ""}${marginPct.toFixed(1)}%`;
  const thin = !negative && marginPct !== null && marginPct !== undefined && marginPct < 5;
  return { text: filsJod(marginFils), pct, tone: negative ? "error" : thin ? "warning" : "success", negative };
}

/* ─── Types: our fulfillment type ↔ 1Epin category type ─── */

export function catalogTypeLabel(type: string | null | undefined): string {
  const t = (type ?? "").toLowerCase();
  if (t === "epin") return "E-pin (code)";
  if (t === "topup") return "Top-up";
  return t ? t : "Unknown";
}

/** Our product fulfillment type that a 1Epin category type may be linked to. */
export function fulfillmentForCatalogType(type: string | null | undefined): "CODE" | "DIRECT_TOPUP" | "" {
  const t = (type ?? "").toLowerCase();
  if (t === "epin") return "CODE";
  if (t === "topup") return "DIRECT_TOPUP";
  return "";
}

export function catalogTypeForFulfillment(ftype: string | null | undefined): "epin" | "topup" | "" {
  const t = (ftype ?? "").toUpperCase();
  if (t === "CODE") return "epin";
  if (t === "DIRECT_TOPUP") return "topup";
  return "";
}

export function typesMatch(catalogType: string | null | undefined, fulfillmentType: string | null | undefined): boolean {
  const want = fulfillmentForCatalogType(catalogType);
  // Unknown 1Epin types are not blocked here; the backend decides.
  return !want || want === (fulfillmentType ?? "").toUpperCase();
}

/* ─── Counts as stock ─── */

const STOCK_REASONS: Record<string, string> = {
  ignored: "This link is switched off (ignored).",
  unmapped_variant: "It is not linked to a specific product option.",
  supplier_inactive: "The 1Epin supplier is switched off.",
  live_disabled:
    "This mode doesn't buy from 1Epin on demand, so it can't promise stock to customers (test mode without ONEEPIN_TEST_COUNTS_AS_STOCK, or mock mode outside development).",
  unsupported_supplier: "Only 1Epin can buy automatically.",
  auto_buy_off: "“Buy automatically” is off.",
  catalog_missing: "1Epin doesn't list this product any more (or the catalog was never synced).",
  catalog_stale: "The 1Epin catalog was not synced in the last 48 hours — sync it.",
};

/** Why a mapping does (not) keep the option on sale when we have no codes of our own. */
export function countsAsStockText(counts: boolean | null | undefined, reason: string | null | undefined): string {
  if (counts) return "Stays on sale even with no codes of our own — 1Epin delivers on demand.";
  return reason && STOCK_REASONS[reason] ? STOCK_REASONS[reason] : "Does not count as stock.";
}

/* ─── Top-up player id template ─── */

const PLAYER_KEY_RE = /^(player[_\- ]?id|user[_\- ]?id|uid|account[_\- ]?id|game[_\- ]?id|id)$/i;
const TEMPLATE_KEY_RE = /\{([^{}]+)\}/g;

/** Field the backend uses when the template is blank (same rule as services/mapping.py). */
export function defaultPlayerKey(keys: string[]): string | null {
  for (const key of keys) if (PLAYER_KEY_RE.test(key.trim())) return key;
  return keys[0] ?? null;
}

export function templateKeys(template: string): string[] {
  return Array.from(template.matchAll(TEMPLATE_KEY_RE), (m) => m[1].trim());
}

export type TemplatePreview = { value: string; missing: string[]; unknown: string[]; usedTemplate: string; error: string };

/**
 * Preview of what we send to 1Epin as `user`, mirroring backend `render_user`.
 * `values` are sample/real customer field values; `knownKeys` are the product's field keys.
 */
export function previewUserTemplate(
  template: string,
  values: Record<string, string>,
  knownKeys: string[] = Object.keys(values),
): TemplatePreview {
  let used = (template ?? "").trim();
  if (!used) {
    const key = defaultPlayerKey(knownKeys);
    if (!key) return { value: "", missing: [], unknown: [], usedTemplate: "", error: "The product has no customer fields to take the player ID from." };
    used = `{${key}}`;
  }
  const lowered = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  const known = new Set(knownKeys.map((k) => k.toLowerCase()));
  const missing: string[] = [];
  const unknown: string[] = [];
  const value = used
    .replace(TEMPLATE_KEY_RE, (_, raw: string) => {
      const key = raw.trim();
      if (knownKeys.length && !known.has(key.toLowerCase())) unknown.push(key);
      const v = (values[key] ?? lowered[key.toLowerCase()] ?? "").trim();
      if (!v) missing.push(key);
      return v;
    })
    .trim();
  const error = unknown.length
    ? `Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Use one of the keys listed below.`
    : missing.length
      ? `Missing value for ${missing.join(", ")}.`
      : !value
        ? "The player ID would be empty."
        : "";
  return { value, missing, unknown, usedTemplate: used, error };
}

/** Example value per field key, for the template preview ("playerId" → "123456789"). */
export function sampleFieldValue(key: string): string {
  const k = key.toLowerCase();
  if (k.includes("zone") || k.includes("server")) return "2001";
  if (k.includes("mail")) return "player@example.com";
  if (k.includes("name")) return "PlayerName";
  return "123456789";
}

/* ─── Misc ─── */

export function durationText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** "MMH-1001-55-2" → our order number "1001" (null when the pattern does not match). */
export function orderNumberFromSupplierRef(ref: string | null | undefined): string | null {
  const m = /^MMH-(.+)-(\d+)-(\d+)$/.exec((ref ?? "").trim());
  return m ? m[1] : null;
}

export function logActionLabel(action: string): string {
  const map: Record<string, string> = {
    ping: "Connection test",
    checkBalance: "Balance check",
    balance: "Balance check",
    sync: "Catalog sync",
    allProducts: "Catalog download",
    categories: "Categories",
    products: "Products",
    addOrder: "Place order",
    checkOrder: "Check order",
    callback: "1Epin callback",
  };
  return map[action] ?? action;
}
