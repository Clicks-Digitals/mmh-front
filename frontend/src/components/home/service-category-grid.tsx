"use client";

import { CategoryTileImage } from "@/components/home/category-tile-image";
import { FOCUS_RING } from "@/components/ui/control";
import { HOME_SERVICE_TILES } from "@/data/home";
import { useLanguage } from "@/context/language-context";
import { cn } from "@/lib/cn";
import { catalog as liveCatalog } from "@/data/products";
import { getSnapshotCategories, getSnapshotMenuCategories } from "@/lib/catalog-snapshot";
import { homeCategoryTiles } from "@/lib/category-image";
import { hrefHasProducts } from "@/lib/listing";
import { buildMenu } from "@/lib/nav-menu";
import Link from "next/link";

/** D20: tiles from the admin menu categories (sorted); the built-in tiles when none are flagged / the API fails. */
export function ServiceCategoryGrid() {
  const { t, locale } = useLanguage();
  const products = liveCatalog();
  const categories = getSnapshotCategories();
  const { source, tiles } = homeCategoryTiles(
    buildMenu(getSnapshotMenuCategories(), categories, products),
    HOME_SERVICE_TILES,
    products,
    categories,
  );
  const visible = source === "menu" ? tiles : tiles.filter((tile) => hrefHasProducts(tile.href, products, categories));
  if (!visible.length) return null;

  return (
    <section className="container-mmh py-6 sm:py-8" aria-label={t("home.services")}>
      <h2 className="mb-5 text-center text-xl font-bold tracking-tight sm:mb-6 sm:text-2xl">{t("home.services")}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 lg:gap-8">
        {visible.map((tile) => {
          const label = tile.labelKey ? t(tile.labelKey) : locale === "ar" ? tile.labelAr || tile.label || "" : tile.label || "";
          if (source === "static") {
            return (
              <Link
                key={tile.id}
                href={tile.href}
                aria-label={label}
                className={cn("block transition duration-300 hover:brightness-110", FOCUS_RING, "rounded-lg")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={tile.images[0]} alt="" loading="lazy" decoding="async" className="h-auto w-full" />
              </Link>
            );
          }
          return (
            <Link
              key={tile.id}
              href={tile.href}
              className={cn(
                "group flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition hover:border-gold/40",
                FOCUS_RING,
              )}
            >
              <CategoryTileImage src={tile.images} alt="" artworkKey={tile.artworkKey} fit="contain" className="aspect-square w-full" />
              <span className="px-3 py-3 text-center text-sm font-semibold leading-5">{label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
