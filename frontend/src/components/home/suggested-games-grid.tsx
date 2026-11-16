"use client";

import { CategoryTileImage } from "@/components/home/category-tile-image";
import { useLanguage } from "@/context/language-context";
import { catalog as liveCatalog } from "@/data/products";
import { getSnapshotCategories } from "@/lib/catalog-snapshot";
import { hrefHasProducts } from "@/lib/listing";
import type { StoreHomeTile } from "@/types";
import Link from "next/link";

/** "MMH suggests" glow circles — tiles from Admin → Content → Home tiles (only those leading to products). */
export function SuggestedGamesGrid({ tiles }: { tiles: StoreHomeTile[] }) {
  const { t, locale } = useLanguage();
  const products = liveCatalog();
  const categories = getSnapshotCategories();
  const visible = tiles.filter((tile) => /^https?:\/\//i.test(tile.href) || hrefHasProducts(tile.href, products, categories));
  if (!visible.length) return null;
  return (
    <section className="container-mmh py-6 sm:py-8">
      <h2 className="mb-4 text-center text-xl font-bold tracking-tight sm:mb-6 sm:text-2xl">{t("home.suggest")}</h2>
      <div className="mx-auto grid max-w-5xl grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 sm:gap-x-5 sm:gap-y-7 lg:grid-cols-6">
        {visible.map((tile) => (
          <Link
            key={tile.id}
            href={tile.href}
            className="group flex flex-col items-center gap-2.5 rounded-2xl outline-none transition-transform duration-300 hover:-translate-y-1.5 focus-visible:ring-2 focus-visible:ring-gold motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <span className="block aspect-square w-full max-w-[9.5rem] rounded-full bg-[conic-gradient(from_210deg,#f7c037,#8b5cf6,#f7c037)] p-[3px] shadow-[0_10px_24px_rgba(0,0,0,0.4)] transition-shadow duration-300 group-hover:shadow-[0_0_0_2px_rgba(247,192,55,0.5),0_0_28px_rgba(139,92,246,0.6),0_14px_30px_rgba(0,0,0,0.45)]">
              <CategoryTileImage
                entity={tile}
                alt=""
                className="h-full w-full rounded-full border-[3px] border-deep [&_img]:duration-500 [&_img]:group-hover:scale-110"
              />
            </span>
            <span className="line-clamp-2 text-center text-xs font-bold leading-snug text-white transition-colors group-hover:text-gold sm:text-sm">
              {locale === "ar" ? tile.titleAr : tile.title}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
