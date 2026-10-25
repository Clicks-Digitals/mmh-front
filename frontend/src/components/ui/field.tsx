"use client";

import { CONTROL } from "@/components/ui/control";
import { cn } from "@/lib/cn";
import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  suffix?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function Field({ label, error, hint, suffix, className, id, ...props }: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? props.name ?? autoId;
  return (
    <label className="block space-y-1.5" htmlFor={fieldId}>
      <span className="text-sm font-medium text-fg">{label}</span>
      <span className="relative block">
        <input
          id={fieldId}
          className={cn(CONTROL, error && "border-danger focus-visible:border-danger focus-visible:ring-danger", suffix ? "pe-10" : "", className)}
          {...props}
        />
        {suffix ? <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-muted">{suffix}</span> : null}
      </span>
      {hint && !error ? <span className="text-xs text-muted">{hint}</span> : null}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  );
}
