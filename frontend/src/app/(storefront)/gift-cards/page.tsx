import { pageMeta } from "@/lib/seo";
import { ListingPage } from "@/server/catalog/listing-page";

export const metadata = pageMeta("Gift cards", "PlayStation Store, Steam, Xbox, Nintendo, Google Play and Apple gift cards in JOD.", "/gift-cards");

export default function GiftCardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ListingPage
      slug="gift-cards"
      title={{ en: "Gift Cards", ar: "بطاقات الهدايا" }}
      basePath="/gift-cards"
      searchParams={searchParams}
      discount={false}
    />
  );
}
