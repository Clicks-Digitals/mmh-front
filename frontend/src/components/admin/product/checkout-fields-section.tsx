"use client";

import { FIELD_KINDS, applyFieldKind, effectiveFieldKey, fieldKindOf, patchFieldLabel, type FieldDraft } from "@/components/admin/lib/product-form";
import { CountPill, EditorSection, ErrorPill, Toggle } from "@/components/admin/product/editor-ui";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import type { AdminFieldOption } from "@/lib/api/admin";
import { cn } from "@/lib/cn";
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type Props = {
  fields: FieldDraft[];
  errors: Record<string, Record<string, string>>;
  listError?: string;
  disabled: boolean;
  isTopup: boolean;
  onChange: (key: string, patch: Partial<FieldDraft>) => void;
  /** adds a field (optionally pre-filled) and returns its key */
  onAdd: (preset?: Partial<FieldDraft>) => string;
  onRemove: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
};

/** One-click starting points for the details customers usually type. */
const PRESETS: Array<{ label: string; patch: Partial<FieldDraft> }> = [
  { label: "Player ID", patch: { label_en: "Player ID", label_ar: "معرّف اللاعب", type: "TEXT", input_format: "numeric", required: true } },
  { label: "Zone / Server ID", patch: { label_en: "Zone ID", label_ar: "معرّف المنطقة", type: "TEXT", input_format: "numeric", required: true } },
  { label: "Account email", patch: { label_en: "Account email", label_ar: "البريد الإلكتروني للحساب", type: "EMAIL", input_format: "email", required: true } },
  {
    label: "Server (list)",
    patch: { label_en: "Server", label_ar: "الخادم", type: "SELECT", input_format: "text", required: true, options: [{ value: "", label_en: "", label_ar: "" }] },
  },
];

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
  const set = (i: number, patch: Partial<AdminFieldOption>) => onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-medium">
        Choices customers pick from <span className="text-[var(--clicks-error)]">*</span>
      </p>
      {options.map((o, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_36px] gap-2">
          <input
            aria-label={`Choice ${i + 1} (English)`}
            className={adminInputClass}
            disabled={disabled}
            placeholder="e.g. Europe"
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
            aria-label={`Remove choice ${i + 1}`}
            disabled={disabled}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--clicks-muted)] hover:bg-red-50 hover:text-red-600"
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      {!disabled ? (
        <button type="button" className="admin-btn admin-btn-secondary h-8 gap-1 text-xs" onClick={() => onChange([...options, { value: "", label_en: "", label_ar: "" }])}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add choice
        </button>
      ) : null}
      {error ? <p className="text-[11px] text-[var(--clicks-error)]">{error}</p> : null}
    </div>
  );
}

export function CheckoutFieldsSection({ fields, errors, listError, disabled, isTopup, onChange, onAdd, onRemove, onMove }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const visible = fields.filter((f) => !f.delete);
  const current = visible.find((f) => f.key_local === editing) ?? null;
  const problems = visible.filter((f) => Object.keys(errors[f.key_local] ?? {}).length).length + (listError ? 1 : 0);

  const presets = !disabled ? (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="me-1 text-[12px] text-[var(--clicks-muted)]">Add:</span>
      {PRESETS.filter((p) => !visible.some((f) => (f.label_en ?? "").trim().toLowerCase() === String(p.patch.label_en).toLowerCase())).map((p) => (
        <button
          key={p.label}
          type="button"
          className="h-7 rounded-full border border-[var(--clicks-border)] bg-white px-2.5 text-[12px] font-medium text-[var(--clicks-text)] hover:border-[var(--clicks-blue)] hover:text-[var(--clicks-blue)]"
          onClick={() => onAdd(p.patch)}
        >
          + {p.label}
        </button>
      ))}
      <button
        type="button"
        className="h-7 rounded-full border border-dashed border-[var(--clicks-border-strong)] px-2.5 text-[12px] font-medium text-[var(--clicks-blue)]"
        onClick={() => setEditing(onAdd())}
      >
        + Custom…
      </button>
    </div>
  ) : null;

  return (
    <EditorSection
      id="section-fields"
      title="Checkout details"
      description={
        isTopup
          ? "What the customer types at checkout so the top-up reaches the right account — usually a Player ID."
          : "Code products usually need nothing here. Add a detail only if checkout must ask for something."
      }
      collapsible
      defaultOpen={isTopup || visible.length > 0}
      forceOpen={problems > 0}
      badge={problems ? <ErrorPill count={problems} /> : visible.length ? <CountPill>{visible.length}</CountPill> : null}
      bodyClassName="px-0 pb-0"
    >
      {listError ? (
        <p role="alert" className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          {listError}
        </p>
      ) : null}
      {visible.length ? (
        <ul className="divide-y divide-[var(--clicks-border)] border-y border-[var(--clicks-border)]">
          {visible.map((f, idx) => {
            const errs = errors[f.key_local] ?? {};
            const kind = FIELD_KINDS.find((k) => k.value === fieldKindOf(f));
            const firstError = Object.values(errs)[0];
            return (
              <li key={f.key_local} className={cn("flex items-center gap-3 px-5 py-3", firstError && "bg-red-50/40")}>
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={disabled || idx === 0}
                    onClick={() => onMove(f.key_local, -1)}
                    className="rounded p-0.5 text-[var(--clicks-muted)] hover:bg-[#EEF1F6] disabled:opacity-25"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={disabled || idx === visible.length - 1}
                    onClick={() => onMove(f.key_local, 1)}
                    className="rounded p-0.5 text-[var(--clicks-muted)] hover:bg-[#EEF1F6] disabled:opacity-25"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setEditing(f.key_local)}>
                  <span className="block truncate text-[13px] font-semibold text-[var(--clicks-navy)]">
                    {f.label_en || <span className="text-[var(--clicks-muted)]">Unnamed detail</span>}
                    {f.label_ar ? <span className="ms-2 font-normal text-[var(--clicks-muted)]">{f.label_ar}</span> : null}
                  </span>
                  <span className="block text-[11px] text-[var(--clicks-muted)]">
                    {kind?.label}
                    {f.type === "SELECT" ? ` · ${(f.options ?? []).length} choice${(f.options ?? []).length === 1 ? "" : "s"}` : ""}
                    {f.required ? " · Required" : " · Optional"}
                  </span>
                  {firstError ? <span className="mt-0.5 block text-[11px] font-semibold text-[var(--clicks-error)]">{firstError}</span> : null}
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${f.label_en || "detail"}`}
                  onClick={() => setEditing(f.key_local)}
                  className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-[var(--clicks-muted)] hover:text-[var(--clicks-navy)]",
                    firstError ? "border-red-300 text-red-600" : "border-[var(--clicks-border)]",
                  )}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {!disabled ? (
                  <button
                    type="button"
                    aria-label={`Remove ${f.label_en || "detail"}`}
                    onClick={() => onRemove(f.key_local)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--clicks-muted)] hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-t border-[var(--clicks-border)] px-5 py-4 text-[12px] text-[var(--clicks-muted)]">
          {isTopup ? "No details yet — add a Player ID so the top-up can be delivered." : "Nothing is asked at checkout."}
        </p>
      )}
      {presets ? <div className="px-5 py-4">{presets}</div> : null}

      <AdminModal
        open={Boolean(current)}
        wide
        title={current?.label_en ? `Edit “${current.label_en}”` : "New checkout detail"}
        description="Saved with the product when you press Save."
        onClose={() => setEditing(null)}
      >
        {current ? (
          <FieldEditor
            f={current}
            errs={errors[current.key_local] ?? {}}
            disabled={disabled}
            onChange={onChange}
            onDone={() => setEditing(null)}
            onRemove={() => {
              setEditing(null);
              onRemove(current.key_local);
            }}
          />
        ) : null}
      </AdminModal>
    </EditorSection>
  );
}

function FieldEditor({
  f,
  errs,
  disabled,
  onChange,
  onDone,
  onRemove,
}: {
  f: FieldDraft;
  errs: Record<string, string>;
  disabled: boolean;
  onChange: (key: string, patch: Partial<FieldDraft>) => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const showAdvanced = advanced || Boolean(errs.key);
  const kind = fieldKindOf(f);
  const input = (key: keyof FieldDraft, rtl = false) => ({
    id: `pf-${f.key_local}-${String(key)}`,
    disabled,
    dir: rtl ? "rtl" : undefined,
    className: cn(adminInputClass, errs[key as string] && "border-[var(--clicks-error)]"),
    value: String(f[key] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange(f.key_local, { [key]: e.target.value } as Partial<FieldDraft>),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name customers see (English)" htmlFor={`pf-${f.key_local}-label_en`} required error={errs.label_en}>
          <input {...input("label_en")} placeholder="Player ID" onChange={(e) => onChange(f.key_local, patchFieldLabel(f, e.target.value))} />
        </FormField>
        <FormField label="Name (Arabic)" htmlFor={`pf-${f.key_local}-label_ar`} optional>
          <input {...input("label_ar", true)} placeholder="معرّف اللاعب" />
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="What do they type?" htmlFor={`pf-${f.key_local}-kind`} hint={FIELD_KINDS.find((k) => k.value === kind)?.hint}>
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
        <div className="flex items-end pb-2">
          <Toggle
            id={`pf-${f.key_local}-required`}
            label="Customer must fill this in"
            checked={Boolean(f.required)}
            disabled={disabled}
            onChange={(required) => onChange(f.key_local, { required })}
          />
        </div>
      </div>

      {kind === "select" ? (
        <div className="rounded-lg border border-[var(--clicks-border)] bg-[#FAFBFD] p-3">
          <OptionsEditor field={f} disabled={disabled} error={errs.options} onChange={(options) => onChange(f.key_local, { options })} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Example in the box (English)" htmlFor={`pf-${f.key_local}-placeholder_en`} optional>
            <input {...input("placeholder_en")} placeholder="e.g. 5123456789" />
          </FormField>
          <FormField label="Example in the box (Arabic)" htmlFor={`pf-${f.key_local}-placeholder_ar`} optional>
            <input {...input("placeholder_ar", true)} />
          </FormField>
          <FormField label="Shortest allowed" htmlFor={`pf-${f.key_local}-min_length`} optional hint="Characters." error={errs.min_length}>
            <input {...input("min_length")} inputMode="numeric" placeholder="e.g. 6" />
          </FormField>
          <FormField label="Longest allowed" htmlFor={`pf-${f.key_local}-max_length`} optional hint="Characters." error={errs.max_length}>
            <input {...input("max_length")} inputMode="numeric" placeholder="e.g. 12" />
          </FormField>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Help text (English)" htmlFor={`pf-${f.key_local}-help_text_en`} optional hint="e.g. “Find it under Profile → ID.”">
          <input {...input("help_text_en")} />
        </FormField>
        <FormField label="Help text (Arabic)" htmlFor={`pf-${f.key_local}-help_text_ar`} optional>
          <input {...input("help_text_ar", true)} />
        </FormField>
      </div>

      <div className="rounded-lg border border-dashed border-[var(--clicks-border)]">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-4 py-3 text-start text-[12px] font-semibold text-[var(--clicks-navy)]"
          aria-expanded={showAdvanced}
          onClick={() => setAdvanced(!showAdvanced)}
        >
          <ChevronDown className={cn("h-4 w-4 text-[var(--clicks-muted)] transition", !showAdvanced && "-rotate-90")} aria-hidden />
          Advanced <span className="font-normal text-[var(--clicks-muted)]">— internal key</span>
        </button>
        {showAdvanced ? (
          <div className="px-4 pb-4">
            <FormField
              label="Internal key"
              htmlFor={`pf-${f.key_local}-key`}
              optional
              hint={
                f.id
                  ? "Used in exports and supplier requests. Avoid changing it on a selling product."
                  : `Made from the English name${effectiveFieldKey(f) ? ` (“${effectiveFieldKey(f)}”)` : ""}. Change only if a supplier needs a specific name.`
              }
              error={errs.key}
            >
              <input
                {...input("key")}
                className={cn(adminInputClass, "font-mono", errs.key && "border-[var(--clicks-error)]")}
                onChange={(e) => onChange(f.key_local, { key: e.target.value, key_touched: true })}
              />
            </FormField>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--clicks-border)] pt-4">
        {!disabled ? (
          <button type="button" className="admin-btn admin-btn-ghost !text-[var(--clicks-error)] hover:!bg-red-50" onClick={onRemove}>
            Remove detail
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="admin-btn admin-btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
