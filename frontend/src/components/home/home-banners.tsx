"use client";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { cn } from "@/lib/cn";
import { useEffect, useState } from "react";

export interface HomeBanner {
  id: number;
  title: string;
  titleAr: string;
  subtitle: string;
  subtitleAr: string;
  kicker: string;
  href: string;
  desktopImage: string;
  mobileImage: string;
}

/** CMS-managed HOME banners (Admin → Content → Banners). */
export function HomeBanners({ banners }: { banners: HomeBanner[] }) {
  const { t, locale } = useLanguage();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length < 2) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % banners.length), 7000);
    return () => window.clearInterval(timer);
  }, [banners.length]);

  const banner = banners[index % banners.length];
  if (!banner) return null;
  const title = locale === "ar" ? banner.titleAr || banner.title : banner.title;
  const subtitle = locale === "ar" ? banner.subtitleAr || banner.subtitle : banner.subtitle;
  const desktop = banner.desktopImage || banner.mobileImage;
  const mobile = banner.mobileImage || banner.desktopImage;

  return (
    <section className="relative isolate flex min-h-[min(78vh,720px)] w-full flex-col overflow-hidden bg-[#17182b] text-white" aria-roledescription="carousel">
      {desktop ? (
        <picture>
          {mobile ? <source media="(max-width: 767px)" srcSet={mobile} /> : null}
          <img src={desktop} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </picture>
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(23,24,43,0.2)_0%,rgba(23,24,43,0.75)_100%)]" aria-hidden />
      <div className="relative z-10 flex flex-1 flex-col items-center justify-end px-5 pb-12 pt-16 text-center sm:px-8 sm:pb-16">
        {banner.kicker ? <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold sm:text-sm">{banner.kicker}</p> : null}
        <h1 className="mt-3 max-w-4xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">{title}</h1>
        {subtitle ? <p className="mt-4 max-w-2xl text-sm leading-7 text-white/80 sm:text-base">{subtitle}</p> : null}
        {banner.href ? (
          <Button href={banner.href} size="lg" className="mt-8 min-w-[200px]">
            {t("home.bannerCta")}
          </Button>
        ) : null}
        {banners.length > 1 ? (
          <div className="mt-6 flex gap-2">
            {banners.map((item, dot) => (
              <button
                key={item.id}
                type="button"
                aria-label={`${dot + 1} / ${banners.length}`}
                aria-current={dot === index}
                onClick={() => setIndex(dot)}
                className={cn("h-2 rounded-full transition-all", dot === index ? "w-6 bg-gold" : "w-2 bg-white/40")}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
