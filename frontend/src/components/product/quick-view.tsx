"use client";

import { ProductCover } from "@/components/product/product-artwork";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/ui/price";
import { ICON_HIT } from "@/components/ui/control";
import { getProductBySlug } from "@/data/products";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { useEscape, useScrollLock } from "@/hooks/use-overlay";
import { X } from "lucide-react";

export function QuickView() {
  const { quickViewSlug, closeQuickView } = useUi();
  const product = quickViewSlug ? getProductBySlug(quickViewSlug) : undefined;
  const { t, locale } = useLanguage();
  const open = Boolean(product);

  useScrollLock(open);
  useEscape(open, closeQuickView);

  if (!product) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <button type="button" className="absolute inset-0 bg-overlay" onClick={closeQuickView} aria-label={t("common.close")} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={locale === "ar" ? product.nameAr : product.name}
        className="absolute inset-x-0 bottom-0 mx-auto max-h-[92dvh] w-[min(100%,840px)] overflow-y-auto rounded-t-[16px] border border-line bg-elevated pb-[env(safe-area-inset-bottom)] md:bottom-auto md:top-1/2 md:max-h-[min(88vh,720px)] md:-translate-y-1/2 md:rounded-[16px]"
      >
        <button type="button" className={ICON_HIT + " absolute end-3 top-3"} onClick={closeQuickView} aria-label={t("common.close")}>
          <X className="h-5 w-5" />
        </button>
        <div className="grid md:grid-cols-2">
          <ProductCover product={product} className="md:rounded-s-[16px]" />
          <div className="p-5 sm:p-6">
            <p className="text-xs uppercase tracking-wide text-muted">{product.brand}</p>
            <h2 className="mt-1 text-xl font-semibold">{locale === "ar" ? product.nameAr : product.name}</h2>
            <p className="mt-2 text-sm text-muted">{locale === "ar" ? product.shortDescriptionAr : product.shortDescription}</p>
            <div className="mt-4">
              <Price amount={product.priceJod} compareAt={product.compareAtPriceJod} locale={locale} size="lg" />
            </div>
            {!product.inStock ? <p className="mt-3 text-sm font-semibold text-danger">{t("common.outOfStock")}</p> : null}
            <div className="mt-6">
              <Button className="w-full sm:w-auto" href={`/product/${product.slug}`} onClick={closeQuickView}>
                {t("common.viewProduct")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
