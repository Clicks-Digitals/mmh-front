"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/ui/price";
import { ProductCover } from "@/components/product/product-artwork";
import { Rating } from "@/components/ui/rating";
import { StockBadge } from "@/components/ui/stock-badge";
import { FOCUS_RING, ICON_HIT } from "@/components/ui/control";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { useWishlist } from "@/context/wishlist-context";
import { discountPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Product, ProductBadge } from "@/types";
import { ChevronLeft, ChevronRight, Eye, Heart, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const BADGE_KEYS: Record<ProductBadge, string> = {
  new: "common.new",
  bestseller: "common.bestseller",
  limited: "common.limited",
  sale: "common.sale",
  digital: "common.digital",
  region_locked: "common.regionLocked",
  topup: "common.topup",
};

export function ProductCard({
  product,
  layout = "grid",
  variant = "default",
}: {
  product: Product;
  layout?: "grid" | "list";
  variant?: "default" | "category";
}) {
  const { t, locale } = useLanguage();
  const { toggle, has } = useWishlist();
  const { openQuickView } = useUi();
  const wished = has(product.id);
  const sale = discountPercent(product.priceJod, product.compareAtPriceJod);
  const cardBadges = product.badges
    .filter((badge): badge is ProductBadge => badge in BADGE_KEYS && badge !== "digital")
    .slice(0, 2);
  const start = product.digitalOptions.denominations[0];
  const region = product.digitalOptions.regions[0];
  const list = layout === "list";

  if (variant === "category") {
    return (
      <article className="mmh-card group relative flex h-full flex-col overflow-hidden rounded-md border border-line/80 bg-card">
        <div className="relative overflow-hidden">
          <Link href={`/product/${product.slug}`} className="relative block">
            <div className="transition-transform duration-500 [@media(hover:hover)]:group-hover:scale-[1.03]">
              <ProductCover
                product={product}
                shot="cover"
                label={product.imageAlts?.[0] || (locale === "ar" ? product.nameAr : product.name)}
                showTypeBadge={false}
              />
            </div>
            {!product.inStock ? (
              <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-deep/55 text-sm font-semibold text-white">
                {t("common.outOfStock")}
              </span>
            ) : null}
          </Link>
          <div className="absolute start-2 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2 opacity-0 transition [@media(hover:hover)]:group-hover:opacity-100 sm:flex">
            <button
              type="button"
              className={cn(ICON_HIT, "h-9 w-9 border border-white/25 bg-deep/70 text-white backdrop-blur", wished && "text-gold")}
              onClick={() => toggle(product.id)}
              aria-label={t("common.wishlist")}
              aria-pressed={wished}
            >
              <Heart className={cn("h-4 w-4", wished && "fill-gold")} />
            </button>
            <button
              type="button"
              className={cn(ICON_HIT, "h-9 w-9 border border-white/25 bg-deep/70 text-white backdrop-blur")}
              onClick={() => openQuickView(product.slug)}
              aria-label={t("common.quickView")}
            >
              <Eye className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <span className="inline-flex w-fit max-w-full truncate rounded-sm bg-deep px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg">
            {locale === "ar" ? product.digitalOptions.platformLabelAr : product.digitalOptions.platformLabel}
          </span>
          <Link
            href={`/product/${product.slug}`}
            className="line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-fg transition hover:text-gold"
          >
            {locale === "ar" ? product.nameAr : product.name}
          </Link>
          <p className="line-clamp-1 text-xs text-muted">
            {locale === "ar" ? product.shortDescriptionAr : product.shortDescription}
          </p>
          <Price
            amount={product.priceJod}
            compareAt={product.compareAtPriceJod}
            locale={locale}
            size="sm"
            className="mt-auto [&>span:first-child]:text-fg [&>span:last-child]:text-muted"
          />
          <Link
            href={`/product/${product.slug}`}
            className={cn(
              "mt-1 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-fg/35 bg-transparent text-xs font-semibold text-fg transition hover:border-gold hover:text-gold",
              FOCUS_RING,
            )}
          >
            {product.inStock ? <Plus className="h-3.5 w-3.5" /> : null}
            {product.inStock ? t("common.viewOptions") : t("common.outOfStock")}
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "mmh-card group relative overflow-hidden rounded-[12px] border border-line bg-card transition-[border-color,box-shadow] [@media(hover:hover)]:hover:border-gold/38",
        list ? "grid grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[200px_minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)]" : "flex h-full flex-col",
      )}
    >
      <div className="relative min-h-0 overflow-hidden">
        <Link href={`/product/${product.slug}`} className="relative block h-full">
          <div className="h-full transition-transform duration-500 [@media(hover:hover)]:group-hover:scale-[1.04]">
            <ProductCover
              product={product}
              shot="cover"
              label={product.imageAlts?.[0] || (locale === "ar" ? product.nameAr : product.name)}
              showTypeBadge={false}
              className={list ? "aspect-auto h-full min-h-[132px] sm:min-h-[200px]" : undefined}
            />
          </div>
          <div
            className={cn(
              "pointer-events-none absolute start-2 top-2 z-10 flex flex-wrap gap-1 sm:start-3 sm:top-3 sm:gap-1.5",
              list ? "end-2 sm:end-3" : "end-12 sm:end-14",
            )}
          >
            {cardBadges.map((badge) => (
              <Badge key={badge} badge={badge} label={t(BADGE_KEYS[badge])} />
            ))}
            {sale && !cardBadges.includes("sale") ? <Badge badge="sale" label={`-${sale}%`} /> : null}
          </div>
          {!product.inStock ? (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-deep/80 py-1.5 text-center text-xs font-semibold text-white">
              {t("common.outOfStock")}
            </span>
          ) : null}
        </Link>
        {!list ? (
          <button
            type="button"
            className={cn(
              ICON_HIT,
              "absolute end-2 top-2 z-20 h-9 w-9 border border-line bg-elevated/90 backdrop-blur sm:end-3 sm:top-3",
              wished && "text-gold",
            )}
            onClick={() => toggle(product.id)}
            aria-label={t("common.wishlist")}
            aria-pressed={wished}
          >
            <Heart className={cn("h-4 w-4", wished && "fill-gold")} />
          </button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted sm:text-[11px]">
          {locale === "ar" ? product.digitalOptions.platformLabelAr : product.digitalOptions.platformLabel}
          {region ? ` · ${locale === "ar" ? region.nameAr : region.name}` : ""}
        </p>
        <Link href={`/product/${product.slug}`} className="mt-1 line-clamp-2 min-h-9 text-[13px] font-semibold leading-5 sm:min-h-10 sm:text-sm">
          {locale === "ar" ? product.nameAr : product.name}
        </Link>
        {start ? (
          <p className="mt-1 hidden text-xs text-muted sm:block">
            {locale === "ar" ? start.labelAr : start.label}
            {region?.currency ? ` · ${region.currency}` : ""}
          </p>
        ) : null}
        {product.reviewCount > 0 ? (
          <div className="mt-2 hidden sm:block">
            <Rating value={product.rating} count={product.reviewCount} reviewsLabel={t("common.reviews")} />
          </div>
        ) : null}
        <div className="mt-2 flex items-end justify-between gap-2 sm:mt-3 sm:gap-3">
          <Price amount={product.priceJod} compareAt={product.compareAtPriceJod} locale={locale} className="[&>span:first-child]:text-gold" />
          <span className="hidden sm:inline">
            <StockBadge
              inStock={product.inStock}
              inLabel={t("common.inStock")}
              lowLabel={t("common.lowStock")}
              outLabel={t("common.outOfStock")}
            />
          </span>
        </div>
        <div className={cn("mt-auto flex items-center gap-2 pt-3 sm:pt-4", list && "flex-wrap")}>
          <Button
            href={`/product/${product.slug}`}
            className={cn(
              "h-10 min-h-10 whitespace-nowrap px-3 text-center text-xs leading-none sm:h-11 sm:min-h-11 sm:px-4 sm:text-sm",
              list ? "w-auto min-w-[9.5rem] max-w-full" : "min-w-0 flex-1",
            )}
          >
            {product.inStock ? t("common.viewOptions") : t("common.outOfStock")}
          </Button>
          {list ? (
            <>
              <button
                type="button"
                className={cn(ICON_HIT, "h-10 w-10 shrink-0 border border-line bg-elevated sm:h-11 sm:w-11", wished && "text-gold")}
                onClick={() => toggle(product.id)}
                aria-label={t("common.wishlist")}
                aria-pressed={wished}
              >
                <Heart className={cn("h-4 w-4", wished && "fill-gold")} />
              </button>
              <button
                type="button"
                className={cn(ICON_HIT, "hidden h-10 w-10 shrink-0 border border-line sm:inline-flex sm:h-11 sm:w-11")}
                onClick={() => openQuickView(product.slug)}
                aria-label={t("common.quickView")}
              >
                <Eye className="h-4 w-4" />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function DigitalCard({ product }: { product: Product }) {
  return <ProductCard product={product} />;
}

export function ProductGrid({
  products,
  view = "grid",
  density = "default",
  cardVariant = "default",
}: {
  products: Product[];
  view?: "grid" | "list";
  density?: "default" | "dense";
  cardVariant?: "default" | "category";
}) {
  return (
    <div
      className={cn(
        view === "list"
          ? "space-y-3 sm:space-y-4"
          : density === "dense"
            ? "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
            : "grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4",
      )}
    >
      {products.map((product) => (
        <ProductCard key={product.id} product={product} layout={view} variant={cardVariant} />
      ))}
    </div>
  );
}

export function ProductRail({ products }: { products: Product[] }) {
  const { t } = useLanguage();
  const scroller = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(products.length > 1);
  const [overflow, setOverflow] = useState(products.length > 1);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;

    const sync = () => {
      const first = el.firstElementChild;
      const last = el.lastElementChild;
      if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) {
        setOverflow(false);
        setCanPrev(false);
        setCanNext(false);
        return;
      }
      const box = el.getBoundingClientRect();
      const firstBox = first.getBoundingClientRect();
      const lastBox = last.getBoundingClientRect();
      const rtl = getComputedStyle(el).direction === "rtl";
      const prev = rtl ? firstBox.right > box.right + 4 : firstBox.left < box.left - 4;
      const next = rtl ? lastBox.left < box.left - 4 : lastBox.right > box.right + 4;
      setCanPrev(prev);
      setCanNext(next);
      setOverflow(prev || next);
    };

    const observer = new ResizeObserver(sync);
    observer.observe(el);
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [products]);

  const scrollByCard = (direction: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    const card = el.firstElementChild;
    const amount = (card instanceof HTMLElement ? card.offsetWidth : el.clientWidth * 0.8) + 16;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: (rtl ? -direction : direction) * amount, behavior: "smooth" });
  };

  if (products.length === 0) return null;

  return (
    <div className="relative">
      <div
        ref={scroller}
        className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 pb-1"
      >
        {products.map((product) => (
          <div
            key={product.id}
            className="w-[min(248px,82vw)] shrink-0 snap-start sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-3rem)/4)]"
          >
            <ProductCard product={product} />
          </div>
        ))}
      </div>

      {overflow ? (
        <>
          {canNext ? (
            <div className="pointer-events-none absolute inset-y-0 end-0 hidden w-14 bg-gradient-to-l from-deep to-transparent sm:block rtl:bg-gradient-to-r" />
          ) : null}
          {canPrev ? (
            <div className="pointer-events-none absolute inset-y-0 start-0 hidden w-14 bg-gradient-to-r from-deep to-transparent sm:block rtl:bg-gradient-to-l" />
          ) : null}
          <button
            type="button"
            className={cn(
              ICON_HIT,
              "absolute start-1 top-1/2 z-10 hidden -translate-y-1/2 border border-white/15 bg-deep/90 text-fg shadow-lg backdrop-blur hover:border-gold hover:text-gold disabled:pointer-events-none disabled:opacity-30 sm:inline-flex",
            )}
            onClick={() => scrollByCard(-1)}
            disabled={!canPrev}
            aria-label={t("common.previous")}
          >
            <ChevronLeft className="h-5 w-5 rtl-flip" />
          </button>
          <button
            type="button"
            className={cn(
              ICON_HIT,
              "absolute end-1 top-1/2 z-10 hidden -translate-y-1/2 border border-white/15 bg-deep/90 text-fg shadow-lg backdrop-blur hover:border-gold hover:text-gold disabled:pointer-events-none disabled:opacity-30 sm:inline-flex",
            )}
            onClick={() => scrollByCard(1)}
            disabled={!canNext}
            aria-label={t("common.next")}
          >
            <ChevronRight className="h-5 w-5 rtl-flip" />
          </button>
        </>
      ) : null}
    </div>
  );
}
