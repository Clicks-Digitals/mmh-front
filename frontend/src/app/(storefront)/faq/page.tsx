import { FAQ_ITEMS } from "@/data/faq";
import { FaqAccordion } from "@/components/ui/faq-accordion";
import { pageMeta } from "@/lib/seo";
import { serverT } from "@/server/locale";
import { loadPublishedFaqs } from "@/server/catalog/map";

export const metadata = pageMeta("FAQ", "Digital codes, regions, top-ups, and MMH store questions.", "/faq");

export default async function FaqPage() {
  const { t } = await serverT();
  const rows = await loadPublishedFaqs().catch(() => []);
  const faqs = rows.length
    ? rows.map((row) => {
        const en = row.translations.find((item) => item.locale === "en");
        const ar = row.translations.find((item) => item.locale === "ar");
        return {
          id: row.id,
          group: "store" as const,
          question: en?.question ?? "",
          questionAr: ar?.question ?? en?.question ?? "",
          answer: en?.answer ?? "",
          answerAr: ar?.answer ?? en?.answer ?? "",
        };
      })
    : FAQ_ITEMS;
  return (
    <div className="container-mmh max-w-3xl py-10 md:py-14">
      <h1 className="text-2xl font-semibold sm:text-3xl">{t("faq.title")}</h1>
      <div className="mt-8"><FaqAccordion items={faqs} /></div>
    </div>
  );
}
