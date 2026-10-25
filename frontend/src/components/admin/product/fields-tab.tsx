"use client";

import { EmptyState } from "@/components/admin/ui/empty-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import {
  FIELD_KINDS,
  applyFieldKind,
  effectiveFieldKey,
  fieldKindOf,
  patchFieldLabel,
  type FieldDraft,
} from "@/components/admin/lib/product-form";
import type { AdminFieldOption } from "@/lib/api/admin";
import { useState } from "react";

type Props = {
  fields: FieldDraft[];
  errors: Record<string, Record<string, string>>;
  disabled: boolean;
  isTopup: boolean;
  onChange: (key: string, patch: Partial<FieldDraft>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
};

function OptionsEditor({
  field,
  disabled,
  error,
  onChange,
}: {
  field: FieldDraft;
  disabled: boolean;
  error?: string;
  onChange: (options: AdminFieldOption[]) => void;
}) {
  const options = field.options ?? [];
  const set = (i: number, patch: Partial<AdminFieldOption>) =>
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-[var(--clicks-border)] bg-[#FAFBFD] p-3 sm:col-span-2 lg:col-span-4">
      <p className="text-[12px] font-medium">
        Choices customers pick from <span className="text-[var(--clicks-error)]">*</span>
      </p>
      {options.map((o, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            aria-label={`Choice ${i + 1} (English)`}
            className={adminInputClass}
            disabled={disabled}
            placeholder="English, e.g. Europe"
            value={o.label_en}
            onChange={(e) => set(i, { label_en: e.target.value })}
          />
          <input
            aria-label={`Choice ${i + 1} (Arabic)`}
            className={adminInputClass}
            disabled={disabled}
            dir="rtl"
            placeholder="بالعربية"
            value={o.label_ar ?? ""}
            onChange={(e) => set(i, { label_ar: e.target.value })}
          />
          <button
            type="button"
            disabled={disabled}
            className="admin-btn admin-btn-ghost h-9 text-xs text-[var(--clicks-error)]"
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      {!disabled ? (
        <button
          type="button"
          className="admin-btn admin-btn-secondary h-8 text-xs"
          onClick={() => onChange([...options, { value: "", label_en: "", label_ar: "" }])}
        >
          Add choice
        </button>
      ) : null}
      {error ? <p className="text-[11px] text-[var(--clicks-error)]">{error}</p> : null}
    </div>
  );
}

export function FieldsTab({ fields, errors, disabled, isTopup, onChange, onAdd, onRemove, onMove }: Props) {
  const [advanced, setAdvanced] = useState<Record<string, boolean>>({});
  const visible = fields.filter((f) => !f.delete);
  const input = (f: FieldDraft, key: keyof FieldDraft, rtl = false) => ({
    id: `pf-${f.key_local}-${String(key)}`,
    disabled,
    dir: rtl ? "rtl" : undefined,
    className: `${adminInputClass} ${errors[f.key_local]?.[key as string] ? "border-[var(--clicks-error)]" : ""}`,
    value: String(f[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange(f.key_local, { [key]: e.target.value } as Partial<FieldDraft>),
  });

  return (
    <section className="admin-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Required customer details</h2>
          <p className="mt-0.5 text-xs text-[var(--clicks-muted)]">
            Information the customer must type at checkout, such as a Player ID, Zone ID or server. It is checked before
            payment and shown to staff on the order.
            {isTopup ? " Direct top-ups usually need at least a Player ID." : " Code products usually need none."}
          </p>
        </div>
        {!disabled ? (
          <button type="button" className="admin-btn admin-btn-secondary" onClick={onAdd}>
            Add detail
          </button>
        ) : null}
      </div>
      <div className="space-y-3">
        {visible.map((f, idx) => {
          const errs = errors[f.key_local] ?? {};
          const kind = fieldKindOf(f);
          const showAdvanced = advanced[f.key_local] || Boolean(errs.key);
          return (
            <div
              key={f.key_local}
              className={`grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4 ${
                Object.keys(errs).length ? "border-red-300" : "border-[var(--clicks-border)]"
              }`}
            >
              <FormField label="Name shown to customers (English)" htmlFor={`pf-${f.key_local}-label_en`} required error={errs.label_en}>
                <input
                  {...input(f, "label_en")}
                  placeholder="Player ID"
                  onChange={(e) => onChange(f.key_local, patchFieldLabel(f, e.target.value))}
                />
              </FormField>
              <FormField label="Name (Arabic)" htmlFor={`pf-${f.key_local}-label_ar`} optional>
                <input {...input(f, "label_ar", true)} placeholder="معرّف اللاعب" />
              </FormField>
              <FormField
                label="What do they type?"
                htmlFor={`pf-${f.key_local}-kind`}
                hint={FIELD_KINDS.find((k) => k.value === kind)?.hint}
              >
                <select
                  id={`pf-${f.key_local}-kind`}
                  disabled={disabled}
                  className={adminInputClass}
                  value={kind}
                  onChange={(e) => {
                    const next = applyFieldKind(e.target.value);
                    onChange(f.key_local, {
                      ...next,
                      ...(next.type === "SELECT" && !(f.options ?? []).length ? { options: [{ value: "", label_en: "", label_ar: "" }] } : {}),
                    });
                  }}
                >
                  {FIELD_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </FormField>
              {kind !== "select" ? (
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Min. length" htmlFor={`pf-${f.key_local}-min_length`} optional error={errs.min_length}>
                    <input {...input(f, "min_length")} inputMode="numeric" placeholder="e.g. 6" />
                  </FormField>
                  <FormField label="Max. length" htmlFor={`pf-${f.key_local}-max_length`} optional error={errs.max_length}>
                    <input {...input(f, "max_length")} inputMode="numeric" placeholder="e.g. 12" />
                  </FormField>
                </div>
              ) : (
                <div />
              )}
              {kind === "select" ? (
                <OptionsEditor
                  field={f}
                  disabled={disabled}
                  error={errs.options}
                  onChange={(options) => onChange(f.key_local, { options })}
                />
              ) : (
                <>
                  <FormField label="Example in the box (English)" htmlFor={`pf-${f.key_local}-placeholder_en`} optional>
                    <input {...input(f, "placeholder_en")} placeholder="e.g. 5123456789" />
                  </FormField>
                  <FormField label="Example in the box (Arabic)" htmlFor={`pf-${f.key_local}-placeholder_ar`} optional>
                    <input {...input(f, "placeholder_ar", true)} />
                  </FormField>
                </>
              )}
              <FormField
                label="Help text (English)"
                htmlFor={`pf-${f.key_local}-help_text_en`}
                optional
                hint="e.g. “Find it under Profile → ID in the game.”"
              >
                <input {...input(f, "help_text_en")} />
              </FormField>
              <FormField label="Help text (Arabic)" htmlFor={`pf-${f.key_local}-help_text_ar`} optional>
                <input {...input(f, "help_text_ar", true)} />
              </FormField>

              {showAdvanced ? (
                <FormField
                  label="Internal key"
                  htmlFor={`pf-${f.key_local}-key`}
                  optional
                  className="sm:col-span-2"
                  hint={
                    f.id
                      ? "Used in exports and supplier requests. Changing it on a selling product is not recommended."
                      : `Made from the English name automatically${effectiveFieldKey(f) ? ` (“${effectiveFieldKey(f)}”)` : ""}. Only change it if a supplier needs a specific name.`
                  }
                  error={errs.key}
                >
                  <input
                    {...input(f, "key")}
                    className={`${adminInputClass} font-mono ${errs.key ? "border-[var(--clicks-error)]" : ""}`}
                    onChange={(e) => onChange(f.key_local, { key: e.target.value, key_touched: true })}
                  />
                </FormField>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 lg:col-span-4">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={Boolean(f.required)}
                      onChange={(e) => onChange(f.key_local, { required: e.target.checked })}
                    />
                    Customer must fill this in
                  </label>
                  <button
                    type="button"
                    className="text-xs font-medium text-[var(--clicks-blue)]"
                    onClick={() => setAdvanced((s) => ({ ...s, [f.key_local]: !showAdvanced }))}
                  >
                    {showAdvanced ? "Hide advanced" : "Advanced"}
                  </button>
                </div>
                {!disabled ? (
                  <div className="flex gap-2">
                    <button type="button" className="admin-btn admin-btn-ghost h-8 text-xs" disabled={idx === 0} onClick={() => onMove(f.key_local, -1)}>
                      Move up
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn-ghost h-8 text-xs"
                      disabled={idx === visible.length - 1}
                      onClick={() => onMove(f.key_local, 1)}
                    >
                      Move down
                    </button>
                    <button type="button" className="admin-btn admin-btn-danger h-8 text-xs" onClick={() => onRemove(f.key_local)}>
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {!visible.length ? (
        <EmptyState
          title="No customer details needed"
          description="Add Player ID, Zone ID, server, etc. when checkout needs them. Code products usually need none."
        />
      ) : null}
    </section>
  );
}
