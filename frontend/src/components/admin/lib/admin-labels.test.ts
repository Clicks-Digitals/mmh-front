import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  auditMetaRows,
  formatAuditValue,
  humanizeEnumValue,
  isInternalMetaKey,
  summarizeAuditMeta,
} from "@/components/admin/lib/audit";
import { categoryTreeOptions } from "@/components/admin/lib/category-tree";
import { storePagePath } from "@/components/admin/lib/content-pages";
import { adminErrorMessage, adminErrorSummary, adminFieldErrors } from "@/components/admin/lib/errors";
import {
  itemDeliverySummary,
  paidWithText,
  paymentProviderLabel,
  PAYMENT_PROVIDER_OPTIONS,
} from "@/components/admin/lib/orders";
import { generalServerErrors } from "@/components/admin/lib/product-form";
import { friendlyValidationMessage } from "@/components/admin/lib/validation-messages";
import { variantDisplayName, variantOptionLabel } from "@/components/admin/lib/variants";

describe("friendly validation messages (item 13)", () => {
  it("rewrites duplicate-value messages", () => {
    expect(friendlyValidationMessage("coupon with this code already exists.")).toBe("A coupon with this code already exists.");
    expect(friendlyValidationMessage("A coupon with this code already exists")).toBe("A coupon with this code already exists.");
    expect(friendlyValidationMessage("product with this slug already exists.")).toBe(
      "Another product already uses this web address.",
    );
    expect(friendlyValidationMessage("category with this slug already exists.")).toBe(
      "Another category already uses this web address.",
    );
    expect(friendlyValidationMessage("banner with this placement already exists.")).toBe(
      "Another banner already uses this placement.",
    );
    expect(friendlyValidationMessage("product variant with this sku already exists.")).toBe(
      "Another product option already uses this SKU.",
    );
    expect(friendlyValidationMessage("The fields product, sku must make a unique set.")).toBe(
      "This combination of product and SKU is already used.",
    );
    expect(friendlyValidationMessage("Price must be positive")).toBe("Price must be positive");
  });

  it("is used by the panel error helpers without the raw field prefix", () => {
    const coupon = new ApiError("API 400", 400, "validation", { detail: { code: ["coupon with this code already exists."] } });
    expect(adminFieldErrors(coupon)).toEqual({ code: "A coupon with this code already exists." });
    expect(adminErrorMessage(coupon)).toBe("A coupon with this code already exists.");
    expect(adminErrorSummary(coupon)).toBe("A coupon with this code already exists.");
    const slug = new ApiError("API 400", 400, "validation", { slug: ["product with this slug already exists."] });
    expect(adminErrorMessage(slug)).toBe("Another product already uses this web address.");
    expect(generalServerErrors({ detail: { slug: ["product with this slug already exists."] } })).toEqual({
      slug: "Another product already uses this web address.",
    });
    // Other messages keep their field context.
    expect(adminErrorMessage(new ApiError("API 400", 400, "validation", { price: ["Too low"] }))).toBe("price: Too low");
  });
});

describe("audit humanising (item 12)", () => {
  it("turns enum values into sentence case", () => {
    expect(humanizeEnumValue("NOT_STARTED")).toBe("Not started");
    expect(humanizeEnumValue("PROCESSING")).toBe("Processing");
    expect(humanizeEnumValue("PARTIALLY_REFUNDED")).toBe("Partially refunded");
    expect(humanizeEnumValue("MANUAL_REVIEW")).toBe("Needs review");
    expect(humanizeEnumValue("JOD")).toBe("JOD");
    expect(humanizeEnumValue("bank transfer")).toBe("bank transfer");
  });

  it("formats via, status changes, money and booleans", () => {
    expect(formatAuditValue("owner", "via")).toBe("Customer (signed in)");
    expect(formatAuditValue("access_token", "via")).toBe("Customer (email link)");
    expect(formatAuditValue("PAID→REFUNDED", "payment_status")).toBe("Paid → Refunded");
    expect(formatAuditValue("NOT_STARTED→COMPLETED", "fulfillment_status")).toBe("Not started → Delivered");
    expect(formatAuditValue({ from: "PROCESSING", to: "PARTIALLY_REFUNDED" }, "status")).toBe("Processing → Partially refunded");
    expect(formatAuditValue(1500, "amount_off_fils")).toBe("JOD 1.50");
    expect(formatAuditValue(true)).toBe("Yes");
    expect(formatAuditValue("paypal", "provider")).toBe("PayPal");
  });

  it("hides internal keys", () => {
    for (const key of ["short_item_ids", "code_ids", "variant_id", "item_id", "ids", "id", "order_item_id", "role_label"]) {
      expect(isInternalMetaKey(key)).toBe(true);
    }
    expect(isInternalMetaKey("paypal_capture_id")).toBe(false);
    expect(isInternalMetaKey("order_number")).toBe(false);
    const rows = auditMetaRows({ order_number: "AB12", via: "owner", code_ids: [1, 2], variant_id: 46, status: "PROCESSING" });
    expect(rows.map((r) => `${r.label}: ${r.value}`)).toEqual(["Order: AB12", "Status: Processing", "Via: Customer (signed in)"]);
    expect(summarizeAuditMeta({ short_item_ids: [3], assigned: 2 })).toBe("Codes assigned: 2");
    expect(summarizeAuditMeta({ changes: { payment_status: "PAID→PARTIALLY_REFUNDED" } })).toBe(
      "Payment: Paid → Partially refunded",
    );
  });
});

describe("payment provider labels (item 16)", () => {
  it("uses one wording everywhere", () => {
    expect(paymentProviderLabel("paypal")).toBe("PayPal");
    expect(paymentProviderLabel("free")).toBe("Free order");
    expect(paymentProviderLabel("manual")).toBe("Manual");
    expect(paymentProviderLabel("bank_transfer")).toBe("Bank transfer");
    expect(paymentProviderLabel("")).toBe("—");
    expect(paidWithText("manual")).toBe("Paid manually (outside PayPal)");
    expect(paidWithText("paypal")).toBe("PayPal");
    expect(PAYMENT_PROVIDER_OPTIONS.map((o) => o.label)).toEqual(["PayPal", "Free order", "Manual"]);
  });
});

describe("item delivery summary (item 7)", () => {
  it("says refunded + retired instead of 0 of N delivered", () => {
    const s = itemDeliverySummary(
      {
        delivery_state: "retired_refunded",
        codes: [{ delivered_at: "2026-10-01T10:00:00Z" }, { delivered_at: "2026-10-02T10:00:00Z" }],
      },
      { payment_status: "REFUNDED", fulfillment_status: "COMPLETED" },
    );
    expect(s.label).toBe("Refunded · codes retired");
    expect(s.showStats).toBe(false);
    expect(s.showActions).toBe(false);
    expect(s.deliveredAt).toBe("2026-10-02T10:00:00Z");
  });

  it("shows Cancelled without stats or actions on cancelled orders", () => {
    const s = itemDeliverySummary(
      { delivery_state: "pending", delivery_state_label: "Not delivered" },
      { payment_status: "CANCELLED", fulfillment_status: "CANCELLED" },
    );
    expect(s).toMatchObject({ label: "Cancelled", showStats: false, showActions: false });
  });

  it("keeps normal states", () => {
    const s = itemDeliverySummary(
      { delivery_state: "partial", delivery_state_label: "Partly delivered" },
      { payment_status: "PAID", fulfillment_status: "PROCESSING" },
    );
    expect(s).toMatchObject({ label: "Partly delivered", showStats: true, showActions: true, tone: "warning" });
  });
});

describe("variant labels (item 14)", () => {
  it("joins product and option names", () => {
    expect(variantDisplayName("PUBG Mobile", "60 UC")).toBe("PUBG Mobile – 60 UC");
    expect(variantDisplayName("", "60 UC")).toBe("60 UC");
    expect(variantDisplayName(null, null)).toBe("");
    expect(variantOptionLabel({ product_name: "PUBG Mobile", name_en: "60 UC", sku: "PUBG-60" })).toBe(
      "PUBG Mobile – 60 UC (PUBG-60)",
    );
    expect(variantOptionLabel({ sku: "PUBG-60" })).toBe("PUBG-60");
  });
});

describe("category picker tree and page paths (item 17)", () => {
  it("indents sub-categories under their parent", () => {
    const options = categoryTreeOptions([
      { id: 1, name_en: "Gift cards", parent: null, status: "PUBLISHED" },
      { id: 2, name_en: "Games", parent: null, status: "PUBLISHED" },
      { id: 3, name_en: "PlayStation", parent: 1, status: "DRAFT" },
      { id: 4, name_en: "PSN Plus", parent: 3, status: "PUBLISHED" },
    ]);
    expect(options.map((o) => [o.category.id, o.depth])).toEqual([
      [1, 0],
      [3, 1],
      [4, 2],
      [2, 0],
    ]);
    expect(options[1].label).toBe("    ↳ PlayStation (draft)");
  });

  it("survives cycles and missing parents", () => {
    const options = categoryTreeOptions([
      { id: 1, name_en: "A", parent: 2 },
      { id: 2, name_en: "B", parent: 1 },
      { id: 3, name_en: "C", parent: 99 },
    ]);
    expect(options.map((o) => Number(o.category.id)).sort()).toEqual([1, 2, 3]);
  });

  it("maps built-in page slugs to their store routes", () => {
    expect(storePagePath("about")).toBe("/about");
    expect(storePagePath("digital-product-policy")).toBe("/digital-product-policy");
    expect(storePagePath("shipping")).toBe("/pages/shipping");
  });
});
