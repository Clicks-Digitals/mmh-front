"use client";

import { passwordChecklist } from "@/components/admin/ops/auth-helpers";
import { Check, Circle } from "lucide-react";
import { useId, useState } from "react";

/** Password input with show/hide toggle and a live checklist of the rules (RO-13, D16). */
export function PasswordField({
  id,
  label,
  value,
  email,
  required,
  optionalHint,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  email?: string;
  required?: boolean;
  /** shown when the field is empty and optional */
  optionalHint?: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const listId = useId();
  const checks = passwordChecklist(value, email);
  const showChecks = required || value.length > 0;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[12px] font-medium text-[var(--clicks-text)]">
        {label}
        {required ? <span className="ms-0.5 text-[var(--clicks-error)]">*</span> : null}
      </label>
      <span className="relative block">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          className="admin-input admin-input--trail-action"
          value={value}
          aria-invalid={Boolean(error)}
          aria-describedby={showChecks ? listId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute end-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[var(--clicks-blue)]"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </span>
      {showChecks ? (
        <ul id={listId} className="grid gap-0.5 text-[11px] sm:grid-cols-2">
          {checks.map((check) => (
            <li
              key={check.key}
              className={`flex items-center gap-1.5 ${check.ok ? "text-emerald-700" : "text-[var(--clicks-muted)]"}`}
            >
              {check.ok ? <Check className="h-3 w-3" aria-hidden /> : <Circle className="h-3 w-3" aria-hidden />}
              <span>
                {check.label}
                <span className="sr-only">{check.ok ? " — done" : " — not yet"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : optionalHint ? (
        <p className="text-[11px] text-[var(--clicks-muted)]">{optionalHint}</p>
      ) : null}
      {error ? <p className="text-[11px] text-[var(--clicks-error)]">{error}</p> : null}
    </div>
  );
}
