"use client";

import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EntityImageField } from "@/components/admin/ui/entity-image-field";
import { ErrorState } from "@/components/admin/ui/error-state";
import { DEFAULT_HERO_URL, DEFAULT_LOGO_URL } from "@/context/brand-assets-context";
import { notifySettingsChanged } from "@/components/admin/layout/maintenance-bar";
import { validateSettingsForm } from "@/components/admin/lib/settings-form";
import { FormErrorSummary, FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage, adminFieldErrors } from "@/components/admin/lib/errors";
import { useAdminQuery } from "@/hooks/use-admin-query";
import {
  asList,
  deleteSiteImage,
  getSiteSettings,
  listBanners,
  updateSiteSettings,
  uploadSiteImage,
  type Banner,
  type SiteImageTarget,
  type SiteSettings,
} from "@/lib/api/admin";
import { useAdminAccess } from "@/components/admin/admin-access";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Live banners on the home page hide the home picture (the store shows the banner instead). */
export function liveHomeBanners(banners: ReadonlyArray<Pick<Banner, "placement" | "status" | "published">>): number {
  return banners.filter((b) => (b.placement ?? "HOME").toUpperCase() === "HOME" && b.status === "live").length;
}

function useLiveHomeBannerCount(token: string | undefined, enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!token || !enabled) return;
    let cancelled = false;
    listBanners(token, { page_size: 100 })
      .then((data) => {
        if (!cancelled) setCount(liveHomeBanners(asList(data).items));
      })
      .catch(() => {
        // Advisory only: without banner access the note is simply not shown.
      });
    return () => {
      cancelled = true;
    };
  }, [token, enabled]);
  return enabled ? count : 0;
}

// Shown on the storefront Contact page, footer, and floating chat buttons. Empty = hidden.
const CONTACT_FIELDS = [
  { name: "support_email", label: "Support email", type: "email", hint: "" },
  { name: "support_phone", label: "Support phone", type: "tel", hint: "" },
  { name: "business_hours", label: "Business hours", type: "text", hint: "e.g. Daily 10:00–22:00" },
  {
    name: "whatsapp_number",
    label: "WhatsApp number",
    type: "tel",
    hint: "Digits only, with the country code and without + or spaces, e.g. 962791234567.",
  },
  { name: "telegram_url", label: "Telegram link", type: "url", hint: "e.g. https://t.me/yourchannel" },
  { name: "instagram_url", label: "Instagram link", type: "url", hint: "e.g. https://instagram.com/yourshop" },
  { name: "facebook_url", label: "Facebook link", type: "url", hint: "e.g. https://facebook.com/yourshop" },
  { name: "tiktok_url", label: "TikTok link", type: "url", hint: "e.g. https://tiktok.com/@yourshop" },
  { name: "youtube_url", label: "YouTube link", type: "url", hint: "e.g. https://youtube.com/@yourshop" },
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

  function check(): boolean {
    const local = validateSettingsForm(form);
    setErrors(local);
    return Object.keys(local).length === 0;
  }

  async function save() {
    if (!token) return;
    if (!check()) return;
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
      notifySettingsChanged(next);
      toast.push("Settings saved", "success");
    } catch (err) {
      const fieldErrs = adminFieldErrors(err);
      setErrors(fieldErrs);
      toast.push(Object.keys(fieldErrs).length ? "Settings were not saved — please fix the highlighted fields." : adminErrorMessage(err, "Save failed"), "error");
    } finally {
      setPending(false);
    }
  }

  const enablingMaintenance = form.maintenance_mode && !settings.maintenance_mode;

  return (
    <form
      className="max-w-xl space-y-4 rounded-xl border border-[var(--clicks-border)] bg-white p-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!check()) return;
        if (enablingMaintenance) setConfirmMaintenance(true);
        else void save();
      }}
    >
      <FormErrorSummary
        errors={errors}
        labels={Object.fromEntries([
          ["store_name", "Store name"],
          ["low_stock_threshold", "Low stock threshold"],
          ...CONTACT_FIELDS.map((f) => [f.name, f.label]),
        ])}
        idFor={(key) => key}
      />
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
            inputMode={field.name === "whatsapp_number" ? "numeric" : undefined}
            placeholder={field.name === "whatsapp_number" ? "962791234567" : undefined}
            aria-invalid={errors[field.name] ? true : undefined}
            onChange={(e) => {
              const value = e.target.value;
              setForm((f) => ({ ...f, [field.name]: value }));
              setErrors((prev) => {
                if (!prev[field.name]) return prev;
                const next = { ...prev };
                delete next[field.name];
                return next;
              });
            }}
          />
        </FormField>
      ))}
      <div className="border-t border-[var(--clicks-border)] pt-4">
        <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Operations</h2>
      </div>
      <FormField
        label="Low stock threshold"
        htmlFor="low_stock_threshold"
        hint="A published code variant counts as low stock when its available codes are at or below this number (available ≤ threshold). Used on the dashboard, Inventory and the products filter."
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
          Shows a “back soon” page to shoppers instead of the catalog, so nobody can buy. Order pages, accounts, sign-in and
          contact keep working, and so does this admin panel. A yellow bar at the top of the panel reminds you while it is on.
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

/** Store logo and home picture — uploaded here, bundled defaults until then. */
function BrandPictures({ settings, token, onChanged }: { settings: SiteSettings; token?: string; onChanged: (s: SiteSettings) => void }) {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canBanners = can("content.read");
  const liveBanners = useLiveHomeBannerCount(token, canBanners);
  const upload = async (target: SiteImageTarget, file: File) => {
    if (!token) return;
    onChanged(await uploadSiteImage(token, target, file));
    toast.push(target === "logo" ? "Logo uploaded" : "Home picture uploaded", "success");
  };
  const remove = async (target: SiteImageTarget) => {
    if (!token) return;
    onChanged(await deleteSiteImage(token, target));
    toast.push(target === "logo" ? "Logo removed" : "Home picture removed", "success");
  };
  return (
    <section className="mt-4 max-w-xl space-y-3 rounded-xl border border-[var(--clicks-border)] bg-white p-5" aria-label="Logo and home picture">
      <div>
        <h2 className="text-[14px] font-semibold text-[var(--clicks-navy)]">Logo &amp; home picture</h2>
        <p className="text-[12px] text-[var(--clicks-muted)]">Saved as soon as you upload — no need to press Save.</p>
      </div>
      <EntityImageField
        label="Store logo"
        recommended="square, 512 × 512 px (PNG with a transparent background works best)"
        imageUrl={settings.logo_image_url}
        fallbackUrl={DEFAULT_LOGO_URL}
        canWrite={Boolean(token)}
        removeDescription="The store goes back to the default MMH logo."
        onUpload={(file) => upload("logo", file)}
        onRemove={() => remove("logo")}
      />
      <EntityImageField
        label="Home picture"
        recommended="wide, 1920 × 1080 px"
        minEdge={720}
        shape="wide"
        imageUrl={settings.hero_image_url}
        fallbackUrl={DEFAULT_HERO_URL}
        canWrite={Boolean(token)}
        removeDescription="The home page goes back to the default picture. It is only shown while no home banner is live (Content → Banners)."
        onUpload={(file) => upload("hero", file)}
        onRemove={() => remove("hero")}
      />
      {liveBanners > 0 ? (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          A banner is showing on the home page — the home picture appears only when no banner is live.{" "}
          <Link href="/admin/banners" className="font-semibold text-[var(--clicks-blue)] underline-offset-2 hover:underline">
            Open Banners
          </Link>
        </p>
      ) : null}
      <p className="text-[11px] text-[var(--clicks-muted)]">
        The home picture fills the top of the home page whenever no home banner is live. The logo appears in the header, footer and promo strip.
      </p>
    </section>
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
        <>
          <SettingsForm settings={settings} token={token} onSaved={(s) => setSettings(s)} />
          <BrandPictures settings={settings} token={token} onChanged={(s) => setSettings(s)} />
        </>
      ) : null}
    </div>
  );
}
