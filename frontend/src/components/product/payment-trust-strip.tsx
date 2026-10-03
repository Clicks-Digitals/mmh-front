"use client";

import { useLanguage } from "@/context/language-context";

const METHODS = ["PayPal"] as const;

export function PaymentTrustStrip() {
  const { t } = useLanguage();

  return (
    <section className="mt-10 overflow-hidden rounded-2xl bg-brand-deep px-4 py-4 text-white sm:px-6" aria-label={t("product.paymentsTitle")}>
      <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-gold/90">{t("product.paymentsTitle")}</p>
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {METHODS.map((method) => (
          <span
            key={method}
            className="inline-flex min-h-9 items-center rounded-lg border border-white/15 bg-white/10 px-3 text-xs font-semibold tracking-wide text-white/95"
          >
            {method}
          </span>
        ))}
      </div>
    </section>
  );
}
