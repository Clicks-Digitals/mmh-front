import type { Locale } from "@/types";

/** One failing cart line from a 409 `out_of_stock` response (D2). */
export interface StockLine {
  productId: string;
  variantId: number | null;
  productName: string;
  productNameAr: string;
  variantName: string;
  variantNameAr: string;
  requested: number;
  available: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** Parse `lines` from an error body ({code: "out_of_stock", lines: [...]}). Unknown shapes → []. */
export function parseStockLines(body: unknown): StockLine[] {
  if (!body || typeof body !== "object") return [];
  const lines = (body as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((line): line is Record<string, unknown> => Boolean(line && typeof line === "object"))
    .map((line) => {
      const variantId = Number(line.variant_id);
      return {
        productId: text(line.product_id),
        variantId: Number.isFinite(variantId) && variantId > 0 ? variantId : null,
        productName: text(line.product_name),
        productNameAr: text(line.product_name_ar) || text(line.product_name),
        variantName: text(line.variant_name),
        variantNameAr: text(line.variant_name_ar) || text(line.variant_name),
        requested: Math.max(0, Math.floor(Number(line.requested) || 0)),
        available: Math.max(0, Math.floor(Number(line.available) || 0)),
      };
    });
}

/** "Steam Wallet · $10" in the current locale. */
export function stockLineName(line: StockLine, locale: Locale): string {
  const product = locale === "ar" ? line.productNameAr : line.productName;
  const variant = locale === "ar" ? line.variantNameAr : line.variantName;
  return variant ? `${product} · ${variant}` : product;
}
