import { Fragment } from "react";
import { Hero } from "@/components/home/hero";
import { HomeBanners, type HomeBanner } from "@/components/home/home-banners";
import { CategorySwiperSection } from "@/components/home/category-swiper-section";
import { HomePromoBanner } from "@/components/home/home-promo-banner";
import { HomeSupportCta } from "@/components/home/home-support-cta";
import { LatestProducts } from "@/components/home/latest-products";
import { PlatformQuickLinks } from "@/components/home/platform-quick-links";
import { ServiceCategoryGrid } from "@/components/home/service-category-grid";
import { SuggestedGamesGrid } from "@/components/home/suggested-games-grid";
import { HomeImageSection, HomeProductsSection } from "@/components/home/home-custom-sections";
import type { HomeSection } from "@/lib/design";
import { listBanners } from "@/lib/api/cms";
import { resolveMediaUrl } from "@/lib/media";
import { fetchApiHomeTiles, fetchApiPlatforms } from "@/server/catalog/from-api";
import { pageMeta } from "@/lib/seo";
import { hasContactChannel } from "@/lib/site-contact";
import { loadStoreSettings } from "@/server/site-contact";

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
  const [banners, settings, platforms, suggested] = await Promise.all([
    loadHomeBanners(),
    loadStoreSettings(),
    fetchApiPlatforms(),
    fetchApiHomeTiles("SUGGESTED"),
  ]);
  // Admin → Store design decides the order and which sections show.
  const render = (section: HomeSection) => {
    switch (section.type) {
      case "banners":
        return banners.length ? <HomeBanners banners={banners} /> : <Hero />;
      case "promo":
        return <HomePromoBanner />;
      case "platforms":
        return <PlatformQuickLinks platforms={platforms} />;
      case "categories":
        return <CategorySwiperSection />;
      case "best_sellers":
        return <LatestProducts />;
      case "services":
        return <ServiceCategoryGrid />;
      case "suggested":
        return <SuggestedGamesGrid tiles={suggested} />;
      case "support":
        return <HomeSupportCta hasContact={hasContactChannel(settings.contact)} />;
      case "products":
        return <HomeProductsSection section={section} />;
      case "image":
        return <HomeImageSection section={section} />;
    }
  };
  return (
    <>
      {settings.homeLayout
        .filter((section) => section.visible)
        .map((section) => (
          <Fragment key={section.id}>{render(section)}</Fragment>
        ))}
    </>
  );
}
