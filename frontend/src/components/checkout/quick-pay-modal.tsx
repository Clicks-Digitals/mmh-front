"use client";

import { PaymentStep, type CheckoutFailure } from "@/components/checkout/payment-step";
import { Field } from "@/components/ui/field";
import { Price } from "@/components/ui/price";
import { ICON_HIT } from "@/components/ui/control";
import { useLanguage } from "@/context/language-context";
import { useEscape, useScrollLock } from "@/hooks/use-overlay";
import { toFils } from "@/lib/coupon";
import { isValidEmail, isValidPhone } from "@/lib/validation";
import type { CartDigitalMeta, DigitalDenomination, Product } from "@/types";
import { ShoppingBag, X } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { cn } from "@/lib/cn";

export interface QuickBuyPayload {
  product: Product;
  quantity: number;
  digital: CartDigitalMeta;
  denomination: DigitalDenomination;
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
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const signedIn = status === "authenticated" && session?.user?.kind === "CUSTOMER" && Boolean(session.user.email);
  const [emailInput, setEmail] = useState("");
  const [nameInput, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);

  const close = useCallback(() => {
    setConfirmed(false);
    setFailure(null);
    setShowErrors(false);
    onClose();
  }, [onClose]);

  useScrollLock(open);
  useEscape(open, close);

  if (!open || !payload) return null;

  const email = signedIn ? session!.user.email : emailInput.trim();
  const fullName = (signedIn ? session?.user?.name || nameInput : nameInput).trim() || (signedIn ? email.split("@")[0] : "");
  const total = Math.round(payload.denomination.priceJod * 1000 * payload.quantity) / 1000;
  const productName = locale === "ar" ? payload.product.nameAr : payload.product.name;

  const errors = {
    email: !isValidEmail(email) ? t("validation.email") : "",
    name: fullName.length < 2 ? t("validation.required") : "",
    phone: phone.trim() && !isValidPhone(phone) ? t("validation.phone") : "",
    confirm: !confirmed ? t("checkout.required") : "",
  };
  const valid = !errors.email && !errors.name && !errors.phone && !errors.confirm;

  const serverField = failure?.field ?? "";
  const fieldServerError = (key: string) => (serverField === key && failure?.message ? failure.message : "");

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-overlay/80 backdrop-blur-sm" aria-label={t("nav.close")} onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("buy.payTitle")}
        className="relative z-10 max-h-[min(92dvh,760px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-card p-6 shadow-[0_24px_80px_rgba(23,24,43,0.35)] sm:p-8"
      >
        <button type="button" className={cn(ICON_HIT, "absolute end-3 top-3")} onClick={close} aria-label={t("nav.close")}>
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 pe-10">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-elevated text-brand-deep">
            <ShoppingBag className="h-6 w-6" />
          </span>
          <h2 className="text-xl font-bold tracking-tight">{t("buy.payTitle")}</h2>
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
          {fieldServerError("variant_id") || fieldServerError("quantity") || fieldServerError("product_id") ? (
            <p className="mt-2 text-xs text-danger">
              {fieldServerError("variant_id") || fieldServerError("quantity") || fieldServerError("product_id")}
            </p>
          ) : null}
          {payload.product.digitalOptions.requiredCustomerFields.some((field) => fieldServerError(field.id)) ? (
            <p className="mt-2 text-xs text-danger">
              {payload.product.digitalOptions.requiredCustomerFields.map((field) => fieldServerError(field.id)).find(Boolean)}
            </p>
          ) : null}
        </div>

        <div className="mt-5 space-y-3">
          {signedIn ? (
            <p className="text-sm text-muted">{t("checkout.signedInAs", { email })}</p>
          ) : (
            <>
              <Field
                label={t("checkout.email")}
                type="email"
                autoComplete="email"
                value={emailInput}
                onChange={(event) => setEmail(event.target.value)}
                hint={t("checkout.contactHint")}
                error={(showErrors && errors.email) || fieldServerError("email") || undefined}
              />
              <Field
                label={t("checkout.name")}
                autoComplete="name"
                value={nameInput}
                onChange={(event) => setName(event.target.value)}
                error={(showErrors && errors.name) || fieldServerError("full_name") || undefined}
              />
              <p className="text-xs text-muted">
                {t("checkout.signInOptional")}{" "}
                <Link href={`/login?callbackUrl=${encodeURIComponent(pathname || "/")}`} className="font-semibold text-brand-deep hover:text-fg">
                  {t("account.signIn")}
                </Link>
              </p>
            </>
          )}
          <Field
            label={t("checkout.phone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            hint={t("checkout.phoneHint")}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+962 79 123 4567"
            error={(phone && errors.phone) || fieldServerError("phone") || undefined}
          />
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-elevated p-4 text-sm leading-5 text-muted">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#F7C037]"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>{t("product.confirmCombined")}</span>
        </label>
        {showErrors && errors.confirm ? <p className="mt-1 text-xs text-danger">{errors.confirm}</p> : null}

        <p className="mt-4 text-xs leading-5 text-muted">
          {t(payload.product.fulfillmentType === "direct_topup" ? "delivery.topupWhere" : "delivery.where")}
        </p>

        <div className="mt-5">
          <PaymentStep
            input={{
              email,
              fullName,
              phone,
              items: [
                {
                  productId: payload.product.id,
                  ...(payload.denomination.variantId
                    ? { variantId: payload.denomination.variantId }
                    : { denominationId: payload.denomination.id }),
                  quantity: payload.quantity,
                  fields: payload.digital.customerFields,
                },
              ],
            }}
            totalFils={toFils(total)}
            onBeforePrepare={() => {
              setShowErrors(true);
              return valid;
            }}
            onFailure={setFailure}
            onPaid={(orderNumber) => {
              close();
              router.push(`/order-success?number=${encodeURIComponent(orderNumber)}`);
            }}
          />
        </div>
      </div>
    </div>
  );
}
