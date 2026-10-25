"use client";

import { CategoryTileImage } from "@/components/home/category-tile-image";
import { useLanguage } from "@/context/language-context";
import { catalog as liveCatalog } from "@/data/products";
import type { StorePlatform } from "@/types";
import Link from "next/link";

/**
 * Brand row: published platforms (Admin → Platforms, by sort order) that have products. Each tile
 * shows the platform's uploaded logo, else its built-in picture.
 */
export function PlatformQuickLinks({ platforms }: { platforms: StorePlatform[] }) {
  const { t, locale } = useLanguage();
  const products = liveCatalog();
  const visible = [...platforms]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .filter((platform) => products.some((product) => product.platform === platform.slug));
  if (!visible.length) return null;

  return (
    <section className="container-mmh py-5 sm:py-7" aria-label={t("home.shopByCategory")}>
      <div className="flex gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-4 sm:gap-5 sm:overflow-visible lg:grid-cols-8 lg:gap-4">
        {visible.map((platform) => (
          <Link
            key={platform.slug}
            href={`/category/${platform.slug}`}
            className="group flex w-[6.5rem] shrink-0 flex-col items-center gap-2.5 sm:w-auto"
          >
            <span className="relative block h-24 w-24 overflow-hidden rounded-2xl border border-line bg-[#17182b] shadow-sm transition group-hover:border-gold/40 sm:h-28 sm:w-28 lg:h-[7.5rem] lg:w-[7.5rem]">
              <CategoryTileImage entity={platform} alt="" className="h-full w-full" />
            </span>
            <span className="line-clamp-2 text-center text-xs font-semibold leading-4 text-fg sm:text-sm">
              {locale === "ar" ? platform.nameAr : platform.name}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
