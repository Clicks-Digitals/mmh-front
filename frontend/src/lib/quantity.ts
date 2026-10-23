/** Hard per-line cap enforced by the backend (quantity 1–5 per line). */
export const MAX_QTY_PER_LINE = 5;

export interface QuantityLimits {
  min: number;
  max: number;
}

export function quantityLimits(minQuantity?: number | null, maxQuantity?: number | null): QuantityLimits {
  const min = Math.max(1, Math.floor(Number(minQuantity) || 1));
  const rawMax = Math.floor(Number(maxQuantity) || MAX_QTY_PER_LINE);
  const max = Math.max(min, Math.min(MAX_QTY_PER_LINE, rawMax));
  return { min: Math.min(min, MAX_QTY_PER_LINE), max };
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
