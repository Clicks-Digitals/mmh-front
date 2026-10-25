"use client";

import { Button } from "@/components/ui/button";
import { useBrandAssets } from "@/context/brand-assets-context";
import { useLanguage } from "@/context/language-context";

export function HomePromoBanner() {
  const { t } = useLanguage();
  const { logoUrl } = useBrandAssets();

  return (
    <section className="container-mmh py-5 sm:py-7">
      <div className="relative isolate overflow-hidden rounded-2xl bg-brand-deep px-5 py-8 text-white sm:px-8 sm:py-10 lg:px-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 12% 50%, rgba(247,192,55,0.28), transparent 40%), linear-gradient(120deg, transparent 40%, rgba(104,106,176,0.35))",
          }}
          aria-hidden
        />
        <div className="relative grid items-center gap-6 md:grid-cols-[auto_1fr_auto] md:gap-10">
          <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-2xl bg-white/8 ring-1 ring-white/15 sm:h-32 sm:w-32">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="" width={96} height={96} className="h-20 w-20 rounded-full object-contain sm:h-24 sm:w-24" />
          </div>
          <div className="text-center md:text-start">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("home.promoTitle")}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/78 sm:text-base">{t("home.promoBody")}</p>
          </div>
          <div className="flex justify-center md:justify-end">
            <Button href="/shop" variant="primary" size="lg">
              {t("home.promoCta")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
