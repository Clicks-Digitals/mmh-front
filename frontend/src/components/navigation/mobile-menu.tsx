"use client";

import { LanguageSwitcher } from "@/components/navigation/language-switcher";
import { ICON_HIT } from "@/components/ui/control";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { CATEGORIES } from "@/data/categories";
import { useEscape, useScrollLock } from "@/hooks/use-overlay";
import { getSnapshotCategories, getSnapshotMenuCategories } from "@/lib/catalog-snapshot";
import { buildMenu, platformTiles } from "@/lib/nav-menu";
import { catalog } from "@/data/products";
import { hrefHasProducts } from "@/lib/listing";
import { cn } from "@/lib/cn";
import type { Category } from "@/types";
import { ChevronDown, ChevronRight, Heart, PackageSearch, Search, ShoppingBag, User, X } from "lucide-react";
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

type MenuRow = { key: string; label: string; href: string; children: Array<{ key: string; label: string; href: string }> };

/**
 * Top-level rows with their sub-items. A category without sub-categories lists the brands
 * (platforms) it sells, e.g. Gift cards → PlayStation, Steam, Apple…
 */
function buildMenuRows(locale: string): MenuRow[] {
  const flat = buildMenuCategories();
  const products = catalog();
  const snapshot = getSnapshotCategories();
  const label = (en: string, ar?: string) => (locale === "ar" ? ar || en : en);
  return flat
    .filter((category) => !category.parent)
    .map((category) => {
      let children = flat
        .filter((child) => child.parent === category.slug)
        .map((child) => ({ key: child.slug, label: label(child.name, child.nameAr), href: child.href }));
      if (!children.length) {
        const brands = platformTiles(category.slug, products, snapshot).filter((tile) => tile.href !== category.href);
        if (brands.length > 1) {
          children = brands.map((tile) => ({ key: tile.href, label: label(tile.label ?? "", tile.labelAr), href: tile.href }));
        }
      }
      return { key: category.slug, label: label(category.name, category.nameAr), href: category.href, children };
    });
}

function MobileMenuPanel() {
  const { mobileNavOpen, setMobileNavOpen, setSearchOpen } = useUi();
  const { t, locale } = useLanguage();
  const { data: session, status } = useSession();
  const signedIn = status === "authenticated" && session?.user?.kind === "CUSTOMER";
  const pathname = usePathname();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rows = useMemo(() => buildMenuRows(locale), [locale]);
  const active = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  // The row holding the current page starts open.
  const [open, setOpen] = useState<string | null>(
    () => rows.find((row) => row.children.some((child) => active(child.href)))?.key ?? null,
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

  const close = () => setMobileNavOpen(false);
  const rowClass = "flex min-h-[54px] w-full items-center justify-between gap-3 px-5 text-start text-[15px] font-semibold text-white transition hover:bg-white/5";

  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" className="absolute inset-0 bg-overlay/80 backdrop-blur-[3px]" aria-label={t("nav.close")} onClick={close} />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.mainMenu")}
        className="mmh-drawer-in absolute inset-y-0 start-0 flex h-full w-[min(90vw,420px)] flex-col bg-deep pt-[env(safe-area-inset-top)] shadow-2xl"
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 ps-5 pe-3">
          <p className="text-[15px] font-semibold text-white">{t("nav.mainMenu")}</p>
          <button
            ref={closeRef}
            type="button"
            className={cn(ICON_HIT, "h-10 w-10 text-white hover:bg-white/10")}
            onClick={close}
            aria-label={t("nav.close")}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain" aria-label={t("nav.menu")}>
          <div className="px-4 py-3">
            <button
              type="button"
              className="flex h-11 w-full items-center gap-3 rounded-xl bg-white/6 px-3.5 text-start text-[13px] text-white/60 transition hover:bg-white/10 hover:text-white"
              onClick={() => {
                close();
                setSearchOpen(true);
              }}
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="truncate">{t("common.searchPlaceholder")}</span>
            </button>
          </div>

          <ul className="border-t border-white/10">
            <li className="border-b border-white/10">
              <Link href="/" onClick={close} className={cn(rowClass, active("/") && pathname === "/" && "text-gold")}>
                {t("common.home")}
              </Link>
            </li>
            {rows.map((row) => {
              const expanded = open === row.key;
              if (!row.children.length) {
                return (
                  <li key={row.key} className="border-b border-white/10">
                    <Link href={row.href} onClick={close} className={cn(rowClass, active(row.href) && "text-gold")}>
                      <span className="min-w-0 truncate">{row.label}</span>
                    </Link>
                  </li>
                );
              }
              return (
                <li key={row.key} className="border-b border-white/10">
                  <button
                    type="button"
                    className={cn(rowClass, expanded && "bg-white/[0.04]")}
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : row.key)}
                  >
                    <span className="min-w-0 truncate">{row.label}</span>
                    <ChevronDown className={cn("h-5 w-5 shrink-0 text-white/60 transition-transform", expanded && "rotate-180 text-gold")} aria-hidden />
                  </button>
                  {expanded ? (
                    <ul className="bg-black/15 pb-2">
                      <li>
                        <Link
                          href={row.href}
                          onClick={close}
                          className="flex min-h-11 items-center justify-between px-5 ps-8 text-[14px] font-semibold text-gold hover:bg-white/5"
                        >
                          {t("nav.viewAll")}
                          <ChevronRight className="h-4 w-4 rtl-flip" aria-hidden />
                        </Link>
                      </li>
                      {row.children.map((child) => (
                        <li key={child.key}>
                          <Link
                            href={child.href}
                            onClick={close}
                            className={cn(
                              "flex min-h-11 items-center px-5 ps-8 text-[14px] text-white/80 hover:bg-white/5 hover:text-white",
                              active(child.href) && "font-semibold text-gold",
                            )}
                          >
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {/* ST-02: account, orders and wishlist are reachable on mobile. */}
          <ul className="grid grid-cols-2 gap-2 px-4 pt-4 text-sm">
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

          <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between gap-3">
              <LanguageSwitcher />
              <span className="rounded-lg bg-white/8 px-3 py-2 text-xs font-semibold text-white/70">{t("nav.currencyLabel")}</span>
            </div>
          </div>
        </nav>
      </aside>
    </div>
  );
}
