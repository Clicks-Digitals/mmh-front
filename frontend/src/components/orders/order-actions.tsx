"use client";

import { PayPalCheckout } from "@/components/checkout/paypal-checkout";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { usePayPalConfig } from "@/hooks/use-paypal-config";
import type { OrderView } from "@/lib/orders";
import { stockLineMessage, type StockLine } from "@/lib/stock-errors";
import { useState } from "react";

/**
 * D1: an unpaid order can be paid later ("Complete payment" re-opens PayPal for this same order)
 * or cancelled by the customer.
 */
export function UnpaidOrderActions({
  order,
  urlToken,
  onChanged,
}: {
  order: OrderView;
  urlToken?: string;
  /** Called after payment or cancellation with the fresh order (or null to re-load). */
  onChanged: (next: OrderView | null) => void;
}) {
  const { t, locale } = useLanguage();
  const config = usePayPalConfig();
  const [paying, setPaying] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState<StockLine[]>([]);

  if (!order.canPay && !order.canCancel) return null;

  const cancel = async () => {
    setBusy(true);
    setError("");
    try {
      const { cancelOrderAction } = await import("@/server/actions/orders");
      const result = await cancelOrderAction(order.number, urlToken);
      if (result.ok) {
        setConfirmCancel(false);
        onChanged(result.order);
        return;
      }
      setError(
        t(
          result.error === "already_paid"
            ? "orderActions.cancelPaid"
            : result.error === "payment_in_progress"
              ? "orderActions.cancelInProgress"
              : result.error === "throttled"
                ? "checkout.throttled"
                : result.error === "not_found"
                  ? "orderActions.noAccess"
                  : "orderActions.cancelFailed",
        ),
      );
    } catch {
      setError(t("orderActions.cancelFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-amber/30 bg-amber/5 p-5" aria-label={t("orderActions.title")}>
      <h2 className="font-semibold">{t("orderActions.title")}</h2>
      <p className="mt-1 text-sm text-muted">{t(order.canPay ? "orderActions.body" : "orderActions.bodyCancelOnly")}</p>
      {error ? (
        <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {lines.length ? (
        <ul className="mt-2 space-y-1 text-sm text-danger">
          {lines.map((line) => {
            const message = stockLineMessage(line, locale);
            return <li key={`${line.productId}-${line.variantId ?? ""}`}>{t(message.key, message.values)}</li>;
          })}
        </ul>
      ) : null}
      {paying && order.canPay ? (
        <div className="mt-4">
          <PayPalCheckout
            currencyCode={(config?.currency || "USD").toUpperCase()}
            createOrder={async () => {
              setError("");
              setLines([]);
              const { startOrderPaymentAction } = await import("@/server/actions/orders");
              const result = await startOrderPaymentAction(order.number, urlToken);
              if (result.ok) return { orderId: result.paypalOrderId };
              if (result.error === "already_paid") {
                onChanged(null);
                throw new Error("ALREADY_PAID");
              }
              if (result.error === "out_of_stock") setLines(result.lines);
              const message = t(
                result.error === "out_of_stock"
                  ? "orderActions.outOfStock"
                  : result.error === "not_payable"
                    ? "orderActions.notPayable"
                    : result.error === "throttled"
                      ? "checkout.throttled"
                      : result.error === "not_found"
                        ? "orderActions.noAccess"
                        : "checkout.paypalUnavailable",
              );
              setError(message);
              throw new Error("ALREADY_PAID");
            }}
            onPaid={() => onChanged(null)}
            onCancel={() => setError(t("checkout.paypalCancel"))}
            onError={(message) => setError(message)}
          />
        </div>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {order.canPay && !paying ? (
          <Button onClick={() => setPaying(true)} className="sm:w-auto">
            {t("orderActions.pay")}
          </Button>
        ) : null}
        {order.canCancel && !confirmCancel ? (
          <Button variant="outline" onClick={() => setConfirmCancel(true)} disabled={busy}>
            {t("orderActions.cancel")}
          </Button>
        ) : null}
      </div>
      {confirmCancel ? (
        <div className="mt-4 rounded-xl border border-line bg-card p-4 text-sm" role="alertdialog" aria-label={t("orderActions.cancelConfirmTitle")}>
          <p className="font-medium">{t("orderActions.cancelConfirmTitle")}</p>
          <p className="mt-1 text-muted">{t("orderActions.cancelConfirmBody")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void cancel()} disabled={busy}>
              {busy ? t("common.loading") : t("orderActions.cancelYes")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmCancel(false)} disabled={busy}>
              {t("orderActions.cancelNo")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
