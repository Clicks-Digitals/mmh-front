import { deliveredCodeCount, isDelivered, pendingCodeCount, type CustomerOrderStatus, type OrderView } from "@/lib/orders";

export type StatusTone = "success" | "warning" | "danger" | "neutral";

export interface OrderStatusCopy {
  /** Translation key of the headline. */
  title: string;
  /** Translation key of the explanation ("" = none). */
  body: string;
  values: Record<string, string | number>;
  tone: StatusTone;
  /** Show "codes will appear here / delivered after payment" style delivery copy and spinners. */
  showDelivery: boolean;
}

/** Translation key of the short customer status label (badges, lists). */
export function customerStatusKey(status: CustomerOrderStatus): string {
  return `orderState.${status}`;
}

export function customerStatusTone(status: CustomerOrderStatus): StatusTone {
  switch (status) {
    case "delivered":
      return "success";
    case "processing":
    case "awaiting_payment":
      return "warning";
    case "partially_refunded":
      return "neutral";
    default:
      return "danger";
  }
}

/** D4 / OR-05 / OR-07 / OR-28: headline and copy for the customer order and success pages. */
export function orderStatusCopy(order: OrderView): OrderStatusCopy {
  const codes = order.items.some((item) => item.fulfillmentType === "CODE");
  const topups = order.items.some((item) => item.fulfillmentType === "DIRECT_TOPUP");
  const tone = customerStatusTone(order.status);
  const base = { values: {} as Record<string, string | number>, tone };
  switch (order.status) {
    case "awaiting_payment":
      return { ...base, title: "orderCopy.awaitingTitle", body: order.canPay ? "orderCopy.awaitingBody" : "orderCopy.awaitingBodyNoPay", showDelivery: false };
    case "payment_failed":
      return { ...base, title: "orderCopy.failedTitle", body: "orderCopy.failedBody", showDelivery: false };
    case "cancelled":
      return { ...base, title: "orderCopy.cancelledTitle", body: "orderCopy.cancelledBody", showDelivery: false };
    case "expired":
      return { ...base, title: "orderCopy.expiredTitle", body: "orderCopy.expiredBody", showDelivery: false };
    case "refunded":
      return { ...base, title: "orderCopy.refundedTitle", body: codes ? "orderCopy.refundedBodyCodes" : "orderCopy.refundedBody", showDelivery: false };
    case "partially_refunded":
      return {
        ...base,
        title: "orderCopy.partialRefundTitle",
        body: "orderCopy.partialRefundBody",
        values: { amount: (order.refundedFils / 1000).toFixed(2) },
        showDelivery: !isDelivered(order),
      };
    default:
      break;
  }

  // Paid: processing or delivered.
  const delivered = order.status === "delivered" || isDelivered(order);
  const partial = pendingCodeCount(order);
  if (!delivered && codes && partial.delivered > 0 && partial.pending > 0) {
    return {
      ...base,
      tone: "warning",
      title: "orderCopy.partialTitle",
      body: "orderCopy.partialBody",
      values: { delivered: partial.delivered, total: partial.total },
      showDelivery: true,
    };
  }
  if (delivered) {
    if (codes && topups) return { ...base, tone: "success", title: "orderCopy.deliveredTitle", body: "orderCopy.deliveredMixed", showDelivery: false };
    if (topups) return { ...base, tone: "success", title: "orderCopy.topupDoneTitle", body: "orderCopy.topupDoneBody", showDelivery: false };
    return {
      ...base,
      tone: "success",
      title: deliveredCodeCount(order) > 0 ? "orderCopy.codesReadyTitle" : "orderCopy.deliveredTitle",
      body: "orderCopy.codesReadyBody",
      showDelivery: false,
    };
  }
  if (order.fulfillmentStatus === "MANUAL_REVIEW") {
    return { ...base, title: "orderCopy.paidTitle", body: "orderCopy.reviewBody", showDelivery: true };
  }
  if (codes && topups) return { ...base, title: "orderCopy.paidTitle", body: "orderCopy.mixedBody", showDelivery: true };
  if (topups) return { ...base, title: "orderCopy.paidTitle", body: "orderCopy.topupBody", showDelivery: true };
  return {
    ...base,
    title: "orderCopy.paidTitle",
    body: order.email ? "orderCopy.codeBody" : "orderCopy.codeBodyNoEmail",
    values: { email: order.email },
    showDelivery: true,
  };
}
