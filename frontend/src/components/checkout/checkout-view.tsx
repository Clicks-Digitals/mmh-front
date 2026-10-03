"use client";

import { PayPalCheckout } from "@/components/checkout/paypal-checkout";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Price } from "@/components/ui/price";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { linePrice, maskAccountValue } from "@/lib/cart";
import { getProductById } from "@/data/products";
import { ApiError } from "@/lib/api/client";
import { createPayPalOrder } from "@/lib/api/paypal";
import { isValidDemoPhone, isValidEmail } from "@/lib/validation";
import { STORAGE_KEYS, writeJson } from "@/lib/storage";
import type { CheckoutDraft } from "@/types";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

function errorCode(error: ApiError) {
  if (!error.body || typeof error.body !== "object") return "";
  const code = (error.body as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

const empty: CheckoutDraft = {
  customer: { fullName: "", email: "", phone: "" },
  digital: { method: "account", contact: "" },
  payment: { method: "paypal" },
  notes: "",
  regionConfirmed: false,
  refundConfirmed: false,
};

export function CheckoutView() {
  const { items, subtotal, discount, promoCode, clear, hydrated } = useCart();
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<CheckoutDraft>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [prepared, setPrepared] = useState<{
    id: string;
    orderNumber: string;
    checkoutToken: string;
    paypalAmount: string;
    paypalCurrency: string;
  } | null>(null);
  const total = subtotal - discount;
  const idempotencyKey = useMemo(
    () =>
      items
        .map((item) => `${item.lineId}:${item.quantity}:${item.digital?.denominationId ?? ""}`)
        .join("|") + `:${draft.customer.email}:paypal`,
    [items, draft.customer.email],
  );

  useEffect(() => {
    setPrepared(null);
  }, [idempotencyKey]);

  const patch = (next: Partial<CheckoutDraft>) => setDraft((current) => ({ ...current, ...next }));

  const validate = (currentStep: number) => {
    const next: Record<string, string> = {};
    if (currentStep === 1) {
      if (!draft.customer.fullName.trim()) next.name = t("checkout.required");
      if (!isValidEmail(draft.customer.email)) next.email = t("checkout.invalidEmail");
      if (!isValidDemoPhone(draft.customer.phone)) next.phone = t("checkout.invalidPhone");
    }
    if (currentStep === 4) {
      if (!draft.regionConfirmed) next.confirm = t("checkout.required");
      if (!draft.refundConfirmed) next.refund = t("checkout.required");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const steps = useMemo(() => [t("checkout.step1"), t("checkout.step2"), t("checkout.step3"), t("checkout.step4")], [t]);

  const finish = (orderId: string, orderNumber: string) => {
    writeJson(STORAGE_KEYS.checkout, { draft, items, total, createdAt: new Date().toISOString(), orderId });
    clear();
    router.push(`/order-success?ref=${encodeURIComponent(orderId)}&number=${encodeURIComponent(orderNumber)}`);
  };

  const prepareOrder = async () => {
    setPreparing(true);
    setPlaceError("");
    try {
      const { createStorefrontOrder } = await import("@/server/actions/checkout");
      const result = await createStorefrontOrder({
        email: draft.customer.email,
        fullName: draft.customer.fullName,
        phone: draft.customer.phone,
        notes: draft.notes,
        idempotencyKey,
        couponCode: promoCode || undefined,
        paymentProvider: "paypal",
        items: items.map((item) => ({
          productId: item.productId,
          variantId: item.digital?.denominationId || getProductById(item.productId)?.digitalOptions.denominations[0]?.id || item.productId,
          quantity: item.quantity,
          fields: item.digital?.customerFields,
        })),
      });
      if (!result.ok) {
        setPlaceError(result.message);
        patch({ regionConfirmed: false, refundConfirmed: false });
        return;
      }
      if (result.paymentStatus === "PAID") {
        finish(result.id, result.orderNumber);
        return;
      }
      if (!result.checkoutToken || !result.paypalAmount || !result.paypalCurrency) {
        setPlaceError(t("checkout.paypalUnavailable"));
        patch({ regionConfirmed: false, refundConfirmed: false });
        return;
      }
      setPrepared({
        id: result.id,
        orderNumber: result.orderNumber,
        checkoutToken: result.checkoutToken,
        paypalAmount: result.paypalAmount,
        paypalCurrency: result.paypalCurrency,
      });
    } catch (error) {
      setPlaceError(error instanceof Error ? error.message : t("checkout.paypalUnavailable"));
      patch({ regionConfirmed: false, refundConfirmed: false });
    } finally {
      setPreparing(false);
    }
  };

  if (!hydrated) return <div className="container-mmh py-16">{t("common.loading")}</div>;
  if (items.length === 0) {
    return (
      <div className="container-mmh py-16">
        <p className="text-muted">{t("cart.empty")}</p>
        <Button className="mt-4" href="/shop">{t("cart.emptyCta")}</Button>
      </div>
    );
  }

  return (
    <div className="container-mmh grid gap-8 py-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10 lg:py-10">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">{t("checkout.title")}</h1>
        <ol className="mt-6 flex gap-2 overflow-x-auto pb-1 text-xs">
          {steps.map((label, index) => (
            <li
              key={label}
              className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 ${step === index + 1 ? "bg-gold text-elevated" : index + 1 < step ? "bg-brand text-fg" : "bg-brand-deep text-muted"}`}
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/15 text-[11px] font-semibold">
                {index + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <div className="mt-8 space-y-4">
            <p className="text-sm text-muted">{t("checkout.contactHint")}</p>
            <Field label={t("checkout.name")} value={draft.customer.fullName} error={errors.name} onChange={(event) => patch({ customer: { ...draft.customer, fullName: event.target.value } })} />
            <Field label={t("checkout.email")} value={draft.customer.email} error={errors.email} onChange={(event) => patch({ customer: { ...draft.customer, email: event.target.value } })} />
            <Field label={t("checkout.phone")} hint={t("checkout.phoneHint")} value={draft.customer.phone} error={errors.phone} onChange={(event) => patch({ customer: { ...draft.customer, phone: event.target.value } })} />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-8 space-y-4">
            {items.map((item) => {
              const product = getProductById(item.productId);
              if (!product) return null;
              const player = item.digital?.customerFields?.playerId || item.digital?.customerFields?.userId;
              return (
                <article key={item.lineId} className="rounded-[12px] border border-line bg-card p-4 text-sm">
                  <p className="font-medium">{locale === "ar" ? product.nameAr : product.name}</p>
                  <p className="mt-1 text-muted">
                    {item.digital?.platform} · {item.digital?.regionName} · {item.digital?.denominationLabel}
                  </p>
                  <p className="text-accent">
                    {product.fulfillmentType === "direct_topup"
                      ? t("common.topup")
                      : item.digital?.giftIntent === "recipient"
                        ? `${t("gift.sentTo")} ${item.digital.recipientPhone || item.digital.deliveryContact || ""}`
                        : item.digital?.giftIntent === "self"
                          ? t("gift.keptInOrders")
                          : t("common.instant")}
                    {item.digital?.giftIntent !== "recipient" && item.digital?.deliveryContact ? ` · ${item.digital.deliveryContact}` : ""}
                    {player ? ` · ${maskAccountValue(player)}` : ""}
                  </p>
                  {item.digital?.giftMessage ? <p className="mt-2 text-xs text-muted">“{item.digital.giftMessage}”</p> : null}
                  <p className="mt-2 text-xs text-amber">{t("checkout.refundWarn")}</p>
                  <Link href="/cart" className="mt-2 inline-block text-xs text-gold">{t("common.edit")}</Link>
                </article>
              );
            })}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-8 space-y-3">
            <p className="text-sm text-muted">{t("checkout.payNote")}</p>
            <div className="flex min-h-12 w-full items-center rounded-xl border border-line bg-card px-4 text-start font-medium">
              {t("checkout.payCard")}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="mt-8 space-y-3 text-sm">
            <p className="break-words"><strong>{draft.customer.fullName}</strong> · {draft.customer.email} · {draft.customer.phone}</p>
            <p className="rounded-xl border border-line bg-card p-3 text-muted">{t("checkout.payNote")}</p>
            {prepared ? (
              <p className="rounded-xl border border-line bg-card p-3 text-sm">
                <span className="text-muted">{t("checkout.paypalCharge")}</span>
                <span className="ms-2 font-semibold">
                  {prepared.paypalAmount} {prepared.paypalCurrency}
                </span>
              </p>
            ) : null}
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-card p-4 leading-5 text-muted">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#F7C037]"
                checked={draft.regionConfirmed && draft.refundConfirmed}
                disabled={preparing}
                onChange={(event) => {
                  const checked = event.target.checked;
                  patch({ regionConfirmed: checked, refundConfirmed: checked });
                  if (!checked) {
                    setPrepared(null);
                    return;
                  }
                  void prepareOrder();
                }}
              />
              <span>{t("product.confirmCombined")}</span>
            </label>
            {errors.confirm || errors.refund ? <p className="text-xs text-danger">{t("checkout.required")}</p> : null}
            {preparing ? <p className="text-sm text-muted">{t("checkout.paypalPreparing")}</p> : null}
            {prepared ? (
              <PayPalCheckout
                currencyCode={prepared.paypalCurrency}
                createOrder={async () => {
                  try {
                    const created = await createPayPalOrder(prepared.orderNumber, prepared.checkoutToken);
                    if (!created.paypal_order_id) throw new Error(t("checkout.paypalUnavailable"));
                    return { orderId: created.paypal_order_id };
                  } catch (error) {
                    if (error instanceof ApiError && errorCode(error) === "already_paid") {
                      finish(prepared.id, prepared.orderNumber);
                      throw new Error("ALREADY_PAID");
                    }
                    throw error;
                  }
                }}
                onPaid={() => finish(prepared.id, prepared.orderNumber)}
                onCancel={() => setPlaceError(t("checkout.paypalCancel"))}
                onError={(message) => setPlaceError(message)}
              />
            ) : null}
            {draft.regionConfirmed && !prepared && !preparing ? (
              <Button variant="secondary" onClick={() => void prepareOrder()}>
                {t("checkout.payCard")}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row">
          {step > 1 ? (
            <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setStep((value) => value - 1)}>
              {t("common.back")}
            </Button>
          ) : null}
          {step < 4 ? (
            <Button className="w-full sm:w-auto" onClick={() => validate(step) && setStep((value) => value + 1)}>{t("common.continue")}</Button>
          ) : null}
          {placeError ? <p className="text-sm text-danger">{placeError}</p> : null}
        </div>
      </div>
      <aside className="order-first h-fit rounded-[14px] border border-line bg-elevated p-5 lg:order-none">
        <h2 className="font-semibold">{t("cart.summary")}</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {items.map((item) => {
            const product = getProductById(item.productId);
            if (!product) return null;
            return (
              <li key={item.lineId} className="flex justify-between gap-3">
                <span>{locale === "ar" ? product.nameAr : product.name} × {item.quantity}</span>
                <Price amount={linePrice(item, product)} locale={locale} size="sm" />
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-between border-t border-line pt-3 font-semibold">
          <span>{t("cart.total")}</span>
          <Price amount={total} locale={locale} />
        </div>
      </aside>
    </div>
  );
}
