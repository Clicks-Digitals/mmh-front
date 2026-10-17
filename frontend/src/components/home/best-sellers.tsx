"use client";

import { ProductGrid } from "@/components/product/product-card";
import { SectionHeading } from "@/components/ui/section-heading";
import { PRODUCTS } from "@/data/products";
import { getSnapshotProducts } from "@/lib/catalog-snapshot";
import { useLanguage } from "@/context/language-context";

export function BestSellers() {
  const { t } = useLanguage();
  const catalog = getSnapshotProducts();
  const products = (catalog.length ? catalog : PRODUCTS).filter((product) => product.bestseller).slice(0, 8);
  return (
    <section className="container-mmh py-6">
      <SectionHeading title={t("home.bestSellers")} actionHref="/category/best-sellers" actionLabel={t("common.viewAll")} />
      <ProductGrid products={products} />
    </section>
  );
}
