import { PRODUCTS } from "@/data/products";
import { searchCatalog } from "@/lib/search";
import { discountPercent } from "@/lib/format";
import type { FilterState, Product, SortOption } from "@/types";

export function applyFilters(products: Product[], filters: FilterState): Product[] {
  let result = products;

  if (filters.q) {
    const query = filters.q;
    result = searchCatalog(result, query);
  }

  if (filters.category) {
    result = result.filter(
      (product) => product.category === filters.category || product.platform === filters.category,
    );
  }

  if (filters.brand) {
    result = result.filter((product) => product.brand.toLowerCase() === filters.brand?.toLowerCase());
  }

  if (filters.type) {
    result = result.filter((product) => product.fulfillmentType === filters.type);
  }

  if (filters.kind) {
    result = result.filter((product) => product.digitalOptions.kind === filters.kind);
  }

  if (typeof filters.min === "number") {
    result = result.filter((product) => product.priceJod >= filters.min!);
  }

  if (typeof filters.max === "number") {
    result = result.filter((product) => product.priceJod <= filters.max!);
  }

  if (filters.availability === "in_stock") {
    result = result.filter((product) => product.inStock);
  }

  if (filters.discount) {
    result = result.filter((product) => Boolean(discountPercent(product.priceJod, product.compareAtPriceJod)));
  }

  if (filters.rating) {
    result = result.filter((product) => product.rating >= filters.rating!);
  }

  if (filters.platform) {
    result = result.filter((product) => product.platform === filters.platform);
  }

  if (filters.region) {
    result = result.filter((product) =>
      product.digitalOptions.regions.some((region) => region.id === filters.region),
    );
  }

  return sortProducts(result, filters.sort ?? "featured");
}

export function sortProducts(products: Product[], sort: SortOption): Product[] {
  const copy = [...products];
  switch (sort) {
    case "newest":
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "price-asc":
      return copy.sort((a, b) => a.priceJod - b.priceJod);
    case "price-desc":
      return copy.sort((a, b) => b.priceJod - a.priceJod);
    case "rating":
      return copy.sort((a, b) => b.rating - a.rating);
    case "discount":
      return copy.sort((a, b) => {
        const da = discountPercent(a.priceJod, a.compareAtPriceJod) ?? 0;
        const db = discountPercent(b.priceJod, b.compareAtPriceJod) ?? 0;
        return db - da;
      });
    default:
      return copy.sort((a, b) => Number(b.featured) - Number(a.featured) || b.rating - a.rating);
  }
}

export function parseFilterParams(
  searchParams: Record<string, string | string[] | undefined>,
): FilterState {
  const pick = (key: string) => {
    const value = searchParams[key];
    if (Array.isArray(value)) return String(value[0] ?? "");
    if (typeof value === "string") return value;
    return undefined;
  };

  const min = pick("min");
  const max = pick("max");
  const rating = pick("rating");

  return {
    q: pick("q") ?? "",
    category: pick("category") ?? "",
    brand: pick("brand") ?? "",
    type: (pick("type") as FilterState["type"]) || "",
    kind: (pick("kind") as FilterState["kind"]) || "",
    min: min ? Number(min) : undefined,
    max: max ? Number(max) : undefined,
    availability: pick("inStock") === "1" ? "in_stock" : "",
    discount: pick("discount") === "1",
    rating: rating ? Number(rating) : undefined,
    platform: pick("platform") ?? "",
    region: pick("region") ?? "",
    sort: (pick("sort") as SortOption) || "featured",
    view: pick("view") === "list" ? "list" : "grid",
  };
}

export function filtersToQuery(filters: FilterState): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.type) params.set("type", filters.type);
  if (filters.kind) params.set("kind", filters.kind);
  if (typeof filters.min === "number") params.set("min", String(filters.min));
  if (typeof filters.max === "number") params.set("max", String(filters.max));
  if (filters.availability === "in_stock") params.set("inStock", "1");
  if (filters.discount) params.set("discount", "1");
  if (filters.rating) params.set("rating", String(filters.rating));
  if (filters.platform) params.set("platform", filters.platform);
  if (filters.region) params.set("region", filters.region);
  if (filters.sort && filters.sort !== "featured") params.set("sort", filters.sort);
  if (filters.view === "list") params.set("view", "list");
  return params.toString();
}

export function emptyFilters(preserve: Pick<FilterState, "sort" | "view" | "category"> = {}): FilterState {
  return {
    q: "",
    brand: "",
    type: "",
    kind: "",
    min: undefined,
    max: undefined,
    availability: "",
    discount: false,
    rating: undefined,
    platform: "",
    region: "",
    sort: preserve.sort ?? "featured",
    view: preserve.view ?? "grid",
    category: preserve.category ?? "",
  };
}

export function countActiveFilters(filters: FilterState): number {
  let count = 0;
  if (filters.q) count += 1;
  if (filters.category) count += 1;
  if (filters.brand) count += 1;
  if (filters.type) count += 1;
  if (filters.kind) count += 1;
  if (typeof filters.min === "number") count += 1;
  if (typeof filters.max === "number") count += 1;
  if (filters.availability === "in_stock") count += 1;
  if (filters.discount) count += 1;
  if (filters.rating) count += 1;
  if (filters.platform) count += 1;
  if (filters.region) count += 1;
  return count;
}

export const ALL_PRODUCTS = PRODUCTS;
