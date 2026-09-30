"use client";

import { CategoryArtwork, ProductCover } from "@/components/product/product-artwork";
import { Price } from "@/components/ui/price";
import { FOCUS_RING, ICON_HIT } from "@/components/ui/control";
import { CATEGORIES, HOME_CATEGORIES } from "@/data/categories";
import { TRENDING_SEARCHES } from "@/data/navigation";
import { searchProducts } from "@/data/products";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { useDebouncedValue } from "@/hooks/use-client";
import { useEscape, useScrollLock } from "@/hooks/use-overlay";
import { STORAGE_KEYS } from "@/lib/storage";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/cn";
import { getSnapshotCategories } from "@/lib/catalog-snapshot";
import { ArrowRight, Clock, Search, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

function chipClass(active = false) {
  return cn(
    "inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors",
    FOCUS_RING,
    active
      ? "border-gold bg-brand/20 text-fg"
      : "border-line bg-card text-muted hover:bg-brand/16 hover:text-gold",
  );
}

export function SearchOverlay() {
  const { searchOpen, setSearchOpen } = useUi();
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useLocalStorage<string[]>(STORAGE_KEYS.recentSearches, []);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebouncedValue(query, 220);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setActive(-1);
  };

  useScrollLock(searchOpen);
  useEscape(searchOpen, closeSearch);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  const products = useMemo(() => searchProducts(debounced).slice(0, 6), [debounced]);
  const categories = useMemo(() => {
    const databaseCategories = getSnapshotCategories();
    const catalog = databaseCategories.length ? databaseCategories : CATEGORIES;
    if (!debounced) {
      return HOME_CATEGORIES.map((slug) => catalog.find((category) => category.slug === slug)).filter(
        (category): category is (typeof catalog)[number] => Boolean(category),
      );
    }
    const q = debounced.toLowerCase();
    return catalog.filter(
      (category) => category.name.toLowerCase().includes(q) || category.nameAr.includes(debounced),
    ).slice(0, 4);
  }, [debounced]);

  const remember = (value: string) => {
    setRecent((current) => [value, ...current.filter((item) => item !== value)].slice(0, 6));
  };

  const goSearch = (value: string) => {
    const next = value.trim();
    if (!next) return;
    remember(next);
    closeSearch();
    router.push(`/search?q=${encodeURIComponent(next)}`);
  };

  if (!searchOpen) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={t("nav.search")}>
      <button type="button" className="absolute inset-0 bg-overlay" aria-label={t("common.close")} onClick={closeSearch} />
      <div className="relative mx-auto mt-0 flex h-full w-full flex-col overflow-hidden bg-card pt-[env(safe-area-inset-top)] shadow-[0_24px_80px_rgba(16,17,31,0.55)] sm:mt-16 sm:h-auto sm:max-h-[min(84vh,720px)] sm:w-[min(100%-1.5rem,820px)] sm:rounded-[18px] sm:border sm:border-line sm:pt-0">
        <form
          className="flex items-center gap-3 border-b border-line bg-elevated px-4 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            goSearch(query);
          }}
        >
          <Search className="h-5 w-5 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(-1);
            }}
            onKeyDown={(event) => {
              const total = products.length + categories.length;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((current) => Math.min(total - 1, current + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => Math.max(-1, current - 1));
              }
            }}
            placeholder={t("common.searchPlaceholder")}
            className="h-16 w-full bg-transparent px-0 text-base text-fg outline-none placeholder:text-subtle focus:border-0 focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            aria-label={t("nav.search")}
          />
          {query ? (
            <button type="button" className={cn("text-xs text-muted hover:text-fg", FOCUS_RING, "rounded-md px-2 py-1")} onClick={() => setQuery("")}>
              {t("search.clear")}
            </button>
          ) : (
            <kbd className="hidden rounded-md border border-line bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted sm:inline">⌘K</kbd>
          )}
          <button type="button" className={ICON_HIT} onClick={closeSearch} aria-label={t("common.close")}>
            <X className="h-5 w-5" />
          </button>
        </form>

        <div className="flex-1 overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
          {!debounced ? (
            <div className="space-y-8">
              {recent.length > 0 ? (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{t("search.recent")}</p>
                    <button
                      type="button"
                      className={cn("text-xs text-muted hover:text-fg", FOCUS_RING, "rounded-md px-1.5 py-1")}
                      onClick={() => setRecent([])}
                    >
                      {t("search.clearRecent")}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recent.map((item) => (
                      <button key={item} type="button" className={chipClass()} onClick={() => goSearch(item)}>
                        <Clock className="h-3.5 w-3.5 text-muted" />
                        {item}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                  <TrendingUp className="h-3.5 w-3.5 text-gold" />
                  {t("search.trending")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {TRENDING_SEARCHES.map((item) => (
                    <button key={item} type="button" className={chipClass()} onClick={() => goSearch(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{t("search.suggested")}</p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {categories.map((category) => (
                    <Link
                      key={category.slug}
                      href={category.href}
                      className={cn(
                        "group overflow-hidden rounded-[14px] border border-line bg-card transition-colors hover:border-gold/40",
                        FOCUS_RING,
                      )}
                      onClick={closeSearch}
                    >
                      <CategoryArtwork artworkKey={category.artworkKey} className="aspect-[16/10]" />
                      <p className="px-3 py-2.5 text-sm font-medium group-hover:text-gold">
                        {locale === "ar" ? category.nameAr : category.name}
                      </p>
                    </Link>
                  ))}
                </div>
              </section>
            </div>
          ) : products.length === 0 && categories.length === 0 ? (
            <div className="py-10 text-center">
              <Search className="mx-auto h-8 w-8 text-muted" />
              <p className="mt-3 text-sm text-muted">{t("search.empty")}</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {TRENDING_SEARCHES.slice(0, 4).map((item) => (
                  <button key={item} type="button" className={chipClass()} onClick={() => goSearch(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {categories.length > 0 ? (
                <section>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{t("search.categories")}</p>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((category, index) => (
                      <Link
                        key={category.slug}
                        href={category.href}
                        className={chipClass(active === index)}
                        onClick={closeSearch}
                      >
                        {locale === "ar" ? category.nameAr : category.name}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
              <section>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{t("search.products")}</p>
                <div className="space-y-1.5">
                  {products.map((product, index) => {
                    const highlight = active === categories.length + index;
                    return (
                      <Link
                        key={product.id}
                        href={`/product/${product.slug}`}
                        className={cn(
                          "flex items-center gap-3 rounded-[14px] border border-transparent p-2 hover:bg-brand/16",
                          FOCUS_RING,
                          highlight && "border-gold/40 bg-brand/20",
                        )}
                        onClick={() => {
                          remember(query);
                          closeSearch();
                        }}
                      >
                        <div className="h-14 w-14 overflow-hidden rounded-[10px] border border-line">
                          <ProductCover product={product} compact />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{locale === "ar" ? product.nameAr : product.name}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {[
                              locale === "ar" ? product.digitalOptions.platformLabelAr : product.digitalOptions.platformLabel,
                              locale === "ar" ? product.digitalOptions.regions[0]?.nameAr : product.digitalOptions.regions[0]?.name,
                              product.fulfillmentType === "direct_topup" ? t("common.topup") : t("common.instant"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <Price amount={product.priceJod} locale={locale} size="sm" />
                      </Link>
                    );
                  })}
                </div>
                <Link
                  href={`/search?q=${encodeURIComponent(debounced)}`}
                  className={cn("mt-4 inline-flex items-center gap-2 text-sm text-gold hover:underline", FOCUS_RING, "rounded-md")}
                  onClick={() => {
                    remember(debounced);
                    closeSearch();
                  }}
                >
                  {t("search.viewAll")}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                </Link>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
