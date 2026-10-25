import { cn } from "@/lib/cn";
import { AlertCircle } from "lucide-react";

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  warning,
  required,
  optional,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  /** non-blocking advice shown in amber (e.g. "don't promise instant delivery") */
  warning?: string;
  required?: boolean;
  /** show a quiet "(optional)" after the label */
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[12px] font-medium text-[var(--clicks-text)]">
        {label}
        {required ? (
          <span className="ms-0.5 text-[var(--clicks-error)]" aria-hidden>
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
        {optional && !required ? <span className="ms-1 font-normal text-[var(--clicks-muted)]">(optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="text-[11px] text-[var(--clicks-error)]">
          {error}
        </p>
      ) : null}
      {warning && !error ? <p className="text-[11px] text-amber-700">{warning}</p> : null}
      {hint && !error ? <p className="text-[11px] text-[var(--clicks-muted)]">{hint}</p> : null}
    </div>
  );
}

/**
 * Box at the top of a form listing what needs fixing, in plain words, with links that
 * jump to each field (CA-26: errors used to appear only as a toast far from the field).
 */
export function FormErrorSummary({
  errors,
  labels,
  idFor,
  title = "Please fix the following:",
  className,
}: {
  errors: Record<string, string | undefined>;
  /** field key -> label shown in the list */
  labels?: Record<string, string>;
  /** field key -> input id to focus */
  idFor?: (key: string) => string | undefined;
  title?: string;
  className?: string;
}) {
  const entries = Object.entries(errors).filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (!entries.length) return null;
  return (
    <div role="alert" className={cn("rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-900", className)}>
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertCircle className="h-4 w-4" aria-hidden />
        {title}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 ps-6">
        {entries.map(([key, message]) => {
          const id = idFor?.(key);
          const label = labels?.[key];
          const text = label ? `${label}: ${message}` : message;
          return (
            <li key={key}>
              {id ? (
                <a
                  href={`#${id}`}
                  className="underline decoration-red-300 underline-offset-2 hover:decoration-red-700"
                  onClick={(e) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    e.preventDefault();
                    el.scrollIntoView({ block: "center", behavior: "smooth" });
                    (el as HTMLElement).focus?.({ preventScroll: true });
                  }}
                >
                  {text}
                </a>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const adminInputClass = "admin-input";

export const adminTextareaClass =
  "min-h-[88px] w-full rounded-[var(--admin-radius-sm)] border border-[var(--clicks-border)] bg-white px-3 py-2 text-sm outline-none transition focus:border-[var(--clicks-blue)] focus:shadow-[0_0_0_3px_var(--clicks-blue-soft)]";

export const adminSelectClass = "admin-input";
