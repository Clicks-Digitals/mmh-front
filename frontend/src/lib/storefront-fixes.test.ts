import { describe, expect, it } from "vitest";
import { categoryImageCandidates, homeCategoryTiles } from "@/lib/category-image";
import { cartDeliveryNoteKey } from "@/lib/delivery-copy";
import { denominationSellable } from "@/lib/digital-options";
import { keywordCatalogImage } from "@/lib/static-images";
import { parseStockLines, stockLineMessage } from "@/lib/stock-errors";
import { formatMessage, translations } from "@/data/translations";
import { HOME_SERVICE_TILES } from "@/data/home";
import { PRODUCTS } from "@/data/products";
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

describe("category artwork (item 5 / ST-30, D20)", () => {
  const pubg: Category = {
    slug: "pubg-mobile",
    name: "PUBG Mobile UC",
    nameAr: "شدات ببجي موبايل",
    description: "",
    descriptionAr: "",
    href: "/category/pubg-mobile",
    artworkKey: "gift",
  };

  it("uses own artwork first and falls back to bundled art by name before the placeholder", () => {
    expect(categoryImageCandidates({ ...pubg, artworkUrl: "https://cdn/x.png" }, [], [])[0]).toBe("https://cdn/x.png");
    expect(categoryImageCandidates(pubg, [], [])).toEqual(["/catalog/pubg-uc.webp"]);
    expect(categoryImageCandidates({ ...pubg, slug: "misc", name: "Misc", nameAr: "", artworkKey: "card-steam" }, [], [])).toEqual([
      "/catalog/steam-wallet.webp",
    ]);
  });

  it("uses the image of the product a category links to", () => {
    const product = PRODUCTS[0];
    const images = categoryImageCandidates({ ...pubg, slug: "linked", name: "Linked", nameAr: "", href: `/product/${product.slug}` }, PRODUCTS, []);
    expect(images[0]).toBe(product.images[0]);
  });

  it("matches keywords in slugs and names", () => {
    expect(keywordCatalogImage("free-fire")).toBe("/catalog/free-fire.webp");
    expect(keywordCatalogImage("", "PlayStation Plus")).toBe("/catalog/ps-plus.webp");
    expect(keywordCatalogImage("gift-cards")).toBe("");
  });

  it("home tiles come from menu categories, static tiles only when the menu is empty", () => {
    const menu = [{ slug: "pubg-mobile", href: "/category/pubg-mobile", label: "PUBG", labelAr: "ببجي", artworkKey: "card-pubg" }];
    const fromMenu = homeCategoryTiles(menu, HOME_SERVICE_TILES, [], []);
    expect(fromMenu.source).toBe("menu");
    expect(fromMenu.tiles.map((tile) => tile.id)).toEqual(["pubg-mobile"]);
    expect(fromMenu.tiles[0].images).toContain("/catalog/pubg-uc.webp");
    const fallback = homeCategoryTiles([], HOME_SERVICE_TILES, [], []);
    expect(fallback.source).toBe("static");
    expect(fallback.tiles).toHaveLength(HOME_SERVICE_TILES.length);
  });
});
