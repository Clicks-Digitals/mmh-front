"use client";

import { ActionButton } from "@/components/admin/ops/controls";
import type { OrderDetail, OrderDetailItem } from "@/components/admin/ops/api";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { useAdminToast } from "@/components/admin/ui/toast";
import { formatJod } from "@/components/admin/lib/money";
import {
  itemSupplierBuy,
  itemSupplierCheck,
  itemSupplierRetry,
  type ItemActionResponse,
  type ItemSupplierOrder,
} from "@/components/admin/oneepin/api";
import { describeFailure } from "@/components/admin/oneepin/errors";
import { filsJod, jodText, supplierAmount, supplierStatusLabel } from "@/components/admin/oneepin/labels";
import { SupplierStatusBadge } from "@/components/admin/oneepin/ui";
import { useAdminToken } from "@/hooks/use-admin-token";
import { formatAdminDateTime } from "@/lib/admin/format";
import Link from "next/link";
import { useState } from "react";

type Action = "check" | "retry" | "buy";

export function itemSupplierOrder(item: OrderDetailItem): ItemSupplierOrder | null {
  const so = (item as OrderDetailItem & { supplier_order?: ItemSupplierOrder | null }).supplier_order;
  return so ?? null;
}

/**
 * "1Epin" block on an order item: where the supplier purchase stands and the staff actions
 * (Check now / Retry with 1Epin / Buy from 1Epin now). Buying asks for confirmation and shows
 * the cost against the sale price first.
 */
export function OneEpinItemBlock({
  order,
  item,
  canFulfill,
  onOrderUpdated,
}: {
  order: OrderDetail;
  item: OrderDetailItem;
  canFulfill: boolean;
  onOrderUpdated: (next: OrderDetail) => void;
}) {
  const token = useAdminToken();
  const toast = useAdminToast();
  const [pending, setPending] = useState<Action | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const so = itemSupplierOrder(item);
  if (!so) return null;

  const orderKey = order.order_number || order.id;
  const quote = so.actions.buy_now.quote ?? null;
  const loss = quote && quote.cost_fils !== null && quote.cost_fils > quote.sale_fils;

  async function run(action: Action) {
    if (!token) return;
    setPending(action);
    try {
      const fn = action === "check" ? itemSupplierCheck : action === "retry" ? itemSupplierRetry : itemSupplierBuy;
      const next: ItemActionResponse = await fn(token, orderKey, item.id);
      const { supplier_action, ...orderPayload } = next;
      if (orderPayload && "order_number" in orderPayload) onOrderUpdated(orderPayload as OrderDetail);
      const status = supplier_action?.supplier_order?.status;
      const label = supplierStatusLabel(status, supplier_action?.supplier_order?.status_label);
      const tone = status === "COMPLETED" ? "success" : status === "FAILED" || status === "MANUAL_REVIEW" ? "warning" : "info";
      const verb = action === "check" ? "Checked with 1Epin" : "Sent to 1Epin";
      toast.push(`${verb}: ${label}.${supplier_action?.supplier_order?.message ? ` ${supplier_action.supplier_order.message}` : ""}`, tone);
      setConfirm(null);
    } catch (err) {
      toast.push(describeFailure(err, "That did not work. Try again."), "error");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--clicks-border)] bg-white px-3 py-2 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-semibold text-[var(--clicks-muted)]">1Epin</p>
          <SupplierStatusBadge status={so.status} label={so.status_label} withHelp />
          {so.message ? <p className="text-[var(--clicks-text)]">{so.message}</p> : null}
          {so.raw_reason ? (
            <p className="text-[11px] text-[var(--clicks-muted)]">
              1Epin said: <span className="font-mono">{so.raw_reason}</span>
            </p>
          ) : null}
          <p className="text-[11px] text-[var(--clicks-muted)]">
            {so.external_order_number ? (
              <>
                1Epin order{" "}
                {so.supplier_order_id ? (
                  <Link href={`/admin/integrations/1epin/orders/${so.supplier_order_id}`} className="font-mono text-[var(--clicks-blue)]">
                    {so.external_order_number}
                  </Link>
                ) : (
                  <span className="font-mono">{so.external_order_number}</span>
                )}
                {" · "}
              </>
            ) : null}
            {so.cost_jod ? `Cost ${jodText(so.cost_jod)} · ` : ""}
            {so.attempts} attempt{so.attempts === 1 ? "" : "s"}
            {so.updated_at ? ` · updated ${formatAdminDateTime(so.updated_at)}` : ""}
            {!so.mapped ? " · not linked to a 1Epin product" : ""}
          </p>
        </div>
        {canFulfill ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            <ActionButton
              small
              label={pending === "check" ? "Checking…" : "Check now"}
              enabled={so.actions.check.enabled}
              reason={so.actions.check.disabled_reason}
              pending={pending !== null}
              onClick={() => void run("check")}
            />
            <ActionButton
              small
              label="Retry with 1Epin"
              enabled={so.actions.retry.enabled}
              reason={so.actions.retry.disabled_reason}
              pending={pending !== null}
              onClick={() => setConfirm("retry")}
            />
            <ActionButton
              small
              variant="primary"
              label="Buy from 1Epin now"
              enabled={so.actions.buy_now.enabled}
              reason={so.actions.buy_now.disabled_reason}
              pending={pending !== null}
              onClick={() => setConfirm("buy")}
            />
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirm === "retry"}
        title="Retry with 1Epin?"
        description="The last 1Epin attempt definitely failed. This places a NEW order at 1Epin and pays for it from the 1Epin balance. The normal safety limits (max cost, no loss) still apply."
        confirmLabel="Retry and pay"
        pending={pending === "retry"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void run("retry")}
      >
        <PlayerBox so={so} />
        {quote ? <QuoteBox quote={quote} /> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "buy"}
        title="Buy from 1Epin now?"
        description="This buys the missing units from 1Epin right now and pays from the 1Epin balance. It skips the automatic safety limits, so check the numbers below."
        confirmLabel={quote?.cost_jod ? `Buy for ${jodText(quote.cost_jod)}` : "Buy now"}
        danger={Boolean(loss)}
        pending={pending === "buy"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void run("buy")}
      >
        <PlayerBox so={so} />
        {quote ? <QuoteBox quote={quote} /> : <p className="text-[13px] text-[var(--clicks-muted)]">No price available — sync the 1Epin catalog first.</p>}
      </ConfirmDialog>
    </div>
  );
}

/** Top-ups: the exact player value 1Epin will receive, so a wrong ID is caught before paying. */
function PlayerBox({ so }: { so: ItemSupplierOrder }) {
  if (so.kind !== "topup") return null;
  if (so.player_user_error) {
    return (
      <p role="alert" className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
        {so.player_user_error}. Fix it with “Edit top-up details” on the item first.
      </p>
    );
  }
  if (!so.player_user) return null;
  return (
    <p className="mb-2 rounded-lg bg-[#F7F8FC] px-3 py-2 text-[13px]">
      Player ID sent to 1Epin: <span className="font-mono font-semibold text-[var(--clicks-navy)]">{so.player_user}</span>
      <span className="block text-[11px] text-[var(--clicks-muted)]">Wrong? Close this and use “Edit top-up details” on the item.</span>
    </p>
  );
}

function QuoteBox({ quote }: { quote: NonNullable<ItemSupplierOrder["actions"]["buy_now"]["quote"]> }) {
  const margin = quote.cost_fils !== null ? quote.sale_fils - quote.cost_fils : null;
  const loss = margin !== null && margin < 0;
  return (
    <div className="space-y-2 text-[13px]">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg bg-[#F7F8FC] px-3 py-2">
        <dt className="text-[var(--clicks-muted)]">1Epin product</dt>
        <dd>
          {quote.product_name} <span className="font-mono text-[11px] text-[var(--clicks-muted)]">ID {quote.external_product_id}</span>
        </dd>
        <dt className="text-[var(--clicks-muted)]">Units</dt>
        <dd>
          {quote.units} for the customer{quote.quantity !== quote.units ? ` (${quote.quantity} at 1Epin)` : ""}
        </dd>
        <dt className="text-[var(--clicks-muted)]">1Epin cost</dt>
        <dd className="tabular-nums">
          {jodText(quote.cost_jod)} <span className="text-[11px] text-[var(--clicks-muted)]">({supplierAmount(quote.cost, quote.currency)})</span>
        </dd>
        <dt className="text-[var(--clicks-muted)]">Customer paid</dt>
        <dd className="tabular-nums">{formatJod(quote.sale_fils)}</dd>
        <dt className="text-[var(--clicks-muted)]">Profit</dt>
        <dd className={`tabular-nums font-medium ${loss ? "text-[var(--clicks-error)]" : "text-emerald-700"}`}>
          {margin !== null ? filsJod(margin) : "—"}
          {loss ? " (loss)" : ""}
        </dd>
      </dl>
      {loss ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-900">
          1Epin costs more than the customer paid. Buying now loses {filsJod(-(margin ?? 0))}.
        </p>
      ) : null}
      {quote.over_limit && quote.max_cost_fils ? (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          This is above the cost limit you set for this product ({formatJod(quote.max_cost_fils)}). Buying now overrides that limit.
        </p>
      ) : null}
    </div>
  );
}
