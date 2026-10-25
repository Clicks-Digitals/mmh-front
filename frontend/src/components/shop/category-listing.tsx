import { ShopCatalog } from "@/components/shop/shop-catalog";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import type { FilterState, Product } from "@/types";
import Link from "next/link";

export interface CategorySubLink {
  href: string;
  label: string;
}

export function CategoryListing({
  title,
  breadcrumbs,
  subcategories = [],
  initial,
  source,
  basePath,
  subcategoriesLabel = "Subcategories",
  description = "",
}: {
  title: string;
  /** D20 / CA-17: the category description, shown under the title. */
  description?: string;
  breadcrumbs: Crumb[];
  subcategories?: CategorySubLink[];
  initial: FilterState;
  source: Product[];
  basePath: string;
  subcategoriesLabel?: string;
}) {
  return (
    <div>
      <section className="border-b border-line bg-brand-deep text-white">
        <div className="container-mmh py-8 sm:py-10">
          <Breadcrumbs tone="onAccent" items={breadcrumbs} />
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          {description ? <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-6 text-white/80 sm:text-base">{description}</p> : null}
          {subcategories.length ? (
            <nav aria-label={subcategoriesLabel} className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {subcategories.map((child, index) => (
                <span key={child.href} className="inline-flex items-center gap-4">
                  {index > 0 ? <span className="hidden text-white/35 sm:inline" aria-hidden>
                    |
                  </span> : null}
                  <Link href={child.href} className="font-medium text-white/90 transition hover:text-gold">
                    {child.label}
                  </Link>
                </span>
              ))}
            </nav>
          ) : null}
        </div>
      </section>

      <div className="container-mmh py-5 sm:py-7">
        <ShopCatalog initial={initial} source={source} basePath={basePath} mode="category" />
      </div>
    </div>
  );
}
