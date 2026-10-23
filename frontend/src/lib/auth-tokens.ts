/** Seconds before expiry at which the Django access token is refreshed. */
export const REFRESH_MARGIN_SECONDS = 15 * 60;

/** `exp` (seconds since epoch) from a JWT, or null if it cannot be read. Signature is not verified. */
export function jwtExpiry(token: string | undefined | null): number | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json =
      typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

export function accessTokenNeedsRefresh(
  expiresAt: number | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  margin = REFRESH_MARGIN_SECONDS,
): boolean {
  if (!expiresAt) return false;
  return nowSeconds >= expiresAt - margin;
}
