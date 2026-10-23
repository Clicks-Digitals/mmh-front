"use client";

import { OrderDetail } from "@/components/orders/order-detail";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { formatDate, formatJod } from "@/lib/format";
import { fulfillmentStatusKey, paymentStatusKey } from "@/lib/order-status";
import type { OrderView } from "@/lib/orders";
import { KeyRound, PackageCheck, ShoppingBag, UserRound } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";

export type CustomerOrderSummary = OrderView;

function countItems(orders: OrderView[], type: "CODE" | "DIRECT_TOPUP") {
  return orders.flatMap((order) => order.items).filter((item) => item.fulfillmentType === type).length;
}

export function CustomerAccount({
  profile,
  orders,
}: {
  profile: { name: string; email: string; phone: string };
  orders: OrderView[];
}) {
  const { t } = useLanguage();
  const cards = [
    { href: "/account/orders", label: t("account.ordersCount"), count: orders.length, icon: ShoppingBag },
    { href: "/account/codes", label: t("account.codesCount"), count: countItems(orders, "CODE"), icon: KeyRound },
    { href: "/account/top-ups", label: t("account.topupsCount"), count: countItems(orders, "DIRECT_TOPUP"), icon: PackageCheck },
  ];
  return (
    <div className="container-mmh py-8 sm:py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-deep">MMH</p>
          <h1 className="mt-2 text-3xl font-bold">{profile.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {profile.email}
            {profile.phone ? ` · ${profile.phone}` : ""}
          </p>
        </div>
        <Button variant="secondary" onClick={() => signOut({ callbackUrl: "/" })}>
          {t("account.signOut")}
        </Button>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {cards.map(({ href, label, count, icon: Icon }) => (
          <Link key={href} href={href} className="rounded-2xl border border-line bg-card p-5 shadow-sm transition hover:border-brand/30">
            <Icon className="h-5 w-5 text-brand" />
            <p className="mt-4 text-sm text-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold">{count}</p>
          </Link>
        ))}
      </div>
      <section className="mt-10">
        <h2 className="font-semibold">{t("account.profile")}</h2>
        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-line bg-card p-5">
          <UserRound className="h-5 w-5 text-brand" />
          <div>
            <p className="font-medium">{profile.name}</p>
            <p className="text-sm text-muted">{profile.email}</p>
            {profile.phone ? <p className="text-sm text-muted">{profile.phone}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export function CustomerOrders({ orders, mode = "all" }: { orders: OrderView[]; mode?: "all" | "codes" | "topups" }) {
  const { t, locale } = useLanguage();
  const title = t(mode === "codes" ? "account.codesTitle" : mode === "topups" ? "account.topupsTitle" : "account.ordersTitle");
  const filtered = orders
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
      {filtered.length ? (
        <div className="mt-7 space-y-4">
          {filtered.map((order) => (
            <article key={order.id} className="rounded-2xl border border-line bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/account/orders/${order.number}`} className="font-mono font-bold text-brand-deep" dir="ltr">
                    {order.number}
                  </Link>
                  <p className="mt-1 text-xs text-muted">{formatDate(order.createdAt, locale)}</p>
                </div>
                <span className="font-semibold">{formatJod(order.totalFils / 1000, locale)}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-gold/16 px-3 py-1.5">
                  {t("order.payment")}: {t(paymentStatusKey(order.paymentStatus))}
                </span>
                <span className="rounded-full bg-elevated px-3 py-1.5">
                  {t("order.fulfillment")}: {t(fulfillmentStatusKey(order.fulfillmentStatus))}
                </span>
              </div>
              <ul className="mt-4 divide-y divide-line">
                {order.items.map((item) => (
                  <li key={item.id} className="py-3 text-sm">
                    <p className="font-medium">
                      {item.productName}
                      {item.variantName ? ` · ${item.variantName}` : ""} × {item.quantity}
                    </p>
                    {item.fields.map((field) => (
                      <p key={field.key} className="mt-1 text-xs text-muted">
                        {field.label}: <span dir="ltr">{field.maskedValue}</span>
                      </p>
                    ))}
                    {item.fulfillmentType === "CODE" ? (
                      item.codes.length ? (
                        item.codes.map((code) => (
                          <p key={code.id} className="mt-1 font-mono text-xs text-muted" dir="ltr">
                            {code.masked}
                          </p>
                        ))
                      ) : (
                        <p className="mt-1 text-xs text-muted">{t("order.codePending")}</p>
                      )
                    ) : (
                      <p className="mt-1 text-xs text-muted">{item.delivered ? t("order.topupDone") : t("order.topupPending")}</p>
                    )}
                  </li>
                ))}
              </ul>
              <Button href={`/account/orders/${order.number}`} variant="outline" size="sm" className="mt-2">
                {item0Label(order, t)}
              </Button>
            </article>
          ))}
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

function item0Label(order: OrderView, t: (key: string) => string) {
  const revealable = order.paymentStatus === "PAID" && order.items.some((item) => item.fulfillmentType === "CODE" && item.codes.length);
  return revealable ? t("order.reveal") : t("order.viewDetails");
}

export function CustomerOrderDetail({ order }: { order: OrderView }) {
  const { t } = useLanguage();
  return (
    <div className="container-mmh max-w-3xl py-8 sm:py-12">
      <Link href="/account/orders" className="text-sm font-semibold text-brand-deep hover:text-fg">
        ← {t("order.backToOrders")}
      </Link>
      <div className="mt-4">
        <OrderDetail
          initial={order}
          canReveal
          poll
          heading={<h1 className="text-2xl font-bold sm:text-3xl">{t("order.title", { number: order.number })}</h1>}
        />
      </div>
    </div>
  );
}
