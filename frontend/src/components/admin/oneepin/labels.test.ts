import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  alertKindLabel,
  supersededAttempts,
  supersededLabel,
  catalogTypeForFulfillment,
  countsAsStockText,
  defaultPlayerKey,
  durationText,
  filsJod,
  jodText,
  marginView,
  modeExplanation,
  modeLabel,
  normalizeCode,
  oneEpinErrorText,
  orderNumberFromSupplierRef,
  parseStatusList,
  previewUserTemplate,
  resultCodeMessage,
  resultCodeTitle,
  supplierAmount,
  supplierStatusLabel,
  supplierStatusTone,
  templateKeys,
  toggleStatus,
  typesMatch,
} from "@/components/admin/oneepin/labels";
import { describeFailure } from "@/components/admin/oneepin/errors";

describe("1Epin result codes", () => {
  it("explains the setup codes in plain words", () => {
    expect(resultCodeTitle("02")).toBe("1Epin rejected our server's IP");
    expect(resultCodeMessage("02")).toContain("Register the outgoing IP");
    expect(resultCodeMessage("03")).toMatch(/^Wrong 1Epin email or password\./);
    expect(resultCodeMessage("04")).toContain("Top up the 1Epin wallet");
    expect(resultCodeMessage("10")).toContain("retried automatically");
  });

  it("normalizes numeric codes and leaves others alone", () => {
    expect(normalizeCode("2")).toBe("02");
    expect(normalizeCode(7)).toBe("07");
    expect(normalizeCode(" 13 ")).toBe("13");
    expect(normalizeCode("not_configured")).toBe("not_configured");
    expect(normalizeCode("")).toBe("");
    expect(normalizeCode(null)).toBe("");
    expect(resultCodeTitle("2")).toBe("1Epin rejected our server's IP");
  });

  it("falls back for unknown codes", () => {
    expect(resultCodeTitle("99")).toBe("1Epin code 99");
    expect(resultCodeMessage("weird", "fallback")).toBe("fallback");
    expect(resultCodeTitle("")).toBe("");
  });

  it("maps our API error codes", () => {
    expect(resultCodeMessage("not_configured")).toContain("email/password are not set");
    expect(resultCodeMessage("type_mismatch")).toContain("e-pins link to code products");
  });

  it("prefers the code meaning over the raw detail", () => {
    expect(oneEpinErrorText({ detail: "Unauthorized Ip Address (1.2.3.4)", code: "02" }, "x")).toContain("rejected our server's IP");
    expect(oneEpinErrorText({ detail: "Something odd" }, "x")).toBe("Something odd");
    expect(oneEpinErrorText(null, "fallback")).toBe("fallback");
  });

  it("describes failed requests from ApiError bodies", () => {
    const err = new ApiError("Bad gateway", 502, "server", { ok: false, detail: "Unknown user", code: "03" });
    expect(describeFailure(err, "Failed")).toMatch(/^Wrong 1Epin email or password/);
    const net = new ApiError("Network", 0, "network");
    expect(describeFailure(net, "Failed")).toContain("Network error");
    expect(describeFailure(new Error("boom"), "Failed")).toBe("boom");
  });
});

describe("modes", () => {
  it("labels and explains each mode", () => {
    expect(modeLabel("live")).toBe("Live");
    expect(modeLabel("TEST")).toBe("Test");
    expect(modeLabel("mock")).toBe("Mock (practice)");
    expect(modeExplanation("mock")).toContain("simulated");
    expect(modeExplanation("mock")).toContain("counts as in stock");
    expect(modeExplanation("live")).toContain("real purchases");
  });
});

describe("supplier order statuses", () => {
  it("has a plain label and tone for each status", () => {
    expect(supplierStatusLabel("MANUAL_REVIEW")).toBe("Needs review");
    expect(supplierStatusLabel("UNKNOWN")).toBe("Checking with 1Epin");
    expect(supplierStatusLabel(null)).toBe("Not ordered from 1Epin");
    expect(supplierStatusLabel("NEW_THING", "Backend label")).toBe("Backend label");
    expect(supplierStatusTone("COMPLETED")).toBe("success");
    expect(supplierStatusTone("FAILED")).toBe("error");
    expect(supplierStatusTone("PROCESSING")).toBe("info");
  });

  it("parses and toggles the multi-status filter", () => {
    expect(parseStatusList("failed, manual_review,bogus")).toEqual(["FAILED", "MANUAL_REVIEW"]);
    expect(parseStatusList("")).toEqual([]);
    expect(toggleStatus("FAILED", "MANUAL_REVIEW")).toBe("FAILED,MANUAL_REVIEW");
    expect(toggleStatus("FAILED,MANUAL_REVIEW", "FAILED")).toBe("MANUAL_REVIEW");
  });
});

describe("money", () => {
  it("formats JOD values", () => {
    expect(jodText("1.234 JOD")).toBe("JOD 1.234");
    expect(jodText("-0.500 JOD")).toBe("JOD -0.500");
    expect(jodText(null)).toBe("—");
    expect(filsJod(1234)).toBe("JOD 1.234");
    expect(filsJod(-500)).toBe("JOD -0.500");
    expect(filsJod(null)).toBe("—");
    expect(supplierAmount("12.5000", "USD")).toBe("12.50 USD");
    expect(supplierAmount(null, "USD")).toBe("—");
  });

  it("colours the margin", () => {
    expect(marginView(-250, -5)).toEqual({ text: "JOD -0.250", pct: "-5.0%", tone: "error", negative: true });
    expect(marginView(100, 2).tone).toBe("warning");
    expect(marginView(1500, 25)).toMatchObject({ tone: "success", pct: "+25.0%" });
    expect(marginView(null, null)).toMatchObject({ text: "—", tone: "neutral" });
  });
});

describe("types", () => {
  it("matches CODE with epin and DIRECT_TOPUP with topup", () => {
    expect(typesMatch("epin", "CODE")).toBe(true);
    expect(typesMatch("epin", "DIRECT_TOPUP")).toBe(false);
    expect(typesMatch("topup", "DIRECT_TOPUP")).toBe(true);
    expect(typesMatch("topup", "CODE")).toBe(false);
    expect(typesMatch("other", "CODE")).toBe(true);
    expect(catalogTypeForFulfillment("CODE")).toBe("epin");
    expect(catalogTypeForFulfillment("DIRECT_TOPUP")).toBe("topup");
  });
});

describe("counts as stock", () => {
  it("explains the reason", () => {
    expect(countsAsStockText(true, null)).toContain("Stays on sale");
    expect(countsAsStockText(false, "catalog_stale")).toContain("48 hours");
    expect(countsAsStockText(false, "live_disabled")).toContain("doesn't buy from 1Epin on demand");
    expect(countsAsStockText(false, "nope")).toBe("Does not count as stock.");
  });
});

describe("top-up user template", () => {
  it("picks the player id field like the backend", () => {
    expect(defaultPlayerKey(["server", "playerId"])).toBe("playerId");
    expect(defaultPlayerKey(["zone", "user_id"])).toBe("user_id");
    expect(defaultPlayerKey(["nickname"])).toBe("nickname");
    expect(defaultPlayerKey([])).toBeNull();
  });

  it("renders a combined template", () => {
    const p = previewUserTemplate("{userId}({zoneId})", { userId: "123", zoneId: "45" }, ["userId", "zoneId"]);
    expect(p.value).toBe("123(45)");
    expect(p.error).toBe("");
    expect(templateKeys("{userId}({ zoneId })")).toEqual(["userId", "zoneId"]);
  });

  it("uses the default field when blank and matches keys case-insensitively", () => {
    expect(previewUserTemplate("", { playerId: "999" }, ["playerId"])).toMatchObject({ value: "999", usedTemplate: "{playerId}" });
    expect(previewUserTemplate("{PLAYERID}", { playerId: "7" }, ["playerId"]).value).toBe("7");
  });

  it("reports unknown and missing keys", () => {
    const unknown = previewUserTemplate("{uid}", { playerId: "1" }, ["playerId"]);
    expect(unknown.unknown).toEqual(["uid"]);
    expect(unknown.error).toContain("Unknown field");
    const missing = previewUserTemplate("{playerId}", {}, ["playerId"]);
    expect(missing.missing).toEqual(["playerId"]);
    expect(previewUserTemplate("", {}, []).error).toContain("no customer fields");
  });
});

describe("misc", () => {
  it("formats durations and order numbers", () => {
    expect(durationText(420)).toBe("420 ms");
    expect(durationText(2300)).toBe("2.3 s");
    expect(durationText(null)).toBe("—");
    expect(orderNumberFromSupplierRef("MMH-MMH10023-55-2")).toBe("MMH10023");
    expect(orderNumberFromSupplierRef("other")).toBeNull();
  });
});

describe("1Epin fixes from the verification pass", () => {
  it("labels the cost-limit and out-of-stock alerts", () => {
    expect(alertKindLabel("cost_limit")).toBe("Cost above limit");
    expect(alertKindLabel("out_of_stock")).toBe("Out of stock after payment");
    expect(alertKindLabel("order_failed")).toBe("Order failed");
  });

  it("shows earlier attempts as replaced, never as needing review", () => {
    expect(supersededLabel(3)).toBe("Replaced by attempt 3");
    expect(supersededLabel(null)).toBe("");
    const map = supersededAttempts([
      { attempt: 1, status: "MANUAL_REVIEW" },
      { attempt: 2, status: "FAILED" },
      { attempt: 3, status: "COMPLETED" },
    ]);
    expect([...map.entries()]).toEqual([
      [1, 3],
      [2, 3],
    ]);
    expect(supersededAttempts([{ attempt: 1, status: "FAILED" }]).size).toBe(0);
  });
});
