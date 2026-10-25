"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useCart } from "@/context/cart-context";
import { useLanguage } from "@/context/language-context";
import { useToast } from "@/context/toast-context";
import { couponReasonKey } from "@/lib/coupon-storage";
import { useState } from "react";

/** ST-03 / OR-25 / D6: coupon field, applied coupon line, specific reasons and free-order note. */
export function CouponBox({ email = "" }: { email?: string }) {
  const { t } = useLanguage();
  const { push } = useToast();
  const { applyPromo, removePromo, promoError, promoChecking, promoCode, promoPending, freeOrder, couponNotice, dismissCouponNotice } =
    useCart();
  const [code, setCode] = useState("");
  return (
    <div className="mt-4">
      {couponNotice ? (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-xl border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber" role="status">
          <span>
            {t("coupon.removedNotice")} {t(couponReasonKey(couponNotice))}
          </span>
          <button type="button" className="shrink-0 px-1 text-muted hover:text-fg" onClick={dismissCouponNotice} aria-label={t("nav.close")}>
            ×
          </button>
        </div>
      ) : null}
      {promoCode ? (
        <div className="flex items-center justify-between rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm">
          <span className="font-semibold text-success" dir="ltr">
            {promoCode}
          </span>
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={removePromo}>
            {t("cart.promoRemove")}
          </button>
        </div>
      ) : promoPending ? (
        <p className="rounded-xl border border-line bg-card px-3 py-2 text-xs text-muted">{t("coupon.rechecking", { code: promoPending })}</p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await applyPromo(code, email);
            if (result === "ok") {
              setCode("");
              push({ title: t("cart.promoOk"), tone: "success" });
            }
          }}
        >
          <Field label={t("cart.promo")} value={code} onChange={(event) => setCode(event.target.value)} maxLength={40} dir="ltr" />
          <Button type="submit" variant="secondary" className="mt-2 w-full" disabled={promoChecking || !code.trim()}>
            {promoChecking ? t("cart.promoChecking") : t("cart.promoApply")}
          </Button>
        </form>
      )}
      {promoError && !promoCode ? <p className="mt-2 text-xs text-danger">{t(couponReasonKey(promoError))}</p> : null}
      {freeOrder ? <p className="mt-2 rounded-xl bg-success/10 px-3 py-2 text-xs text-success">{t("coupon.freeOrder")}</p> : null}
    </div>
  );
}
