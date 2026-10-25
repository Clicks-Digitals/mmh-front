"use client";

import { OrderDetail } from "@/components/orders/order-detail";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/context/language-context";
import type { OrderView } from "@/lib/orders";
import { isValidEmail } from "@/lib/validation";
import { useState } from "react";

export function OrderLookupForm({ initialNumber = "" }: { initialNumber?: string }) {
  const { t } = useLanguage();
  const [number, setNumber] = useState(initialNumber);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<OrderView | null>(null);

  return (
    <div className="space-y-8">
      <form
        className="space-y-4 rounded-2xl border border-line bg-card p-5 sm:p-6"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!number.trim() || !isValidEmail(email)) {
            setError(t("lookup.invalid"));
            return;
          }
          setBusy(true);
          setError("");
          try {
            const { lookupOrderAction } = await import("@/server/actions/orders");
            const result = await lookupOrderAction({ number, email });
            if (result.ok) setOrder(result.order);
            else {
              setOrder(null);
              setError(t(result.error === "not_found" ? "lookup.notFound" : result.error === "invalid" ? "lookup.invalid" : "lookup.unavailable"));
            }
          } catch {
            setError(t("lookup.unavailable"));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t("lookup.number")} value={number} onChange={(event) => setNumber(event.target.value)} autoComplete="off" dir="ltr" />
        <Field label={t("lookup.email")} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t("common.loading") : t("lookup.submit")}
        </Button>
        <p className="text-xs leading-5 text-muted">{t("lookup.codesHint")}</p>
      </form>
      {order ? <OrderDetail key={order.number} initial={order} canReveal={false} revealHint="lookup" /> : null}
    </div>
  );
}
