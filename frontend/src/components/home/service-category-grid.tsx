"use client";

import { CategoryTileImage } from "@/components/home/category-tile-image";
import { FOCUS_RING } from "@/components/ui/control";
import { useLanguage } from "@/context/language-context";
import { cn } from "@/lib/cn";
import { catalog as liveCatalog } from "@/data/products";
import { getSnapshotCategories, getSnapshotMenuCategories } from "@/lib/catalog-snapshot";
import { buildMenu } from "@/lib/nav-menu";
import Link from "next/link";

/**
 * D20: tiles from the admin menu categories (sorted). Each shows the category's uploaded picture,
 * else its built-in picture. No menu categories → no section (nothing hard-coded).
 */
export function ServiceCategoryGrid() {
  const { t, locale } = useLanguage();
  const tiles = buildMenu(getSnapshotMenuCategories(), getSnapshotCategories(), liveCatalog());
  if (!tiles.length) return null;
  return (
    <section className="container-mmh py-6 sm:py-8" aria-label={t("home.services")}>
      <h2 className="mb-5 text-center text-xl font-bold tracking-tight sm:mb-6 sm:text-2xl">{t("home.services")}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 lg:gap-8">
        {tiles.map((tile) => (
          <Link
            key={tile.slug}
            href={tile.href}
            className={cn(
              "group flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition hover:border-gold/40",
              FOCUS_RING,
            )}
          >
            <CategoryTileImage
              entity={{ imageUrl: tile.imageUrl, artworkKey: tile.artworkKey, slug: tile.slug }}
              alt=""
              fit="contain"
              className="aspect-square w-full"
            />
            <span className="px-3 py-3 text-center text-sm font-semibold leading-5">
              {locale === "ar" ? tile.labelAr || tile.label : tile.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
