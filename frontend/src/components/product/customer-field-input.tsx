"use client";

import { CONTROL, FOCUS_RING } from "@/components/ui/control";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/context/language-context";
import { cn } from "@/lib/cn";
import { normalizeDigits } from "@/lib/digits";
import { customerFieldError, fieldErrorMessage, fieldFormat, fieldInputProps } from "@/lib/validation";
import type { RequiredCustomerField } from "@/types";
import { useId, useState } from "react";

/**
 * D17: one required customer field (Player ID, Zone ID, server…) — a native <select> for option
 * lists, otherwise an input matching the field format. Arabic-Indic digits are converted as you
 * type for numeric / phone fields (ST-11).
 */
export function CustomerFieldInput({
  field,
  value,
  onChange,
  showError,
  onBlur,
  serverError,
  inputRef,
}: {
  field: RequiredCustomerField;
  value: string;
  onChange: (value: string) => void;
  showError: boolean;
  onBlur?: () => void;
  serverError?: string;
  inputRef?: (element: HTMLInputElement | HTMLSelectElement | null) => void;
}) {
  const { t, locale } = useLanguage();
  const selectId = useId();
  const [guideOpen, setGuideOpen] = useState(false);
  const label = `${locale === "ar" ? field.labelAr || field.label : field.label}${field.required ? " *" : ""}`;
  const error = customerFieldError(field, value);
  const message = serverError || (showError && error ? fieldErrorMessage(field, error, t) : "");
  const help = locale === "ar" ? field.helpTextAr || field.helpText : field.helpText;
  const format = fieldFormat(field);
  const options = (field.options ?? []).filter((option) => option.value);
  const lengthHint =
    field.minLength && field.maxLength && field.minLength === field.maxLength
      ? t("field.exactLength", { count: field.minLength })
      : field.minLength && field.maxLength
        ? t("field.lengthRange", { min: field.minLength, max: field.maxLength })
        : "";
  const formatHint = format === "numeric" ? t("field.digitsHint") : format === "alphanumeric" ? t("field.alnumHint") : "";
  const hint = [formatHint, lengthHint].filter(Boolean).join(" · ");

  return (
    <div data-field-id={field.id}>
      {options.length ? (
        <label className="block space-y-1.5" htmlFor={selectId}>
          <span className="text-sm font-medium text-fg">{label}</span>
          <select
            id={selectId}
            ref={inputRef}
            className={cn(CONTROL, "appearance-auto", message && "border-danger focus-visible:border-danger focus-visible:ring-danger")}
            value={value}
            required={field.required}
            aria-invalid={Boolean(message)}
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">{t("field.choose")}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {locale === "ar" ? option.labelAr || option.label : option.label}
              </option>
            ))}
          </select>
          {message ? <span className="text-xs text-danger">{message}</span> : null}
        </label>
      ) : (
        <Field
          ref={inputRef as (element: HTMLInputElement | null) => void}
          label={label}
          placeholder={locale === "ar" ? field.placeholderAr || field.placeholder : field.placeholder}
          {...fieldInputProps(field)}
          value={value}
          required={field.required}
          aria-invalid={Boolean(message)}
          hint={hint || undefined}
          error={message || undefined}
          onBlur={onBlur}
          onChange={(event) => {
            const next = event.target.value;
            onChange(format === "numeric" || format === "phone" ? normalizeDigits(next) : next);
          }}
        />
      )}
      {help ? (
        <>
          <button
            type="button"
            className={cn("mt-1 rounded-md text-xs text-gold hover:underline", FOCUS_RING)}
            aria-expanded={guideOpen}
            onClick={() => setGuideOpen((open) => !open)}
          >
            {t("product.findId")}
          </button>
          {guideOpen ? <p className="mt-2 rounded-[12px] border border-line bg-elevated p-3 text-xs leading-5 text-muted">{help}</p> : null}
        </>
      ) : null}
    </div>
  );
}
