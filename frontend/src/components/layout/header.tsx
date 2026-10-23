"use client";

import { DesktopNav } from "@/components/navigation/desktop-nav";
import { LanguageSwitcher } from "@/components/navigation/language-switcher";
import { ICON_HIT } from "@/components/ui/control";
import { Logo } from "@/components/ui/logo";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { cn } from "@/lib/cn";
import { formatJod } from "@/lib/format";
import { Menu, Search, ShoppingBag, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function Header() {
  const { t, locale } = useLanguage();
  const { itemCount, total, hydrated } = useCart();
  const { setSearchOpen, setCartOpen, setMobileNavOpen } = useUi();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-mmh-nav
      className={cn(
        "sticky top-0 z-[40] border-b border-line/80 bg-card transition-[box-shadow,background-color]",
        scrolled ? "bg-card/98 shadow-[0_10px_28px_rgba(23,24,43,0.1)] backdrop-blur-xl" : "shadow-none",
      )}
    >
      <div className="container-mmh flex h-16 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <button
            type="button"
            className={cn(ICON_HIT, "h-10 w-10 rounded-xl border border-line bg-elevated text-fg hover:border-brand/30 hover:bg-brand/10 sm:h-11 sm:w-11")}
            onClick={() => setMobileNavOpen(true)}
            aria-label={t("nav.menu")}
          >
            <Menu className="h-5 w-5" strokeWidth={2.25} />
          </button>
          <Logo className="min-w-0" size={40} />
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            className={cn(ICON_HIT, "h-10 w-10 rounded-xl sm:h-11 sm:w-11")}
            onClick={() => setSearchOpen(true)}
            aria-label={t("nav.search")}
          >
            <Search className="h-5 w-5" />
          </button>
          <div className="hidden sm:block">
            <LanguageSwitcher compact />
          </div>
          <Link
            href="/account"
            className={cn(ICON_HIT, "hidden h-10 w-10 rounded-xl sm:inline-flex sm:h-11 sm:w-11")}
            aria-label={t("nav.account")}
          >
            <User className="h-5 w-5" />
          </Link>
          <button
            type="button"
            className="relative ms-0.5 flex min-h-10 items-center gap-2.5 rounded-xl border border-line bg-elevated px-2.5 py-1.5 transition-colors hover:border-brand/30 hover:bg-brand/10 sm:min-h-11 sm:px-3"
            onClick={() => setCartOpen(true)}
            aria-label={t("nav.cart")}
          >
            <span className="relative">
              <ShoppingBag className="h-5 w-5 text-fg" />
              {hydrated && itemCount > 0 ? (
                <span className="absolute -end-2 -top-2 min-w-4 rounded-full bg-gold px-1 text-[10px] font-bold leading-4 text-brand-deep">
                  {itemCount}
                </span>
              ) : null}
            </span>
            <span className="hidden text-start sm:block">
              <span className="block text-[11px] leading-none text-muted">{t("nav.cart")}</span>
              <span className="mt-1 block text-xs font-semibold leading-none text-fg">
                {hydrated ? formatJod(total, locale) : formatJod(0, locale)}
              </span>
            </span>
          </button>
        </div>
      </div>
      <DesktopNav />
    </header>
  );
}
