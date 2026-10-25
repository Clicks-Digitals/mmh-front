"use client";

import { CouponBox } from "@/components/cart/coupon-box";
import { UsdEstimate } from "@/components/checkout/payment-step";
import { ProductCover } from "@/components/product/product-artwork";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Price } from "@/components/ui/price";
import { QuantitySelector } from "@/components/ui/quantity-selector";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useToast } from "@/context/toast-context";
import { useWishlist } from "@/context/wishlist-context";
import { getProductById } from "@/data/products";
import { CustomerFieldInput } from "@/components/product/customer-field-input";
import {
  cartHasRegionLocked,
  lineDenomination,
  lineFieldsText,
  lineLimits,
  lineProblem,
  lineProblemKey,
  linePrice,
} from "@/lib/cart";
import { formatDiscount } from "@/lib/coupon";
import { lowStockCount } from "@/lib/quantity";
import { customerFieldsValid, normalizeFieldValue } from "@/lib/validation";
import type { CartItem, Product } from "@/types";
import Link from "next/link";
import { useState } from "react";

function LineEditor({ item, product, onDone }: { item: CartItem; product: Product; onDone: () => void }) {
  const { t } = useLanguage();
  const { updateItemDigital } = useCart();
  const [values, setValues] = useState<Record<string, string>>(item.digital?.customerFields ?? {});
  const [submitted, setSubmitted] = useState(false);
  const fieldDefs = product.digitalOptions.requiredCustomerFields;
  const valid = customerFieldsValid(fieldDefs, values);

  return (
    <div className="mt-3 space-y-3 rounded-[10px] border border-line bg-card p-3">
      {fieldDefs.map((field) => (
        <CustomerFieldInput
          key={field.id}
          field={field}
          value={values[field.id] ?? ""}
          showError={submitted}
          onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        {fieldDefs.length && item.digital ? (
          <Button
            onClick={() => {
              setSubmitted(true);
              if (!valid || !item.digital) return;
              const cleaned = Object.fromEntries(
                Object.entries(values)
                  .map(([key, value]) => [key, normalizeFieldValue(value)] as const)
                  .filter(([, value]) => value),
              );
              updateItemDigital(item.lineId, { ...item.digital, customerFields: cleaned });
              onDone();
            }}
          >
            {t("cart.saveDetails")}
          </Button>
        ) : null}
        <Button href={`/product/${product.slug}`} variant="secondary">
          {t("common.viewOptions")}
        </Button>
      </div>
    </div>
  );
}

export function CartPageView() {
  const { items, updateQty, removeItem, subtotal, total, discountFils, totalFils, promoCode, hydrated } = useCart();
  const { add: addToWishlist } = useWishlist();
  const { t, locale } = useLanguage();
  const { push } = useToast();
  const [editing, setEditing] = useState<string | null>(null);

  if (!hydrated) return <div className="container-mmh py-16 text-muted">{t("common.loading")}</div>;
  if (items.length === 0) {
    return (
      <div className="container-mmh py-16">
        <EmptyState title={t("cart.empty")} actionHref="/shop" actionLabel={t("cart.emptyCta")} />
      </div>
    );
  }

  const regionLocked = cartHasRegionLocked(items);
  const problems = items.map((item) => lineProblem(item, getProductById(item.productId)));
  const blocked = problems.some(Boolean);

  return (
    <div className="container-mmh grid gap-8 py-8 lg:grid-cols-[1.2fr_0.8fr] lg:gap-10 lg:py-10">
      <div className="space-y-6 sm:space-y-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">{t("cart.title")}</h1>
        {regionLocked ? (
          <p className="rounded-[12px] border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">{t("cart.regionWarning")}</p>
        ) : null}
        <section>
          {items.map((item, index) => {
            const product = getProductById(item.productId);
            const problem = problems[index];
            if (!product) {
              return (
                <div key={item.lineId} className="mb-3 flex items-center justify-between rounded-[12px] border border-danger/40 bg-card p-4 text-sm">
                  <span className="text-danger">{t("checkout.lineNeedsOptions")}</span>
                  <button type="button" className="text-xs text-danger" onClick={() => removeItem(item.lineId)}>
                    {t("common.remove")}
                  </button>
                </div>
              );
            }
            const limits = lineLimits(item, product);
            const fieldsText = lineFieldsText(item, product, locale);
            const left = lowStockCount(lineDenomination(item, product)?.availableQuantity);
            return (
              <div key={item.lineId} className="mb-3 rounded-[12px] border border-line bg-card p-4">
                <div className="flex gap-3 sm:gap-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[10px] sm:h-24 sm:w-24">
                    <ProductCover product={product} compact className="h-full w-full" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <Link href={`/product/${product.slug}`} className="font-medium leading-5">
                        {locale === "ar" ? product.nameAr : product.name}
                      </Link>
                      <span className="shrink-0">
                        <Price amount={linePrice(item, product)} locale={locale} />
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {[item.digital?.platform, item.digital?.regionName, item.digital?.denominationLabel].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-xs text-muted">
                      {product.fulfillmentType === "direct_topup" ? t("common.topup") : t("delivery.afterPayment")}
                      {fieldsText ? ` · ${fieldsText}` : ""}
                    </p>
                    {problem ? <p className="mt-1 text-xs text-danger">{t(lineProblemKey(problem), { max: limits.max })}</p> : null}
                    {!problem && left ? <p className="mt-1 text-xs text-amber">{t("stock.onlyNLeft", { count: left })}</p> : null}
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <QuantitySelector
                        value={item.quantity}
                        min={limits.min}
                        max={limits.max}
                        onChange={(value) => updateQty(item.lineId, value)}
                        onLimit={(max) => push({ title: t("product.qtyMax", { max }), tone: "info" })}
                      />
                      <button type="button" className="text-xs text-gold" onClick={() => setEditing(editing === item.lineId ? null : item.lineId)}>
                        {t("common.edit")}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-muted"
                        onClick={() => {
                          addToWishlist(product.id);
                          removeItem(item.lineId);
                          push({ title: t("cart.movedToWishlist"), tone: "success" });
                        }}
                      >
                        {t("cart.moveWishlist")}
                      </button>
                      <button type="button" className="text-xs text-danger" onClick={() => removeItem(item.lineId)}>
                        {t("common.remove")}
                      </button>
                    </div>
                    {editing === item.lineId ? <LineEditor item={item} product={product} onDone={() => setEditing(null)} /> : null}
                  </div>
                </div>
              </div>
            );
          })}
          <p className="text-sm text-muted">{t("cart.digitalNote")}</p>
        </section>
      </div>
      <aside className="h-fit rounded-[14px] border border-line bg-elevated p-5 lg:sticky lg:top-24">
        <h2 className="font-semibold">{t("cart.summary")}</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t("cart.subtotal")}</dt>
            <dd>
              <Price amount={subtotal} locale={locale} size="sm" />
            </dd>
          </div>
          {discountFils > 0 ? (
            <div className="flex justify-between text-success">
              <dt>
                {t("cart.discount")} ({promoCode})
              </dt>
              <dd>{formatDiscount(discountFils, locale)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-line pt-3 font-semibold">
            <dt>{t("cart.total")}</dt>
            <dd>
              <Price amount={total} locale={locale} />
            </dd>
          </div>
        </dl>
        <UsdEstimate totalFils={totalFils} className="mt-2 text-xs text-muted" />
        <CouponBox />
        <Button className="mt-5 w-full" href={blocked ? undefined : "/checkout"} disabled={blocked}>
          {t("cart.checkout")}
        </Button>
        {blocked ? <p className="mt-2 text-xs text-danger">{t("cart.fixLine")}</p> : null}
      </aside>
    </div>
  );
}
