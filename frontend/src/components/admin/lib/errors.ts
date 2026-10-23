import { ApiError } from "@/lib/api/client";

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
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenMessages);
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => {
      const label = humanizeField(key);
      return flattenMessages(inner).map((msg) => (label ? `${label}: ${msg}` : msg));
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
    if (key === "code" || key === "detail") continue;
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
  if (typeof record.detail === "string" && record.detail) return record.detail;
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
