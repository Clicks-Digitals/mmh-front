"use client";

import { PayPalCheckout } from "@/components/checkout/paypal-checkout";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { usePayPalConfig } from "@/hooks/use-paypal-config";
import { ApiError, apiErrorCode } from "@/lib/api/client";
import { createPayPalOrder } from "@/lib/api/paypal";
import { estimatePayPalAmount } from "@/lib/coupon";
import { couponReasonKey, type CouponReason } from "@/lib/coupon-storage";
import { checkoutFingerprint, resolveAttempt, type CheckoutAttempt } from "@/lib/idempotency";
import { parseStockLines, stockLineName, type StockLine } from "@/lib/stock-errors";
import type { CheckoutErrorCode, CheckoutResult } from "@/server/actions/checkout";
import type { Locale } from "@/types";
import { useRef, useState } from "react";

export interface CheckoutInput {
  email: string;
  fullName: string;
  phone?: string;
  notes?: string;
  /** D9: emails are sent in this language. */
  locale?: Locale;
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
  /** D2: every cart line that is short of stock. */
  lines?: StockLine[];
}

const COUPON_FAILURES = new Set<string>([
  "invalid_coupon",
  "coupon_expired",
  "coupon_not_started",
  "coupon_limit_reached",
  "coupon_customer_limit",
]);

export function isCouponFailure(failure: CheckoutFailure | null): boolean {
  return Boolean(failure && COUPON_FAILURES.has(failure.code));
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
    return new Intl.NumberFormat(locale === "ar" ? "ar-JO-u-nu-latn" : "en-US", { style: "currency", currency }).format(amount);
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

export function failureMessage(failure: CheckoutFailure, t: (key: string, values?: Record<string, string | number>) => string): string {
  if (COUPON_FAILURES.has(failure.code)) {
    return `${t("coupon.removedNotice")} ${t(couponReasonKey(failure.code as CouponReason))}`;
  }
  switch (failure.code) {
    case "out_of_stock":
      return failure.lines?.length ? t("stock.someLines") : `${t("checkout.outOfStock")}${failure.message ? ` (${failure.message})` : ""}`;
    case "order_not_payable":
      return t("checkout.notPayable");
    case "account_disabled":
      return t("auth.accountDisabled");
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
/** D2: the failing lines of a 409 out_of_stock, in the current language. */
export function StockLinesList({ lines }: { lines?: StockLine[] }) {
  const { t, locale } = useLanguage();
  if (!lines?.length) return null;
  return (
    <ul className="mt-2 list-disc space-y-1 ps-5">
      {lines.map((line) => (
        <li key={`${line.productId}-${line.variantId ?? ""}`}>
          {t(line.available > 0 ? "stock.lineOnlyN" : "stock.lineNone", {
            name: stockLineName(line, locale),
            count: line.available,
            requested: line.requested,
          })}
        </li>
      ))}
    </ul>
  );
}

export function PaymentStep({
  input,
  totalFils,
  disabled,
  freeOrder = false,
  onFailure,
  onPaid,
  onBeforePrepare,
}: {
  input: CheckoutInput;
  totalFils: number;
  disabled?: boolean;
  /** D6: the coupon covers the whole order — no PayPal, the order is placed as paid. */
  freeOrder?: boolean;
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
    coupon: `${input.couponCode ?? ""}|${(input.notes ?? "").trim()}`,
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
        notes: input.notes?.trim() || undefined,
        locale: input.locale ?? locale,
        idempotencyKey: attempt.current.key,
        paymentProvider: "paypal",
      });
      if (!result.ok) {
        // A failed attempt with changed inputs gets a fresh key; identical retries reuse it.
        if (result.code === "order_not_payable" || result.code === "out_of_stock" || COUPON_FAILURES.has(result.code)) {
          attempt.current = null;
        }
        fail({ code: result.code, message: result.message, field: result.field, lines: result.lines });
        return;
      }
      if (result.freeOrder || result.paymentStatus === "PAID") {
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
      {freeOrder ? (
        <p className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">{t("coupon.freeOrder")}</p>
      ) : current ? (
        <p className="rounded-xl border border-line bg-card p-3 text-sm font-semibold">{t("checkout.chargedExact", { amount: exact })}</p>
      ) : (
        <UsdEstimate totalFils={totalFils} className="text-sm text-muted" />
      )}
      {error ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          <p>{failureMessage(error, t)}</p>
          <StockLinesList lines={error.lines} />
        </div>
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
              if (code === "out_of_stock") {
                setPrepared(null);
                attempt.current = null;
                fail({
                  code: "out_of_stock",
                  message: "",
                  field: "",
                  lines: err instanceof ApiError ? parseStockLines(err.body) : [],
                });
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
            {preparing
              ? t(freeOrder ? "checkout.placingFree" : "checkout.paypalPreparing")
              : t(freeOrder ? "checkout.placeFreeOrder" : "checkout.continueToPayment")}
          </Button>
          {freeOrder ? null : <p className="text-xs leading-5 text-muted">{t("checkout.preparePaypal")}</p>}
        </>
      )}
    </div>
  );
}
