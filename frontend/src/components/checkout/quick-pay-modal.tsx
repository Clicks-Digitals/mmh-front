"use client";

import { PayPalCheckout } from "@/components/checkout/paypal-checkout";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Price } from "@/components/ui/price";
import { ICON_HIT } from "@/components/ui/control";
import { useLanguage } from "@/context/language-context";
import { useEscape, useScrollLock } from "@/hooks/use-overlay";
import { ApiError } from "@/lib/api/client";
import { createPayPalOrder } from "@/lib/api/paypal";
import { STORAGE_KEYS, writeJson } from "@/lib/storage";
import { isValidDemoPhone } from "@/lib/validation";
import type { CartDigitalMeta, Product } from "@/types";
import { User, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { cn } from "@/lib/cn";

function paypalErrorCode(error: ApiError) {
  if (!error.body || typeof error.body !== "object") return "";
  const code = (error.body as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

export interface QuickBuyPayload {
  product: Product;
  quantity: number;
  digital: CartDigitalMeta;
  unitPriceJod: number;
}

export function QuickPayModal({
  open,
  payload,
  onClose,
}: {
  open: boolean;
  payload: QuickBuyPayload | null;
  onClose: () => void;
}) {
  const { t, locale } = useLanguage();
  const { data: session } = useSession();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [prepared, setPrepared] = useState<{
    id: string;
    orderNumber: string;
    checkoutToken: string;
    paypalAmount: string;
    paypalCurrency: string;
  } | null>(null);

  const close = useCallback(() => {
    if (preparing) return;
    setError("");
    setConfirmed(false);
    setPrepared(null);
    onClose();
  }, [onClose, preparing]);

  useScrollLock(open);
  useEscape(open, close);

  if (!open || !payload) return null;

  const total = payload.unitPriceJod * payload.quantity;
  const productName = locale === "ar" ? payload.product.nameAr : payload.product.name;
  const welcomeName = session?.user?.name || session?.user?.email || "";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-overlay/80 backdrop-blur-sm" aria-label={t("nav.close")} onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("buy.payTitle")}
        className="relative z-10 max-h-[min(92dvh,720px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-card p-6 shadow-[0_24px_80px_rgba(23,24,43,0.35)] sm:p-8"
      >
        <button type="button" className={cn(ICON_HIT, "absolute end-3 top-3")} onClick={close} aria-label={t("nav.close")}>
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 pe-10">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-elevated text-brand-deep">
            <User className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm text-muted">
              {t("buy.welcome")}
              {welcomeName ? `, ${welcomeName}` : ""}
            </p>
            <h2 className="text-xl font-bold tracking-tight">{t("buy.payTitle")}</h2>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-line bg-elevated px-4 py-3">
          <div className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-semibold">{productName}</p>
              <p className="mt-1 text-muted">
                {payload.digital.denominationLabel}
                {payload.digital.regionName ? ` · ${payload.digital.regionName}` : ""}
                {` · ×${payload.quantity}`}
              </p>
            </div>
            <Price amount={total} locale={locale} />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3 font-semibold">
            <span>{t("cart.total")}</span>
            <Price amount={total} locale={locale} size="lg" />
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <Field
            label={t("checkout.phone")}
            hint={t("checkout.phoneHint")}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+962 7X XXX XXXX"
            error={phone && !isValidDemoPhone(phone) ? t("checkout.invalidPhone") : undefined}
          />
          <p className="text-xs leading-5 text-muted">{t("checkout.payNote")}</p>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-elevated p-4 text-sm leading-5 text-muted">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#F7C037]"
            checked={confirmed}
            disabled={preparing}
            onChange={(event) => {
              const checked = event.target.checked;
              setConfirmed(checked);
              if (!checked) {
                setPrepared(null);
                return;
              }
              void prepareOrder();
            }}
          />
          <span>{t("product.confirmCombined")}</span>
        </label>

        {prepared ? (
          <p className="mt-4 rounded-xl border border-line bg-elevated p-3 text-sm">
            <span className="text-muted">{t("checkout.paypalCharge")}</span>
            <span className="ms-2 font-semibold">
              {prepared.paypalAmount} {prepared.paypalCurrency}
            </span>
          </p>
        ) : null}
        {preparing ? <p className="mt-3 text-sm text-muted">{t("checkout.paypalPreparing")}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {prepared ? (
          <div className="mt-5">
            <PayPalCheckout
              currencyCode={prepared.paypalCurrency}
              createOrder={async () => {
                try {
                  const created = await createPayPalOrder(prepared.orderNumber, prepared.checkoutToken);
                  if (!created.paypal_order_id) throw new Error(t("checkout.paypalUnavailable"));
                  return { orderId: created.paypal_order_id };
                } catch (err) {
                  if (err instanceof ApiError && paypalErrorCode(err) === "already_paid") {
                    finish(prepared.id, prepared.orderNumber);
                    throw new Error("ALREADY_PAID");
                  }
                  throw err;
                }
              }}
              onPaid={() => finish(prepared.id, prepared.orderNumber)}
              onCancel={() => setError(t("checkout.paypalCancel"))}
              onError={(message) => setError(message)}
            />
          </div>
        ) : null}
        {confirmed && !prepared && !preparing ? (
          <Button className="mt-6 w-full" variant="secondary" onClick={() => void prepareOrder()}>
            {t("checkout.payCard")}
          </Button>
        ) : null}
      </div>
    </div>
  );

  async function prepareOrder() {
    if (!payload) return;
    if (!session?.user?.email) {
      setError(t("buy.needLogin"));
      setConfirmed(false);
      return;
    }
    if (!isValidDemoPhone(phone)) {
      setError(t("checkout.invalidPhone"));
      setConfirmed(false);
      return;
    }
    setPreparing(true);
    setError("");
    const email = session.user.email;
    const fullName = session.user.name?.trim() || email.split("@")[0] || "Customer";
    try {
      const { createStorefrontOrder } = await import("@/server/actions/checkout");
      const result = await createStorefrontOrder({
        email,
        fullName,
        phone: phone.trim(),
        idempotencyKey: `paypal:${payload.product.id}:${payload.digital.denominationId}:${payload.quantity}:${email}`,
        paymentProvider: "paypal",
        items: [
          {
            productId: payload.product.id,
            variantId: payload.digital.denominationId || payload.product.digitalOptions.denominations[0]?.id || payload.product.id,
            quantity: payload.quantity,
            fields: payload.digital.customerFields,
          },
        ],
      });
      if (!result.ok) {
        setError(result.message);
        setConfirmed(false);
        return;
      }
      if (result.paymentStatus === "PAID") {
        finishPaid(result.id, result.orderNumber, fullName, email);
        return;
      }
      if (!result.checkoutToken || !result.paypalAmount || !result.paypalCurrency) {
        setError(t("checkout.paypalUnavailable"));
        setConfirmed(false);
        return;
      }
      setPrepared({
        id: result.id,
        orderNumber: result.orderNumber,
        checkoutToken: result.checkoutToken,
        paypalAmount: result.paypalAmount,
        paypalCurrency: result.paypalCurrency,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("checkout.paypalUnavailable"));
      setConfirmed(false);
    } finally {
      setPreparing(false);
    }
  }

  function finish(orderId: string, orderNumber: string) {
    const email = session?.user?.email || "";
    const fullName = session?.user?.name?.trim() || email.split("@")[0] || "Customer";
    finishPaid(orderId, orderNumber, fullName, email);
  }

  function finishPaid(orderId: string, orderNumber: string, fullName: string, email: string) {
    if (!payload) return;
    writeJson(STORAGE_KEYS.checkout, {
      draft: {
        customer: { fullName, email, phone: phone.trim() },
        digital: {
          method: payload.digital.deliveryMethod,
          contact: payload.digital.deliveryContact,
        },
        payment: { method: "paypal" },
        notes: "",
        regionConfirmed: true,
        refundConfirmed: true,
      },
      items: [
        {
          lineId: `buy-${payload.product.id}`,
          productId: payload.product.id,
          quantity: payload.quantity,
          digital: payload.digital,
          addedAt: new Date().toISOString(),
        },
      ],
      total,
      createdAt: new Date().toISOString(),
      orderId,
      quickBuy: true,
    });
    onClose();
    router.push(`/order-success?ref=${encodeURIComponent(orderId)}&number=${encodeURIComponent(orderNumber)}`);
  }
}
