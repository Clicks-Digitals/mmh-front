import type { Category, Product } from "@/types";

let products: Product[] = [];
let categories: Category[] = [];
let menuCategories: Category[] = [];

export function setCatalogSnapshot(nextProducts: Product[], nextCategories: Category[], nextMenu: Category[] = []) {
  products = nextProducts;
  categories = nextCategories;
  menuCategories = nextMenu;
}

/** D20: categories flagged show_in_menu (catalog/categories/?menu=1), sorted. */
export function getSnapshotMenuCategories() {
  return menuCategories;
}

export function getSnapshotProducts() {
  return products;
}

export function getSnapshotCategories() {
  return categories;
}
