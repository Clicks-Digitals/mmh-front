export const DEFAULT_SITE_URL = "https://www.mmhcard.com";

/** Normalise a configured public site URL: absolute http(s), no trailing slash. Falls back to the default. */
export function normalizeSiteUrl(raw: string | undefined | null, fallback = DEFAULT_SITE_URL): string {
  const value = String(raw ?? "").trim();
  if (!value) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return fallback;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return fallback;
  }
}

/** Absolute URL for a site path, e.g. absoluteUrl("https://x.com", "/shop") → "https://x.com/shop". */
export function absoluteUrl(base: string, path = "/"): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return cleanPath === "/" ? `${base}/` : `${base}${cleanPath}`;
}

export function siteUrl(): string {
  return normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
}
