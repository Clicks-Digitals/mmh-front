"use client";

import { CurrencySelect } from "@/components/navigation/currency-select";
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
import { ChevronDown, Heart, PackageSearch, ShoppingBag, User, UserPlus, X } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

function buildMenuCategories(): Category[] {
  const snapshot = getSnapshotCategories();
  const products = catalog();
  // D20: the admin-managed menu wins when any category is flagged "show in menu".
  const menu = buildMenu(getSnapshotMenuCategories(), snapshot, products, { includeEmpty: true });
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

type MenuRow = { key: string; label: string; href: string; external?: boolean; children: MenuRow[] };

const MAX_DEPTH = 3;

/**
 * The category part of the menu, up to three levels (e.g. PlayStation Plus → PS5 Plus →
 * Essential). Sub-levels come from the category tree in the panel; a top category without
 * sub-categories lists the brands (platforms) it sells, e.g. Gift cards → PlayStation, Steam…
 */
function buildMenuRows(locale: string): MenuRow[] {
  const flat = buildMenuCategories();
  const products = catalog();
  const snapshot = getSnapshotCategories();
  // Staff-built menu (D20): show every published sub-category, even before it has products.
  const adminMenu = getSnapshotMenuCategories().some((category) => category.showInMenu !== false);
  const pool = [...snapshot, ...flat.filter((c) => !snapshot.some((s) => s.slug === c.slug))];
  const label = (en: string, ar?: string) => (locale === "ar" ? ar || en : en);
  const bySort = (a: Category, b: Category) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);
  const seen = new Set<string>();

  const childrenOf = (slug: string, depth: number, fromMenu: Category[]): MenuRow[] => {
    if (depth >= MAX_DEPTH) return [];
    const source = fromMenu.length ? fromMenu : pool.filter((c) => c.parent === slug).sort(bySort);
    return source
      .filter((c) => !seen.has(`${slug}>${c.slug}`) && (adminMenu || hrefHasProducts(c.href, products, snapshot)))
      .map((c) => {
        seen.add(`${slug}>${c.slug}`);
        return { key: `${slug}>${c.slug}`, label: label(c.name, c.nameAr), href: c.href, children: childrenOf(c.slug, depth + 1, []) };
      });
  };

  return flat
    .filter((category) => !category.parent)
    .map((category) => {
      let children = childrenOf(category.slug, 1, flat.filter((c) => c.parent === category.slug));
      if (!children.length) {
        const brands = platformTiles(category.slug, products, snapshot).filter((tile) => tile.href !== category.href);
        if (brands.length > 1) {
          children = brands.map((tile) => ({ key: `${category.slug}>${tile.href}`, label: label(tile.label ?? "", tile.labelAr), href: tile.href, children: [] }));
        }
      }
      return { key: category.slug, label: label(category.name, category.nameAr), href: category.href, children };
    });
}

export function MobileMenu() {
  const { mobileNavOpen } = useUi();
  return mobileNavOpen ? <MobileMenuPanel /> : null;
}

function MobileMenuPanel() {
  const { mobileNavOpen, setMobileNavOpen } = useUi();
  const { t, locale } = useLanguage();
  const { data: session, status } = useSession();
  const signedIn = status === "authenticated" && session?.user?.kind === "CUSTOMER";
  const pathname = usePathname();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const active = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  const { shortcuts, categories } = useMemo(() => {
    const products = catalog();
    const snapshot = getSnapshotCategories();
    const categoryRows = buildMenuRows(locale);
    const linked = new Set(categoryRows.map((row) => row.href));
    const shortcutRows: MenuRow[] = [
      { key: "best-sellers", label: t("nav.bestSellers"), href: "/category/best-sellers", children: [] },
      { key: "deals", label: t("nav.deals"), href: "/deals", children: [] },
    ].filter((row) => !linked.has(row.href) && hrefHasProducts(row.href, products, snapshot));

    return {
      shortcuts: shortcutRows,
      categories: categoryRows,
    };
  }, [locale, t]);

  // Rows on the way to the current page start open.
  const [open, setOpen] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    const walk = (rows: MenuRow[], trail: string[]) => {
      for (const row of rows) {
        if (row.href && active(row.href) && trail.length) trail.forEach((k) => keys.add(k));
        walk(row.children, [...trail, row.key]);
      }
    };
    walk(categories, []);
    return keys;
  });
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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

  const renderRow = (row: MenuRow, depth: number): React.ReactNode => {
    const pad = depth === 0 ? "ps-5" : depth === 1 ? "ps-9" : "ps-12";
    const text =
      depth === 0 ? "min-h-[54px] text-[15px] font-semibold text-white" : depth === 1 ? "min-h-11 text-[14px] text-white/85" : "min-h-10 text-[13px] text-white/70";
    const base = cn("flex w-full items-center justify-between gap-3 pe-5 text-start transition hover:bg-white/5 hover:text-white", pad, text);
    if (!row.children.length) {
      const content = <span className="min-w-0 truncate">{row.label}</span>;
      return (
        <li key={row.key} className={cn(depth === 0 && "border-b border-white/10")}>
          {row.external ? (
            <a href={row.href} target={row.href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer" className={base} dir="auto">
              {content}
            </a>
          ) : (
            <Link href={row.href} onClick={close} className={cn(base, active(row.href) && "font-semibold text-gold")}>
              {content}
            </Link>
          )}
        </li>
      );
    }
    const expanded = open.has(row.key);
    return (
      <li key={row.key} className={cn(depth === 0 && "border-b border-white/10")}>
        <button type="button" className={cn(base, expanded && depth === 0 && "bg-white/[0.04]")} aria-expanded={expanded} onClick={() => toggle(row.key)}>
          <span className="min-w-0 truncate">{row.label}</span>
          <ChevronDown
            className={cn("shrink-0 text-white/55 transition-transform", depth === 0 ? "h-5 w-5" : "h-4 w-4", expanded && "rotate-180 text-gold")}
            aria-hidden
          />
        </button>
        {expanded ? (
          <ul className={cn(depth === 0 && "bg-black/15 pb-2")}>
            {row.children.map((child) => renderRow(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

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
          <ul className="border-t border-white/10">
            <li className="border-b border-white/10">
              <Link href="/" onClick={close} className={cn("flex min-h-[54px] items-center px-5 text-[15px] font-semibold text-white hover:bg-white/5", pathname === "/" && "text-gold")}>
                {t("common.home")}
              </Link>
            </li>
            {shortcuts.map((row) => renderRow(row, 0))}
            {categories.map((row) => renderRow(row, 0))}
          </ul>

          {/* ST-02: account, orders and wishlist are reachable on mobile. */}
          <ul className="grid grid-cols-2 gap-2 px-4 pt-4 text-sm">
            {[
              ...(signedIn
                ? [
                    { href: "/account", label: t("nav.account"), icon: User },
                    { href: "/account/orders", label: t("account.orders"), icon: ShoppingBag },
                  ]
                : [
                    { href: "/login", label: t("account.signIn"), icon: User },
                    { href: "/register", label: t("account.register"), icon: UserPlus },
                  ]),
              { href: "/wishlist", label: t("nav.wishlist"), icon: Heart },
              { href: "/order-lookup", label: t("footer.orderLookup"), icon: PackageSearch },
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
            <LanguageSwitcher />
            <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">{t("currency.label")}</p>
            <CurrencySelect tone="menu" />
          </div>
        </nav>
      </aside>
    </div>
  );
}
