"use client";

import { PayPalCheckout } from "@/components/checkout/paypal-checkout";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { usePayPalConfig } from "@/hooks/use-paypal-config";
import { ApiError, apiErrorCode } from "@/lib/api/client";
import { createPayPalOrder } from "@/lib/api/paypal";
import { estimatePayPalAmount } from "@/lib/coupon";
import { checkoutFingerprint, resolveAttempt, type CheckoutAttempt } from "@/lib/idempotency";
import type { CheckoutErrorCode, CheckoutResult } from "@/server/actions/checkout";
import { useRef, useState } from "react";

export interface CheckoutInput {
  email: string;
  fullName: string;
  phone?: string;
  notes?: string;
  couponCode?: string;
  items: Array<{
    productId: string;
    variantId?: number;
    denominationId?: string;
    quantity: number;
    fields?: Record<string, string>;
  }>;
}

export interface CheckoutFailure {
  code: CheckoutErrorCode | "paypal";
  message: string;
  field: string;
}

type Prepared = {
  fingerprint: string;
  id: string;
  orderNumber: string;
  checkoutToken: string;
  paypalAmount: string;
  paypalCurrency: string;
};

function formatMoney(amount: number, currency: string, locale: "en" | "ar") {
  try {
    return new Intl.NumberFormat(locale === "ar" ? "ar-JO" : "en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** "Charged in USD (≈ $X)" estimate from the public PayPal FX rate. */
export function UsdEstimate({ totalFils, className }: { totalFils: number; className?: string }) {
  const { t, locale } = useLanguage();
  const config = usePayPalConfig();
  if (!config?.enabled) return null;
  const currency = (config.currency || "USD").toUpperCase();
  if (currency === "JOD") return null;
  const estimate = estimatePayPalAmount(totalFils, config.fx_rate);
  if (estimate == null) return null;
  return (
    <p className={className ?? "text-xs text-muted"}>
      {t("checkout.chargedUsd", { currency, amount: formatMoney(estimate, currency, locale) })}
    </p>
  );
}

export function failureMessage(failure: CheckoutFailure, t: (key: string) => string): string {
  switch (failure.code) {
    case "out_of_stock":
      return `${t("checkout.outOfStock")}${failure.message ? ` (${failure.message})` : ""}`;
    case "order_not_payable":
      return t("checkout.notPayable");
    case "invalid_coupon":
      return t("checkout.couponInvalid");
    case "throttled":
      return t("checkout.throttled");
    case "invalid_input":
      return t("checkout.fixFields");
    case "checkout_error":
      return failure.message || t("checkout.fixFields");
    case "paypal":
      return failure.message || t("checkout.paypalUnavailable");
    default:
      return t("checkout.failed");
  }
}

/**
 * Explicit "Continue to payment" → creates the order (random idempotency key per attempt,
 * reused only for retries of the same attempt) → shows the exact PayPal amount and buttons.
 */
export function PaymentStep({
  input,
  totalFils,
  disabled,
  onFailure,
  onPaid,
  onBeforePrepare,
}: {
  input: CheckoutInput;
  totalFils: number;
  disabled?: boolean;
  onFailure?: (failure: CheckoutFailure | null) => void;
  onPaid: (orderNumber: string) => void;
  /** Return false to stop (e.g. client-side validation failed). */
  onBeforePrepare?: () => boolean;
}) {
  const { t, locale } = useLanguage();
  const attempt = useRef<CheckoutAttempt | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<CheckoutFailure | null>(null);
  const fingerprint = checkoutFingerprint({
    email: input.email,
    fullName: input.fullName,
    phone: input.phone,
    coupon: input.couponCode,
    items: input.items.map((item) => ({ ...item, variantId: item.variantId ?? item.denominationId })),
  });
  // A prepared PayPal order only belongs to the exact cart/details it was created for.
  const current = prepared?.fingerprint === fingerprint ? prepared : null;

  const fail = (failure: CheckoutFailure | null) => {
    setError(failure);
    onFailure?.(failure);
  };

  const prepare = async () => {
    if (onBeforePrepare && !onBeforePrepare()) return;
    attempt.current = resolveAttempt(attempt.current, fingerprint);
    setPreparing(true);
    fail(null);
    try {
      const { createStorefrontOrder } = await import("@/server/actions/checkout");
      const result: CheckoutResult = await createStorefrontOrder({
        ...input,
        phone: input.phone?.trim() || undefined,
        couponCode: input.couponCode || undefined,
        idempotencyKey: attempt.current.key,
        paymentProvider: "paypal",
      });
      if (!result.ok) {
        // A failed attempt with changed inputs gets a fresh key; identical retries reuse it.
        if (result.code === "order_not_payable" || result.code === "out_of_stock") attempt.current = null;
        fail({ code: result.code, message: result.message, field: result.field });
        return;
      }
      if (result.paymentStatus === "PAID") {
        onPaid(result.orderNumber);
        return;
      }
      if (!result.checkoutToken || !result.paypalAmount || !result.paypalCurrency) {
        fail({ code: "paypal", message: t("checkout.paypalUnavailable"), field: "" });
        return;
      }
      setPrepared({
        fingerprint,
        id: result.id,
        orderNumber: result.orderNumber,
        checkoutToken: result.checkoutToken,
        paypalAmount: result.paypalAmount,
        paypalCurrency: result.paypalCurrency,
      });
    } catch {
      fail({ code: "unavailable", message: "", field: "" });
    } finally {
      setPreparing(false);
    }
  };

  const exact = current ? formatMoney(Number(current.paypalAmount), current.paypalCurrency, locale) : "";

  return (
    <div className="space-y-3">
      {current ? (
        <p className="rounded-xl border border-line bg-card p-3 text-sm font-semibold">{t("checkout.chargedExact", { amount: exact })}</p>
      ) : (
        <UsdEstimate totalFils={totalFils} className="text-sm text-muted" />
      )}
      {error ? (
        <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {failureMessage(error, t)}
        </p>
      ) : null}
      {current ? (
        <PayPalCheckout
          currencyCode={current.paypalCurrency}
          createOrder={async () => {
            try {
              const created = await createPayPalOrder(current.orderNumber, current.checkoutToken);
              if (!created.paypal_order_id) throw new Error(t("checkout.paypalUnavailable"));
              return { orderId: created.paypal_order_id };
            } catch (err) {
              const code = err instanceof ApiError ? apiErrorCode(err) : "";
              if (code === "already_paid") {
                onPaid(current.orderNumber);
                throw new Error("ALREADY_PAID");
              }
              if (code === "order_not_payable") {
                setPrepared(null);
                attempt.current = null;
                fail({ code: "order_not_payable", message: "", field: "" });
                throw new Error("ALREADY_PAID");
              }
              throw err;
            }
          }}
          onPaid={() => onPaid(current.orderNumber)}
          onCancel={() => fail({ code: "paypal", message: t("checkout.paypalCancel"), field: "" })}
          onError={(message) => fail({ code: "paypal", message, field: "" })}
        />
      ) : (
        <>
          <Button className="w-full" disabled={disabled || preparing} onClick={() => void prepare()}>
            {preparing ? t("checkout.paypalPreparing") : t("checkout.continueToPayment")}
          </Button>
          <p className="text-xs leading-5 text-muted">{t("checkout.preparePaypal")}</p>
        </>
      )}
    </div>
  );
}
