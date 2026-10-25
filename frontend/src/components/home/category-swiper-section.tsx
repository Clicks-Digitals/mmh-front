"use client";

import { CategoryTileImage } from "@/components/home/category-tile-image";
import { FOCUS_RING, ICON_HIT } from "@/components/ui/control";
import { HOME_CATEGORY_SWIPER } from "@/data/home";
import { useLanguage } from "@/context/language-context";
import { useEscape, useScrollLock } from "@/hooks/use-overlay";
import { cn } from "@/lib/cn";
import { X } from "lucide-react";
import { catalog as liveCatalog } from "@/data/products";
import { getSnapshotCategories, getSnapshotMenuCategories } from "@/lib/catalog-snapshot";
import { hrefHasProducts } from "@/lib/listing";
import { buildMenu } from "@/lib/nav-menu";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

const hasProducts = (href: string) => hrefHasProducts(href, liveCatalog(), getSnapshotCategories());

type TileChild = { href: string; label: string; image?: string; artworkKey: string };
type CategoryItem = { id: string; label: string; image?: string; artworkKey: string; children: TileChild[] };

/**
 * D20: home category tiles come from the admin menu categories (sorted); the built-in set is the
 * fallback when no category is flagged "show in menu".
 */
function homeTiles(t: (key: string) => string, locale: "en" | "ar"): CategoryItem[] {
  const menu = buildMenu(getSnapshotMenuCategories(), getSnapshotCategories(), liveCatalog());
  if (menu.length) {
    return menu.map((entry) => {
      const label = locale === "ar" ? entry.labelAr : entry.label;
      const children = entry.children.length
        ? [
            ...entry.children.map((child) => ({
              href: child.href,
              label: locale === "ar" ? child.labelAr : child.label,
              image: child.artworkUrl,
              artworkKey: child.artworkKey,
            })),
            { href: entry.href, label: t("nav.viewAll"), image: entry.artworkUrl, artworkKey: entry.artworkKey },
          ]
        : [{ href: entry.href, label, image: entry.artworkUrl, artworkKey: entry.artworkKey }];
      return { id: entry.slug, label, image: entry.artworkUrl, artworkKey: entry.artworkKey, children };
    });
  }
  return HOME_CATEGORY_SWIPER.map((item) => ({
    id: item.id,
    label: t(item.labelKey),
    image: item.image,
    artworkKey: item.artworkKey,
    children: item.children.map((child) => ({ href: child.href, label: t(child.labelKey), image: child.image, artworkKey: child.artworkKey })),
  }));
}

export function CategorySwiperSection() {
  const { t, locale } = useLanguage();
  const [active, setActive] = useState<CategoryItem | null>(null);
  const close = useCallback(() => setActive(null), []);

  useScrollLock(Boolean(active));
  useEscape(Boolean(active), close);

  const loop = useMemo(() => {
    const available = homeTiles(t, locale).filter((item) => item.children.some((child) => hasProducts(child.href)));
    return [...available, ...available];
  }, [t, locale]);

  if (!loop.length) return null;

  return (
    <section className="py-6 sm:py-8" aria-label={t("home.categoriesTitle")}>
      <div className="container-mmh mb-5 sm:mb-6">
        <h2 className="text-center text-xl font-bold tracking-tight sm:text-2xl">{t("home.categoriesTitle")}</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted">{t("home.categoriesSubtitle")}</p>
      </div>

      <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_5%,black_95%,transparent)]">
        <div
          className={cn(
            "category-marquee flex w-max gap-5 pe-5 sm:gap-7 sm:pe-7 lg:gap-8 lg:pe-8",
            active && "category-marquee-paused",
          )}
        >
          {loop.map((item, index) => (
            <button
              key={`${item.id}-${index}`}
              type="button"
              onClick={() => setActive(item)}
              className={cn(
                "group flex w-[min(42vw,11.5rem)] shrink-0 flex-col items-center gap-3 rounded-2xl sm:w-[min(28vw,14.5rem)] lg:w-[min(22vw,17rem)]",
                FOCUS_RING,
              )}
            >
              <span className="relative aspect-square w-full rounded-full bg-[radial-gradient(circle_at_35%_30%,#3a3b63,#17182b_70%)] p-[3px] shadow-[0_0_0_1px_rgba(247,192,55,0.35),0_12px_28px_rgba(0,0,0,0.35)] transition group-hover:shadow-[0_0_0_2px_rgba(247,192,55,0.55),0_16px_36px_rgba(0,0,0,0.4)] sm:p-[4px]">
                <span className="relative block h-full w-full overflow-hidden rounded-full border border-brand/40 bg-[#17182b]">
                  <CategoryTileImage
                    src={item.image}
                    alt=""
                    artworkKey={item.artworkKey}
                    className="h-full w-full"
                  />
                </span>
              </span>
              <span className="line-clamp-2 min-h-8 text-center text-sm font-semibold leading-4 text-fg sm:min-h-10 sm:text-base sm:leading-5 lg:text-lg">
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {active ? (
        <div className="fixed inset-0 z-[80] flex flex-col bg-deep" role="dialog" aria-modal="true" aria-label={active.label}>
          <div className="flex items-center justify-between border-b border-line px-4 py-4 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">MMH</p>
              <h3 className="mt-1 text-xl font-bold sm:text-2xl">{active.label}</h3>
            </div>
            <button type="button" className={cn(ICON_HIT, "h-11 w-11")} onClick={close} aria-label={t("common.close")}>
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
            <p className="mb-5 text-sm text-muted">{t("home.categoriesModalHint")}</p>
            <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
              {active.children.filter((child) => hasProducts(child.href)).map((child) => (
                <Link
                  key={child.href + child.label}
                  href={child.href}
                  onClick={close}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-card transition hover:border-gold/40"
                >
                  <span className="relative aspect-square overflow-hidden bg-[#17182b]">
                    <CategoryTileImage
                      src={child.image}
                      alt=""
                      artworkKey={child.artworkKey}
                      className="h-full w-full transition duration-300 group-hover:scale-[1.04]"
                    />
                  </span>
                  <span className="px-3 py-3 text-center text-sm font-semibold leading-5">{child.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
