"use client";

import { LanguageSwitcher } from "@/components/navigation/language-switcher";
import { ICON_HIT } from "@/components/ui/control";
import { SITE } from "@/config/site";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { CATEGORIES } from "@/data/categories";
import { useEscape, useScrollLock } from "@/hooks/use-overlay";
import { getSnapshotCategories, getSnapshotMenuCategories } from "@/lib/catalog-snapshot";
import { buildMenu } from "@/lib/nav-menu";
import { catalog } from "@/data/products";
import { hrefHasProducts } from "@/lib/listing";
import { formatJod } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Category } from "@/types";
import { ChevronLeft, ChevronRight, Heart, PackageSearch, Search, ShoppingBag, User, X } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

function buildMenuCategories(): Category[] {
  const snapshot = getSnapshotCategories();
  const products = catalog();
  // D20: the admin-managed menu wins when any category is flagged "show in menu".
  const menu = buildMenu(getSnapshotMenuCategories(), snapshot, products);
  if (menu.length) {
    const flat: Category[] = [];
    for (const entry of menu) {
      const base = snapshot.find((category) => category.slug === entry.slug);
      flat.push({ ...(base ?? ({} as Category)), slug: entry.slug, name: entry.label, nameAr: entry.labelAr, href: entry.href, artworkKey: entry.artworkKey, description: base?.description ?? "", descriptionAr: base?.descriptionAr ?? "", parent: undefined });
      for (const child of entry.children) {
        const childBase = snapshot.find((category) => category.slug === child.slug);
        flat.push({ ...(childBase ?? ({} as Category)), slug: child.slug, name: child.label, nameAr: child.labelAr, href: child.href, artworkKey: child.artworkKey, description: childBase?.description ?? "", descriptionAr: childBase?.descriptionAr ?? "", parent: entry.slug });
      }
    }
    return flat;
  }
  // Curated tree + live root categories; every entry must lead to products.
  const bySlug = new Map(CATEGORIES.map((category) => [category.slug, category]));
  for (const category of snapshot) bySlug.set(category.slug, category);
  const all = Array.from(bySlug.values());
  const withProducts = all.filter((category) => hrefHasProducts(category.href, products, snapshot));
  const kept = new Set(withProducts.map((category) => category.slug));
  // Keep parents whose own listing is empty only if a child survives.
  const seenHref = new Set<string>();
  return all
    .filter((category) => kept.has(category.slug) || all.some((child) => child.parent === category.slug && kept.has(child.slug)))
    .filter((category) => !category.parent || kept.has(category.slug))
    .filter((category) => {
      // ST-24: one entry per destination (e.g. /deals listed once).
      const key = `${category.parent ?? ""}|${category.href}`;
      if (seenHref.has(key)) return false;
      seenHref.add(key);
      return true;
    });
}

export function MobileMenu() {
  const { mobileNavOpen } = useUi();
  return mobileNavOpen ? <MobileMenuPanel /> : null;
}

function MobileMenuPanel() {
  const { mobileNavOpen, setMobileNavOpen, setSearchOpen, setCartOpen } = useUi();
  const { t, locale } = useLanguage();
  const { itemCount, total, hydrated } = useCart();
  const { data: session, status } = useSession();
  const signedIn = status === "authenticated" && session?.user?.kind === "CUSTOMER";
  const pathname = usePathname();
  const [stack, setStack] = useState<string[]>([]);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const categories = useMemo(() => buildMenuCategories(), []);
  const currentParent = stack.at(-1);
  const currentCategory = categories.find((category) => category.slug === currentParent);
  const visibleCategories = useMemo(
    () => categories.filter((category) => (currentParent ? category.parent === currentParent : !category.parent)),
    [categories, currentParent],
  );

  useScrollLock(mobileNavOpen);
  useEscape(mobileNavOpen, () => setMobileNavOpen(false));

  useEffect(() => {
    if (!mobileNavOpen) return;
    closeRef.current?.focus();
    const dialog = dialogRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  const close = () => {
    setMobileNavOpen(false);
    setStack([]);
  };
  const active = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  const labelOf = (category: Category) => (locale === "ar" ? category.nameAr : category.name);

  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" className="absolute inset-0 bg-overlay/80 backdrop-blur-[2px]" aria-label={t("nav.close")} onClick={close} />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.menu")}
        className="absolute inset-y-0 start-0 flex h-full w-[min(88vw,360px)] flex-col bg-deep pt-[env(safe-area-inset-top)] shadow-2xl"
      >
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
          {currentParent ? (
            <button
              type="button"
              className={cn(ICON_HIT, "h-10 w-10 text-white hover:bg-white/10")}
              onClick={() => setStack((current) => current.slice(0, -1))}
              aria-label={t("common.back")}
            >
              <ChevronLeft className="h-5 w-5 rtl-flip" />
            </button>
          ) : (
            <p className="text-sm font-semibold text-white">{t("nav.mainMenu")}</p>
          )}
          {currentCategory ? (
            <p className="min-w-0 flex-1 truncate px-3 text-center text-sm font-semibold text-white">
              {labelOf(currentCategory)}
            </p>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            className={cn(ICON_HIT, "h-10 w-10 text-white hover:bg-white/10")}
            onClick={close}
            aria-label={t("nav.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto" aria-label={t("nav.menu")}>
          <button
            type="button"
            className="flex h-12 w-full items-center gap-3 border-b border-white/10 px-4 text-start text-sm text-white/65 transition hover:bg-white/5 hover:text-white"
            onClick={() => {
              close();
              setSearchOpen(true);
            }}
          >
            <Search className="h-4 w-4" />
            {t("common.searchPlaceholder")}
          </button>

          {currentParent ? (
            <Link
              href={currentCategory?.href ?? "/shop"}
              onClick={close}
              className="flex min-h-12 items-center justify-between border-b border-white/10 px-4 text-sm font-semibold text-gold"
            >
              <span>{t("nav.viewAll")}</span>
              <ChevronRight className="h-4 w-4 rtl-flip" />
            </Link>
          ) : (
            <Link
              href="/"
              onClick={close}
              className={cn(
                "flex min-h-12 items-center border-b border-white/10 px-4 text-sm font-medium text-white",
                active("/") && "bg-white/8 text-gold",
              )}
            >
              {t("common.home")}
            </Link>
          )}

          <ul>
            {visibleCategories.map((category) => {
              const children = categories.filter((item) => item.parent === category.slug);
              const hasChildren = children.length > 0;
              const name = labelOf(category);

              if (hasChildren) {
                return (
                  <li key={category.slug} className="border-b border-white/10">
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-start text-sm font-medium text-white transition hover:bg-white/5"
                      onClick={() => setStack((current) => [...current, category.slug])}
                    >
                      <span className="min-w-0 truncate">{name}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-white/80 rtl-flip" aria-hidden />
                    </button>
                  </li>
                );
              }

              return (
                <li key={category.slug} className="border-b border-white/10">
                  <Link
                    href={category.href}
                    onClick={close}
                    className={cn(
                      "flex min-h-12 items-center px-4 text-sm font-medium text-white transition hover:bg-white/5",
                      active(category.href) && "bg-white/8 text-gold",
                    )}
                  >
                    {name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* ST-02: account, orders and wishlist are reachable on mobile. */}
        <ul className="grid grid-cols-2 gap-2 border-t border-white/10 px-4 pt-3 text-sm">
          {[
            { href: signedIn ? "/account" : "/login", label: t(signedIn ? "nav.account" : "account.signIn"), icon: User },
            { href: signedIn ? "/account/orders" : "/order-lookup", label: t(signedIn ? "account.orders" : "footer.orderLookup"), icon: signedIn ? ShoppingBag : PackageSearch },
            { href: "/wishlist", label: t("nav.wishlist"), icon: Heart },
            ...(signedIn ? [{ href: "/order-lookup", label: t("footer.orderLookup"), icon: PackageSearch }] : [{ href: "/register", label: t("account.register"), icon: User }]),
          ].map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                onClick={close}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-xl bg-white/5 px-3 font-medium text-white hover:bg-white/10",
                  active(href) && "text-gold",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="border-t border-white/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <LanguageSwitcher />
            <span className="rounded-lg bg-white/8 px-3 py-2 text-xs font-semibold text-white/70">{SITE.currency}</span>
          </div>
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between rounded-xl bg-brand px-4 text-sm font-semibold text-white"
            onClick={() => {
              close();
              setCartOpen(true);
            }}
          >
            <span>
              {t("nav.cart")}
              {hydrated && itemCount ? ` (${itemCount})` : ""}
            </span>
            <span>{hydrated ? formatJod(total, locale) : SITE.currency}</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
