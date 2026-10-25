"use client";

import { OrderDetail } from "@/components/orders/order-detail";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { orderStatusCopy } from "@/lib/order-copy";
import type { OrderView } from "@/lib/orders";
import { ShieldCheck } from "lucide-react";

/** Shown when the order cannot be opened (missing number, someone else's order, expired link). */
export function OrderUnavailable({ signedIn = false }: { signedIn?: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="container-mmh max-w-2xl py-16 text-center">
      <h1 className="text-2xl font-semibold">{t("order.unavailableTitle")}</h1>
      <p className="mt-3 text-sm text-muted">{t(signedIn ? "order.unavailableSignedIn" : "order.unavailableBody")}</p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        {signedIn ? <Button href="/account/orders">{t("success.orders")}</Button> : <Button href="/order-lookup">{t("order.lookupCta")}</Button>}
        <Button href="/shop" variant="outline">
          {t("success.continue")}
        </Button>
      </div>
    </div>
  );
}

export function OrderSuccessView({
  order,
  canReveal,
  urlToken,
  signedIn = false,
}: {
  order: OrderView | null;
  canReveal: boolean;
  urlToken?: string;
  signedIn?: boolean;
}) {
  const { t } = useLanguage();

  if (!order) return <OrderUnavailable signedIn={signedIn} />;

  return (
    <div className="container-mmh max-w-3xl py-10 md:py-16">
      <OrderDetail
        initial={order}
        canReveal={canReveal}
        urlToken={urlToken}
        poll
        heading={(live) => {
          const copy = orderStatusCopy(live);
          return (
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">MMH</p>
              <h1 className="mt-3 text-2xl font-bold sm:text-3xl">{t(copy.title, copy.values)}</h1>
              {copy.body ? <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">{t(copy.body, copy.values)}</p> : null}
            </div>
          );
        }}
      />
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-brand/15 bg-brand/5 p-4 text-sm text-muted">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <p>{t(signedIn ? "success.saveNumberSignedIn" : "success.saveNumber")}</p>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        {signedIn ? (
          <Button href="/account/orders">{t("success.orders")}</Button>
        ) : (
          <Button href="/order-lookup">{t("success.lookup")}</Button>
        )}
        <Button href="/shop" variant="outline">
          {t("success.continue")}
        </Button>
        <Button href="/contact" variant="ghost">
          {t("success.support")}
        </Button>
      </div>
    </div>
  );
}
