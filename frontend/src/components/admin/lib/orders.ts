export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending payment",
  AUTHORIZED: "Authorized",
  PAID: "Paid",
  FAILED: "Payment failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
};

export const FULFILLMENT_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  QUEUED: "Queued",
  PROCESSING: "Processing",
  COMPLETED: "Delivered",
  FAILED: "Fulfillment failed",
  MANUAL_REVIEW: "Manual review",
  CANCELLED: "Cancelled",
};

export function paymentStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PAYMENT_STATUS_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}

export function fulfillmentStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return FULFILLMENT_STATUS_LABELS[status] ?? status.replaceAll("_", " ").toLowerCase();
}

export type TransitionKind = "payment" | "fulfillment";

/** Action-style button label for a transition target. */
export function transitionLabel(
  kind: TransitionKind,
  target: string,
  ctx: { currentPayment?: string; hasPaypal?: boolean } = {},
): string {
  if (kind === "payment") {
    switch (target) {
      case "PAID":
        return "Mark paid";
      case "AUTHORIZED":
        return "Mark authorized";
      case "FAILED":
        return "Mark payment failed";
      case "CANCELLED":
        return "Cancel order";
      case "REFUNDED":
        if (ctx.currentPayment === "PARTIALLY_REFUNDED") {
          return ctx.hasPaypal ? "Refund remaining (PayPal)" : "Mark fully refunded";
        }
        return ctx.hasPaypal ? "Full refund (PayPal)" : "Mark refunded";
      case "PARTIALLY_REFUNDED":
        return ctx.hasPaypal ? "Partial refund (PayPal)" : "Mark partially refunded";
      default:
        return `Set ${paymentStatusLabel(target).toLowerCase()}`;
    }
  }
  switch (target) {
    case "QUEUED":
      return "Queue";
    case "PROCESSING":
      return "Start processing";
    case "COMPLETED":
      return "Mark delivered";
    case "FAILED":
      return "Mark fulfillment failed";
    case "MANUAL_REVIEW":
      return "Send to manual review";
    case "CANCELLED":
      return "Cancel fulfillment";
    default:
      return `Set ${fulfillmentStatusLabel(target).toLowerCase()}`;
  }
}

/** Transitions that need a confirmation dialog (money-moving or destructive). */
export function transitionNeedsConfirm(kind: TransitionKind, target: string): boolean {
  if (kind === "payment") return ["PAID", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED", "FAILED"].includes(target);
  return ["CANCELLED", "FAILED", "COMPLETED"].includes(target);
}

/** The backend requires a reason only for manual PAID; we also ask (optional) for refunds/cancel. */
export function transitionReasonRequired(kind: TransitionKind, target: string): boolean {
  return kind === "payment" && target === "PAID";
}

export function transitionIsDanger(target: string): boolean {
  return ["CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "FAILED"].includes(target);
}
