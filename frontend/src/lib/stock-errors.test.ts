import { describe, expect, it } from "vitest";

import { parseStockLines, stockCartUpdates, stockLineMessage } from "@/lib/stock-errors";

const body = {
  code: "out_of_stock",
  detail: "Not enough stock",
  lines: [
    { product_id: 7, variant_id: 70, product_name: "Razer Gold", product_name_ar: "رازer", variant_name: "$10", variant_name_ar: "", requested: 2, available: 0 },
    { product_id: 8, variant_id: 80, product_name: "Steam", product_name_ar: "", variant_name: "$20", variant_name_ar: "", requested: 3, available: 1 },
  ],
};

describe("out of stock at payment (create-order 409)", () => {
  it("parses the sold-out lines and names them", () => {
    const lines = parseStockLines(body);
    expect(lines).toHaveLength(2);
    expect(stockLineMessage(lines[0], "en")).toEqual({
      key: "stock.lineNone",
      values: { name: "Razer Gold · $10", count: 0, requested: 2, available: 0 },
    });
    expect(stockLineMessage(lines[1], "en").key).toBe("stock.lineOnlyN");
  });

  it("removes sold-out lines and reduces short lines in the cart", () => {
    const lines = parseStockLines(body);
    const updates = stockCartUpdates(
      [
        { lineId: "a", productId: "7", variantId: 70, quantity: 2 },
        { lineId: "b", productId: "8", variantId: 80, quantity: 3 },
        { lineId: "c", productId: "9", variantId: 90, quantity: 1 },
      ],
      lines,
    );
    expect(updates).toEqual([
      { lineId: "a", remove: true },
      { lineId: "b", remove: false, quantity: 1 },
    ]);
  });

  it("falls back to the product id when a line has no variant", () => {
    const lines = parseStockLines({ lines: [{ product_id: 5, requested: 1, available: 0 }] });
    expect(stockCartUpdates([{ lineId: "x", productId: "5", variantId: null, quantity: 1 }], lines)).toEqual([
      { lineId: "x", remove: true },
    ]);
  });
});
