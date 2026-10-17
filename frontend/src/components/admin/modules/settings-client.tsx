"use client";

import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { useAdminQuery } from "@/hooks/use-admin-query";
import { getSiteSettings, updateSiteSettings } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
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

export function SettingsClient() {
  const toast = useAdminToast();
  const [pending, setPending] = useState(false);
  const { data: settings, setData: setSettings, loading, error, reload, token } = useAdminQuery((tok) =>
    getSiteSettings(tok),
  );

  return (
    <div>
      <PageHeader title="Settings" description="Site-wide configuration." />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading ? <div className="h-48 animate-pulse rounded-xl border border-[var(--clicks-border)] bg-white" /> : null}
      {!loading && !error && settings ? (
        <form
          className="max-w-xl space-y-4 rounded-xl border border-[var(--clicks-border)] bg-white p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!token) return;
            setPending(true);
            const fd = new FormData(e.currentTarget);
            try {
              const next = await updateSiteSettings(token, {
                store_name: String(fd.get("store_name") ?? ""),
                ...Object.fromEntries(CONTACT_FIELDS.map((field) => [field.name, String(fd.get(field.name) ?? "").trim()])),
                currency_display: String(fd.get("currency_display") ?? "JOD"),
                low_stock_threshold: Number(fd.get("low_stock_threshold") ?? 5),
                maintenance_mode: fd.get("maintenance_mode") === "on",
              });
              setSettings(next);
              toast.push("Settings saved", "success");
            } catch (err) {
              toast.push(err instanceof ApiError ? err.message : "Save failed", "error");
            } finally {
              setPending(false);
            }
          }}
        >
          <FormField label="Store name" htmlFor="store_name">
            <input
              id="store_name"
              name="store_name"
              className={adminInputClass}
              defaultValue={settings.store_name ?? "MMH"}
            />
          </FormField>
          <div className="border-t border-[var(--clicks-border)] pt-4">
            <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Contact &amp; social</h2>
            <p className="mt-1 text-xs text-[var(--clicks-muted)]">
              Shown on the store&apos;s Contact page, footer, and chat buttons. Leave a field empty to hide it.
            </p>
          </div>
          {CONTACT_FIELDS.map((field) => (
            <FormField key={field.name} label={field.label} htmlFor={field.name} hint={field.hint || undefined}>
              <input
                id={field.name}
                name={field.name}
                type={field.type}
                className={adminInputClass}
                defaultValue={settings[field.name] ?? ""}
              />
            </FormField>
          ))}
          <div className="border-t border-[var(--clicks-border)] pt-4" />
          <FormField label="Currency display" htmlFor="currency_display">
            <input
              id="currency_display"
              name="currency_display"
              className={adminInputClass}
              defaultValue={settings.currency_display ?? "JOD"}
            />
          </FormField>
          <FormField label="Low stock threshold" htmlFor="low_stock_threshold">
            <input
              id="low_stock_threshold"
              name="low_stock_threshold"
              type="number"
              className={adminInputClass}
              defaultValue={settings.low_stock_threshold ?? 5}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input name="maintenance_mode" type="checkbox" defaultChecked={Boolean(settings.maintenance_mode)} />
            Maintenance mode
          </label>
          <button
            type="submit"
            disabled={pending}
            className="h-10 rounded-lg bg-[var(--clicks-blue)] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save settings"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
