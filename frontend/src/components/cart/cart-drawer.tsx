"use client";

import { ChargedNote } from "@/components/ui/charged-note";
import { ProductCover } from "@/components/product/product-artwork";
import { UsdEstimate } from "@/components/checkout/payment-step";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/ui/price";
import { QuantitySelector } from "@/components/ui/quantity-selector";
import { ICON_HIT } from "@/components/ui/control";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useUi } from "@/context/ui-context";
import { getProductById } from "@/data/products";
import { useEscape, useScrollLock } from "@/hooks/use-overlay";
import { cartDeliveryNoteKey } from "@/lib/delivery-copy";
import { cartHasRegionLocked, lineLimits, lineProblem, lineProblemKey, linePrice, maskAccountValue } from "@/lib/cart";
import { useToast } from "@/context/toast-context";
import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

export function CartDrawer() {
  const { cartOpen, setCartOpen } = useUi();
  const { items, updateQty, removeItem, subtotal, total, discount, totalFils, freeOrder, hydrated } = useCart();
  const { push } = useToast();
  const { t, locale } = useLanguage();
  const closeRef = useRef<HTMLButtonElement>(null);

  useScrollLock(cartOpen);
  useEscape(cartOpen, () => setCartOpen(false));

  useEffect(() => {
    if (cartOpen) closeRef.current?.focus();
  }, [cartOpen]);

  if (!cartOpen) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" className="absolute inset-0 bg-overlay" aria-label={t("common.close")} onClick={() => setCartOpen(false)} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("cart.title")}
        className="absolute inset-y-0 end-0 flex h-full w-full max-w-[420px] flex-col bg-card pt-[env(safe-area-inset-top)] shadow-2xl"
      >
        <div className="flex h-16 items-center justify-between border-b border-line px-4 sm:h-[72px] sm:px-5">
          <h2 className="text-lg font-semibold">{t("cart.title")}</h2>
          <button ref={closeRef} type="button" className={ICON_HIT} onClick={() => setCartOpen(false)} aria-label={t("common.close")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!hydrated ? null : items.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-muted">{t("cart.empty")}</p>
              <Button className="mt-4" href="/shop" onClick={() => setCartOpen(false)}>
                {t("cart.emptyCta")}
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              {cartHasRegionLocked(items) ? (
                <p className="rounded-[10px] border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">{t("cart.regionWarning")}</p>
              ) : null}
              <section>
                {items.map((item) => {
                  const product = getProductById(item.productId);
                  if (!product) return null;
                  const player = item.digital?.customerFields?.playerId || item.digital?.customerFields?.userId;
                  return (
                    <div key={item.lineId} className="mb-3 rounded-[12px] border border-line bg-card p-3">
                      <div className="flex gap-3">
                        <div className="h-16 w-16 overflow-hidden rounded-lg">
                          <ProductCover product={product} compact className="h-full w-full" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{locale === "ar" ? product.nameAr : product.name}</p>
                          <p className="text-xs text-muted">
                            {item.digital?.regionName} · {item.digital?.denominationLabel}
                          </p>
                          {player ? <p className="text-xs text-muted">{maskAccountValue(player)}</p> : null}
                          {lineProblem(item, product) ? (
                            <p className="text-xs text-danger">{t(lineProblemKey(lineProblem(item, product)), { max: lineLimits(item, product).max })}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <QuantitySelector
                              value={item.quantity}
                              min={lineLimits(item, product).min}
                              max={lineLimits(item, product).max}
                              onChange={(value) => updateQty(item.lineId, value)}
                              onLimit={(max) => push({ title: t("product.qtyMax", { max }), tone: "info" })}
                            />
                            <button type="button" className="text-xs text-danger" onClick={() => removeItem(item.lineId)}>
                              {t("common.remove")}
                            </button>
                          </div>
                        </div>
                      </div>
                      <Price amount={linePrice(item, product)} locale={locale} size="sm" className="mt-2" />
                    </div>
                  );
                })}
                <p className="text-xs text-muted">{t(cartDeliveryNoteKey(items.map((item) => getProductById(item.productId)?.fulfillmentType)))}</p>
              </section>
            </div>
          )}
        </div>
        {hydrated && items.length > 0 ? (
          <div className="border-t border-line p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5">
            <div className="mb-4 flex items-center justify-between text-sm">
              <span className="text-muted">{t("cart.subtotal")}</span>
              <Price amount={subtotal} locale={locale} />
            </div>
            {discount > 0 || freeOrder ? (
              <div className="mb-4 flex items-center justify-between text-sm font-semibold">
                <span>{t("cart.total")}</span>
                {freeOrder ? <span className="text-success">{t("order.free")}</span> : <Price amount={total} locale={locale} />}
              </div>
            ) : null}
            {freeOrder ? null : <ChargedNote amountJod={total} className="mb-1" />}
            {freeOrder ? null : <UsdEstimate totalFils={totalFils} className="mb-3 text-xs text-muted" />}
            <Button className="w-full" href="/checkout" onClick={() => setCartOpen(false)}>
              {t("cart.checkout")}
            </Button>
            <Link href="/cart" className="mt-3 block text-center text-sm text-muted hover:text-fg" onClick={() => setCartOpen(false)}>
              {t("cart.title")}
            </Link>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
