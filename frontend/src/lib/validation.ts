import { normalizeDigits } from "@/lib/digits";
import type { FieldInputFormat, RequiredCustomerField } from "@/types";

/** D12: optional "Notes for the shop" at checkout. */
export const MAX_CUSTOMER_NOTE = 500;

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Normalise a phone number: strips spaces, dashes, dots and brackets; converts a leading 00 to +;
 * turns Jordanian local mobiles (07XXXXXXXX) into +9627XXXXXXXX.
 * Returns "" when the value is not a plausible phone number.
 */
export function normalizePhone(value: string): string {
  const raw = normalizeDigits(String(value ?? "")).replace(/[\s\p{Cf}]+/gu, " ").trim();
  if (!raw) return "";
  if (/[^\d+\s\-().]/.test(raw)) return "";
  let compact = raw.replace(/[\s\-().]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  if ((compact.match(/\+/g) ?? []).length > 1 || (compact.includes("+") && !compact.startsWith("+"))) return "";
  if (/^07\d{8}$/.test(compact)) return `+962${compact.slice(1)}`;
  if (/^9627\d{8}$/.test(compact)) return `+${compact}`;
  const digits = compact.replace(/^\+/, "");
  if (!/^\d{8,15}$/.test(digits)) return "";
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

export type FieldError =
  | "required"
  | "email"
  | "tel"
  | "too_long"
  | "too_short"
  | "numeric"
  | "alphanumeric"
  | "option"
  | null;

const MAX_FIELD_LENGTH = 200;

type FieldRules = Pick<RequiredCustomerField, "type" | "required"> &
  Partial<Pick<RequiredCustomerField, "inputFormat" | "minLength" | "maxLength" | "options">>;

/** Effective value format: the D17 `input_format`, else the legacy field type (email/tel). */
export function fieldFormat(field: FieldRules): FieldInputFormat {
  if (field.inputFormat && field.inputFormat !== "text") return field.inputFormat;
  if (field.type === "email") return "email";
  if (field.type === "tel") return "phone";
  return "text";
}

/** Value as the backend stores it: trimmed, Arabic-Indic digits → ASCII (ST-11). */
export function normalizeFieldValue(value: string | null | undefined): string {
  return normalizeDigits(String(value ?? "")).trim();
}

/** Same rules as the backend checkout (D17): required, options, format, min/max length. */
export function customerFieldError(field: FieldRules, value: string): FieldError {
  const trimmed = normalizeFieldValue(value);
  if (!trimmed) return field.required ? "required" : null;
  if (trimmed.length > MAX_FIELD_LENGTH) return "too_long";
  const options = (field.options ?? []).filter((option) => String(option.value ?? "").trim());
  if (options.length) {
    return options.some((option) => option.value === trimmed) ? null : "option";
  }
  const format = fieldFormat(field);
  if (format === "email" && !isValidEmail(trimmed)) return "email";
  if (format === "phone" && !/^\+?[0-9][0-9\s\-().]{4,24}$/.test(trimmed)) return "tel";
  if (format === "numeric" && !/^[0-9]+$/.test(trimmed)) return "numeric";
  if (format === "alphanumeric" && !/^[A-Za-z0-9]+$/.test(trimmed)) return "alphanumeric";
  if (field.minLength && trimmed.length < field.minLength) return "too_short";
  if (field.maxLength && trimmed.length > field.maxLength) return "too_long";
  return null;
}

export function validateCustomerField(field: FieldRules, value: string): boolean {
  return customerFieldError(field, value) === null;
}

export function customerFieldsValid(
  fields: Array<FieldRules & Pick<RequiredCustomerField, "id">>,
  values: Record<string, string> | undefined,
): boolean {
  return fields.every((field) => validateCustomerField(field, values?.[field.id] ?? ""));
}

/** First field (in display order) whose value is invalid, or null. */
export function firstInvalidField<T extends FieldRules & Pick<RequiredCustomerField, "id">>(
  fields: T[],
  values: Record<string, string> | undefined,
): T | null {
  return fields.find((field) => !validateCustomerField(field, values?.[field.id] ?? "")) ?? null;
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
      return "validation.tooLongN";
    case "too_short":
      return "validation.tooShortN";
    case "numeric":
      return "validation.digitsOnly";
    case "alphanumeric":
      return "validation.lettersDigits";
    case "option":
      return "validation.chooseOption";
    default:
      return "";
  }
}

/** Translated message for a field error, with the field's own length limits. */
export function fieldErrorMessage(
  field: FieldRules,
  error: FieldError,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (!error) return "";
  return t(fieldErrorKey(error), {
    min: field.minLength ?? 1,
    max: field.maxLength ?? MAX_FIELD_LENGTH,
  });
}

/** HTML input attributes that match the field format (mobile keyboards, max length). */
export function fieldInputProps(field: FieldRules): {
  type: "text" | "email" | "tel";
  inputMode?: "numeric" | "tel" | "email" | "text";
  maxLength: number;
  dir?: "ltr";
} {
  const format = fieldFormat(field);
  const maxLength = Math.min(field.maxLength || MAX_FIELD_LENGTH, MAX_FIELD_LENGTH);
  if (format === "email") return { type: "email", inputMode: "email", maxLength, dir: "ltr" };
  if (format === "phone") return { type: "tel", inputMode: "tel", maxLength, dir: "ltr" };
  if (format === "numeric") return { type: "text", inputMode: "numeric", maxLength, dir: "ltr" };
  if (format === "alphanumeric") return { type: "text", inputMode: "text", maxLength, dir: "ltr" };
  return { type: "text", maxLength };
}
