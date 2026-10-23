import type { RequiredCustomerField } from "@/types";

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Normalise a phone number: strips spaces, dashes, dots and brackets; converts a leading 00 to +;
 * turns Jordanian local mobiles (07XXXXXXXX) into +9627XXXXXXXX.
 * Returns "" when the value is not a plausible phone number.
 */
export function normalizePhone(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/[^\d+\s\-().]/.test(raw)) return "";
  let compact = raw.replace(/[\s\-().]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  if ((compact.match(/\+/g) ?? []).length > 1 || (compact.includes("+") && !compact.startsWith("+"))) return "";
  if (/^07\d{8}$/.test(compact)) return `+962${compact.slice(1)}`;
  if (/^9627\d{8}$/.test(compact)) return `+${compact}`;
  const digits = compact.replace(/^\+/, "");
  if (!/^\d{7,15}$/.test(digits)) return "";
  // Jordanian numbers given with the country code must be a valid mobile/landline length.
  if (digits.startsWith("962") && !/^962\d{8,9}$/.test(digits)) return "";
  // Reject placeholder-like sequences (all the same digit).
  if (/^(\d)\1+$/.test(digits)) return "";
  return compact.startsWith("+") ? compact : digits;
}

/** International E.164-ish phone: optional +, 7–15 digits, spaces/dashes ignored. */
export function isValidPhone(value: string): boolean {
  return normalizePhone(value) !== "";
}

export function isValidJordanPhone(value: string): boolean {
  return /^\+9627[789]\d{7}$/.test(normalizePhone(value));
}

export type FieldError = "required" | "email" | "tel" | "too_long" | "too_short" | null;

const MAX_FIELD_LENGTH = 200;

/** Same rules as the backend: required, max length, EMAIL and TEL types validated. */
export function customerFieldError(field: Pick<RequiredCustomerField, "type" | "required">, value: string): FieldError {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return field.required ? "required" : null;
  if (trimmed.length > MAX_FIELD_LENGTH) return "too_long";
  if (field.type === "email") return isValidEmail(trimmed) ? null : "email";
  if (field.type === "tel") return isValidPhone(trimmed) ? null : "tel";
  return null;
}

export function validateCustomerField(field: Pick<RequiredCustomerField, "type" | "required">, value: string): boolean {
  return customerFieldError(field, value) === null;
}

export function customerFieldsValid(
  fields: Array<Pick<RequiredCustomerField, "id" | "type" | "required">>,
  values: Record<string, string> | undefined,
): boolean {
  return fields.every((field) => validateCustomerField(field, values?.[field.id] ?? ""));
}

export function fieldErrorKey(error: FieldError): string {
  switch (error) {
    case "required":
      return "validation.required";
    case "email":
      return "validation.email";
    case "tel":
      return "validation.phone";
    case "too_long":
      return "validation.tooLong";
    case "too_short":
      return "validation.tooShort";
    default:
      return "";
  }
}
