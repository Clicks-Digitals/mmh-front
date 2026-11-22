"use client";

import { FOCUS_RING, ICON_HIT } from "@/components/ui/control";
import { CurrencySelect } from "@/components/navigation/currency-select";
import { Logo } from "@/components/ui/logo";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { cn } from "@/lib/cn";
import { Globe, Menu, Search, ShoppingCart, User } from "lucide-react";
import { catalog } from "@/data/products";
import { getSnapshotCategories } from "@/lib/catalog-snapshot";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

/**
 * Store header: menu + search on the start side, the logo in the middle, and language,
 * currency, account and cart on the end side. Below it, the links staff put in the navbar.
 */
export function Header() {
  const { t, locale, setLocale } = useLanguage();
  const { itemCount, hydrated } = useCart();
  const { setSearchOpen, setCartOpen, setMobileNavOpen } = useUi();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const iconButton = cn(ICON_HIT, "mmh-neon-hover h-10 w-9 shrink-0 rounded-xl text-fg hover:bg-white/8 sm:w-10");
  const textButton = cn(
    "mmh-neon-hover inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-fg/85 transition-colors hover:bg-white/8 hover:text-fg",
    FOCUS_RING,
  );

  return (
    <header
      data-mmh-nav
      className={cn(
        "sticky top-0 z-[40] border-b transition-[box-shadow,background-color,border-color]",
        scrolled
          ? "border-line/80 bg-card/95 shadow-[0_10px_28px_rgba(23,24,43,0.18)] backdrop-blur-xl"
          : "border-transparent bg-card",
      )}
    >
      <div className="container-mmh grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-2 sm:h-[72px]">
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          <button type="button" className={cn(textButton, "shrink-0 px-1.5 text-[14px] font-semibold text-fg sm:px-2.5 sm:ps-2")} onClick={() => setMobileNavOpen(true)}>
            <Menu className="h-6 w-6 shrink-0" strokeWidth={2.25} aria-hidden />
            <span className="hidden sm:inline">{t("nav.menu")}</span>
            <span className="sr-only sm:hidden">{t("nav.menu")}</span>
          </button>
          <button type="button" className={iconButton} onClick={() => setSearchOpen(true)} aria-label={t("nav.search")}>
            <Search className="h-5 w-5" />
          </button>
          <CurrencySelect tone="compact" className="lg:hidden" />
        </div>

        <Logo className="justify-self-center max-[350px]:[&>span]:hidden" size={40} />

        <div className="flex min-w-0 items-center justify-end gap-0.5 sm:gap-1">
          <button
            type="button"
            className={cn(textButton, "hidden md:inline-flex")}
            onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
            aria-label={t("common.language")}
          >
            <Globe className="h-4 w-4 text-muted" aria-hidden />
            <span lang={locale === "ar" ? "en" : "ar"}>{locale === "ar" ? "English" : "العربية"}</span>
          </button>
          <CurrencySelect className="hidden lg:inline-flex" />
          <Link href="/account" className={iconButton} aria-label={t("nav.account")}>
            <User className="h-5 w-5" />
          </Link>
          <button type="button" className={cn(iconButton, "relative")} onClick={() => setCartOpen(true)} aria-label={t("nav.cart")}>
            <ShoppingCart className="h-5 w-5" />
            {hydrated && itemCount > 0 ? (
              <span className="absolute end-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold leading-none text-[#17182B]">
                {itemCount}
              </span>
            ) : null}
          </button>
        </div>
      </div>
      <NavbarLinks />
    </header>
  );
}

/** Categories, then products, that staff switched "Show in the navbar" on for. Hidden when none. */
function NavbarLinks() {
  const { locale } = useLanguage();
  const pathname = usePathname();
  const links = useMemo(() => {
    const categories = getSnapshotCategories()
      .filter((category) => category.showInNavbar)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
      .map((category) => ({ href: category.href, label: locale === "ar" ? category.nameAr || category.name : category.name }));
    const products = catalog()
      .filter((product) => product.showInNavbar)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((product) => ({ href: `/product/${product.slug}`, label: locale === "ar" ? product.nameAr || product.name : product.name }));
    return [...categories, ...products].filter((link, i, all) => all.findIndex((other) => other.href === link.href) === i);
  }, [locale]);

  if (!links.length) return null;
  return (
    <nav aria-label="Featured" className="border-t border-line/60">
      <ul className="container-mmh flex h-11 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:justify-center [&::-webkit-scrollbar]:hidden">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                className={cn(
                  "mmh-neon-hover inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium transition-colors",
                  FOCUS_RING,
                  active ? "bg-white/10 text-gold" : "text-fg/80 hover:bg-white/8 hover:text-fg",
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
