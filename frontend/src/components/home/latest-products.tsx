"use client";

import { ProductRail } from "@/components/product/product-card";
import { catalog as liveCatalog } from "@/data/products";
import { useLanguage } from "@/context/language-context";
import Link from "next/link";

export function LatestProducts() {
  const { t } = useLanguage();
  const source = liveCatalog();
  const products = source.filter((product) => product.trending).slice(0, 8);
  const items = products.length ? products : source.slice(0, 8);

  return (
    <section className="container-mmh py-6 sm:py-8">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{t("home.trending")}</h2>
        <Link href="/shop?sort=newest" className="text-sm font-semibold text-gold hover:text-fg">
          {t("common.viewAll")}
        </Link>
      </div>
      <ProductRail products={items} />
    </section>
  );
}
