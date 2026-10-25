import { describe, expect, it } from "vitest";
import { PRODUCTS } from "@/data/products";
import { accessTokenNeedsRefresh, jwtExpiry } from "@/lib/auth-tokens";
import { brandCountKey, brandsFromProducts } from "@/lib/brands";
import { cartTotals, couponApplies, estimatePayPalAmount, formatDiscount, toFils } from "@/lib/coupon";
import { claimsInstant, safeDeliveryEstimate, stripInstantClaims } from "@/lib/delivery-copy";
import { checkoutFingerprint, resolveAttempt } from "@/lib/idempotency";
import { hrefHasProducts, newestProducts, productsForListing } from "@/lib/listing";
import { mapApiOrder, maskValue, orderTimeline, shouldPollOrder } from "@/lib/orders";
import { clampQuantity, mergeQuantity, quantityLimits } from "@/lib/quantity";
import { robotsRules } from "@/lib/robots";
import { foldText, matchesQuery, searchCatalog, tokenize } from "@/lib/search";
import { absoluteUrl, DEFAULT_SITE_URL, normalizeSiteUrl } from "@/lib/site-url";
import { customerFieldError, isValidPhone, normalizePhone } from "@/lib/validation";
import { TRENDING_SEARCHES } from "@/data/navigation";
import type { Product } from "@/types";

describe("phone validation", () => {
  it("accepts international and Jordanian numbers", () => {
    expect(isValidPhone("+962 79 123 4567")).toBe(true);
    expect(isValidPhone("0791234567")).toBe(true);
    expect(isValidPhone("+44 20-7946-0958")).toBe(true);
    expect(isValidPhone("0044 20 7946 0958")).toBe(true);
    expect(isValidPhone("+1 (415) 555-0100")).toBe(true);
  });
  it("normalises Jordanian mobiles", () => {
    expect(normalizePhone("079 123 4567")).toBe("+962791234567");
    expect(normalizePhone("962791234567")).toBe("+962791234567");
  });
  it("rejects placeholders and junk", () => {
    expect(isValidPhone("+962 7X XXX XXXX")).toBe(false);
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("+1234567890123456")).toBe(false);
    expect(isValidPhone("0000000000")).toBe(false);
    expect(isValidPhone("+9627912")).toBe(false);
    expect(isValidPhone("12+345678")).toBe(false);
    expect(isValidPhone("")).toBe(false);
  });
});

describe("customer field validation", () => {
  it("applies required, email and tel rules", () => {
    expect(customerFieldError({ type: "text", required: true }, "  ")).toBe("required");
    expect(customerFieldError({ type: "text", required: false }, "")).toBeNull();
    expect(customerFieldError({ type: "text", required: true }, "51234567")).toBeNull();
    expect(customerFieldError({ type: "email", required: true }, "nope")).toBe("email");
    expect(customerFieldError({ type: "email", required: true }, "a@b.co")).toBeNull();
    expect(customerFieldError({ type: "tel", required: true }, "+962 7X")).toBe("tel");
    expect(customerFieldError({ type: "text", required: true }, "x".repeat(201))).toBe("too_long");
  });
});

describe("coupon math", () => {
  it("converts JOD to fils without float drift", () => {
    expect(toFils(8.9)).toBe(8900);
    expect(toFils(21.5 * 3)).toBe(64500);
  });
  it("only applies a quote to the subtotal it was validated for", () => {
    const coupon = { code: "SAVE", subtotalFils: 10000, discountFils: 1500, totalFils: 8500 };
    expect(couponApplies(coupon, 10000)).toBe(true);
    expect(cartTotals(10000, coupon)).toEqual({ subtotalFils: 10000, discountFils: 1500, totalFils: 8500, code: "SAVE" });
    expect(cartTotals(12000, coupon)).toEqual({ subtotalFils: 12000, discountFils: 0, totalFils: 12000, code: "" });
  });
  it("never discounts more than the subtotal", () => {
    expect(cartTotals(1000, { code: "X", subtotalFils: 1000, discountFils: 5000, totalFils: 0 }).totalFils).toBe(0);
  });
  it("formats the discount", () => {
    expect(formatDiscount(1500, "en")).toBe("- JOD 1.50");
    expect(formatDiscount(1500, "ar").startsWith("- ")).toBe(true);
  });
  it("estimates the PayPal amount from the FX rate", () => {
    expect(estimatePayPalAmount(10000, "1.41")).toBe(14.1);
    expect(estimatePayPalAmount(10000, "")).toBeNull();
    expect(estimatePayPalAmount(0, "1.41")).toBeNull();
  });
});

describe("idempotency keys", () => {
  const base = {
    email: "A@b.com",
    fullName: "Ali",
    coupon: "",
    items: [{ productId: "p", variantId: 3, quantity: 1, fields: { playerId: "123" } }],
  };
  it("reuses the key only for an identical retry", () => {
    let n = 0;
    const gen = () => `k${++n}`;
    const first = resolveAttempt(null, checkoutFingerprint(base), gen);
    expect(resolveAttempt(first, checkoutFingerprint({ ...base, email: "a@b.com" }), gen).key).toBe(first.key);
    expect(resolveAttempt(first, checkoutFingerprint({ ...base, coupon: "SAVE" }), gen).key).not.toBe(first.key);
    expect(
      resolveAttempt(first, checkoutFingerprint({ ...base, items: [{ ...base.items[0], quantity: 2 }] }), gen).key,
    ).not.toBe(first.key);
    expect(
      resolveAttempt(first, checkoutFingerprint({ ...base, items: [{ ...base.items[0], fields: { playerId: "9" } }] }), gen)
        .key,
    ).not.toBe(first.key);
  });
  it("generates random keys by default", () => {
    const a = resolveAttempt(null, "x");
    const b = resolveAttempt(null, "x");
    expect(a.key).not.toBe(b.key);
    expect(a.key.length).toBeGreaterThanOrEqual(16);
  });
});

describe("quantity limits", () => {
  it("caps at 5 and respects variant min/max", () => {
    expect(quantityLimits()).toEqual({ min: 1, max: 5 });
    expect(quantityLimits(2, 10)).toEqual({ min: 2, max: 5 });
    expect(quantityLimits(1, 3)).toEqual({ min: 1, max: 3 });
    expect(clampQuantity(9, quantityLimits())).toBe(5);
    expect(mergeQuantity(4, 3, quantityLimits())).toEqual({ quantity: 5, capped: true });
    expect(mergeQuantity(1, 1, quantityLimits())).toEqual({ quantity: 2, capped: false });
  });
});

describe("search", () => {
  it("folds case, diacritics and Arabic variants", () => {
    expect(foldText("PokÉmon")).toBe("pokemon");
    expect(foldText("أَلعاب")).toBe(foldText("العاب"));
    expect(tokenize("PUBG  uc!")).toEqual(["pubg", "uc"]);
  });
  it("matches every token across fields", () => {
    const pubg = PRODUCTS.find((product) => product.id === "pubg-uc")!;
    expect(matchesQuery(pubg, "pubg uc")).toBe(true);
    expect(matchesQuery(pubg, "UC PUBG")).toBe(true);
    expect(matchesQuery(pubg, "pubg steam")).toBe(false);
    const psn = PRODUCTS.find((product) => product.id === "psn-store")!;
    expect(matchesQuery(psn, "playstation us")).toBe(true);
    expect(matchesQuery(psn, psn.nameAr)).toBe(true);
  });
  it("every suggested search returns results on the seed catalog", () => {
    for (const term of TRENDING_SEARCHES) expect(searchCatalog(PRODUCTS, term).length, term).toBeGreaterThan(0);
  });
});

describe("site url", () => {
  it("normalises and defaults", () => {
    expect(normalizeSiteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(normalizeSiteUrl("https://shop.example.com/")).toBe("https://shop.example.com");
    expect(normalizeSiteUrl("shop.example.com")).toBe("https://shop.example.com");
    expect(normalizeSiteUrl("ftp://x")).toBe(DEFAULT_SITE_URL);
    expect(absoluteUrl("https://a.com", "/shop")).toBe("https://a.com/shop");
    expect(absoluteUrl("https://a.com", "/")).toBe("https://a.com/");
  });
  it("blocks everything on panel-only deployments", () => {
    expect(robotsRules(true, "https://a.com").rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    const store = robotsRules(false, "https://a.com");
    expect(store.sitemap).toBe("https://a.com/sitemap.xml");
    expect(JSON.stringify(store.rules)).toContain("/admin");
  });
});

describe("listings and navigation", () => {
  it("new products are the newest 12 or the last 30 days", () => {
    const now = Date.parse("2026-10-01T00:00:00Z");
    const make = (i: number, date: string) => ({ ...PRODUCTS[0], id: `p${i}`, slug: `p${i}`, createdAt: date }) as Product;
    const old = Array.from({ length: 20 }, (_, i) => make(i, `2025-01-${String(i + 1).padStart(2, "0")}`));
    expect(newestProducts(old, now)).toHaveLength(12);
    expect(newestProducts(old, now)[0].id).toBe("p19");
    const fresh = Array.from({ length: 15 }, (_, i) => make(100 + i, "2026-09-20"));
    expect(newestProducts([...old, ...fresh], now)).toHaveLength(15);
  });
  it("hides links without products", () => {
    expect(hrefHasProducts("/category/playstation", PRODUCTS)).toBe(true);
    expect(hrefHasProducts("/category/does-not-exist", PRODUCTS)).toBe(false);
    expect(hrefHasProducts("/product/steam-wallet", PRODUCTS)).toBe(true);
    expect(hrefHasProducts("/product/nope", PRODUCTS)).toBe(false);
    expect(hrefHasProducts("/gift-cards", [])).toBe(false);
    expect(
      productsForListing("game-top-ups", PRODUCTS).every(
        (product) => product.fulfillmentType === "direct_topup" || product.category === "game-top-ups",
      ),
    ).toBe(true);
  });
  it("counts brands with correct plural keys", () => {
    expect(brandsFromProducts(PRODUCTS).length).toBeGreaterThan(3);
    expect(brandCountKey(1, "en")).toBe("brands.count.one");
    expect(brandCountKey(2, "en")).toBe("brands.count.other");
    expect(brandCountKey(2, "ar")).toBe("brands.count.two");
    expect(brandCountKey(5, "ar")).toBe("brands.count.few");
    expect(brandCountKey(11, "ar")).toBe("brands.count.other");
  });
});

describe("orders", () => {
  const api = {
    id: 1,
    order_number: "ABC123",
    email: "a@b.com",
    subtotal_fils: 10000,
    discount_fils: 1000,
    total_fils: 9000,
    total_jod: 9,
    payment_status: "PAID",
    fulfillment_status: "PROCESSING",
    created_at: "2026-10-01T10:00:00Z",
    items: [
      {
        id: 7,
        quantity: 1,
        unit_price_fils: 5000,
        product_name: "PUBG UC",
        variant_name: "60 UC",
        fulfillment_type: "DIRECT_TOPUP",
        customer_fields: { playerId: "5123456789" },
        delivered: false,
      },
      {
        id: 8,
        quantity: 1,
        unit_price_fils: 5000,
        product_name: "Steam",
        fulfillment_type: "CODE",
        delivered: true,
        codes: [{ id: 3, masked: "••••AB12" }],
      },
    ],
  };
  it("maps fulfillment types, fields and codes", () => {
    const order = mapApiOrder(api);
    expect(order.items[0].fulfillmentType).toBe("DIRECT_TOPUP");
    expect(order.items[1].fulfillmentType).toBe("CODE");
    expect(order.items[0].fields[0]).toEqual({
      key: "playerId",
      label: "Player ID",
      labelAr: "معرّف اللاعب",
      displayValue: "•••789",
      displayValueAr: "•••789",
    });
    expect(order.items[1].codes).toEqual([{ id: "3", masked: "••••AB12" }]);
    expect(order.totalFils).toBe(9000);
    expect(maskValue("abc")).toBe("abc");
  });
  it("polls while paid but not delivered", () => {
    const order = mapApiOrder(api);
    expect(shouldPollOrder(order)).toBe(true);
    expect(shouldPollOrder({ ...order, fulfillmentStatus: "COMPLETED" })).toBe(false);
    expect(shouldPollOrder({ ...order, paymentStatus: "CANCELLED", fulfillmentStatus: "CANCELLED" })).toBe(false);
    expect(orderTimeline(order).map((step) => step.done)).toEqual([true, true, true, false]);
  });
});

describe("delivery copy", () => {
  it("never shows instant claims", () => {
    expect(claimsInstant("Instant after payment confirmation")).toBe(true);
    expect(safeDeliveryEstimate("Instant after payment confirmation", "en")).toBe("Delivered after payment confirmation");
    expect(safeDeliveryEstimate("فوري بعد تأكيد الدفع", "ar")).toBe("يُسلَّم بعد تأكيد الدفع");
    expect(safeDeliveryEstimate("Within 1 hour", "en")).toBe("Within 1 hour");
    expect(stripInstantClaims("Buy Steam Wallet instantly from MMH.")).toBe("Buy Steam Wallet from MMH.");
    expect(stripInstantClaims("اشترِ ستيم فوراً من إم إم إتش.")).toBe("اشترِ ستيم من إم إم إتش.");
  });
});

describe("auth tokens", () => {
  const encode = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
  it("reads exp and decides when to refresh", () => {
    expect(jwtExpiry(encode({ exp: 1000 }))).toBe(1000);
    expect(jwtExpiry("garbage")).toBeNull();
    expect(accessTokenNeedsRefresh(1000, 100, 60)).toBe(false);
    expect(accessTokenNeedsRefresh(1000, 950, 60)).toBe(true);
    expect(accessTokenNeedsRefresh(null, 950, 60)).toBe(false);
  });
});
