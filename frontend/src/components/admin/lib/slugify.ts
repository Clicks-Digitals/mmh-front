/** Slug / key helpers mirroring backend catalog/slugs.py (CA-15, CA-22). */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "PlayStation Plus — 12 Months!" -> "playstation-plus-12-months" ("" for Arabic-only input). */
export function slugify(value: string | null | undefined, maxLength = 50): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

export function isValidSlug(value: string | null | undefined): boolean {
  return SLUG_PATTERN.test(String(value ?? "").trim());
}

/** "Player ID" -> "player_id"; "2nd server" -> "f_2nd_server"; "" when nothing usable. */
export function fieldKeyFromLabel(label: string | null | undefined): string {
  let key = slugify(label, 64).replace(/-/g, "_");
  if (key && /^\d/.test(key)) key = `f_${key}`;
  return key.slice(0, 64);
}

export const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * Value used by the "auto from name" slug inputs: while the user has not typed a slug of
 * their own, follow the name; once they edit it, keep their value.
 */
export function autoSlug(name: string, current: string, touched: boolean): string {
  return touched ? current : slugify(name);
}
