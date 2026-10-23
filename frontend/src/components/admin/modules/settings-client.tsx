"use client";

import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, adminFieldErrors } from "@/components/admin/lib/errors";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { getSiteSettings, updateSiteSettings, type SiteSettings } from "@/lib/api/admin";
import { useState } from "react";

// Shown on the storefront Contact page, footer, and floating chat buttons. Empty = hidden.
const CONTACT_FIELDS = [
  { name: "support_email", label: "Support email", type: "email", hint: "" },
  { name: "support_phone", label: "Support phone", type: "tel", hint: "" },
  { name: "business_hours", label: "Business hours", type: "text", hint: "e.g. Daily 10:00–22:00" },
  { name: "whatsapp_number", label: "WhatsApp number", type: "tel", hint: "International format without +, e.g. 962791234567" },
  { name: "telegram_url", label: "Telegram link", type: "url", hint: "e.g. https://t.me/yourchannel" },
  { name: "instagram_url", label: "Instagram link", type: "url", hint: "" },
  { name: "facebook_url", label: "Facebook link", type: "url", hint: "" },
  { name: "tiktok_url", label: "TikTok link", type: "url", hint: "" },
  { name: "youtube_url", label: "YouTube link", type: "url", hint: "" },
] as const;

type ContactKey = (typeof CONTACT_FIELDS)[number]["name"];
type Form = Record<ContactKey, string> & {
  store_name: string;
  low_stock_threshold: string;
  maintenance_mode: boolean;
};

function toForm(s: SiteSettings): Form {
  return {
    store_name: s.store_name ?? "",
    low_stock_threshold: String(s.low_stock_threshold ?? 5),
    maintenance_mode: Boolean(s.maintenance_mode),
    ...(Object.fromEntries(CONTACT_FIELDS.map((f) => [f.name, s[f.name] ?? ""])) as Record<ContactKey, string>),
  };
}

function SettingsForm({ settings, token, onSaved }: { settings: SiteSettings; token?: string; onSaved: (s: SiteSettings) => void }) {
  const toast = useAdminToast();
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  async function save() {
    if (!token) return;
    setPending(true);
    setErrors({});
    try {
      const next = await updateSiteSettings(token, {
        store_name: form.store_name.trim(),
        ...Object.fromEntries(CONTACT_FIELDS.map((f) => [f.name, form[f.name].trim()])),
        low_stock_threshold: Number(form.low_stock_threshold || 0),
        maintenance_mode: form.maintenance_mode,
      });
      onSaved(next);
      setForm(toForm(next));
      toast.push("Settings saved", "success");
    } catch (err) {
      setErrors(adminFieldErrors(err));
      toast.push(adminErrorMessage(err, "Save failed"), "error");
    } finally {
      setPending(false);
    }
  }

  const enablingMaintenance = form.maintenance_mode && !settings.maintenance_mode;

  return (
    <form
      className="max-w-xl space-y-4 rounded-xl border border-[var(--clicks-border)] bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (enablingMaintenance) setConfirmMaintenance(true);
        else void save();
      }}
    >
      <FormField label="Store name" htmlFor="store_name" hint="Used in the store footer and e-mails." error={errors.store_name}>
        <input
          id="store_name"
          className={adminInputClass}
          value={form.store_name}
          maxLength={160}
          onChange={(e) => setForm((f) => ({ ...f, store_name: e.target.value }))}
        />
      </FormField>
      <div className="border-t border-[var(--clicks-border)] pt-4">
        <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Contact &amp; social</h2>
        <p className="mt-1 text-xs text-[var(--clicks-muted)]">
          Shown on the store&apos;s Contact page, footer, and chat buttons. Leave a field empty to hide it.
        </p>
      </div>
      {CONTACT_FIELDS.map((field) => (
        <FormField
          key={field.name}
          label={field.label}
          htmlFor={field.name}
          hint={field.hint || undefined}
          error={errors[field.name]}
        >
          <input
            id={field.name}
            type={field.type}
            className={adminInputClass}
            value={form[field.name]}
            onChange={(e) => setForm((f) => ({ ...f, [field.name]: e.target.value }))}
          />
        </FormField>
      ))}
      <div className="border-t border-[var(--clicks-border)] pt-4">
        <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Operations</h2>
      </div>
      <FormField
        label="Low stock threshold"
        htmlFor="low_stock_threshold"
        hint="Code variants with fewer available codes than this are flagged as low stock on the dashboard and inventory."
        error={errors.low_stock_threshold}
      >
        <input
          id="low_stock_threshold"
          type="number"
          min={0}
          className={adminInputClass}
          value={form.low_stock_threshold}
          onChange={(e) => setForm((f) => ({ ...f, low_stock_threshold: e.target.value }))}
        />
      </FormField>
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.maintenance_mode}
            onChange={(e) => setForm((f) => ({ ...f, maintenance_mode: e.target.checked }))}
          />
          Maintenance mode
        </label>
        <p className="ps-6 text-[11px] text-[var(--clicks-muted)]">
          Shows a “back soon” page to shoppers instead of the store. The admin panel keeps working.
        </p>
      </div>
      <button type="submit" disabled={pending} className="admin-btn admin-btn-primary disabled:opacity-60">
        {pending ? "Saving…" : "Save settings"}
      </button>

      <ConfirmDialog
        open={confirmMaintenance}
        title="Turn on maintenance mode?"
        description="Shoppers will see a “back soon” page and cannot browse or check out until you turn it off."
        confirmLabel="Turn on & save"
        danger
        pending={pending}
        onCancel={() => setConfirmMaintenance(false)}
        onConfirm={() => {
          setConfirmMaintenance(false);
          void save();
        }}
      />
    </form>
  );
}

export function SettingsClient() {
  const { data: settings, setData: setSettings, loading, error, reload, token } = useAdminQuery((tok) =>
    getSiteSettings(tok),
  );

  return (
    <div>
      <PageHeader title="Settings" description="Store-wide configuration." />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading ? <div className="h-48 animate-pulse rounded-xl border border-[var(--clicks-border)] bg-white" /> : null}
      {!loading && !error && settings ? (
        <SettingsForm settings={settings} token={token} onSaved={(s) => setSettings(s)} />
      ) : null}
    </div>
  );
}
