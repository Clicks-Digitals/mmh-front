export type ApiErrorKind =
  | "validation"
  | "authentication"
  | "authorization"
  | "not_found"
  | "supplier"
  | "payment"
  | "server"
  | "network"
  | "unknown";

export class ApiError extends Error {
  status: number;
  kind: ApiErrorKind;
  body: unknown;

  constructor(message: string, status: number, kind: ApiErrorKind, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.body = body;
  }
}

function classify(status: number, body: unknown): ApiErrorKind {
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 404) return "not_found";
  if (status >= 500) {
    const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
    if (/supplier|1epin/i.test(text)) return "supplier";
    if (/payment/i.test(text)) return "payment";
    return "server";
  }
  return "unknown";
}

function messageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  if (Array.isArray(record.detail)) return typeof record.detail[0] === "string" ? record.detail[0] : fallback;
  if (record.detail && typeof record.detail === "object") {
    for (const value of Object.values(record.detail as Record<string, unknown>)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      if (typeof value === "string") return value;
    }
  }
  if (typeof record.message === "string") return record.message;
  const firstKey = Object.keys(record)[0];
  const firstVal = firstKey ? record[firstKey] : null;
  if (Array.isArray(firstVal) && typeof firstVal[0] === "string") return firstVal[0];
  if (typeof firstVal === "string") return firstVal;
  return fallback;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://127.0.0.1:8000/api/v1";

export function getApiBaseUrl() {
  return API_URL.replace(/\/$/, "");
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;
  const isFormData = typeof FormData !== "undefined" && rest.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`, {
      ...rest,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : "Network error", 0, "network");
  }

  if (!response.ok) {
    let body: unknown = null;
    const text = await response.text().catch(() => "");
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const kind = classify(response.status, body);
    throw new ApiError(messageFromBody(body, `API ${response.status}`), response.status, kind, body);
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/csv") || contentType.includes("application/octet-stream")) {
    return (await response.text()) as T;
  }
  return (await response.json()) as T;
}

/** Machine-readable error code from a backend error body ({detail, code}). */
export function apiErrorCode(error: unknown): string {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return "";
  const code = (error.body as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/** Field key a checkout error refers to ({detail, code, field}). */
export function apiErrorField(error: unknown): string {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return "";
  const field = (error.body as { field?: unknown }).field;
  return typeof field === "string" ? field : "";
}

/** Validation errors as {field: [messages]} from {detail: {field: [msg]}}. */
export function apiFieldErrors(error: unknown): Record<string, string[]> {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return {};
  const detail = (error.body as { detail?: unknown }).detail;
  const source = detail && typeof detail === "object" && !Array.isArray(detail) ? detail : error.body;
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (key === "code") continue;
    if (Array.isArray(value)) result[key] = value.filter((item): item is string => typeof item === "string");
    else if (typeof value === "string" && key !== "detail") result[key] = [value];
  }
  return result;
}
