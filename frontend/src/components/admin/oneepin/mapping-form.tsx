"use client";

import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import type { MappingDraft } from "@/components/admin/oneepin/mapping-draft";
import { estimateMargin, maxCostWarning } from "@/components/admin/oneepin/mapping-draft";
import { filsJod, previewUserTemplate, sampleFieldValue } from "@/components/admin/oneepin/labels";
import { MarginText } from "@/components/admin/oneepin/ui";
import { cn } from "@/lib/cn";

export type CustomerFieldInfo = { key: string; label?: string; required?: boolean };

function Choice({
  name,
  checked,
  onChange,
  title,
  body,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  body: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-2 rounded-lg border px-3 py-2 text-[13px]",
        checked ? "border-[var(--clicks-blue)] bg-[var(--clicks-blue-soft)]" : "border-[var(--clicks-border)]",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-0.5" />
      <span>
        <span className="block font-medium text-[var(--clicks-navy)]">{title}</span>
        <span className="block text-[12px] text-[var(--clicks-muted)]">{body}</span>
      </span>
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  body,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  body: React.ReactNode;
  id: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer gap-2 text-[13px]">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span>
        <span className="block font-medium text-[var(--clicks-navy)]">{title}</span>
        <span className="block text-[12px] text-[var(--clicks-muted)]">{body}</span>
      </span>
    </label>
  );
}

/**
 * Settings of a 1Epin link (create + edit dialogs). Every option is explained in plain words;
 * the cost / margin preview updates while typing.
 */
export function MappingSettingsForm({
  draft,
  onChange,
  errors = {},
  kind,
  tiered,
  unitCostFils,
  saleFils,
  fields,
  idPrefix = "map",
}: {
  draft: MappingDraft;
  onChange: (patch: Partial<MappingDraft>) => void;
  errors?: Partial<Record<keyof MappingDraft, string>>;
  /** 1Epin category type: "epin" | "topup" */
  kind: string;
  tiered?: boolean;
  /** JOD fils of ONE 1Epin unit */
  unitCostFils?: number | null;
  /** our sale price (fils) of one unit */
  saleFils?: number | null;
  /** the product's customer fields (top-ups) */
  fields?: CustomerFieldInfo[];
  idPrefix?: string;
}) {
  const topup = kind.toLowerCase() === "topup";
  const estimate = estimateMargin(unitCostFils, draft.quantity_per_unit, saleFils);
  const keys = (fields ?? []).map((f) => f.key);
  const sample = Object.fromEntries(keys.map((k) => [k, sampleFieldValue(k)]));
  const preview = topup ? previewUserTemplate(draft.user_template, sample, keys) : null;
  const costWarning = errors.max_cost ? null : maxCostWarning(draft.max_cost, estimate.costFils);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-lg bg-[#F7F8FC] px-3 py-2 text-[12px] sm:grid-cols-3">
        <p>
          <span className="block text-[11px] text-[var(--clicks-muted)]">1Epin cost (one of ours)</span>
          <span className="font-medium tabular-nums">{filsJod(estimate.costFils)}</span>
        </p>
        <p>
          <span className="block text-[11px] text-[var(--clicks-muted)]">Our sale price</span>
          <span className="font-medium tabular-nums">{filsJod(saleFils)}</span>
        </p>
        <p>
          <span className="block text-[11px] text-[var(--clicks-muted)]">Profit per unit</span>
          <MarginText fils={estimate.marginFils} pct={estimate.marginPct} />
        </p>
      </div>

      {!topup ? (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[12px] font-medium text-[var(--clicks-text)]">Where do codes come from first?</legend>
          <Choice
            name={`${idPrefix}-prefer`}
            checked={!draft.prefer_supplier}
            onChange={() => onChange({ prefer_supplier: false })}
            title="Use our own codes first"
            body="Deliver from codes we imported; buy from 1Epin only what is missing. Usually the cheapest."
          />
          <Choice
            name={`${idPrefix}-prefer`}
            checked={draft.prefer_supplier}
            onChange={() => onChange({ prefer_supplier: true })}
            title="Use 1Epin first"
            body="Always buy from 1Epin, even when we have our own codes in stock."
          />
        </fieldset>
      ) : null}

      <Toggle
        id={`${idPrefix}-auto`}
        checked={draft.auto_buy}
        onChange={(v) => onChange({ auto_buy: v })}
        title="Buy automatically"
        body={
          draft.auto_buy
            ? "When a paid order needs this item, we buy it from 1Epin straight away — no one has to click anything."
            : "Off: nothing is bought by itself. Staff use “Buy from 1Epin now” on the order. The option also stops counting as stock."
        }
      />

      <FormField
        label="Maximum cost (JOD)"
        htmlFor={`${idPrefix}-max`}
        optional
        error={errors.max_cost}
        hint="Safety limit. If 1Epin's price for one of our units goes above this, the automatic purchase is skipped and the order waits for a person. Leave empty for no limit."
      >
        <input
          id={`${idPrefix}-max`}
          inputMode="decimal"
          className={`${adminInputClass} max-w-[180px] tabular-nums`}
          placeholder="e.g. 4.500"
          value={draft.max_cost}
          onChange={(e) => onChange({ max_cost: e.target.value })}
        />
        {costWarning ? (
          <p role="alert" className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            {costWarning}
          </p>
        ) : null}
      </FormField>

      <Toggle
        id={`${idPrefix}-loss`}
        checked={draft.allow_loss}
        onChange={(v) => onChange({ allow_loss: v })}
        title="Allow selling at a loss"
        body="Normally we don't buy automatically when 1Epin costs more than our sale price. Tick this only if you accept losing money on these orders."
      />
      {draft.allow_loss ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-900">
          Warning: with this on, orders are bought even when they lose money
          {estimate.marginFils !== null && estimate.marginFils < 0 ? ` — right now each unit loses ${filsJod(-estimate.marginFils)}` : ""}.
        </p>
      ) : null}

      <FormField
        label="1Epin units per one of ours"
        htmlFor={`${idPrefix}-qty`}
        required
        error={errors.quantity_per_unit}
        hint="How many 1Epin items make one of our items. Usually 1. Example: we sell “100 UC” and 1Epin sells “50 UC” → enter 2."
      >
        <input
          id={`${idPrefix}-qty`}
          type="number"
          min={1}
          max={1000}
          step={1}
          className={`${adminInputClass} max-w-[120px] tabular-nums`}
          value={draft.quantity_per_unit}
          onChange={(e) => onChange({ quantity_per_unit: e.target.value })}
        />
      </FormField>

      {topup ? (
        <FormField
          label="Player ID sent to 1Epin"
          htmlFor={`${idPrefix}-tpl`}
          optional
          hint="Which customer details 1Epin receives as the player ID. Put a field key in curly brackets. Leave empty to send the player ID field as is."
        >
          <input
            id={`${idPrefix}-tpl`}
            className={`${adminInputClass} font-mono`}
            placeholder={preview?.usedTemplate || "{playerId}"}
            value={draft.user_template}
            onChange={(e) => onChange({ user_template: e.target.value })}
          />
          {keys.length ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-[var(--clicks-muted)]">Insert:</span>
              {(fields ?? []).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  title={f.label || f.key}
                  onClick={() => onChange({ user_template: `${draft.user_template}{${f.key}}` })}
                  className="rounded border border-[var(--clicks-border)] bg-white px-1.5 py-0.5 font-mono text-[var(--clicks-navy)] hover:border-[var(--clicks-blue)]"
                >
                  {`{${f.key}}`}
                  {f.label ? <span className="ms-1 font-sans text-[var(--clicks-muted)]">{f.label}</span> : null}
                </button>
              ))}
              {keys.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onChange({ user_template: `{${keys[0]}}(${`{${keys[1]}}`})` })}
                  className="rounded border border-dashed border-[var(--clicks-border)] px-1.5 py-0.5 font-mono text-[var(--clicks-muted)] hover:border-[var(--clicks-blue)]"
                  title="Combined, e.g. Mobile Legends user id + zone id"
                >
                  {`{${keys[0]}}({${keys[1]}})`}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-amber-700">This product has no customer fields. Add a “Player ID” field on the Required details tab.</p>
          )}
          {preview ? (
            <p className={cn("mt-1.5 text-[12px]", preview.error ? "text-amber-700" : "text-[var(--clicks-muted)]")}>
              {preview.error ||
                `Example: a customer who typed ${keys.map((k) => `${k}=${sample[k]}`).join(", ")} → 1Epin receives “${preview.value}”.`}
            </p>
          ) : null}
        </FormField>
      ) : null}

      {tiered ? (
        <FormField
          label="Amount (barem)"
          htmlFor={`${idPrefix}-barem`}
          error={errors.barem}
          hint="This 1Epin product is sold by amount. Enter the amount to buy for one of our units."
        >
          <input
            id={`${idPrefix}-barem`}
            inputMode="decimal"
            className={`${adminInputClass} max-w-[160px] tabular-nums`}
            value={draft.barem}
            onChange={(e) => onChange({ barem: e.target.value })}
          />
        </FormField>
      ) : null}

      <Toggle
        id={`${idPrefix}-ignored`}
        checked={draft.ignored}
        onChange={(v) => onChange({ ignored: v })}
        title="Pause this link"
        body="Keep the link but don't use it: nothing is bought from 1Epin for this option."
      />
    </div>
  );
}
