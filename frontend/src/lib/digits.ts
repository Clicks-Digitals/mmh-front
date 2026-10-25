/** Arabic-Indic (٠-٩) and Extended/Persian (۰-۹) digits → ASCII 0-9 (ST-11). Other characters are kept. */
export function normalizeDigits(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}
