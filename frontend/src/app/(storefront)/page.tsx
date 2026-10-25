import { Hero } from "@/components/home/hero";
import { HomeBanners, type HomeBanner } from "@/components/home/home-banners";
import { CategorySwiperSection } from "@/components/home/category-swiper-section";
import { HomePromoBanner } from "@/components/home/home-promo-banner";
import { HomeSupportCta } from "@/components/home/home-support-cta";
import { LatestProducts } from "@/components/home/latest-products";
import { PlatformQuickLinks } from "@/components/home/platform-quick-links";
import { ServiceCategoryGrid } from "@/components/home/service-category-grid";
import { SuggestedGamesGrid } from "@/components/home/suggested-games-grid";
import { listBanners } from "@/lib/api/cms";
import { resolveMediaUrl } from "@/lib/media";
import { fetchApiHomeTiles, fetchApiPlatforms } from "@/server/catalog/from-api";
import { pageMeta } from "@/lib/seo";
import { hasContactChannel } from "@/lib/site-contact";
import { loadSiteContact } from "@/server/site-contact";

export const metadata = pageMeta(
  "Digital gaming cards and top-ups in Jordan",
  "Jordanian store for digital gaming codes, gift cards, wallet credit, subscriptions, and direct top-ups.",
  "/",
);

async function loadHomeBanners(): Promise<HomeBanner[]> {
  try {
    const data = await listBanners("HOME");
    const rows = Array.isArray(data) ? data : data.results;
    return rows
      .filter((row) => row.title_en || row.desktop_image || row.mobile_image)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((row) => ({
        id: row.id,
        title: row.title_en,
        titleAr: row.title_ar,
        subtitle: row.subtitle_en,
        subtitleAr: row.subtitle_ar,
        kicker: row.kicker,
        href: row.href,
        desktopImage: resolveMediaUrl(row.desktop_image),
        mobileImage: resolveMediaUrl(row.mobile_image),
      }));
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [banners, contact, platforms, suggested] = await Promise.all([
    loadHomeBanners(),
    loadSiteContact(),
    fetchApiPlatforms(),
    fetchApiHomeTiles("SUGGESTED"),
  ]);
  return (
    <>
      {banners.length ? <HomeBanners banners={banners} /> : <Hero />}
      <HomePromoBanner />
      <PlatformQuickLinks platforms={platforms} />
      <CategorySwiperSection />
      <LatestProducts />
      <ServiceCategoryGrid />
      <SuggestedGamesGrid tiles={suggested} />
      <HomeSupportCta hasContact={hasContactChannel(contact)} />
    </>
  );
}
