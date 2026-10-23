/**
 * The reveal endpoint returns the stored plaintext: either the bare code or a JSON
 * payload `{"code": "...", "pin": "..."}` when a PIN exists.
 */
export function parseRevealedCode(plaintext: string | null | undefined): { code: string; pin: string } {
  const raw = (plaintext ?? "").trim();
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { code?: unknown; pin?: unknown };
      if (parsed && typeof parsed === "object" && typeof parsed.code === "string") {
        return { code: parsed.code, pin: typeof parsed.pin === "string" ? parsed.pin : "" };
      }
    } catch {
      // not JSON — fall through and show as-is
    }
  }
  return { code: raw, pin: "" };
}
