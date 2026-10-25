"use client";

import { CouponBox } from "@/components/cart/coupon-box";
import { isCouponFailure, PaymentStep, StockLinesList, UsdEstimate, type CheckoutFailure } from "@/components/checkout/payment-step";
import { Button } from "@/components/ui/button";
import { TEXTAREA } from "@/components/ui/control";
import { Field } from "@/components/ui/field";
import { Price } from "@/components/ui/price";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { checkoutLine, lineDenomination, lineFieldsText, lineLimits, lineProblem, lineProblemKey, linePrice } from "@/lib/cart";
import { stockCartUpdates, type StockLine } from "@/lib/stock-errors";
import { formatDiscount } from "@/lib/coupon";
import { getProductById } from "@/data/products";
import { cn } from "@/lib/cn";
import { isValidEmail, isValidPhone, MAX_CUSTOMER_NOTE } from "@/lib/validation";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";

type Contact = { fullName: string; email: string; phone: string };

export function CheckoutView() {
  const {
    items,
    subtotal,
    total,
    discountFils,
    totalFils,
    promoCode,
    freeOrder,
    removePromo,
    setCouponEmail,
    clear,
    hydrated,
    removeItem,
    updateQty,
  } = useCart();
  const { t, locale } = useLanguage();
  const { data: session, status } = useSession();
  const router = useRouter();
  const sessionEmail = status === "authenticated" && session?.user?.kind === "CUSTOMER" ? session.user.email : "";
  const [step, setStep] = useState(1);
  const [contact, setContact] = useState<Contact>({ fullName: "", email: "", phone: "" });
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);
  /** Sold out between "Continue to payment" and PayPal (409 out_of_stock): shown on every step. */
  const [stockNotice, setStockNotice] = useState<StockLine[] | null>(null);

  const email = (contact.email || sessionEmail).trim();
  const fullName = (contact.fullName || (sessionEmail ? session?.user?.name ?? "" : "")).trim();

  const errors = {
    name: fullName.length < 2 ? t("validation.required") : "",
    email: !isValidEmail(email) ? t("validation.email") : "",
    phone: contact.phone.trim() && !isValidPhone(contact.phone) ? t("validation.phone") : "",
    notes: notes.length > MAX_CUSTOMER_NOTE ? t("validation.tooLongN", { max: MAX_CUSTOMER_NOTE }) : "",
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
      // OR-25: per-customer coupon limits are checked once the email is known.
      setCouponEmail(email);
    }
    if (step === 2 && blocked) return;
    if (step === 2) setStockNotice(null);
    setStep((value) => Math.min(3, value + 1));
  };

  const applyStockProblem = (stockLines: StockLine[]) => {
    const updates = stockCartUpdates(
      items.map((item) => {
        const product = getProductById(item.productId);
        const denomination = product ? lineDenomination(item, product) : undefined;
        return { lineId: item.lineId, productId: item.productId, variantId: denomination?.variantId ?? null, quantity: item.quantity };
      }),
      stockLines,
    );
    for (const update of updates) {
      if (update.remove) removeItem(update.lineId);
      else updateQty(update.lineId, update.quantity);
    }
    setStockNotice(stockLines);
    setConfirmed(false);
    setStep(2);
  };

  const stockBanner = stockNotice ? (
    <div className="mt-6 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger" role="alert">
      <p className="font-semibold">{t("checkout.stockSoldOutTitle")}</p>
      {stockNotice.length ? <StockLinesList lines={stockNotice} /> : <p className="mt-1">{t("checkout.outOfStock")}</p>}
      <p className="mt-2">{items.length ? t("checkout.stockCartUpdated") : t("checkout.stockCartEmpty")}</p>
    </div>
  ) : null;

  if (!hydrated) return <div className="container-mmh py-16">{t("common.loading")}</div>;
  if (items.length === 0) {
    return (
      <div className="container-mmh py-16">
        {stockBanner}
        <p className={stockBanner ? "mt-4 text-muted" : "text-muted"}>{t("cart.empty")}</p>
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

        {stockBanner}

        {step === 1 ? (
          <div className="mt-8 space-y-4">
            {sessionEmail ? (
              <p className="text-sm text-muted">{t("checkout.signedInAs", { email: sessionEmail })}</p>
            ) : (
              <p className="text-sm text-muted">
                {t("checkout.signInOptional")}{" "}
                <Link href="/login?callbackUrl=%2Fcheckout" className="font-semibold text-gold underline-offset-2 hover:underline">
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
              dir="ltr"
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
              dir="ltr"
              placeholder="+962 79 123 4567"
              hint={t("checkout.phoneHint")}
              value={contact.phone}
              error={errors.phone || serverFieldError("phone") || undefined}
              onChange={(event) => setContact((current) => ({ ...current, phone: event.target.value }))}
            />
            {freeOrder ? null : <UsdEstimate totalFils={totalFils} className="text-sm text-muted" />}
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
              const fieldsText = lineFieldsText(item, product, locale);
              const serverError = product.digitalOptions.requiredCustomerFields.map((field) => serverFieldError(field.id)).find(Boolean);
              const topup = product.fulfillmentType === "direct_topup";
              return (
                <article key={item.lineId} className="rounded-[12px] border border-line bg-card p-4 text-sm">
                  <p className="font-medium">
                    {locale === "ar" ? product.nameAr : product.name} × {item.quantity}
                  </p>
                  <p className="mt-1 text-muted">
                    {[item.digital?.platform, topup ? "" : item.digital?.regionName, item.digital?.denominationLabel].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-muted">
                    {topup ? t("delivery.topupAfterPayment") : t("delivery.afterPayment")}
                    {fieldsText ? ` · ${fieldsText}` : ""}
                  </p>
                  {problem ? <p className="mt-2 text-xs text-danger">{t(lineProblemKey(problem), { max: lineLimits(item, product).max })}</p> : null}
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
              <strong>{fullName}</strong> · <span dir="ltr">{email}</span>
              {contact.phone ? (
                <>
                  {" · "}
                  <span dir="ltr">{contact.phone}</span>
                </>
              ) : null}
            </p>
            {freeOrder ? null : <p className="rounded-xl border border-line bg-card p-3 text-muted">{t("checkout.payNote")}</p>}
            <p className="text-muted">{t("delivery.where")}</p>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-fg">{t("checkout.notesLabel")}</span>
              <textarea
                className={cn(TEXTAREA, "min-h-24", errors.notes && "border-danger")}
                value={notes}
                maxLength={MAX_CUSTOMER_NOTE}
                placeholder={t("checkout.notesPlaceholder")}
                onChange={(event) => setNotes(event.target.value)}
              />
              <span className={cn("flex justify-between text-xs", errors.notes ? "text-danger" : "text-muted")}>
                <span>{errors.notes || t("checkout.notesHint")}</span>
                <span dir="ltr">
                  {notes.length}/{MAX_CUSTOMER_NOTE}
                </span>
              </span>
            </label>
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
                notes,
                locale,
                couponCode: promoCode || undefined,
                items: lines.filter((line) => line.product).map((line) => checkoutLine(line.item, line.product!)),
              }}
              totalFils={totalFils}
              freeOrder={freeOrder}
              disabled={blocked}
              onBeforePrepare={() => {
                setShowErrors(true);
                if (errors.name || errors.email || errors.phone) {
                  setStep(1);
                  return false;
                }
                if (errors.notes) return false;
                return confirmed && !blocked;
              }}
              onFailure={(next) => {
                setFailure(next);
                if (!next) return;
                if (next.code === "out_of_stock") {
                  // Keep the customer here: name what sold out, fix the cart, back to the item review.
                  applyStockProblem(next.lines ?? []);
                  return;
                }
                // The coupon was rejected at order time: drop it so the totals are honest again.
                if (isCouponFailure(next)) {
                  removePromo();
                  return;
                }
                if (!next.field) return;
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
                {t("checkout.discount")} (<span dir="ltr">{promoCode}</span>)
              </dt>
              <dd>{formatDiscount(discountFils, locale)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-line pt-3 font-semibold">
            <dt>{t("checkout.total")}</dt>
            <dd>{freeOrder ? <span className="text-success">{t("order.free")}</span> : <Price amount={total} locale={locale} />}</dd>
          </div>
        </dl>
        {freeOrder ? null : <UsdEstimate totalFils={totalFils} className="mt-2 text-xs text-muted" />}
        <CouponBox email={isValidEmail(email) ? email : ""} />
      </aside>
    </div>
  );
}
