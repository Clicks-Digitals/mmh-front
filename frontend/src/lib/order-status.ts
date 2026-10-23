/** Translation keys for backend order statuses (friendly EN/AR labels live in translations.ts). */
const PAYMENT: Record<string, string> = {
  PENDING: "orderStatus.payment.PENDING",
  AUTHORIZED: "orderStatus.payment.AUTHORIZED",
  PAID: "orderStatus.payment.PAID",
  FAILED: "orderStatus.payment.FAILED",
  CANCELLED: "orderStatus.payment.CANCELLED",
  REFUNDED: "orderStatus.payment.REFUNDED",
  PARTIALLY_REFUNDED: "orderStatus.payment.PARTIALLY_REFUNDED",
};

const FULFILLMENT: Record<string, string> = {
  NOT_STARTED: "orderStatus.fulfillment.NOT_STARTED",
  QUEUED: "orderStatus.fulfillment.QUEUED",
  PROCESSING: "orderStatus.fulfillment.PROCESSING",
  COMPLETED: "orderStatus.fulfillment.COMPLETED",
  FAILED: "orderStatus.fulfillment.FAILED",
  MANUAL_REVIEW: "orderStatus.fulfillment.MANUAL_REVIEW",
  CANCELLED: "orderStatus.fulfillment.CANCELLED",
};

export function paymentStatusKey(status: string): string {
  return PAYMENT[status] ?? "orderStatus.unknown";
}

export function fulfillmentStatusKey(status: string): string {
  return FULFILLMENT[status] ?? "orderStatus.unknown";
}

export function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "PAID" || status === "COMPLETED") return "success";
  if (["FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(status)) return "danger";
  if (["PENDING", "AUTHORIZED", "QUEUED", "PROCESSING", "MANUAL_REVIEW", "NOT_STARTED"].includes(status)) return "warning";
  return "neutral";
}
