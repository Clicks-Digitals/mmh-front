import { filsToJodInput, jodInputToFils } from "@/components/admin/lib/money";
import type { MappingSettings, OneEpinMapping } from "@/components/admin/oneepin/api";

/** Editable (string) form of a mapping's settings. */
export type MappingDraft = {
  prefer_supplier: boolean;
  auto_buy: boolean;
  allow_loss: boolean;
  ignored: boolean;
  max_cost: string;
  quantity_per_unit: string;
  user_template: string;
  barem: string;
};

export const DEFAULT_DRAFT: MappingDraft = {
  prefer_supplier: false,
  auto_buy: true,
  allow_loss: false,
  ignored: false,
  max_cost: "",
  quantity_per_unit: "1",
  user_template: "",
  barem: "",
};

export function draftFromMapping(m: Pick<OneEpinMapping, keyof MappingSettings> | null | undefined): MappingDraft {
  if (!m) return { ...DEFAULT_DRAFT };
  return {
    prefer_supplier: Boolean(m.prefer_supplier),
    auto_buy: m.auto_buy !== false,
    allow_loss: Boolean(m.allow_loss),
    ignored: Boolean(m.ignored),
    max_cost: filsToJodInput(m.max_cost_fils ?? null),
    quantity_per_unit: String(m.quantity_per_unit ?? 1),
    user_template: m.user_template ?? "",
    barem: m.barem ? String(Number(m.barem)) : "",
  };
}

export type DraftResult = { ok: true; body: MappingSettings } | { ok: false; errors: Partial<Record<keyof MappingDraft, string>> };

/** Validate the draft and build the API body. Only sends `user_template` for top-ups and `barem` when tiered. */
export function settingsFromDraft(d: MappingDraft, opts: { kind?: string; tiered?: boolean } = {}): DraftResult {
  const errors: Partial<Record<keyof MappingDraft, string>> = {};
  const qty = Number(d.quantity_per_unit.trim());
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000) errors.quantity_per_unit = "Enter a whole number from 1 to 1000.";
  const maxCost = jodInputToFils(d.max_cost);
  if (maxCost !== null && Number.isNaN(maxCost)) errors.max_cost = "Enter an amount like 4.500 (up to 3 decimals), or leave empty.";
  let barem: string | null = null;
  if (opts.tiered) {
    const raw = d.barem.trim().replace(",", ".");
    if (raw) {
      if (!/^\d+(\.\d{1,4})?$/.test(raw) || Number(raw) <= 0) errors.barem = "Enter a positive amount, e.g. 100.";
      else barem = raw;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const body: MappingSettings = {
    prefer_supplier: d.prefer_supplier,
    auto_buy: d.auto_buy,
    allow_loss: d.allow_loss,
    ignored: d.ignored,
    max_cost_fils: maxCost,
    quantity_per_unit: qty,
  };
  if ((opts.kind ?? "").toLowerCase() === "topup") body.user_template = d.user_template.trim();
  if (opts.tiered) body.barem = barem;
  return { ok: true, body };
}

/** Estimated cost/margin of one of our units while editing (cost per 1Epin unit × units). */
export function estimateMargin(
  unitCostFils: number | null | undefined,
  qtyPerUnit: string,
  saleFils: number | null | undefined,
): { costFils: number | null; marginFils: number | null; marginPct: number | null } {
  const qty = Number(qtyPerUnit);
  if (unitCostFils === null || unitCostFils === undefined || !Number.isInteger(qty) || qty < 1) {
    return { costFils: null, marginFils: null, marginPct: null };
  }
  const costFils = unitCostFils * qty;
  if (saleFils === null || saleFils === undefined) return { costFils, marginFils: null, marginPct: null };
  const marginFils = saleFils - costFils;
  const marginPct = saleFils ? Math.round((marginFils * 10000) / saleFils) / 100 : null;
  return { costFils, marginFils, marginPct };
}

/**
 * Live warning while typing a max cost: below today's 1Epin cost for one of our units means the
 * automatic purchase would be skipped right away. null = no warning (empty / invalid / unknown cost).
 */
export function maxCostWarning(maxCostInput: string, costFils: number | null | undefined): string | null {
  if (!maxCostInput.trim() || costFils === null || costFils === undefined) return null;
  const limit = jodInputToFils(maxCostInput);
  if (limit === null || Number.isNaN(limit)) return null;
  if (limit >= costFils) return null;
  return `This is below 1Epin's current cost (JOD ${(costFils / 1000).toFixed(3)} for one of ours): automatic purchases for this option would be skipped and orders would wait for a person.`;
}
