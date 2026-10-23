"use client";

import { PaymentStep, UsdEstimate, type CheckoutFailure } from "@/components/checkout/payment-step";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Price } from "@/components/ui/price";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { checkoutLine, lineProblem, lineProblemKey, linePrice, maskAccountValue } from "@/lib/cart";
import { formatDiscount } from "@/lib/coupon";
import { getProductById } from "@/data/products";
import { isValidEmail, isValidPhone } from "@/lib/validation";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";

type Contact = { fullName: string; email: string; phone: string };

export function CheckoutView() {
  const { items, subtotal, total, discountFils, totalFils, promoCode, clear, hydrated } = useCart();
  const { t, locale } = useLanguage();
  const { data: session, status } = useSession();
  const router = useRouter();
  const sessionEmail = status === "authenticated" && session?.user?.kind === "CUSTOMER" ? session.user.email : "";
  const [step, setStep] = useState(1);
  const [contact, setContact] = useState<Contact>({ fullName: "", email: "", phone: "" });
  const [confirmed, setConfirmed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);

  const email = (contact.email || sessionEmail).trim();
  const fullName = (contact.fullName || (sessionEmail ? session?.user?.name ?? "" : "")).trim();

  const errors = {
    name: fullName.length < 2 ? t("validation.required") : "",
    email: !isValidEmail(email) ? t("validation.email") : "",
    phone: contact.phone.trim() && !isValidPhone(contact.phone) ? t("validation.phone") : "",
  };
  const serverFieldError = (key: string) => (failure?.field === key && failure.message ? failure.message : "");

  const lines = useMemo(
    () =>
      items.map((item) => {
        const product = getProductById(item.productId);
        return { item, product, problem: lineProblem(item, product) };
      }),
    [items],
  );
  const blocked = lines.some((line) => line.problem);
  const steps = [t("checkout.step1"), t("checkout.step2"), t("checkout.reviewPay")];

  const goNext = () => {
    if (step === 1) {
      setShowErrors(true);
      if (errors.name || errors.email || errors.phone) return;
    }
    if (step === 2 && blocked) return;
    setStep((value) => Math.min(3, value + 1));
  };

  if (!hydrated) return <div className="container-mmh py-16">{t("common.loading")}</div>;
  if (items.length === 0) {
    return (
      <div className="container-mmh py-16">
        <p className="text-muted">{t("cart.empty")}</p>
        <Button className="mt-4" href="/shop">
          {t("cart.emptyCta")}
        </Button>
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
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/15 text-[11px] font-semibold">{index + 1}</span>
              <span className="hidden sm:inline">{label}</span>
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <div className="mt-8 space-y-4">
            {sessionEmail ? (
              <p className="text-sm text-muted">{t("checkout.signedInAs", { email: sessionEmail })}</p>
            ) : (
              <p className="text-sm text-muted">
                {t("checkout.signInOptional")}{" "}
                <Link href="/login?callbackUrl=%2Fcheckout" className="font-semibold text-brand-deep hover:text-fg">
                  {t("account.signIn")}
                </Link>
              </p>
            )}
            <Field
              label={t("checkout.name")}
              autoComplete="name"
              value={contact.fullName || (sessionEmail ? session?.user?.name ?? "" : "")}
              error={(showErrors && errors.name) || serverFieldError("full_name") || undefined}
              onChange={(event) => setContact((current) => ({ ...current, fullName: event.target.value }))}
            />
            <Field
              label={t("checkout.email")}
              type="email"
              autoComplete="email"
              hint={t("checkout.contactHint")}
              value={contact.email || sessionEmail}
              error={(showErrors && errors.email) || serverFieldError("email") || undefined}
              onChange={(event) => setContact((current) => ({ ...current, email: event.target.value }))}
            />
            <Field
              label={t("checkout.phone")}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+962 79 123 4567"
              hint={t("checkout.phoneHint")}
              value={contact.phone}
              error={errors.phone || serverFieldError("phone") || undefined}
              onChange={(event) => setContact((current) => ({ ...current, phone: event.target.value }))}
            />
            <UsdEstimate totalFils={totalFils} className="text-sm text-muted" />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-8 space-y-4">
            {lines.map(({ item, product, problem }) => {
              if (!product) {
                return (
                  <article key={item.lineId} className="rounded-[12px] border border-danger/40 bg-card p-4 text-sm text-danger">
                    {t("checkout.lineNeedsOptions")}
                  </article>
                );
              }
              const fieldsText = product.digitalOptions.requiredCustomerFields
                .map((field) => {
                  const value = item.digital?.customerFields?.[field.id];
                  return value ? `${locale === "ar" ? field.labelAr || field.label : field.label}: ${maskAccountValue(value)}` : "";
                })
                .filter(Boolean)
                .join(" · ");
              const serverError = product.digitalOptions.requiredCustomerFields.map((field) => serverFieldError(field.id)).find(Boolean);
              return (
                <article key={item.lineId} className="rounded-[12px] border border-line bg-card p-4 text-sm">
                  <p className="font-medium">
                    {locale === "ar" ? product.nameAr : product.name} × {item.quantity}
                  </p>
                  <p className="mt-1 text-muted">
                    {[item.digital?.platform, item.digital?.regionName, item.digital?.denominationLabel].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-accent">
                    {product.fulfillmentType === "direct_topup" ? t("delivery.topupAfterPayment") : t("delivery.afterPayment")}
                    {fieldsText ? ` · ${fieldsText}` : ""}
                  </p>
                  {problem ? <p className="mt-2 text-xs text-danger">{t(lineProblemKey(problem), { max: 5 })}</p> : null}
                  {serverError ? <p className="mt-2 text-xs text-danger">{serverError}</p> : null}
                  <p className="mt-2 text-xs text-amber">{t("checkout.refundWarn")}</p>
                  <Link href="/cart" className="mt-2 inline-block text-xs text-gold">
                    {t("common.edit")}
                  </Link>
                </article>
              );
            })}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-8 space-y-4 text-sm">
            <p className="break-words">
              <strong>{fullName}</strong> · {email}
              {contact.phone ? ` · ${contact.phone}` : ""}
            </p>
            <p className="rounded-xl border border-line bg-card p-3 text-muted">{t("checkout.payNote")}</p>
            <p className="text-muted">{t("delivery.where")}</p>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-card p-4 leading-5 text-muted">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#F7C037]"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>{t("product.confirmCombined")}</span>
            </label>
            {showErrors && !confirmed ? <p className="text-xs text-danger">{t("checkout.required")}</p> : null}
            <PaymentStep
              input={{
                email,
                fullName,
                phone: contact.phone,
                couponCode: promoCode || undefined,
                items: lines.filter((line) => line.product).map((line) => checkoutLine(line.item, line.product!)),
              }}
              totalFils={totalFils}
              disabled={blocked}
              onBeforePrepare={() => {
                setShowErrors(true);
                if (errors.name || errors.email || errors.phone) {
                  setStep(1);
                  return false;
                }
                return confirmed && !blocked;
              }}
              onFailure={(next) => {
                setFailure(next);
                if (!next?.field) return;
                if (["email", "full_name", "phone"].includes(next.field)) setStep(1);
                else if (next.field !== "coupon_code") setStep(2);
              }}
              onPaid={(orderNumber) => {
                clear();
                router.push(`/order-success?number=${encodeURIComponent(orderNumber)}`);
              }}
            />
          </div>
        ) : null}

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row">
          {step > 1 ? (
            <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setStep((value) => value - 1)}>
              {t("common.back")}
            </Button>
          ) : null}
          {step < 3 ? (
            <Button className="w-full sm:w-auto" disabled={step === 2 && blocked} onClick={goNext}>
              {t("common.continue")}
            </Button>
          ) : null}
        </div>
      </div>
      <aside className="order-first h-fit rounded-[14px] border border-line bg-elevated p-5 lg:order-none">
        <h2 className="font-semibold">{t("cart.summary")}</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {lines.map(({ item, product }) =>
            product ? (
              <li key={item.lineId} className="flex justify-between gap-3">
                <span>
                  {locale === "ar" ? product.nameAr : product.name} × {item.quantity}
                </span>
                <Price amount={linePrice(item, product)} locale={locale} size="sm" />
              </li>
            ) : null,
          )}
        </ul>
        <dl className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t("checkout.subtotal")}</dt>
            <dd>
              <Price amount={subtotal} locale={locale} size="sm" />
            </dd>
          </div>
          {discountFils > 0 ? (
            <div className="flex justify-between text-success">
              <dt>
                {t("checkout.discount")} ({promoCode})
              </dt>
              <dd>{formatDiscount(discountFils, locale)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-line pt-3 font-semibold">
            <dt>{t("checkout.total")}</dt>
            <dd>
              <Price amount={total} locale={locale} />
            </dd>
          </div>
        </dl>
        <UsdEstimate totalFils={totalFils} className="mt-2 text-xs text-muted" />
      </aside>
    </div>
  );
}
