import { ApiError } from "@/lib/api/client";
import { friendlyValidationMessage, isStandaloneMessage } from "@/components/admin/lib/validation-messages";

/** Field label overrides for backend validation keys. */
const FIELD_LABELS: Record<string, string> = {
  non_field_errors: "",
  detail: "",
};

function humanizeField(key: string): string {
  if (key in FIELD_LABELS) return FIELD_LABELS[key];
  return key.replaceAll("_", " ");
}

function flattenMessages(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [friendlyValidationMessage(value)];
  if (Array.isArray(value)) return value.flatMap(flattenMessages);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => {
      const label = humanizeField(key);
      return flattenMessages(inner).map((msg) => (label && !isStandaloneMessage(msg) ? `${label}: ${msg}` : msg));
    });
  }
  return [String(value)];
}

/** Field -> first message map for a DRF validation error (`{detail: {field: [msg]}}` or `{field: [msg]}`). */
export function fieldErrorsFromBody(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  const source =
    record.detail && typeof record.detail === "object" && !Array.isArray(record.detail)
      ? (record.detail as Record<string, unknown>)
      : typeof record.detail === "string"
        ? {}
        : record;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "detail") continue;
    // A top-level `code` string is the machine error code; a `code` *field* (e.g. a coupon
    // code) carries a list of messages and must be kept.
    if (key === "code" && typeof value === "string") continue;
    const messages = flattenMessages(value);
    if (messages.length) out[key] = messages[0];
  }
  return out;
}

/** Human readable message for a backend error body. Prefers `detail`. */
export function messageFromErrorBody(body: unknown, fallback: string): string {
  if (!body) return fallback;
  if (typeof body === "string") return body.trim() && body.length < 300 ? body : fallback;
  if (typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.detail === "string" && record.detail) return friendlyValidationMessage(record.detail);
  if (record.detail && typeof record.detail === "object") {
    const messages = flattenMessages(record.detail);
    if (messages.length) return messages.join(" · ");
  }
  if (typeof record.message === "string" && record.message) return record.message;
  const rest = Object.fromEntries(Object.entries(record).filter(([k]) => k !== "code"));
  const messages = flattenMessages(rest);
  return messages.length ? messages.join(" · ") : fallback;
}

export function adminErrorMessage(err: unknown, fallback = "Request failed"): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return "Network error — check your connection.";
    if (err.status === 429) return "Too many requests — please wait a moment.";
    return messageFromErrorBody(err.body, err.message || fallback);
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function adminFieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError ? fieldErrorsFromBody(err.body) : {};
}

export function errorCode(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const body = err.body as Record<string, unknown> | null;
  return body && typeof body === "object" && typeof body.code === "string" ? body.code : undefined;
}

/** Plain-language messages for API error codes shared by the operations pages. */
const CODE_MESSAGES: Record<string, string> = {
  not_paid: "The order is not paid yet. Delivery can start once it is paid.",
  refund_first: "This order is paid. Refund it first, then cancel.",
  items_not_delivered: "Some items are not delivered yet. Deliver every item first.",
  not_cancellable: "This order can no longer be cancelled.",
  not_refundable: "Only paid orders can be refunded.",
  nothing_to_refund: "Nothing is left to refund on this order.",
  refund_pending: "A refund is still being processed. Wait for it to finish, then try again.",
  invalid_amount: "Enter a refund amount greater than zero.",
  amount_required: "Enter the amount to refund.",
  reason_required: "Enter a reason — it is saved in the order history.",
  email_failed: "The e-mail could not be sent. Check the mail settings and try again.",
  item_complete: "This item is already fully delivered.",
  permission_denied: "Your role does not allow this action.",
};

/**
 * One readable message for a failed request, without raw field-name prefixes
 * ("password: …"). When the error carries field errors that the form shows inline,
 * this returns a short pointer instead of repeating them.
 */
export function adminErrorSummary(err: unknown, fallback = "Something went wrong. Try again.", inlineFields: string[] = []): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return "Network error — check your connection.";
    if (err.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (err.status === 403 && !errorCode(err)) return "Your role does not allow this action.";
    const body = err.body;
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      if (typeof record.detail === "string" && record.detail) return friendlyValidationMessage(record.detail);
      const fields = fieldErrorsFromBody(body);
      const keys = Object.keys(fields).filter((k) => k !== "non_field_errors");
      if (keys.length && keys.every((k) => inlineFields.includes(k))) return "Please fix the highlighted fields.";
      if (fields.non_field_errors) return fields.non_field_errors;
      if (keys.length) return fields[keys[0]];
    }
    const code = errorCode(err);
    if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
    if (typeof body === "string" && body.trim() && body.length < 300) return body;
    return fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
