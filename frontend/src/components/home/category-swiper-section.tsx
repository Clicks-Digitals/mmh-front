"use client";

import { CategoryTileImage } from "@/components/home/category-tile-image";
import { FOCUS_RING, ICON_HIT } from "@/components/ui/control";
import { useLanguage } from "@/context/language-context";
import { useEscape, useScrollLock } from "@/hooks/use-overlay";
import { cn } from "@/lib/cn";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { catalog as liveCatalog } from "@/data/products";
import { getSnapshotCategories, getSnapshotMenuCategories } from "@/lib/catalog-snapshot";
import { hrefHasProducts } from "@/lib/listing";
import type { ArtworkSource } from "@/lib/builtin-artwork";
import { buildMenu, type MenuEntry } from "@/lib/nav-menu";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const hasProducts = (href: string) => hrefHasProducts(href, liveCatalog(), getSnapshotCategories());

type TileChild = { href: string; label: string; picture: ArtworkSource };
type CategoryItem = { id: string; label: string; picture: ArtworkSource; children: TileChild[] };

/** A menu category's own picture (uploaded, else its built-in one) — never a product photo. */
const pictureOf = (entry: MenuEntry): ArtworkSource => ({ imageUrl: entry.imageUrl, artworkKey: entry.artworkKey, slug: entry.slug });

/** D20: home category tiles = the admin menu categories (sorted). No menu categories → no section. */
function homeTiles(t: (key: string) => string, locale: "en" | "ar"): CategoryItem[] {
  const menu = buildMenu(getSnapshotMenuCategories(), getSnapshotCategories(), liveCatalog());
  return menu.map((entry) => {
    const label = locale === "ar" ? entry.labelAr : entry.label;
    const children = entry.children.length
      ? [
          ...entry.children.map((child) => ({
            href: child.href,
            label: locale === "ar" ? child.labelAr : child.label,
            picture: pictureOf(child),
          })),
          { href: entry.href, label: t("nav.viewAll"), picture: pictureOf(entry) },
        ]
      : [{ href: entry.href, label, picture: pictureOf(entry) }];
    return { id: entry.slug, label, picture: pictureOf(entry), children };
  });
}

export function CategorySwiperSection() {
  const { t, locale } = useLanguage();
  const [active, setActive] = useState<CategoryItem | null>(null);
  const close = useCallback(() => setActive(null), []);

  useScrollLock(Boolean(active));
  useEscape(Boolean(active), close);

  const items = useMemo(
    () => homeTiles(t, locale).filter((item) => item.children.some((child) => hasProducts(child.href))),
    [t, locale],
  );
  const trackRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const rtl = locale === "ar";

  /** Slide by about one screen; wraps to the start at the end. `dir` 1 = forward in reading order. */
  const slide = useCallback(
    (dir: 1 | -1) => {
      const track = trackRef.current;
      if (!track) return;
      const max = track.scrollWidth - track.clientWidth;
      if (max <= 0) return;
      const sign = rtl ? -1 : 1; // RTL scrollLeft runs from 0 to -max
      const position = Math.abs(track.scrollLeft);
      const step = Math.max(track.clientWidth * 0.8, 160);
      let next = position + dir * step;
      if (dir === 1 && position >= max - 4) next = 0;
      else if (dir === -1 && position <= 4) next = max;
      track.scrollTo({ left: sign * Math.min(Math.max(next, 0), max), behavior: "smooth" });
    },
    [rtl],
  );

  // Moves on its own; stops while hovered, focused or a category is open.
  useEffect(() => {
    if (paused || active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => slide(1), 3500);
    return () => window.clearInterval(id);
  }, [paused, active, slide]);

  if (!items.length) return null;

  return (
    <section className="py-6 sm:py-8" aria-label={t("home.categoriesTitle")}>
      <div className="container-mmh mb-5 sm:mb-6">
        <h2 className="text-center text-xl font-bold tracking-tight sm:text-2xl">{t("home.categoriesTitle")}</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted">{t("home.categoriesSubtitle")}</p>
      </div>

      <div
        className="group/slider relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
      >
        <div
          ref={trackRef}
          className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-[6vw] pb-3 pt-2 [scrollbar-width:none] sm:gap-7 lg:gap-8 [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(item)}
              className={cn(
                "group flex w-[min(38vw,10.5rem)] shrink-0 snap-center flex-col items-center gap-3 rounded-2xl transition-transform duration-300 ease-out hover:-translate-y-1.5 sm:w-[min(26vw,13rem)] lg:w-[min(18vw,15rem)]",
                FOCUS_RING,
              )}
            >
              <span className="relative aspect-square w-full rounded-full bg-[radial-gradient(circle_at_35%_30%,#3a3b63,#17182b_70%)] p-[3px] shadow-[0_0_0_1px_rgba(247,192,55,0.35),0_12px_28px_rgba(0,0,0,0.35)] transition-[box-shadow] duration-300 group-hover:shadow-[0_0_0_2px_rgba(247,192,55,0.8),0_0_28px_rgba(139,92,246,0.55),0_18px_40px_rgba(0,0,0,0.45)] sm:p-[4px]">
                <span className="relative block h-full w-full overflow-hidden rounded-full border border-brand/40 bg-[#17182b]">
                  <span className="block h-full w-full transition-transform duration-500 ease-out group-hover:scale-110">
                    <CategoryTileImage entity={item.picture} alt="" className="h-full w-full" />
                  </span>
                </span>
              </span>
              <span className="line-clamp-2 min-h-8 text-center text-sm font-semibold leading-4 text-fg transition-colors group-hover:text-gold sm:min-h-10 sm:text-base sm:leading-5 lg:text-lg">
                {item.label}
              </span>
            </button>
          ))}
        </div>
        {items.length > 1 ? (
          <>
            <button
              type="button"
              aria-label={t("slider.previous")}
              onClick={() => slide(-1)}
              className={cn(
                ICON_HIT,
                "absolute start-2 top-[40%] z-10 h-11 w-11 -translate-y-1/2 rounded-full border border-white/15 bg-deep/80 text-white shadow-lg backdrop-blur transition hover:border-gold/60 hover:text-gold sm:start-4",
              )}
            >
              <ChevronLeft className="h-5 w-5 rtl-flip" />
            </button>
            <button
              type="button"
              aria-label={t("slider.next")}
              onClick={() => slide(1)}
              className={cn(
                ICON_HIT,
                "absolute end-2 top-[40%] z-10 h-11 w-11 -translate-y-1/2 rounded-full border border-white/15 bg-deep/80 text-white shadow-lg backdrop-blur transition hover:border-gold/60 hover:text-gold sm:end-4",
              )}
            >
              <ChevronRight className="h-5 w-5 rtl-flip" />
            </button>
          </>
        ) : null}
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
                      entity={child.picture}
                      alt=""
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
