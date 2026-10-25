import { describe, expect, it } from "vitest";
import { builtinArtworkImage, drawnArtworkKey, entityImageSources } from "@/lib/builtin-artwork";
import { cartDeliveryNoteKey } from "@/lib/delivery-copy";
import { denominationSellable } from "@/lib/digital-options";
import { parseStockLines, stockLineMessage } from "@/lib/stock-errors";
import { formatMessage, translations } from "@/data/translations";
import { PRODUCTS } from "@/data/products";
import { mapApiCategory, mapApiProduct } from "@/server/catalog/from-api";
import type { Category, DigitalDenomination } from "@/types";

describe("out-of-stock line messages (item 2)", () => {
  const [few, none] = parseStockLines({
    code: "out_of_stock",
    lines: [
      { product_name: "Steam Wallet", product_name_ar: "ستيم", variant_name: "$10", variant_name_ar: "10$", requested: 3, available: 1 },
      { product_name: "PSN", variant_name: "", requested: 2, available: 0 },
    ],
  });

  it("fills every placeholder of the message in both languages", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const line of [few, none]) {
        const { key, values } = stockLineMessage(line, locale);
        const text = formatMessage(translations[locale][key], values);
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
    const en = stockLineMessage(few, "en");
    expect(formatMessage(translations.en[en.key], en.values)).toBe("Steam Wallet · $10: only 1 left (you asked for 3).");
    const ar = stockLineMessage(few, "ar");
    expect(formatMessage(translations.ar[ar.key], ar.values)).toContain("3");
    expect(stockLineMessage(none, "en").key).toBe("stock.lineNone");
  });
});

describe("sold-out variants (item 3)", () => {
  const variant = (patch: Partial<DigitalDenomination>) => ({ id: "v", label: "x", labelAr: "x", value: 1, currency: "USD", priceJod: 1, ...patch }) as DigitalDenomination;
  it("treats available_quantity 0 or stock flag as sold out, null as untracked", () => {
    expect(denominationSellable(variant({ availableQuantity: 0 }))).toBe(false);
    expect(denominationSellable(variant({ inStock: false }))).toBe(false);
    expect(denominationSellable(variant({ availableQuantity: null }))).toBe(true);
    expect(denominationSellable(variant({ availableQuantity: 4 }))).toBe(true);
    expect(denominationSellable(undefined)).toBe(false);
  });
});

describe("cart delivery note by contents (item 4 / ST-19)", () => {
  it("picks codes / top-ups / mixed copy", () => {
    expect(cartDeliveryNoteKey(["code", "code"])).toBe("cart.digitalNote");
    expect(cartDeliveryNoteKey(["direct_topup"])).toBe("cart.topupNote");
    expect(cartDeliveryNoteKey(["DIRECT_TOPUP", "direct_topup"])).toBe("cart.topupNote");
    expect(cartDeliveryNoteKey(["direct_topup", "code"])).toBe("cart.mixedNote");
    expect(cartDeliveryNoteKey([undefined])).toBe("cart.digitalNote");
    expect(cartDeliveryNoteKey([])).toBe("cart.digitalNote");
  });
  it("has EN and AR copy, and the top-up copy does not talk about codes", () => {
    for (const key of ["cart.topupNote", "cart.mixedNote", "product.soldOutBody"] as const) {
      expect(translations.en[key]).toBeTruthy();
      expect(translations.ar[key]).toBeTruthy();
    }
    expect(translations.en["cart.topupNote"]).not.toMatch(/codes are delivered/i);
  });
});

describe("entity pictures: uploaded image, else built-in artwork — never another product's photo", () => {
  const giftCards: Category = {
    slug: "gift-cards",
    name: "Gift cards",
    nameAr: "بطاقات الهدايا",
    description: "",
    descriptionAr: "",
    href: "/gift-cards",
    artworkKey: "",
  };

  it("uses the uploaded picture first, then the built-in picture", () => {
    expect(entityImageSources({ ...giftCards, imageUrl: "https://api.x/media/uploads/a.png", artworkKey: "card-steam" })).toEqual([
      "https://api.x/media/uploads/a.png",
      "/catalog/steam-wallet.webp",
    ]);
    expect(entityImageSources({ ...giftCards, artworkKey: "card-steam" })).toEqual(["/catalog/steam-wallet.webp"]);
  });

  it("a category without upload or built-in key gets the drawn placeholder, not a product photo", () => {
    expect(entityImageSources(giftCards)).toEqual([]);
    expect(drawnArtworkKey(giftCards)).toBe("gift");
    const ps = PRODUCTS.find((product) => product.images.length);
    expect(ps).toBeTruthy();
    expect(entityImageSources(giftCards)).not.toContain(ps!.images[0]);
  });

  it("matches built-in art only by own key or exact brand slug (no fuzzy name matching)", () => {
    expect(builtinArtworkImage({ slug: "playstation" })).toBe("/catalog/psn-store.webp");
    expect(builtinArtworkImage({ slug: "pubg-mobile" })).toBe("/catalog/pubg-uc.webp");
    expect(builtinArtworkImage({ slug: "subscriptions" })).toBe("");
    expect(builtinArtworkImage({ slug: "my-playstation-deals" })).toBe("");
    // an explicitly picked drawn key wins over the slug
    expect(builtinArtworkImage({ slug: "steam", artworkKey: "deal" })).toBe("");
  });

  it("API mapping keeps the category picture and never adds a bundled product photo", () => {
    const category = mapApiCategory({
      id: 1,
      slug: "gift-cards",
      href: "",
      artwork_key: "",
      image_url: "https://api.x/media/uploads/c.png",
      name_en: "Gift cards",
      name_ar: "",
      description_en: "",
      description_ar: "",
    });
    expect(category.imageUrl).toBe("https://api.x/media/uploads/c.png");
    expect(category.artworkKey).toBe("");
    const product = mapApiProduct({
      id: "psn-store",
      slug: "psn-store",
      kind: "GIFT_CARD",
      fulfillment_type: "CODE",
      brand: "PlayStation",
      artwork_key: "card-psn",
      status: "PUBLISHED",
      featured: false,
      bestseller: false,
      trending: false,
      rating: 0,
      review_count: 0,
      badges: [],
      tags: [],
      name_en: "PSN",
      name_ar: "",
    });
    expect(product.images).toEqual([]);
  });
});
