import { pageMeta } from "@/lib/seo";
import { ListingPage } from "@/server/catalog/listing-page";

export const metadata = pageMeta("Shop digital gaming products in Jordan", "Browse MMH gift cards, wallet credit, subscriptions and game top-ups with JOD pricing.", "/shop");

export default function ShopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ListingPage
      slug=""
      title={{ en: "Shop", ar: "المتجر" }}
      basePath="/shop"
      searchParams={searchParams}
      discount={false}
    />
  );
}
