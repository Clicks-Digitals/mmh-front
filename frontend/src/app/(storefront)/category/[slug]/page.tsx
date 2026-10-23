import { getCategory } from "@/data/categories";
import { isListingGroup, productsForListing } from "@/lib/listing";
import { pageMeta } from "@/lib/seo";
import { resolveStorefrontCategories, resolveStorefrontProducts } from "@/server/catalog/resolve";
import { ListingPage } from "@/server/catalog/listing-page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type Resolved = { slug: string; name: string; nameAr: string; description: string };

/** A backend category, a built-in grouping (PlayStation, Mobile Games…), or a platform with products. */
async function resolveListing(slug: string): Promise<Resolved | undefined> {
  const [categories, products] = await Promise.all([resolveStorefrontCategories(), resolveStorefrontProducts()]);
  const fromApi = categories.find((item) => item.slug === slug);
  if (fromApi) return { slug, name: fromApi.name, nameAr: fromApi.nameAr, description: fromApi.description };
  if (isListingGroup(slug)) {
    const group = getCategory(slug);
    if (!group || !productsForListing(slug, products, categories).length) return undefined;
    return { slug, name: group.name, nameAr: group.nameAr, description: group.description };
  }
  const platformProduct = products.find((product) => product.platform === slug);
  if (platformProduct) {
    const options = platformProduct.digitalOptions;
    return {
      slug,
      name: options.platformLabel || platformProduct.brand,
      nameAr: options.platformLabelAr || options.platformLabel || platformProduct.brand,
      description: `${options.platformLabel || platformProduct.brand} digital products sold by MMH.`,
    };
  }
  return undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const listing = await resolveListing(slug);
  if (!listing) return { title: "Not found", robots: { index: false, follow: false } };
  return pageMeta(listing.name, listing.description || listing.name, `/category/${slug}`);
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const listing = await resolveListing(slug);
  if (!listing) notFound();
  return (
    <ListingPage
      slug={slug}
      title={{ en: listing.name, ar: listing.nameAr }}
      basePath={`/category/${slug}`}
      searchParams={searchParams}
    />
  );
}
