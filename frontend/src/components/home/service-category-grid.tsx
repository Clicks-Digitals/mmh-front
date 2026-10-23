"use client";

import { FOCUS_RING } from "@/components/ui/control";
import { HOME_SERVICE_TILES } from "@/data/home";
import { useLanguage } from "@/context/language-context";
import { cn } from "@/lib/cn";
import { catalog as liveCatalog } from "@/data/products";
import { getSnapshotCategories } from "@/lib/catalog-snapshot";
import { hrefHasProducts } from "@/lib/listing";
import Link from "next/link";

export function ServiceCategoryGrid() {
  const { t } = useLanguage();

  return (
    <section className="container-mmh py-6 sm:py-8" aria-label={t("home.services")}>
      <h2 className="mb-5 text-center text-xl font-bold tracking-tight sm:mb-6 sm:text-2xl">{t("home.services")}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 lg:gap-8">
        {HOME_SERVICE_TILES.filter((tile) => hrefHasProducts(tile.href, liveCatalog(), getSnapshotCategories())).map((tile) => (
          <Link
            key={tile.id}
            href={tile.href}
            aria-label={t(tile.labelKey)}
            className={cn(
              "block transition duration-300 hover:brightness-110",
              FOCUS_RING,
              "rounded-lg",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tile.image}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-auto w-full"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
