"use client";

import { CategoryTileImage } from "@/components/home/category-tile-image";
import { HOME_PLATFORM_LINKS } from "@/data/home";
import { useLanguage } from "@/context/language-context";
import { catalog as liveCatalog } from "@/data/products";
import { getSnapshotCategories } from "@/lib/catalog-snapshot";
import { hrefHasProducts } from "@/lib/listing";
import Link from "next/link";

export function PlatformQuickLinks() {
  const { t } = useLanguage();

  return (
    <section className="container-mmh py-5 sm:py-7" aria-label={t("home.shopByCategory")}>
      <div className="flex gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:grid-cols-4 sm:gap-5 sm:overflow-visible lg:grid-cols-8 lg:gap-4">
        {HOME_PLATFORM_LINKS.filter((tile) => hrefHasProducts(tile.href, liveCatalog(), getSnapshotCategories())).map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="group flex w-[6.5rem] shrink-0 flex-col items-center gap-2.5 sm:w-auto"
          >
            <span className="relative block h-24 w-24 overflow-hidden rounded-2xl border border-line bg-[#17182b] shadow-sm transition group-hover:border-gold/40 sm:h-28 sm:w-28 lg:h-[7.5rem] lg:w-[7.5rem]">
              <CategoryTileImage src={item.image} alt="" artworkKey={item.artworkKey} className="h-full w-full" />
            </span>
            <span className="line-clamp-2 text-center text-xs font-semibold leading-4 text-fg sm:text-sm">
              {t(item.labelKey)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
