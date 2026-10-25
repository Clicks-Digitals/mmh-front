import { getApiBaseUrl } from "@/lib/api/client";

/**
 * Resolve media/catalog image URLs without hardcoding localhost (ST-01).
 * Only uploaded media (/media/…) lives on the API host; every other root-relative path
 * (/home, /brand, /catalog, …) is a Next public asset on the store origin.
 */
export function resolveMediaUrl(url: string | null | undefined, apiBase: string = getApiBaseUrl()): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/media/")) return `${apiBase.replace(/\/api\/v1\/?$/, "")}${url}`;
  return url;
}
