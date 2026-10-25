import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { auditActionLabel, summarizeAuditMeta } from "@/components/admin/lib/audit";
import { parseRevealedCode } from "@/components/admin/lib/codes";
import { isoToLocalInput, localInputToIso } from "@/components/admin/lib/datetime";
import { adminErrorMessage, adminFieldErrors, errorCode } from "@/components/admin/lib/errors";
import { filsToJodInput, jodInputToFils } from "@/components/admin/lib/money";
import {
  fulfillmentStatusLabel,
  transitionLabel,
  transitionNeedsConfirm,
  transitionReasonRequired,
} from "@/components/admin/lib/orders";
import {
  generalFormToPayload,
  newVariantDraft,
  productToGeneralForm,
  splitList,
  tabForErrorKey,
  validateGeneral,
  validateVariant,
  variantDraftToPayload,
} from "@/components/admin/lib/product-form";
import { assignableRoles, canManageAdmin } from "@/components/admin/lib/roles";
import type { AdminProduct } from "@/lib/api/admin";

describe("datetime-local conversion", () => {
  it("round-trips a local wall-clock value without shifting", () => {
    const iso = localInputToIso("2026-03-01T14:30");
    expect(iso).not.toBeNull();
    expect(isoToLocalInput(iso)).toBe("2026-03-01T14:30");
  });

  it("interprets the input in the local zone (matches Date constructor)", () => {
    const expected = new Date(2026, 6, 15, 9, 5).toISOString();
    expect(localInputToIso("2026-07-15T09:05")).toBe(expected);
  });

  it("formats an ISO instant as local wall-clock time", () => {
    const d = new Date(2026, 0, 2, 3, 4);
    expect(isoToLocalInput(d.toISOString())).toBe("2026-01-02T03:04");
  });

  it("handles empty and invalid values", () => {
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput("nope")).toBe("");
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("2026-13")).toBeNull();
  });
});

describe("money input", () => {
  it("parses JOD to fils exactly", () => {
    expect(jodInputToFils("1.5")).toBe(1500);
    expect(jodInputToFils("0.255")).toBe(255);
    expect(jodInputToFils("12")).toBe(12000);
    expect(jodInputToFils("2,75")).toBe(2750);
  });
  it("rejects garbage and negatives", () => {
    expect(jodInputToFils("")).toBeNull();
    expect(Number.isNaN(jodInputToFils("-1"))).toBe(true);
    expect(Number.isNaN(jodInputToFils("1.2345"))).toBe(true);
    expect(Number.isNaN(jodInputToFils("abc"))).toBe(true);
  });
  it("formats fils for inputs", () => {
    expect(filsToJodInput(1500)).toBe("1.5");
    expect(filsToJodInput(null)).toBe("");
  });
});

describe("order transition labels", () => {
  it("labels refund from partially refunded as remaining refund", () => {
    expect(transitionLabel("payment", "REFUNDED", { currentPayment: "PARTIALLY_REFUNDED", hasPaypal: true })).toBe(
      "Refund remaining (PayPal)",
    );
    expect(transitionLabel("payment", "REFUNDED", { currentPayment: "PARTIALLY_REFUNDED" })).toBe(
      "Mark fully refunded",
    );
  });
  it("labels common actions", () => {
    expect(transitionLabel("payment", "PAID")).toBe("Mark paid");
    expect(transitionLabel("fulfillment", "MANUAL_REVIEW")).toBe("Send to manual review");
    expect(fulfillmentStatusLabel("COMPLETED")).toBe("Delivered");
  });
  it("requires reason only for manual paid; confirms money moves", () => {
    expect(transitionReasonRequired("payment", "PAID")).toBe(true);
    expect(transitionReasonRequired("payment", "REFUNDED")).toBe(false);
    expect(transitionNeedsConfirm("payment", "REFUNDED")).toBe(true);
    expect(transitionNeedsConfirm("fulfillment", "PROCESSING")).toBe(false);
  });
});

describe("revealed code parsing", () => {
  it("parses JSON payloads with a pin", () => {
    expect(parseRevealedCode('{"code": "ABCD-1234", "pin": "9876"}')).toEqual({ code: "ABCD-1234", pin: "9876" });
  });
  it("returns bare codes unchanged", () => {
    expect(parseRevealedCode("XYZ-1")).toEqual({ code: "XYZ-1", pin: "" });
    expect(parseRevealedCode("{broken")).toEqual({ code: "{broken", pin: "" });
  });
});

describe("error messages", () => {
  it("prefers string detail", () => {
    const err = new ApiError("x", 409, "unknown", { detail: "Refund it first", code: "refund_first" });
    expect(adminErrorMessage(err)).toBe("Refund it first");
    expect(errorCode(err)).toBe("refund_first");
  });
  it("flattens validation detail objects", () => {
    const err = new ApiError("API 400", 400, "validation", {
      detail: { password: ["This password is too common."], role: ["bad"] },
      code: "validation_error",
    });
    expect(adminErrorMessage(err)).toBe("password: This password is too common. · role: bad");
    expect(adminFieldErrors(err)).toEqual({ password: "This password is too common.", role: "bad" });
  });
  it("handles plain DRF field errors", () => {
    const err = new ApiError("API 400", 400, "validation", { slug: ["Slug already exists"] });
    expect(adminErrorMessage(err)).toBe("slug: Slug already exists");
  });
});

describe("roles", () => {
  it("only super admins assign privileged roles", () => {
    expect(assignableRoles("SUPER_ADMIN")).toContain("ADMIN");
    expect(assignableRoles("ADMIN")).not.toContain("ADMIN");
    expect(assignableRoles("ADMIN")).not.toContain("SUPER_ADMIN");
    expect(canManageAdmin("ADMIN", "SUPER_ADMIN")).toBe(false);
    expect(canManageAdmin("ADMIN", "VIEWER")).toBe(true);
  });
});

describe("audit formatting", () => {
  it("labels known and generic actions", () => {
    expect(auditActionLabel("orders.resend_email")).toBe("Resent delivery e-mail");
    expect(auditActionLabel("catalog.variant.updated")).toBe("Updated catalog variant");
  });
  it("summarizes meta", () => {
    expect(summarizeAuditMeta({ order_number: "MMH-1", reason: "bank transfer" })).toBe(
      "Order: MMH-1 · Reason: bank transfer",
    );
    expect(summarizeAuditMeta({ changes: { store_name: { from: "A", to: "B" } } })).toBe("Store name: A → B");
  });
});

describe("product form", () => {
  const product = {
    id: "p1",
    slug: "steam-card",
    kind: "GIFT_CARD",
    fulfillment_type: "CODE",
    brand: "Steam",
    artwork_key: "steam",
    status: "DRAFT",
    name_en: "Steam",
    category_id: 3,
    platform_id: 4,
    badges: ["new"],
    tags: ["pc", "valve"],
    how_to_use_en: ["Open Steam", "Redeem"],
  } as unknown as AdminProduct;

  it("keeps every general field so saving from another tab is complete", () => {
    const form = productToGeneralForm(product);
    expect(validateGeneral(form)).toEqual({});
    const payload = generalFormToPayload(form);
    expect(payload.name_en).toBe("Steam");
    expect(payload.category_id).toBe(3);
    expect(payload.tags).toEqual(["pc", "valve"]);
    expect(payload.how_to_use_en).toEqual(["Open Steam", "Redeem"]);
  });

  it("flags missing general fields", () => {
    const form = { ...productToGeneralForm(product), name_en: "", slug: "Bad Slug" };
    const errors = validateGeneral(form);
    expect(errors.name_en).toBeTruthy();
    expect(errors.slug).toBeTruthy();
  });

  it("new variants start empty and fail validation until name and price are filled", () => {
    const draft = newVariantDraft({ productId: "p1", index: 0, currency: "usd" });
    expect(draft.package_currency).toBe("USD");
    expect(draft.denomination).toBe("");
    expect(draft.published).toBe(true);
    const errors = validateVariant(draft);
    expect(errors.price).toBeTruthy();
    expect(errors.name_en).toBeTruthy();
    // CA-21: face value / package fields are optional (derived by the server).
    expect(errors.denomination).toBeUndefined();
    const filled = { ...draft, name_en: "10 USD", denomination: "10", package_value: "10", price: "7.5", compare_at: "8" };
    expect(validateVariant(filled)).toEqual({});
    expect(variantDraftToPayload(filled, 0)).toMatchObject({ price_fils: 7500, compare_at_price_fils: 8000 });
  });

  it("maps backend error keys to tabs", () => {
    expect(tabForErrorKey("variants")).toBe("variants");
    expect(tabForErrorKey("fields")).toBe("fields");
    expect(tabForErrorKey("slug")).toBe("general");
    expect(splitList("a, b,,c", "comma")).toEqual(["a", "b", "c"]);
  });
});
