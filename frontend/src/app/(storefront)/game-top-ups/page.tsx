import { pageMeta } from "@/lib/seo";
import { ListingPage } from "@/server/catalog/listing-page";

export const metadata = pageMeta("Game top-ups", "Direct game top-ups processed by our team after payment. Sold by MMH in Jordan.", "/game-top-ups");

export default function GameTopUpsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <ListingPage
      slug="game-top-ups"
      title={{ en: "Game Top-Ups", ar: "شحن الألعاب" }}
      basePath="/game-top-ups"
      searchParams={searchParams}
      discount={false}
    />
  );
}
