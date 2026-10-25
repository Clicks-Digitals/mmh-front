/** Seconds before expiry at which the Django access token is refreshed. */
export const REFRESH_MARGIN_SECONDS = 15 * 60;

/** Decoded JWT payload, or null. Signature is not verified (the backend verifies every request). */
function jwtPayload(token: string | undefined | null): Record<string, unknown> | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json =
      typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("utf8");
    const payload = JSON.parse(json) as unknown;
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `exp` (seconds since epoch) from a JWT, or null if it cannot be read. Signature is not verified. */
export function jwtExpiry(token: string | undefined | null): number | null {
  const exp = jwtPayload(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
}

/** `user_id` claim (SimpleJWT) as a string, or null. */
export function jwtUserId(token: string | undefined | null): string | null {
  const id = jwtPayload(token)?.user_id;
  return typeof id === "number" || (typeof id === "string" && id) ? String(id) : null;
}

export function accessTokenNeedsRefresh(
  expiresAt: number | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  margin = REFRESH_MARGIN_SECONDS,
): boolean {
  if (!expiresAt) return false;
  return nowSeconds >= expiresAt - margin;
}
