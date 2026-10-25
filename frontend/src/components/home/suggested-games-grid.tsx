"use client";

import { CategoryTileImage } from "@/components/home/category-tile-image";
import { useLanguage } from "@/context/language-context";
import { catalog as liveCatalog } from "@/data/products";
import { getSnapshotCategories } from "@/lib/catalog-snapshot";
import { hrefHasProducts } from "@/lib/listing";
import type { StoreHomeTile } from "@/types";
import Link from "next/link";

/** "MMH suggests" grid — tiles from Admin → Content → Home tiles (only those leading to products). */
export function SuggestedGamesGrid({ tiles }: { tiles: StoreHomeTile[] }) {
  const { t, locale } = useLanguage();
  const products = liveCatalog();
  const categories = getSnapshotCategories();
  const visible = tiles.filter((tile) => /^https?:\/\//i.test(tile.href) || hrefHasProducts(tile.href, products, categories));
  if (!visible.length) return null;
  return (
    <section className="container-mmh py-6 sm:py-8">
      <h2 className="mb-4 text-center text-xl font-bold tracking-tight sm:mb-6 sm:text-2xl">{t("home.suggest")}</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:gap-4">
        {visible.map((tile) => (
          <Link
            key={tile.id}
            href={tile.href}
            className="group relative aspect-[4/5] overflow-hidden rounded-2xl border border-line bg-[#17182b] transition hover:border-gold/40"
          >
            <CategoryTileImage
              entity={tile}
              alt=""
              className="absolute inset-0 h-full w-full transition duration-300 group-hover:scale-[1.04]"
            />
            <div className="absolute inset-x-0 bottom-0 bg-[#17182b]/88 px-2.5 py-2.5 backdrop-blur-sm sm:px-3 sm:py-3">
              <p className="line-clamp-2 text-center text-xs font-semibold text-white sm:text-sm">
                {locale === "ar" ? tile.titleAr : tile.title}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
