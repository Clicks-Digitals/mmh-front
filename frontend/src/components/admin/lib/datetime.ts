/**
 * `<input type="datetime-local">` works in the browser's local time with no zone
 * ("2026-03-01T14:30"). The API speaks ISO-8601 instants. These helpers convert in
 * the user's local zone so a value round-trips without shifting.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" in local time ("" for empty/invalid). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** "YYYY-MM-DDTHH:mm" (local time) -> ISO instant (null for empty/invalid). */
export function localInputToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Short label of the browser time zone, e.g. "Asia/Amman". */
export function localTimeZoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  } catch {
    return "local time";
  }
}
