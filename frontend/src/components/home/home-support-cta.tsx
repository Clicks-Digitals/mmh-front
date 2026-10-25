"use client";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";

export function HomeSupportCta({ hasContact = true }: { hasContact?: boolean }) {
  const { t } = useLanguage();
  // ST-13: no channel configured → no "Contact us" call to action that leads nowhere.
  if (!hasContact) return null;

  return (
    <section className="container-mmh py-5 sm:py-7">
      <div className="relative isolate overflow-hidden rounded-2xl bg-brand-deep px-6 py-10 text-center text-white sm:px-10 sm:py-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 30%, rgba(247,192,55,0.22), transparent 36%), radial-gradient(circle at 85% 70%, rgba(104,106,176,0.4), transparent 42%)",
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("home.supportTitle")}</h2>
          <p className="mt-3 text-sm leading-6 text-white/78 sm:text-base">{t("home.supportBody")}</p>
          <Button href="/contact" size="lg" className="mt-7">
            {t("home.supportCta")}
          </Button>
        </div>
      </div>
    </section>
  );
}
