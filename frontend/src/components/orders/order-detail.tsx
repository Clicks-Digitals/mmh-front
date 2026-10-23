"use client";

import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/control";
import { useLanguage } from "@/context/language-context";
import { cn } from "@/lib/cn";
import { formatDiscount } from "@/lib/coupon";
import { formatDate, formatJod } from "@/lib/format";
import { fulfillmentStatusKey, paymentStatusKey, statusTone } from "@/lib/order-status";
import {
  hasCodeItems,
  isDelivered,
  isPaid,
  orderTimeline,
  shouldPollOrder,
  type OrderItemView,
  type OrderView,
  type RevealedCodes,
} from "@/lib/orders";
import { Check, CheckCircle2, Circle, Copy, Eye, KeyRound, Loader2, PackageCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const POLL_MS = 5000;
const POLL_LIMIT_MS = 2 * 60 * 1000;

function StatusPill({ label, status }: { label: string; status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1.5 text-xs font-medium",
        tone === "success" && "bg-success/15 text-success",
        tone === "warning" && "bg-amber/15 text-amber",
        tone === "danger" && "bg-danger/15 text-danger",
        tone === "neutral" && "bg-elevated text-muted",
      )}
    >
      {label}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 text-xs font-semibold text-gold hover:bg-gold/20",
        FOCUS_RING,
      )}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("order.copied") : t("order.copy")}
    </button>
  );
}

function ItemCodes({
  item,
  revealed,
  paid,
}: {
  item: OrderItemView;
  revealed?: RevealedCodes[string];
  paid: boolean;
}) {
  const { t } = useLanguage();
  if (item.fulfillmentType === "DIRECT_TOPUP") {
    return (
      <p className={cn("mt-2 flex items-center gap-2 text-xs", item.delivered ? "text-success" : "text-muted")}>
        <PackageCheck className="h-4 w-4" />
        {item.delivered ? t("order.topupDone") : paid ? t("order.topupPending") : t("delivery.topupAfterPayment")}
      </p>
    );
  }
  if (revealed?.length) {
    return (
      <ul className="mt-3 space-y-2">
        {revealed.map((code) => (
          <li key={code.id} className="rounded-xl border border-dashed border-gold/40 bg-black/20 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("order.code")}</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span className="break-all font-mono text-base font-bold tracking-wider text-gold" dir="ltr">
                {code.code}
              </span>
              <CopyButton value={code.code} />
            </div>
            {code.pin ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted">
                  {t("order.pin")}:{" "}
                  <span className="font-mono text-sm text-fg" dir="ltr">
                    {code.pin}
                  </span>
                </span>
                <CopyButton value={code.pin} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }
  if (item.codes.length) {
    return (
      <ul className="mt-3 space-y-1.5">
        {item.codes.map((code) => (
          <li key={code.id} className="flex items-center gap-2 font-mono text-sm text-muted" dir="ltr">
            <KeyRound className="h-3.5 w-3.5" />
            {code.masked}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="mt-2 text-xs text-muted">{paid ? t("order.codePending") : t("delivery.afterPayment")}</p>;
}

export function OrderDetail({
  initial,
  urlToken,
  canReveal,
  poll = false,
  heading,
}: {
  initial: OrderView;
  urlToken?: string;
  canReveal: boolean;
  /** Refresh the status every 5 s for up to 2 minutes while payment/delivery is pending. */
  poll?: boolean;
  heading?: React.ReactNode;
}) {
  const { t, locale } = useLanguage();
  const [order, setOrder] = useState(initial);
  const [revealed, setRevealed] = useState<RevealedCodes>({});
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState("");
  const [polling, setPolling] = useState(poll && shouldPollOrder(initial));
  const started = useRef<number | null>(null);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      started.current ??= Date.now();
      if (Date.now() - started.current > POLL_LIMIT_MS) {
        window.clearInterval(timer);
        setPolling(false);
        return;
      }
      const { refreshOrderAction } = await import("@/server/actions/orders");
      const next = await refreshOrderAction(order.number, urlToken).catch(() => null);
      if (cancelled || !next) return;
      setOrder(next);
      if (!shouldPollOrder(next)) {
        window.clearInterval(timer);
        setPolling(false);
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [polling, order.number, urlToken]);

  const paid = isPaid(order);
  const delivered = isDelivered(order);
  const codeItems = order.items.filter((item) => item.fulfillmentType === "CODE");
  const revealable = canReveal && paid && codeItems.some((item) => item.codes.length > 0);
  const allRevealed = codeItems.every((item) => item.codes.length === 0 || revealed[item.id]?.length);

  const reveal = async () => {
    setRevealing(true);
    setRevealError("");
    try {
      const { revealCodesAction } = await import("@/server/actions/orders");
      const result = await revealCodesAction(order.number, urlToken);
      if (result.ok) setRevealed(result.codes);
      else
        setRevealError(
          t(
            result.error === "not_paid"
              ? "order.revealNotPaid"
              : result.error === "throttled"
                ? "order.revealThrottled"
                : result.error === "not_found"
                  ? "order.revealLogin"
                  : "order.revealFailed",
          ),
        );
    } catch {
      setRevealError(t("order.revealFailed"));
    } finally {
      setRevealing(false);
    }
  };

  const timeline = orderTimeline(order);

  return (
    <div className="space-y-6">
      {heading}
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted">{t("success.orderNo")}</p>
            <p className="mt-1 font-mono text-lg font-bold" dir="ltr">
              {order.number}
            </p>
            {order.createdAt ? (
              <p className="mt-1 text-xs text-muted">{t("order.placed", { date: formatDate(order.createdAt, locale) })}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill status={order.paymentStatus} label={`${t("order.payment")}: ${t(paymentStatusKey(order.paymentStatus))}`} />
            <StatusPill
              status={order.fulfillmentStatus}
              label={`${t("order.fulfillment")}: ${t(fulfillmentStatusKey(order.fulfillmentStatus))}`}
            />
          </div>
        </div>
        <ol className="mt-5 grid grid-cols-4 gap-2 text-center text-[11px] sm:text-xs">
          {timeline.map((step) => (
            <li key={step.key} className="flex flex-col items-center gap-1.5">
              {step.done ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : step.current ? (
                <Loader2 className={cn("h-5 w-5 text-amber", polling && "animate-spin")} />
              ) : (
                <Circle className="h-5 w-5 text-muted" />
              )}
              <span className={step.done ? "text-fg" : "text-muted"}>{t(`order.timeline.${step.key}`)}</span>
            </li>
          ))}
        </ol>
        {polling ? <p className="mt-3 text-center text-xs text-muted">{t("order.updating")}</p> : null}
      </section>

      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{t("order.items")}</h2>
          {revealable && !allRevealed ? (
            <Button size="sm" onClick={() => void reveal()} disabled={revealing}>
              <Eye className="h-4 w-4" />
              {revealing ? t("order.revealing") : t(codeItems.length > 1 ? "order.revealAll" : "order.reveal")}
            </Button>
          ) : null}
        </div>
        {revealError ? <p className="mt-3 text-sm text-danger">{revealError}</p> : null}
        {!canReveal && paid && hasCodeItems(order) && codeItems.some((item) => item.codes.length) ? (
          <p className="mt-3 text-xs text-muted">{t("order.revealLogin")}</p>
        ) : null}
        <ul className="mt-3 divide-y divide-line">
          {order.items.map((item) => (
            <li key={item.id} className="py-4 text-sm">
              <div className="flex justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    {item.productName}
                    {item.variantName ? ` · ${item.variantName}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {[
                      `${t("order.qty")}: ${item.quantity}`,
                      item.regionName ? `${t("order.region")}: ${item.regionName}` : "",
                      item.platformName ? `${t("order.platform")}: ${item.platformName}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {item.fields.map((field) => (
                    <p key={field.key} className="mt-1 text-xs text-muted">
                      {field.label}: <span dir="ltr">{field.maskedValue}</span>
                    </p>
                  ))}
                  {item.deliveredAt ? (
                    <p className="mt-1 text-xs text-success">{t("order.deliveredAt", { date: formatDate(item.deliveredAt, locale) })}</p>
                  ) : null}
                </div>
                <span className="shrink-0 font-semibold">{formatJod(item.lineTotalFils / 1000, locale)}</span>
              </div>
              <ItemCodes item={item} revealed={revealed[item.id]} paid={paid} />
            </li>
          ))}
        </ul>
        {Object.keys(revealed).length ? <p className="mt-2 text-xs text-amber">{t("order.codeSafe")}</p> : null}
        <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t("order.subtotal")}</dt>
            <dd>{formatJod(order.subtotalFils / 1000, locale)}</dd>
          </div>
          {order.discountFils > 0 ? (
            <div className="flex justify-between text-success">
              <dt>{t("order.discount")}</dt>
              <dd>{formatDiscount(order.discountFils, locale)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between font-semibold">
            <dt>{t("order.total")}</dt>
            <dd>{formatJod(order.totalFils / 1000, locale)}</dd>
          </div>
        </dl>
      </section>
      {delivered ? null : (
        <p className="text-xs leading-5 text-muted">
          {t(order.items.every((item) => item.fulfillmentType === "DIRECT_TOPUP") ? "delivery.topupWhere" : "delivery.where")}
        </p>
      )}
    </div>
  );
}
