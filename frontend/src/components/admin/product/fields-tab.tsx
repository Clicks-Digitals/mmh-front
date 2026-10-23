"use client";

import { EmptyState } from "@/components/admin/ui/empty-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import type { FieldDraft } from "@/components/admin/lib/product-form";

type Props = {
  fields: FieldDraft[];
  errors: Record<string, Record<string, string>>;
  disabled: boolean;
  onChange: (key: string, patch: Partial<FieldDraft>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
};

export function FieldsTab({ fields, errors, disabled, onChange, onAdd, onRemove, onMove }: Props) {
  const visible = fields.filter((f) => !f.delete);
  const input = (f: FieldDraft, key: keyof FieldDraft, rtl = false) => ({
    id: `pf-${f.key_local}-${String(key)}`,
    disabled,
    dir: rtl ? "rtl" : undefined,
    className: adminInputClass,
    value: String(f[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange(f.key_local, { [key]: e.target.value } as Partial<FieldDraft>),
  });

  return (
    <section className="admin-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Required customer fields</h2>
          <p className="mt-0.5 text-xs text-[var(--clicks-muted)]">
            Information the customer must enter at checkout (Player ID, server, UID…). Shown to staff on the order.
          </p>
        </div>
        {!disabled ? (
          <button type="button" className="admin-btn admin-btn-secondary" onClick={onAdd}>
            Add field
          </button>
        ) : null}
      </div>
      <div className="space-y-3">
        {visible.map((f, idx) => {
          const errs = errors[f.key_local] ?? {};
          return (
            <div
              key={f.key_local}
              className={`grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4 ${
                Object.keys(errs).length ? "border-red-300" : "border-[var(--clicks-border)]"
              }`}
            >
              <FormField label="Key" htmlFor={`pf-${f.key_local}-key`} required hint="Internal id, e.g. player_id." error={errs.key}>
                <input {...input(f, "key")} className={`${adminInputClass} font-mono`} />
              </FormField>
              <FormField label="Label (EN)" htmlFor={`pf-${f.key_local}-label_en`} required error={errs.label_en}>
                <input {...input(f, "label_en")} placeholder="Player ID" />
              </FormField>
              <FormField label="Label (AR)" htmlFor={`pf-${f.key_local}-label_ar`}>
                <input {...input(f, "label_ar", true)} />
              </FormField>
              <FormField label="Type" htmlFor={`pf-${f.key_local}-type`} hint="Controls the keyboard and validation.">
                <select {...input(f, "type")}>
                  <option value="TEXT">Text</option>
                  <option value="EMAIL">Email</option>
                  <option value="TEL">Phone</option>
                  <option value="SELECT">Select</option>
                </select>
              </FormField>
              <FormField label="Placeholder (EN)" htmlFor={`pf-${f.key_local}-placeholder_en`}>
                <input {...input(f, "placeholder_en")} />
              </FormField>
              <FormField label="Placeholder (AR)" htmlFor={`pf-${f.key_local}-placeholder_ar`}>
                <input {...input(f, "placeholder_ar", true)} />
              </FormField>
              <FormField label="Help text (EN)" htmlFor={`pf-${f.key_local}-help_text_en`} hint="e.g. where to find the Player ID.">
                <input {...input(f, "help_text_en")} />
              </FormField>
              <FormField label="Help text (AR)" htmlFor={`pf-${f.key_local}-help_text_ar`}>
                <input {...input(f, "help_text_ar", true)} />
              </FormField>
              <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 lg:col-span-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={Boolean(f.required)}
                    onChange={(e) => onChange(f.key_local, { required: e.target.checked })}
                  />
                  Required at checkout
                </label>
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
        <EmptyState title="No customer fields" description="Add Player ID, Server, UID, etc. when checkout needs them." />
      ) : null}
    </section>
  );
}
