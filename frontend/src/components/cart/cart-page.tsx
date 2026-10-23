"use client";

import { UsdEstimate } from "@/components/checkout/payment-step";
import { ProductCover } from "@/components/product/product-artwork";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Price } from "@/components/ui/price";
import { QuantitySelector } from "@/components/ui/quantity-selector";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useToast } from "@/context/toast-context";
import { useWishlist } from "@/context/wishlist-context";
import { getProductById } from "@/data/products";
import { cartHasRegionLocked, lineLimits, lineProblem, lineProblemKey, linePrice, maskAccountValue } from "@/lib/cart";
import { formatDiscount } from "@/lib/coupon";
import { customerFieldError, fieldErrorKey } from "@/lib/validation";
import type { CartItem, Product } from "@/types";
import Link from "next/link";
import { useState } from "react";

function LineEditor({ item, product, onDone }: { item: CartItem; product: Product; onDone: () => void }) {
  const { t, locale } = useLanguage();
  const { updateItemDigital } = useCart();
  const [values, setValues] = useState<Record<string, string>>(item.digital?.customerFields ?? {});
  const [submitted, setSubmitted] = useState(false);
  const fieldDefs = product.digitalOptions.requiredCustomerFields;
  const errors = Object.fromEntries(fieldDefs.map((field) => [field.id, customerFieldError(field, values[field.id] ?? "")]));
  const valid = Object.values(errors).every((error) => error === null);

  return (
    <div className="mt-3 space-y-3 rounded-[10px] border border-line bg-card p-3">
      {fieldDefs.map((field) => (
        <Field
          key={field.id}
          label={`${locale === "ar" ? field.labelAr || field.label : field.label}${field.required ? " *" : ""}`}
          type={field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
          placeholder={locale === "ar" ? field.placeholderAr : field.placeholder}
          value={values[field.id] ?? ""}
          maxLength={200}
          error={submitted && errors[field.id] ? t(fieldErrorKey(errors[field.id])) : undefined}
          onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
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
                  .map(([key, value]) => [key, value.trim()] as const)
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
  const {
    items,
    updateQty,
    removeItem,
    subtotal,
    total,
    discountFils,
    totalFils,
    applyPromo,
    removePromo,
    promoError,
    promoChecking,
    promoCode,
    hydrated,
  } = useCart();
  const { toggle } = useWishlist();
  const { t, locale } = useLanguage();
  const { push } = useToast();
  const [code, setCode] = useState("");
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
            const fieldsText = product.digitalOptions.requiredCustomerFields
              .map((field) => item.digital?.customerFields?.[field.id])
              .filter(Boolean)
              .map((value) => maskAccountValue(value))
              .join(" · ");
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
                          toggle(product.id);
                          removeItem(item.lineId);
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
        {promoCode ? (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm">
            <span className="font-semibold text-success">{promoCode}</span>
            <button type="button" className="text-xs text-muted hover:text-fg" onClick={removePromo}>
              {t("cart.promoRemove")}
            </button>
          </div>
        ) : (
          <form
            className="mt-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await applyPromo(code);
              if (result === "ok") push({ title: t("cart.promoOk"), tone: "success" });
            }}
          >
            <Field label={t("cart.promo")} value={code} onChange={(event) => setCode(event.target.value)} maxLength={64} />
            <Button type="submit" variant="secondary" className="mt-2 w-full" disabled={promoChecking || !code.trim()}>
              {promoChecking ? t("cart.promoChecking") : t("cart.promoApply")}
            </Button>
          </form>
        )}
        {promoError === "invalid" ? <p className="mt-2 text-xs text-danger">{t("cart.promoBad")}</p> : null}
        {promoError === "unavailable" ? <p className="mt-2 text-xs text-danger">{t("cart.promoUnavailable")}</p> : null}
        <Button className="mt-5 w-full" href={blocked ? undefined : "/checkout"} disabled={blocked}>
          {t("cart.checkout")}
        </Button>
        {blocked ? <p className="mt-2 text-xs text-danger">{t("cart.fixLine")}</p> : null}
      </aside>
    </div>
  );
}
