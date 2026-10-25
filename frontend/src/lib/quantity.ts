/** Hard per-line cap enforced by the backend (quantity 1–5 per line). */
export const MAX_QTY_PER_LINE = 5;

export interface QuantityLimits {
  min: number;
  max: number;
}

/** Show "Only N left" at or below this many sellable units (D2). */
export const LOW_STOCK_NOTICE = 5;

/**
 * Per-line quantity limits. `availableQuantity` (D2, reservation-aware stock of a CODE variant)
 * caps the maximum; null/undefined means "not limited by stock" (top-ups, supplier stock).
 */
export function quantityLimits(
  minQuantity?: number | null,
  maxQuantity?: number | null,
  availableQuantity?: number | null,
): QuantityLimits {
  const min = Math.min(Math.max(1, Math.floor(Number(minQuantity) || 1)), MAX_QTY_PER_LINE);
  const rawMax = Math.floor(Number(maxQuantity) || MAX_QTY_PER_LINE);
  let max = Math.max(min, Math.min(MAX_QTY_PER_LINE, rawMax));
  if (typeof availableQuantity === "number" && Number.isFinite(availableQuantity)) {
    max = Math.max(1, Math.min(max, Math.floor(availableQuantity)));
  }
  return { min: Math.min(min, max), max };
}

/** "Only N left" count, or null when stock is not low / not tracked. */
export function lowStockCount(availableQuantity?: number | null): number | null {
  if (typeof availableQuantity !== "number" || !Number.isFinite(availableQuantity)) return null;
  const count = Math.floor(availableQuantity);
  return count > 0 && count <= LOW_STOCK_NOTICE ? count : null;
}

export function clampQuantity(value: number, limits: QuantityLimits): number {
  const n = Math.floor(Number(value) || 0);
  return Math.min(limits.max, Math.max(limits.min, n));
}

export type QuantityProblem = "below_min" | "above_max" | null;

export function quantityProblem(value: number, limits: QuantityLimits): QuantityProblem {
  if (value < limits.min) return "below_min";
  if (value > limits.max) return "above_max";
  return null;
}

/** Merge an added quantity into an existing line, capping at the line max. */
export function mergeQuantity(current: number, added: number, limits: QuantityLimits): { quantity: number; capped: boolean } {
  const wanted = current + added;
  const quantity = clampQuantity(wanted, limits);
  return { quantity, capped: quantity < wanted };
}
