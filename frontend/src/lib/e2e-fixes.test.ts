import { describe, expect, it } from "vitest";
import { couponReason, couponReasonKey, needsRevalidation, parseStoredCoupon, storedCoupon } from "@/lib/coupon-storage";
import { normalizeDigits } from "@/lib/digits";
import { isMaintenanceExempt, maintenanceContactLinks, maintenanceHtml } from "@/lib/maintenance";
import { resolveMediaUrl } from "@/lib/media";
import { buildMenu, dedupeFooterColumns } from "@/lib/nav-menu";
import { customerStatusKey, orderStatusCopy } from "@/lib/order-copy";
import { deriveCustomerStatus, mapApiOrder, maskValue, shouldPollOrder, type ApiOrder } from "@/lib/orders";
import { passwordProblems } from "@/lib/password";
import { lowStockCount, quantityLimits } from "@/lib/quantity";
import { matchesQuery } from "@/lib/search";
import { normalizePriceRange } from "@/lib/catalog";
import { parseStockLines, stockLineName } from "@/lib/stock-errors";
import { customerFieldError, firstInvalidField, normalizePhone } from "@/lib/validation";
import { orderedMedia } from "@/server/catalog/from-api";
import { PRODUCTS } from "@/data/products";
import type { Category, Product, RequiredCustomerField } from "@/types";

const field = (patch: Partial<RequiredCustomerField> = {}): RequiredCustomerField => ({
  id: "playerId",
  label: "Player ID",
  labelAr: "معرّف اللاعب",
  placeholder: "",
  placeholderAr: "",
  type: "text",
  required: true,
  ...patch,
});

describe("Arabic digit normalization (ST-11)", () => {
  it("converts Arabic-Indic and Persian digits", () => {
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(normalizeDigits("۰۷۹")).toBe("079");
    expect(normalizeDigits("ID ١٢a")).toBe("ID 12a");
  });
  it("accepts Arabic digits in phone numbers", () => {
    expect(normalizePhone("٠٧٩١٢٣٤٥٦٧")).toBe("+962791234567");
  });
});

describe("customer field validation (D17)", () => {
  it("validates numeric fields with lengths, after digit conversion", () => {
    const numeric = field({ inputFormat: "numeric", minLength: 8, maxLength: 12 });
    expect(customerFieldError(numeric, "")).toBe("required");
    expect(customerFieldError(numeric, "abc12345")).toBe("numeric");
    expect(customerFieldError(numeric, "1234")).toBe("too_short");
    expect(customerFieldError(numeric, "1234567890123")).toBe("too_long");
    expect(customerFieldError(numeric, "٥١٢٣٤٥٦٧٨٩")).toBeNull();
  });
  it("validates alphanumeric, email, phone and select options", () => {
    expect(customerFieldError(field({ inputFormat: "alphanumeric" }), "ab 12")).toBe("alphanumeric");
    expect(customerFieldError(field({ inputFormat: "email" }), "nope")).toBe("email");
    expect(customerFieldError(field({ type: "tel" }), "+962 79 123 4567")).toBeNull();
    const select = field({ type: "select", options: [{ value: "eu", label: "Europe", labelAr: "أوروبا" }] });
    expect(customerFieldError(select, "asia")).toBe("option");
    expect(customerFieldError(select, "eu")).toBeNull();
    expect(customerFieldError(field({ required: false, inputFormat: "numeric" }), "")).toBeNull();
  });
  it("finds the first invalid field in order", () => {
    const fields = [field({ id: "a" }), field({ id: "b", inputFormat: "numeric" })];
    expect(firstInvalidField(fields, { a: "x", b: "y" })?.id).toBe("b");
    expect(firstInvalidField(fields, { a: "x", b: "1" })).toBeNull();
  });
});

describe("coupon persistence (ST-03 / OR-25)", () => {
  it("parses only well-formed stored coupons", () => {
    expect(parseStoredCoupon({ code: " save10 ", email: "A@B.CO" })).toEqual({ code: "SAVE10", email: "a@b.co" });
    expect(parseStoredCoupon({ code: "bad code!" })).toBeNull();
    expect(parseStoredCoupon("SAVE10")).toBeNull();
    expect(parseStoredCoupon(null)).toBeNull();
  });
  it("re-validates when nothing is applied or subtotal/email changed", () => {
    const stored = storedCoupon("SAVE10", "a@b.co");
    expect(needsRevalidation(stored, null, 5000)).toBe(true);
    expect(needsRevalidation(stored, { code: "SAVE10", subtotalFils: 5000, email: "a@b.co" }, 5000)).toBe(false);
    expect(needsRevalidation(stored, { code: "SAVE10", subtotalFils: 4000, email: "a@b.co" }, 5000)).toBe(true);
    expect(needsRevalidation(stored, { code: "SAVE10", subtotalFils: 5000, email: "" }, 5000)).toBe(true);
    expect(needsRevalidation(stored, null, 0)).toBe(false);
    expect(needsRevalidation(null, null, 5000)).toBe(false);
  });
  it("maps backend codes to specific messages; unknown stays generic", () => {
    expect(couponReason("coupon_expired")).toBe("coupon_expired");
    expect(couponReason("whatever")).toBe("invalid_coupon");
    expect(couponReasonKey("coupon_customer_limit")).toBe("coupon.customerLimit");
    expect(couponReasonKey("unavailable")).toBe("cart.promoUnavailable");
  });
});

const baseOrder: ApiOrder = {
  id: 1,
  order_number: "MMH-1",
  email: "a@b.co",
  total_jod: 10,
  total_fils: 10000,
  payment_status: "PAID",
  fulfillment_status: "PROCESSING",
  created_at: "2026-10-01T10:00:00Z",
  items: [
    {
      id: 1,
      quantity: 2,
      unit_price_fils: 5000,
      product_name: "Steam",
      product_name_ar: "ستيم",
      fulfillment_type: "CODE",
      codes: [{ id: 3, masked: "••••AB12" }],
      codes_delivered: 1,
      codes_pending: 1,
      delivery_state: "partial",
      field_details: [{ key: "zoneId", label_en: "Zone ID", label_ar: "معرّف المنطقة", value: "1234" }],
    },
  ],
};

describe("order status copy (D4 / OR-05 / OR-07 / ST-28)", () => {
  it("uses the backend status and explains partial delivery", () => {
    const order = mapApiOrder({ ...baseOrder, status: "processing" });
    const copy = orderStatusCopy(order);
    expect(copy.title).toBe("orderCopy.partialTitle");
    expect(copy.values).toEqual({ delivered: 1, total: 2 });
    expect(order.items[0].fields[0].displayValue).toBe("1234");
    expect(order.items[0].productNameAr).toBe("ستيم");
  });
  it("never shows delivery copy for cancelled, expired or refunded orders", () => {
    for (const status of ["cancelled", "expired", "refunded"] as const) {
      const order = mapApiOrder({ ...baseOrder, status });
      expect(orderStatusCopy(order).showDelivery).toBe(false);
      expect(shouldPollOrder(order)).toBe(false);
    }
    expect(orderStatusCopy(mapApiOrder({ ...baseOrder, status: "expired" })).title).toBe("orderCopy.expiredTitle");
    expect(orderStatusCopy(mapApiOrder({ ...baseOrder, status: "refunded" })).title).toBe("orderCopy.refundedTitle");
  });
  it("labels unpaid orders 'awaiting payment'", () => {
    const order = mapApiOrder({ ...baseOrder, payment_status: "PENDING", fulfillment_status: "NOT_STARTED", can_pay: true });
    expect(order.status).toBe("awaiting_payment");
    expect(customerStatusKey(order.status)).toBe("orderState.awaiting_payment");
    expect(orderStatusCopy(order).title).toBe("orderCopy.awaitingTitle");
    expect(deriveCustomerStatus("PARTIALLY_REFUNDED", "COMPLETED")).toBe("partially_refunded");
  });
  it("masks only long values and keeps the last 3", () => {
    expect(maskValue("1234")).toBe("1234");
    expect(maskValue("5123456789")).toBe("•••789");
  });
});

describe("stock caps (D2)", () => {
  it("caps quantity by available stock", () => {
    expect(quantityLimits(1, 5, 2)).toEqual({ min: 1, max: 2 });
    expect(quantityLimits(1, 5, null)).toEqual({ min: 1, max: 5 });
    expect(lowStockCount(3)).toBe(3);
    expect(lowStockCount(40)).toBeNull();
    expect(lowStockCount(null)).toBeNull();
  });
  it("parses every failing line of a 409 out_of_stock", () => {
    const lines = parseStockLines({
      code: "out_of_stock",
      lines: [
        { product_id: "steam", variant_id: 4, product_name: "Steam", product_name_ar: "ستيم", variant_name: "$10", requested: 3, available: 1 },
        { product_id: "psn", variant_id: 7, product_name: "PSN", variant_name: "$20", requested: 1, available: 0 },
      ],
    });
    expect(lines).toHaveLength(2);
    expect(stockLineName(lines[0], "ar")).toBe("ستيم · $10");
    expect(lines[1].available).toBe(0);
    expect(parseStockLines({ code: "x" })).toEqual([]);
  });
});

describe("search normalization (ST-10)", () => {
  const psn = PRODUCTS.find((product) => product.platform === "playstation") as Product;
  it("matches Arabic spellings with or without spaces", () => {
    const spaced = { ...psn, nameAr: "بطاقة بلاي ستيشن" };
    expect(matchesQuery(spaced, "بلايستيشن")).toBe(true);
    expect(matchesQuery({ ...psn, nameAr: "بطاقة بلايستيشن" }, "بلاي ستيشن")).toBe(true);
    expect(matchesQuery(psn, "psn")).toBe(true);
  });
});

describe("menu building (D20) and footer (ST-24 / D19)", () => {
  const cat = (slug: string, patch: Partial<Category> = {}): Category => ({
    slug,
    name: slug,
    nameAr: `ar-${slug}`,
    description: "",
    descriptionAr: "",
    href: `/category/${slug}`,
    artworkKey: "gift",
    showInMenu: true,
    ...patch,
  });
  it("sorts menu categories and nests children", () => {
    const menu = buildMenu(
      [cat("b", { sortOrder: 2 }), cat("a", { sortOrder: 1 })],
      [cat("b-child", { parent: "b", showInMenu: false })],
      [],
    );
    expect(menu.map((entry) => entry.slug)).toEqual(["a", "b"]);
    expect(menu[1].children.map((child) => child.slug)).toEqual(["b-child"]);
  });
  it("returns nothing when no category is flagged (→ static nav)", () => {
    expect(buildMenu([], [cat("x")], [])).toEqual([]);
  });
  it("dedupes footer links and appends CMS pages", () => {
    const columns = dedupeFooterColumns(
      [
        { titleKey: "shop", links: [{ href: "/deals", label: "Deals" }, { href: "/contact", label: "Contact" }] },
        { titleKey: "company", links: [{ href: "/contact", label: "Contact" }] },
      ],
      [{ href: "/pages/shipping", label: "Shipping" }],
      "company",
    );
    expect(columns.flatMap((column) => column.links.map((link) => link.href))).toEqual(["/deals", "/contact", "/pages/shipping"]);
  });
});

describe("maintenance (D21)", () => {
  it("exempts order, account, auth, help and static paths", () => {
    for (const path of ["/order/MMH-1", "/order-success", "/order-lookup", "/login", "/register", "/forgot-password", "/reset-password", "/account", "/account/orders", "/contact", "/pages/about-us", "/api/auth/session", "/admin", "/favicon.ico"]) {
      expect(isMaintenanceExempt(path)).toBe(true);
    }
    for (const path of ["/", "/shop", "/product/steam", "/category/x", "/cart", "/checkout", "/search"]) {
      expect(isMaintenanceExempt(path)).toBe(false);
    }
  });
  it("renders contact channels that are set, escaped", () => {
    expect(maintenanceContactLinks({ support_email: "help@mmh.jo", whatsapp_number: "+962 79", instagram_url: "javascript:x" })).toEqual([
      { label: "help@mmh.jo", href: "mailto:help@mmh.jo" },
      { label: "WhatsApp", href: "https://wa.me/96279" },
    ]);
    const html = maintenanceHtml({ locale: "ar", storeName: "<MMH>", contact: {} });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("&lt;MMH&gt;");
  });
});

describe("media (ST-01 / D25)", () => {
  it("keeps store assets on the store origin", () => {
    expect(resolveMediaUrl("/home/hero.webp", "http://api.test/api/v1")).toBe("/home/hero.webp");
    expect(resolveMediaUrl("/media/a.png", "http://api.test/api/v1")).toBe("http://api.test/media/a.png");
  });
  it("orders the gallery primary-first with alt text", () => {
    const media = [
      { url: "b.png", alt: "B", sort_order: 1 },
      { url: "p.png", alt: "Primary", sort_order: 5, is_primary: true },
      { url: "a.png", alt: "", sort_order: 0 },
    ];
    expect(orderedMedia(media, "p.png")).toEqual([
      { url: "p.png", alt: "Primary" },
      { url: "a.png", alt: "" },
      { url: "b.png", alt: "B" },
    ]);
  });
});

describe("price range and passwords", () => {
  it("fixes negative and swapped price bounds (ST-26)", () => {
    expect(normalizePriceRange(-5, 10)).toEqual({ min: 0, max: 10, adjusted: true });
    expect(normalizePriceRange(20, 10)).toEqual({ min: 10, max: 20, adjusted: true });
    expect(normalizePriceRange(1, 10)).toEqual({ min: 1, max: 10, adjusted: false });
  });
  it("rejects weak passwords (D16)", () => {
    expect(passwordProblems("aaaaaaaaaaaa")).toContain("password.lowVariety");
    expect(passwordProblems("123456789012")).toContain("password.allDigits");
    expect(passwordProblems("Str0ng!Passw0rd")).toEqual([]);
  });
});
