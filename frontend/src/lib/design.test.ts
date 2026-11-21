import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_LAYOUT, DEFAULT_THEME, normalizeHomeLayout, normalizeTheme, themeCss } from "@/lib/design";
import { moveSection, sectionSummary } from "@/components/admin/modules/store-design-client";
import { productsForSection } from "@/components/home/home-custom-sections";
import { PRODUCTS } from "@/data/products";

describe("store design", () => {
  it("falls back to the built-in look", () => {
    expect(normalizeTheme(undefined)).toEqual(DEFAULT_THEME);
    expect(normalizeTheme({ primary: "nope", neon: "max" })).toEqual(DEFAULT_THEME);
    expect(themeCss(DEFAULT_THEME)).toBe("");
    expect(normalizeHomeLayout([])).toEqual(DEFAULT_HOME_LAYOUT);
    expect(normalizeHomeLayout("x")).toEqual(DEFAULT_HOME_LAYOUT);
  });

  it("turns a custom theme into CSS variables with readable button text", () => {
    const css = themeCss({ primary: "#22e6ff", secondary: "#a855f7", background: "#0c0b1d", neon: "full" });
    expect(css).toContain("--primary:#22e6ff");
    expect(css).toContain("--background:#0c0b1d");
    expect(css).toContain("--primary-foreground:#17182b");
    expect(css).not.toMatch(/[<>]/);
  });

  it("keeps known sections and drops broken ones", () => {
    const layout = normalizeHomeLayout([
      { type: "suggested", visible: false },
      { type: "image" },
      { type: "products", id: "r", source: "deals", title_en: "Deals", limit: 99 },
      { type: "weird" },
    ]);
    expect(layout.map((s) => s.type)).toEqual(["suggested", "products"]);
    expect(layout[0].visible).toBe(false);
    expect(layout[1].type === "products" && layout[1].limit).toBe(24);
  });

  it("picks products for a hand-made row in the chosen order", () => {
    const [a, b] = PRODUCTS;
    const rows = productsForSection(
      { id: "x", type: "products", visible: true, title_en: "x", title_ar: "", source: "products", category: "", products: [b.slug, "missing", a.slug], limit: 8, style: "row" },
      PRODUCTS,
      [],
    );
    expect(rows.map((p) => p.slug)).toEqual([b.slug, a.slug]);
    expect(sectionSummary({ id: "x", type: "products", visible: true, title_en: "x", title_ar: "", source: "deals", category: "", products: [], limit: 6, style: "grid" }, (s) => s)).toBe(
      "Product grid · products on sale · up to 6",
    );
  });

  it("moves sections within bounds", () => {
    expect(moveSection([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveSection([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
