import type { AdminMediaAsset } from "@/lib/api/admin";
import { getApiBaseUrl } from "@/lib/api/client";

/**
 * Image URL for the admin panel (CA-24).
 *
 * Only uploaded files (`/media/...`) live on the API host. Every other site-relative path
 * (`/home/...`, `/brand/...`, `/catalog/...`) is a static asset of the store itself, and the
 * panel is served from the store origin, so those stay relative.
 */
export function resolveAdminMediaUrl(url: string | null | undefined, apiBase: string = getApiBaseUrl()): string {
  const value = String(url ?? "").trim();
  if (!value) return "";
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")) return value;
  if (value.startsWith("/media/")) {
    const apiRoot = apiBase.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
    return `${apiRoot}${value}`;
  }
  if (value.startsWith("/")) return value;
  if (value.startsWith("media/")) return resolveAdminMediaUrl(`/${value}`, apiBase);
  return `/${value}`;
}

/** Gallery after deleting `target`: when it was the main photo, the first remaining one becomes main. */
export function remainingAfterDelete(media: AdminMediaAsset[], target: AdminMediaAsset): AdminMediaAsset[] {
  const rest = media.filter((m) => String(m.id) !== String(target.id));
  if (!target.is_primary || !rest.length || rest.some((m) => m.is_primary)) return rest;
  const first = [...rest].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || Number(a.id) - Number(b.id))[0];
  return rest.map((m) => ({ ...m, is_primary: m === first }));
}
