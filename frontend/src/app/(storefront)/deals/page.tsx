import { pageMeta } from "@/lib/seo";
import { ListingPage } from "@/server/catalog/listing-page";

export const metadata = pageMeta("Deals", "Discounted digital codes and top-up packages.", "/deals");

export default function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ListingPage
      slug="deals"
      title={{ en: "Deals", ar: "العروض" }}
      basePath="/deals"
      searchParams={searchParams}
      discount={true}
    />
  );
}
