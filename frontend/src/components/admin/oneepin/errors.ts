import { adminErrorSummary } from "@/components/admin/lib/errors";
import { oneEpinErrorText, resultCodeMessage } from "@/components/admin/oneepin/labels";
import { ApiError } from "@/lib/api/client";

/** Body of a failed request (1Epin endpoints return useful fields even on 409/502). */
export function errorBody(err: unknown): Record<string, unknown> | null {
  return err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as Record<string, unknown>) : null;
}

export function errorCodeOf(err: unknown): string {
  const body = errorBody(err);
  return body && typeof body.code === "string" ? body.code : "";
}

/**
 * One honest sentence for a failed 1Epin action: the 1Epin ResultCode meaning when there is
 * one (e.g. "02" → register the IP), otherwise our error code text, otherwise the detail.
 */
export function describeFailure(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return "Network error — check your connection.";
    if (err.status === 403 && !errorCodeOf(err)) return "Your role does not allow this action.";
    const body = errorBody(err);
    if (body) {
      const code = typeof body.code === "string" ? body.code : "";
      if (code && resultCodeMessage(code)) return resultCodeMessage(code);
      if (typeof body.detail === "string" || typeof body.message === "string") return oneEpinErrorText(body, fallback);
    }
    return adminErrorSummary(err, fallback);
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
