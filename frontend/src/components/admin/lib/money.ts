import { formatFils } from "@/server/money";

/**
 * Parse a JOD amount typed by staff ("1.5", "2", "0.250") into integer fils.
 * Returns null for empty input, NaN for invalid input (negative, >3 decimals, garbage).
 */
export function jodInputToFils(value: string | null | undefined): number | null {
  const cleaned = (value ?? "").trim().replace(",", ".");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return Number.NaN;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
}

/** Integer fils -> editable JOD string ("" for null). */
export function filsToJodInput(fils: number | null | undefined): string {
  if (fils == null || !Number.isFinite(fils)) return "";
  return formatFils(Math.round(fils));
}
