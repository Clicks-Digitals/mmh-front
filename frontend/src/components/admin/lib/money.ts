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

/**
 * Panel money display, matching the backend `format_jod`: "JOD 8.90", "JOD 8.905" when
 * the third decimal is used, "JOD -1.50" for negatives. Never shows "−0" or "8.9 JOD".
 */
export function jodAmount(fils: number | null | undefined): string {
  const value = Math.round(Number(fils ?? 0)) || 0;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 1000);
  const frac = abs % 1000;
  const decimals = frac % 10 === 0 ? String(frac / 10).padStart(2, "0") : String(frac).padStart(3, "0");
  return `${sign}${whole}.${decimals}`;
}

export function formatJod(fils: number | null | undefined): string {
  return `JOD ${jodAmount(fils)}`;
}

/** A discount line: "− JOD 1.50", or "JOD 0.00" when there is no discount. */
export function formatJodDiscount(fils: number | null | undefined): string {
  const value = Math.abs(Math.round(Number(fils ?? 0)) || 0);
  return value ? `− ${formatJod(value)}` : formatJod(0);
}
