import { describe, expect, it } from "vitest";
import { defaultRegionId, defaultSellableRegionId, denominationsForRegion, isGiftCardProduct, matchDenominationId, uniqueFaceValues } from "@/lib/digital-options";
import { PRODUCTS } from "@/data/products";
import type { DigitalDenomination, Product } from "@/types";

function withVariants(product: Product, extra: DigitalDenomination[]): Product {
  return {
    ...product,
    digitalOptions: { ...product.digitalOptions, denominations: extra },
  };
}

describe("digital option visibility", () => {
  it("keeps unique fallback denominations unchanged", () => {
    const steam = PRODUCTS.find((item) => item.id === "steam-wallet")!;
    expect(uniqueFaceValues(steam.digitalOptions.denominations)).toHaveLength(3);
    expect(denominationsForRegion(steam, "eu")).toHaveLength(3);
  });

  it("shows one amount per selected region instead of repeating variants", () => {
    const steam = PRODUCTS.find((item) => item.id === "steam-wallet")!;
    const duplicated: DigitalDenomination[] = steam.digitalOptions.denominations.flatMap((item) => [
      { ...item, id: `${item.id}-us`, regionId: "us" },
      { ...item, id: `${item.id}-eu`, regionId: "eu", currency: "EUR" },
    ]);
    const product = withVariants(steam, duplicated);
    expect(denominationsForRegion(product, "eu").map((item) => item.id)).toEqual(["10-eu", "20-eu", "50-eu"]);
    expect(matchDenominationId(product, "eu", "10-us")).toBe("10-eu");
  });

  it("defaults to UAE/MENA when available", () => {
    const psn = PRODUCTS.find((item) => item.id === "psn-store")!;
    expect(defaultRegionId(psn.digitalOptions.regions)).toBe("uae");
  });

  it("opens on a region that has stock when the usual one is sold out", () => {
    const psn = PRODUCTS.find((item) => item.id === "psn-store")!;
    const regions = psn.digitalOptions.regions.map((r) => r.id);
    const other = regions.find((id) => id !== "uae")!;
    const product = {
      ...psn,
      digitalOptions: {
        ...psn.digitalOptions,
        denominations: [
          { ...psn.digitalOptions.denominations[0], id: "a", regionId: "uae", inStock: false },
          { ...psn.digitalOptions.denominations[0], id: "b", regionId: other, inStock: true, availableQuantity: 3 },
        ],
      },
    };
    expect(defaultSellableRegionId(product)).toBe(other);
    expect(defaultSellableRegionId(psn)).toBe("uae");
  });

  it("treats wallet and gift-card products as gift cards", () => {
    const psn = PRODUCTS.find((item) => item.id === "psn-store")!;
    const xbox = PRODUCTS.find((item) => item.id === "xbox-gift")!;
    const pubg = PRODUCTS.find((item) => item.id === "pubg-uc")!;
    expect(isGiftCardProduct(psn)).toBe(true);
    expect(isGiftCardProduct(xbox)).toBe(true);
    expect(isGiftCardProduct(pubg)).toBe(false);
  });
});
