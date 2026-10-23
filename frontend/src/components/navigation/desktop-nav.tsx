"use client";

import { MegaMenu, megaTiles } from "@/components/navigation/mega-menu";
import { NAV_LINKS, type MegaKey } from "@/data/navigation";
import { catalog } from "@/data/products";
import { useLanguage } from "@/context/language-context";
import { getSnapshotCategories } from "@/lib/catalog-snapshot";
import { hrefHasProducts } from "@/lib/listing";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

/** Desktop navigation row with mega menus; links without products are hidden. */
export function DesktopNav() {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [open, setOpen] = useState<MegaKey | null>(null);
  const products = catalog();
  const categories = getSnapshotCategories();
  const links = NAV_LINKS.filter((link) => hrefHasProducts(link.href, products, categories));
  if (!links.length) return null;

  return (
    <nav className="relative hidden border-t border-line/60 lg:block" aria-label={t("nav.mainMenu")} onMouseLeave={() => setOpen(null)}>
      <ul className="container-mmh flex h-11 items-center gap-1">
        {links.map((link) => {
          const mega = link.mega && megaTiles(link.mega).length ? link.mega : undefined;
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <li key={link.href} onMouseEnter={() => setOpen(mega ?? null)}>
              <Link
                href={link.href}
                onFocus={() => setOpen(mega ?? null)}
                onClick={() => setOpen(null)}
                aria-expanded={mega ? open === mega : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-brand/10 hover:text-fg",
                  active && "text-fg",
                  open === link.mega && "bg-brand/10 text-fg",
                )}
              >
                {t(link.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
      {open ? (
        <div className="absolute inset-x-0 top-full z-[45] border-y border-line bg-elevated shadow-[0_24px_48px_rgba(23,24,43,0.18)]">
          <MegaMenu type={open} onNavigate={() => setOpen(null)} />
        </div>
      ) : null}
    </nav>
  );
}
