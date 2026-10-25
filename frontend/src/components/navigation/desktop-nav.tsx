"use client";

import { MegaMenu, MenuEntryPanel, megaTiles } from "@/components/navigation/mega-menu";
import { NAV_LINKS, type MegaKey } from "@/data/navigation";
import { catalog } from "@/data/products";
import { useLanguage } from "@/context/language-context";
import { getSnapshotCategories, getSnapshotMenuCategories } from "@/lib/catalog-snapshot";
import { hrefHasProducts } from "@/lib/listing";
import { buildMenu, uniqueByHref } from "@/lib/nav-menu";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

/**
 * Desktop navigation row with mega menus. D20: driven by the categories flagged "show in menu"
 * (sorted); falls back to the built-in navigation when none are flagged. Links without products are hidden.
 */
export function DesktopNav() {
  const { t, locale } = useLanguage();
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const products = catalog();
  const categories = getSnapshotCategories();
  const menu = useMemo(() => buildMenu(getSnapshotMenuCategories(), categories, products), [categories, products]);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const linkClass = (href: string, key: string) =>
    cn(
      "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-brand/10 hover:text-fg",
      isActive(href) && "text-fg",
      open === key && "bg-brand/10 text-fg",
    );

  if (menu.length) {
    const openEntry = menu.find((entry) => entry.slug === open && entry.children.length);
    return (
      <nav className="relative hidden border-t border-line/60 lg:block" aria-label={t("nav.mainMenu")} onMouseLeave={() => setOpen(null)}>
        <ul className="container-mmh flex h-11 items-center gap-1 overflow-x-auto">
          {menu.map((entry) => (
            <li key={entry.href} onMouseEnter={() => setOpen(entry.children.length ? entry.slug : null)}>
              <Link
                href={entry.href}
                onFocus={() => setOpen(entry.children.length ? entry.slug : null)}
                onClick={() => setOpen(null)}
                aria-expanded={entry.children.length ? open === entry.slug : undefined}
                className={linkClass(entry.href, entry.slug)}
              >
                {locale === "ar" ? entry.labelAr : entry.label}
              </Link>
            </li>
          ))}
        </ul>
        {openEntry ? (
          <div className="absolute inset-x-0 top-full z-[45] border-y border-line bg-elevated shadow-[0_24px_48px_rgba(23,24,43,0.18)]">
            <MenuEntryPanel entry={openEntry} onNavigate={() => setOpen(null)} />
          </div>
        ) : null}
      </nav>
    );
  }

  const links = uniqueByHref(NAV_LINKS.filter((link) => hrefHasProducts(link.href, products, categories)));
  if (!links.length) return null;

  return (
    <nav className="relative hidden border-t border-line/60 lg:block" aria-label={t("nav.mainMenu")} onMouseLeave={() => setOpen(null)}>
      <ul className="container-mmh flex h-11 items-center gap-1">
        {links.map((link) => {
          const mega = link.mega && megaTiles(link.mega).length ? link.mega : undefined;
          return (
            <li key={link.href} onMouseEnter={() => setOpen(mega ?? null)}>
              <Link
                href={link.href}
                onFocus={() => setOpen(mega ?? null)}
                onClick={() => setOpen(null)}
                aria-expanded={mega ? open === mega : undefined}
                className={linkClass(link.href, link.mega ?? "")}
              >
                {t(link.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
      {open ? (
        <div className="absolute inset-x-0 top-full z-[45] border-y border-line bg-elevated shadow-[0_24px_48px_rgba(23,24,43,0.18)]">
          <MegaMenu type={open as MegaKey} onNavigate={() => setOpen(null)} />
        </div>
      ) : null}
    </nav>
  );
}
