"use client";

import { FOCUS_RING, ICON_HIT } from "@/components/ui/control";
import { Logo } from "@/components/ui/logo";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { cn } from "@/lib/cn";
import { Globe, Menu, Search, ShoppingCart, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Store header: menu + search on the start side, the logo in the middle, and language,
 * currency, account and cart on the end side. All navigation lives in the side menu.
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

  const iconButton = cn(ICON_HIT, "h-10 w-10 rounded-xl text-fg hover:bg-white/8");
  const textButton = cn(
    "inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-fg/85 transition-colors hover:bg-white/8 hover:text-fg",
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
          <button type="button" className={cn(textButton, "ps-2 text-[14px] font-semibold text-fg")} onClick={() => setMobileNavOpen(true)}>
            <Menu className="h-6 w-6" strokeWidth={2.25} aria-hidden />
            <span className="hidden sm:inline">{t("nav.menu")}</span>
            <span className="sr-only sm:hidden">{t("nav.menu")}</span>
          </button>
          <button type="button" className={iconButton} onClick={() => setSearchOpen(true)} aria-label={t("nav.search")}>
            <Search className="h-5 w-5" />
          </button>
        </div>

        <Logo className="justify-self-center" size={40} />

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
          <span className="hidden h-10 items-center px-2 text-[13px] font-medium text-muted lg:inline-flex">{t("nav.currencyLabel")}</span>
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
    </header>
  );
}
