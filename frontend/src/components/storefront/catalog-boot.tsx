"use client";

import { setCatalogSnapshot } from "@/lib/catalog-snapshot";
import type { Category, Product } from "@/types";
import { useMemo, type ReactNode } from "react";

export function CatalogBoot({
  products,
  categories,
  menuCategories = [],
  children,
}: {
  products: Product[];
  categories: Category[];
  menuCategories?: Category[];
  children: ReactNode;
}) {
  useMemo(() => {
    setCatalogSnapshot(products, categories, menuCategories);
  }, [products, categories, menuCategories]);
  return children;
}
