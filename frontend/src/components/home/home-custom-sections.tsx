"use client";

import { ProductGrid, ProductRail } from "@/components/product/product-card";
import { useLanguage } from "@/context/language-context";
import { catalog as liveCatalog } from "@/data/products";
import { getSnapshotCategories } from "@/lib/catalog-snapshot";
import type { ImageSection, ProductsSection } from "@/lib/design";
import { newestProducts, productsForListing } from "@/lib/listing";
import { resolveMediaUrl } from "@/lib/media";
import type { Product } from "@/types";
import Link from "next/link";

/** Products for a row added in Admin → Store design. Exported for tests. */
export function productsForSection(section: ProductsSection, products: Product[], categories = getSnapshotCategories()): Product[] {
  let picked: Product[];
  if (section.source === "products") {
    const bySlug = new Map(products.map((p) => [p.slug, p]));
    picked = section.products.map((slug) => bySlug.get(slug)).filter((p): p is Product => Boolean(p));
  } else if (section.source === "deals") {
    picked = products.filter((p) => p.compareAtPriceJod && p.compareAtPriceJod > p.priceJod);
  } else if (section.source === "newest") {
    picked = newestProducts(products);
  } else {
    picked = productsForListing(section.category, products, categories);
  }
  return picked.slice(0, section.limit);
}

function viewAllHref(section: ProductsSection): string | null {
  if (section.source === "category" && section.category) return `/category/${encodeURIComponent(section.category)}`;
  if (section.source === "deals") return "/deals";
  if (section.source === "newest") return "/shop?sort=newest";
  return null;
}

export function HomeProductsSection({ section }: { section: ProductsSection }) {
  const { t, locale } = useLanguage();
  const items = productsForSection(section, liveCatalog());
  if (!items.length) return null;
  const title = (locale === "ar" ? section.title_ar || section.title_en : section.title_en || section.title_ar).trim();
  const more = viewAllHref(section);
  return (
    <section className="container-mmh py-6 sm:py-8">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="mmh-heading text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
        {more ? (
          <Link href={more} className="text-sm font-semibold text-gold hover:text-fg">
            {t("common.viewAll")}
          </Link>
        ) : null}
      </div>
      {section.style === "grid" ? <ProductGrid products={items} density="dense" /> : <ProductRail products={items} />}
    </section>
  );
}

export function HomeImageSection({ section }: { section: ImageSection }) {
  const { locale } = useLanguage();
  const desktop = resolveMediaUrl(section.image);
  const mobile = resolveMediaUrl(section.image_mobile) || desktop;
  const alt = (locale === "ar" ? section.alt_ar || section.alt_en : section.alt_en || section.alt_ar) || "";
  const picture = (
    <picture>
      <source media="(max-width: 639px)" srcSet={mobile} />
      <img src={desktop} alt={alt} loading="lazy" decoding="async" className="block h-auto max-h-[28rem] w-full object-cover sm:max-h-[32rem]" />
    </picture>
  );
  const frame = "mmh-card block overflow-hidden rounded-2xl border border-line bg-card";
  return (
    <section className="container-mmh py-4 sm:py-6">
      {section.href ? (
        <Link
          href={section.href}
          className={`${frame} transition-transform duration-300 hover:-translate-y-0.5 motion-reduce:hover:translate-y-0`}
          {...(/^https?:/i.test(section.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {picture}
        </Link>
      ) : (
        <div className={frame}>{picture}</div>
      )}
    </section>
  );
}
