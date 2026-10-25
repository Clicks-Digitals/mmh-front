import { CategoryListing } from "@/components/shop/category-listing";
import { parseFilterParams } from "@/lib/catalog";
import { hrefHasProducts } from "@/lib/listing";
import { platformTiles } from "@/lib/nav-menu";
import { resolveStorefrontCategories, resolveStorefrontProducts } from "@/server/catalog/resolve";
import { queryPublishedProducts } from "@/server/catalog/query";
import { serverT } from "@/server/locale";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Shared server listing page: localized title/breadcrumbs, only non-empty sub-links. */
export async function ListingPage({
  slug,
  title,
  basePath,
  searchParams,
  discount = false,
}: {
  slug: string;
  title: { en: string; ar: string } | string;
  basePath: string;
  searchParams: SearchParams;
  discount?: boolean;
}) {
  const [{ t, locale }, params, categories, allProducts] = await Promise.all([
    serverT(),
    searchParams,
    resolveStorefrontCategories(),
    resolveStorefrontProducts(),
  ]);
  const base = parseFilterParams(params);
  const filters = { ...base, ...(slug ? { category: slug } : {}), ...(discount ? { discount: true } : {}) };
  const products = await queryPublishedProducts(filters, slug || undefined);
  const heading = typeof title === "string" ? title : locale === "ar" ? title.ar || title.en : title.en;
  const category = slug ? categories.find((item) => item.slug === slug) : undefined;
  const description = category ? (locale === "ar" ? category.descriptionAr || category.description : category.description) : "";

  const platformLinks = slug
    ? platformTiles(slug, allProducts, categories).filter((tile) => tile.href !== basePath)
    : [];
  const childLinks = categories
    .filter((category) => (slug ? category.parent === slug : !category.parent))
    .filter((category) => hrefHasProducts(category.href, allProducts, categories))
    .map((category) => ({ href: category.href, label: locale === "ar" ? category.nameAr || category.name : category.name }));
  const subcategories = [
    ...childLinks,
    ...platformLinks.map((tile) => ({ href: tile.href, label: (locale === "ar" ? tile.labelAr : tile.label) ?? "" })),
  ].filter((link, index, list) => link.href !== basePath && list.findIndex((other) => other.href === link.href) === index);

  return (
    <CategoryListing
      title={heading}
      breadcrumbs={[
        { href: "/", label: t("common.home") },
        ...(basePath === "/shop" ? [] : [{ href: "/shop", label: t("common.shop") }]),
        { label: heading },
      ]}
      subcategories={subcategories.slice(0, 12)}
      subcategoriesLabel={t("listing.subcategories")}
      description={description}
      initial={filters}
      source={products}
      basePath={basePath}
    />
  );
}
