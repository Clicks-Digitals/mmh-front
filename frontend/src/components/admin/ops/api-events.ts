/**
 * Browser event raised by `adminFetch` when the admin API answers 401 or 403, so the
 * access provider can react once for the whole panel (RO-09, RO-15).
 */
export const ADMIN_API_ERROR_EVENT = "mmh:admin-api-error";

export type AdminApiErrorDetail = { status: number; code: string; path: string };

export function emitAdminApiError(detail: AdminApiErrorDetail): void {
  if (typeof window === "undefined") return;
  if (detail.status !== 401 && detail.status !== 403) return;
  window.dispatchEvent(new CustomEvent<AdminApiErrorDetail>(ADMIN_API_ERROR_EVENT, { detail }));
}
