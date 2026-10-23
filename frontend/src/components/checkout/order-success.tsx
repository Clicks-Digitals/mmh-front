"use client";

import { OrderDetail } from "@/components/orders/order-detail";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { deliveredCodeCount, isDelivered, isPaid, type OrderView } from "@/lib/orders";
import { ShieldCheck } from "lucide-react";

function headline(order: OrderView, t: (key: string, values?: Record<string, string | number>) => string) {
  const codes = order.items.some((item) => item.fulfillmentType === "CODE");
  const topups = order.items.some((item) => item.fulfillmentType === "DIRECT_TOPUP");
  if (order.paymentStatus === "CANCELLED" || order.fulfillmentStatus === "CANCELLED") {
    return { title: t("success.cancelledTitle"), body: "" };
  }
  if (!isPaid(order)) return { title: t("success.pendingTitle"), body: t("success.pendingBody") };
  if (order.fulfillmentStatus === "MANUAL_REVIEW") return { title: t("success.paidTitle"), body: t("success.reviewBody") };
  const title = codes && isDelivered(order) && deliveredCodeCount(order) > 0 ? t("success.codesReadyTitle") : t("success.paidTitle");
  if (codes && topups) return { title, body: t("success.mixedBody") };
  if (topups) return { title, body: t("success.topupBody") };
  return {
    title,
    body: order.email ? t("success.codeBody", { email: order.email }) : t("success.codeBodyNoEmail"),
  };
}

export function OrderSuccessView({
  order,
  canReveal,
  urlToken,
}: {
  order: OrderView | null;
  canReveal: boolean;
  urlToken?: string;
}) {
  const { t } = useLanguage();

  if (!order) {
    return (
      <div className="container-mmh max-w-2xl py-16 text-center">
        <h1 className="text-2xl font-semibold">{t("order.unavailableTitle")}</h1>
        <p className="mt-3 text-sm text-muted">{t("order.unavailableBody")}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button href="/order-lookup">{t("order.lookupCta")}</Button>
          <Button href="/shop" variant="outline">
            {t("success.continue")}
          </Button>
        </div>
      </div>
    );
  }

  const copy = headline(order, t);

  return (
    <div className="container-mmh max-w-3xl py-10 md:py-16">
      <OrderDetail
        initial={order}
        canReveal={canReveal}
        urlToken={urlToken}
        poll
        heading={
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-deep">MMH</p>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">{copy.title}</h1>
            {copy.body ? <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">{copy.body}</p> : null}
          </div>
        }
      />
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-brand/15 bg-brand/5 p-4 text-sm text-muted">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <p>{t("success.saveNumber")}</p>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button href="/account/orders">{t("success.orders")}</Button>
        <Button href="/order-lookup" variant="outline">
          {t("success.lookup")}
        </Button>
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
