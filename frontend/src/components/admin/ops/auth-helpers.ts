/**
 * Pure helpers for the admin sign-in flow (RO-02, RO-03, RO-13). No React / Next imports so
 * they are unit-testable.
 */

/**
 * RO-02: only follow `from` when it is a same-site admin path. Anything else (absolute URLs,
 * protocol-relative "//evil", backslash tricks, the login page itself) falls back to /admin.
 */
export function safeAdminRedirect(from: string | null | undefined, fallback = "/admin"): string {
  const value = (from ?? "").trim();
  if (!value) return fallback;
  if (!value.startsWith("/admin")) return fallback;
  if (value.startsWith("//") || value.includes("\\")) return fallback;
  // "/admin", "/admin/…", "/admin?…", "/admin#…" — not "/adminx" or "/admin.evil.com".
  const next = value.charAt("/admin".length);
  if (next && !["/", "?", "#"].includes(next)) return fallback;
  // Control characters / encoded slashes can be normalised by browsers into another host.
  if (/[\u0000-\u001f]/.test(value) || /%2f%2f|%5c/i.test(value)) return fallback;
  if (value === "/admin/login" || value.startsWith("/admin/login?") || value.startsWith("/admin/login/")) {
    return fallback;
  }
  return value;
}

/** RO-03 / D14: sign-in error codes set by src/auth.ts → what the user should read. */
export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  account_disabled: "This account is disabled. Contact the store owner.",
  throttled: "Too many attempts. Wait a minute and try again.",
  not_staff: "This is a customer account. Use the store login.",
};

export function loginErrorMessage(result: { error?: string | null; code?: string | null } | null | undefined): string {
  const code = result?.code ?? "";
  if (code && LOGIN_ERROR_MESSAGES[code]) return LOGIN_ERROR_MESSAGES[code];
  const error = result?.error ?? "";
  if (!error || error === "CredentialsSignin" || code === "credentials") return LOGIN_ERROR_MESSAGES.invalid_credentials;
  return "Sign-in is not available right now. Try again in a minute.";
}

/* ─── Password checklist (RO-13, D16) ─── */

/** A short list of the most common passwords; the server runs the full check on save. */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd",
  "123456789012",
  "qwertyuiop",
  "qwertyuiop12",
  "qwerty123456",
  "iloveyou1234",
  "admin1234567",
  "administrator",
  "letmein12345",
  "welcome12345",
  "abc123456789",
  "1q2w3e4r5t6y",
  "1qaz2wsx3edc",
  "trustno1trustno1",
  "football1234",
  "baseball1234",
  "changeme1234",
  "mmhadmin1234",
]);

export type PasswordCheck = { key: string; label: string; ok: boolean };

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MIN_DISTINCT = 5;

export function passwordChecklist(password: string, email = ""): PasswordCheck[] {
  const value = password ?? "";
  const distinct = new Set(Array.from(value)).size;
  const lowered = value.toLowerCase();
  const local = (email.split("@")[0] ?? "").toLowerCase();
  const similarToEmail = local.length >= 4 && lowered.includes(local);
  return [
    { key: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, ok: value.length >= PASSWORD_MIN_LENGTH },
    {
      key: "variety",
      label: `At least ${PASSWORD_MIN_DISTINCT} different characters`,
      ok: distinct >= PASSWORD_MIN_DISTINCT,
    },
    { key: "numeric", label: "Not only numbers", ok: value.length > 0 && !/^\d+$/.test(value) },
    {
      key: "common",
      label: "Not a common password",
      ok: value.length > 0 && !COMMON_PASSWORDS.has(lowered),
    },
    { key: "email", label: "Not similar to the e-mail address", ok: value.length > 0 && !similarToEmail },
  ];
}

export function passwordAcceptable(password: string, email = ""): boolean {
  return passwordChecklist(password, email).every((check) => check.ok);
}

/* ─── Phone (OR-16): mirrors backend accounts.validators.normalize_phone ─── */

const ARABIC_DIGITS: Record<string, string> = {};
for (let i = 0; i < 10; i += 1) {
  ARABIC_DIGITS[String.fromCharCode(0x0660 + i)] = String(i);
  ARABIC_DIGITS[String.fromCharCode(0x06f0 + i)] = String(i);
}

export const PHONE_ERROR = "Enter a valid phone number, e.g. +962791234567.";

/** Returns the normalised phone ("" for blank) or null when it is not a valid number. */
export function normalizePhone(value: string): string | null {
  const raw = Array.from(value ?? "")
    .map((ch) => ARABIC_DIGITS[ch] ?? ch)
    .join("")
    .trim();
  if (!raw) return "";
  let compact = raw.replace(/[\s\-(). ‏‎]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  if (compact.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
  return /^\d{8,15}$/.test(compact) ? compact : null;
}
