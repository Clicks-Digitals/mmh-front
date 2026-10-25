import { describe, expect, it } from "vitest";
import { DEFAULT_DRAFT, draftFromMapping, estimateMargin, settingsFromDraft } from "@/components/admin/oneepin/mapping-draft";

describe("mapping draft", () => {
  it("round-trips a mapping into the form", () => {
    const d = draftFromMapping({
      prefer_supplier: true,
      auto_buy: false,
      allow_loss: false,
      ignored: false,
      max_cost_fils: 4500,
      quantity_per_unit: 2,
      user_template: "{userId}({zoneId})",
      barem: "100.0000",
    });
    expect(d).toMatchObject({ prefer_supplier: true, auto_buy: false, max_cost: "4.5", quantity_per_unit: "2", barem: "100" });
  });

  it("builds the API body, sending the template only for top-ups and barem only when tiered", () => {
    const epin = settingsFromDraft({ ...DEFAULT_DRAFT, max_cost: "4.5", user_template: "{x}" }, { kind: "epin" });
    expect(epin).toEqual({
      ok: true,
      body: { prefer_supplier: false, auto_buy: true, allow_loss: false, ignored: false, max_cost_fils: 4500, quantity_per_unit: 1 },
    });
    const topup = settingsFromDraft({ ...DEFAULT_DRAFT, user_template: " {playerId} ", barem: "50" }, { kind: "topup", tiered: true });
    expect(topup.ok && topup.body).toMatchObject({ user_template: "{playerId}", barem: "50", max_cost_fils: null });
  });

  it("reports invalid input in plain words", () => {
    const r = settingsFromDraft({ ...DEFAULT_DRAFT, quantity_per_unit: "0", max_cost: "abc", barem: "-1" }, { tiered: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.quantity_per_unit).toContain("1 to 1000");
      expect(r.errors.max_cost).toContain("4.500");
      expect(r.errors.barem).toBeTruthy();
    }
  });

  it("estimates cost and margin per unit", () => {
    expect(estimateMargin(1000, "2", 2500)).toEqual({ costFils: 2000, marginFils: 500, marginPct: 20 });
    expect(estimateMargin(3000, "1", 2500)).toEqual({ costFils: 3000, marginFils: -500, marginPct: -20 });
    expect(estimateMargin(null, "1", 2500).costFils).toBeNull();
    expect(estimateMargin(1000, "x", 2500).costFils).toBeNull();
  });
});
