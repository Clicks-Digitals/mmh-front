"use client";

import { ChangePasswordCard, ProfileCard } from "@/components/account/account-settings";
import { ItemFields, itemTitle, OrderDetail, StatusPill } from "@/components/orders/order-detail";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { formatDate, formatJod } from "@/lib/format";
import { customerStatusKey, customerStatusTone, orderStatusCopy } from "@/lib/order-copy";
import { isClosed, type OrderView } from "@/lib/orders";
import type { CustomerProfile } from "@/server/account/profile";
import { KeyRound, PackageCheck, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";

export type CustomerOrderSummary = OrderView;

/** Orders whose items count as bought (D1: unpaid, cancelled and expired orders are excluded). */
function boughtOrders(orders: OrderView[]) {
  return orders.filter((order) => !["awaiting_payment", "payment_failed", "cancelled", "expired"].includes(order.status));
}

function countItems(orders: OrderView[], type: "CODE" | "DIRECT_TOPUP") {
  return boughtOrders(orders)
    .flatMap((order) => order.items)
    .filter((item) => item.fulfillmentType === type).length;
}

export function CustomerAccount({ profile, orders }: { profile: CustomerProfile; orders: OrderView[] }) {
  const { t } = useLanguage();
  const awaiting = orders.filter((order) => order.status === "awaiting_payment" && order.canPay);
  const cards = [
    { href: "/account/orders", label: t("account.ordersCount"), count: orders.length, icon: ShoppingBag },
    { href: "/account/codes", label: t("account.codesCount"), count: countItems(orders, "CODE"), icon: KeyRound },
    { href: "/account/top-ups", label: t("account.topupsCount"), count: countItems(orders, "DIRECT_TOPUP"), icon: PackageCheck },
  ];
  return (
    <div className="container-mmh py-8 sm:py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">MMH</p>
          <h1 className="mt-2 text-3xl font-bold">{profile.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {profile.email}
            {profile.phone ? (
              <>
                {" · "}
                <span dir="ltr">{profile.phone}</span>
              </>
            ) : null}
          </p>
        </div>
        <Button variant="secondary" onClick={() => signOut({ callbackUrl: "/" })}>
          {t("account.signOut")}
        </Button>
      </div>
      {awaiting.length ? (
        <div className="mt-6 rounded-2xl border border-amber/30 bg-amber/5 p-4 text-sm">
          <p className="font-medium">{t("account.awaitingNotice", { count: awaiting.length })}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {awaiting.slice(0, 5).map((order) => (
              <li key={order.id}>
                <Link href={`/account/orders/${order.number}`} className="font-mono text-xs font-semibold text-gold underline" dir="ltr">
                  {order.number}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {cards.map(({ href, label, count, icon: Icon }) => (
          <Link key={href} href={href} className="rounded-2xl border border-line bg-card p-5 shadow-sm transition hover:border-brand/30">
            <Icon className="h-5 w-5 text-brand" />
            <p className="mt-4 text-sm text-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold">{count}</p>
          </Link>
        ))}
      </div>
      <ProfileCard profile={profile} />
      <ChangePasswordCard />
    </div>
  );
}

export function CustomerOrders({ orders, mode = "all" }: { orders: OrderView[]; mode?: "all" | "codes" | "topups" }) {
  const { t, locale } = useLanguage();
  const title = t(mode === "codes" ? "account.codesTitle" : mode === "topups" ? "account.topupsTitle" : "account.ordersTitle");
  const source = mode === "all" ? orders : boughtOrders(orders);
  const filtered = source
    .map((order) => ({
      ...order,
      items: order.items.filter(
        (item) => mode === "all" || (mode === "codes" ? item.fulfillmentType === "CODE" : item.fulfillmentType === "DIRECT_TOPUP"),
      ),
    }))
    .filter((order) => order.items.length);

  return (
    <div className="container-mmh py-8 sm:py-12">
      <h1 className="text-3xl font-bold">{title}</h1>
      {mode === "codes" ? <p className="mt-2 text-sm text-muted">{t("account.codesPaidOnly")}</p> : null}
      {filtered.length ? (
        <div className="mt-7 space-y-4">
          {filtered.map((order) => {
            const closed = isClosed(order);
            const unpaid = order.status === "awaiting_payment" || order.status === "payment_failed";
            return (
              <article key={order.id} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/account/orders/${order.number}`} className="font-mono font-bold text-gold" dir="ltr">
                      {order.number}
                    </Link>
                    <p className="mt-1 text-xs text-muted">{formatDate(order.createdAt, locale)}</p>
                  </div>
                  <span className="font-semibold">{order.totalFils === 0 ? t("order.free") : formatJod(order.totalFils / 1000, locale)}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <StatusPill tone={customerStatusTone(order.status)} label={t(customerStatusKey(order.status))} />
                </div>
                <ul className="mt-4 divide-y divide-line">
                  {order.items.map((item) => (
                    <li key={item.id} className="py-3 text-sm">
                      <p className="font-medium">
                        {itemTitle(item, locale)} × {item.quantity}
                      </p>
                      <ItemFields item={item} locale={locale} />
                      {closed || unpaid ? null : item.fulfillmentType === "CODE" ? (
                        item.codes.length ? (
                          <>
                            {item.codes.map((code) => (
                              <p key={code.id} className="mt-1 font-mono text-xs text-muted" dir="ltr">
                                {code.masked}
                              </p>
                            ))}
                            {item.codesPending ? (
                              <p className="mt-1 text-xs text-amber">
                                {t("order.partialItem", { delivered: item.codesDelivered ?? item.codes.length, total: item.quantity })}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <p className="mt-1 text-xs text-muted">{t("order.codePending")}</p>
                        )
                      ) : (
                        <p className="mt-1 text-xs text-muted">{item.delivered ? t("order.topupDone") : t("order.topupPending")}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <Button
                  href={`/account/orders/${order.number}`}
                  variant={unpaid && order.canPay ? "primary" : "outline"}
                  size="sm"
                  className="mt-2"
                >
                  {actionLabel(order, t)}
                </Button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">
          {t("account.empty")}
          <div>
            <Button className="mt-5" href="/shop">
              {t("account.browse")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function actionLabel(order: OrderView, t: (key: string) => string) {
  if ((order.status === "awaiting_payment" || order.status === "payment_failed") && order.canPay) return t("orderActions.pay");
  const revealable =
    (order.status === "processing" || order.status === "delivered" || order.status === "partially_refunded") &&
    order.items.some((item) => item.fulfillmentType === "CODE" && item.codes.length);
  return revealable ? t("order.reveal") : t("order.viewDetails");
}

export function CustomerOrderDetail({ order }: { order: OrderView }) {
  const { t } = useLanguage();
  return (
    <div className="container-mmh max-w-3xl py-8 sm:py-12">
      <Link href="/account/orders" className="text-sm font-semibold text-gold hover:text-fg">
        <span aria-hidden className="inline-block rtl-flip">
          ←
        </span>{" "}
        {t("order.backToOrders")}
      </Link>
      <div className="mt-4">
        <OrderDetail
          initial={order}
          canReveal
          poll
          heading={(live) => {
            const copy = orderStatusCopy(live);
            return (
              <div>
                <h1 className="text-2xl font-bold sm:text-3xl">{t("order.title", { number: order.number })}</h1>
                <p className="mt-2 font-semibold">{t(copy.title, copy.values)}</p>
                {copy.body ? <p className="mt-1 text-sm leading-6 text-muted">{t(copy.body, copy.values)}</p> : null}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
