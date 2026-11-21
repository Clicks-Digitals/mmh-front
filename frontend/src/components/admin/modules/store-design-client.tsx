"use client";

import { adminErrorMessage } from "@/components/admin/lib/errors";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { ErrorState } from "@/components/admin/ui/error-state";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { useAdminToast } from "@/components/admin/ui/toast";
import { useAdminQuery } from "@/hooks/use-admin-query";
import {
  fetchAllPages,
  getSiteSettings,
  listCategories,
  listProducts,
  updateSiteSettings,
  uploadDesignImage,
  type AdminCategory,
  type AdminProduct,
  type SiteSettings,
} from "@/lib/api/admin";
import { cn } from "@/lib/cn";
import { resolveMediaUrl } from "@/lib/media";
import {
  BUILTIN_SECTIONS,
  THEME_PRESETS,
  isBackgroundTooLight,
  normalizeHomeLayout,
  normalizeTheme,
  type BuiltinSectionType,
  type HomeSection,
  type ImageSection,
  type NeonLevel,
  type ProductsSection,
  type StoreTheme,
} from "@/lib/design";
import { ArrowDown, ArrowUp, Eye, EyeOff, ExternalLink, ImagePlus, LayoutList, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const ICON_BTN = "rounded-md p-1.5 text-[var(--clicks-muted)] hover:bg-[#EEF1F6] hover:text-[var(--clicks-text)] disabled:opacity-25";
const STORE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.mmhcard.com";

export const BUILTIN_LABELS: Record<BuiltinSectionType, { title: string; hint: string }> = {
  banners: { title: "Banners", hint: "The big sliding banners (Content → Banners), or the home picture when none are live." },
  promo: { title: "Trust strip", hint: "“Trusted codes. Clear regions. Local support.”" },
  platforms: { title: "Brand logos", hint: "PlayStation, Steam, Xbox… (Catalog → Platforms)." },
  categories: { title: "Categories slider", hint: "Round category pictures that slide." },
  best_sellers: { title: "Best sellers", hint: "Products marked as trending." },
  services: { title: "Store services", hint: "Big category cards." },
  suggested: { title: "MMH suggests", hint: "Glow circles (Content → Home tiles)." },
  support: { title: "Contact support", hint: "Call-out with your contact buttons." },
};

const NEON_OPTIONS: Array<{ value: NeonLevel; title: string; body: string }> = [
  { value: "off", title: "Off", body: "Clean and calm. No glow." },
  { value: "accents", title: "Accents", body: "Glow when a customer hovers or picks something. Recommended." },
  { value: "full", title: "Full neon", body: "Glowing edges, headings and header line all the time." },
];

const SOURCE_LABELS: Record<ProductsSection["source"], string> = {
  category: "A category",
  products: "Products I choose",
  deals: "Products on sale",
  newest: "Newest products",
};

export function sectionTitle(section: HomeSection): string {
  if (section.type === "products") return section.title_en || section.title_ar || "Product row";
  if (section.type === "image") return section.alt_en || "Picture banner";
  return BUILTIN_LABELS[section.type].title;
}

export function sectionSummary(section: HomeSection, categoryName: (slug: string) => string): string {
  if (section.type === "products") {
    const from =
      section.source === "category"
        ? `from ${categoryName(section.category)}`
        : section.source === "products"
          ? `${section.products.length} chosen product${section.products.length === 1 ? "" : "s"}`
          : SOURCE_LABELS[section.source].toLowerCase();
    return `Product ${section.style === "grid" ? "grid" : "row"} · ${from} · up to ${section.limit}`;
  }
  if (section.type === "image") return section.href ? `Picture banner → ${section.href}` : "Picture banner (no link)";
  return BUILTIN_LABELS[section.type].hint;
}

/** Move an item one step; returns a new array. */
export function moveSection<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function emptyProducts(): ProductsSection {
  return { id: newId(), type: "products", visible: true, title_en: "", title_ar: "", source: "category", category: "", products: [], limit: 8, style: "row" };
}

function emptyImage(): ImageSection {
  return { id: newId(), type: "image", visible: true, image: "", image_mobile: "", href: "", alt_en: "", alt_ar: "" };
}

/* ─── Preview of the theme ─── */

function ThemePreview({ theme }: { theme: StoreTheme }) {
  const glow = theme.neon !== "off";
  const full = theme.neon === "full";
  return (
    <div
      className="overflow-hidden rounded-xl border border-black/10 p-4 text-white"
      style={{
        background: full
          ? `radial-gradient(28rem 12rem at 90% -10%, ${theme.secondary}55, transparent 70%), ${theme.background}`
          : theme.background,
      }}
      aria-label="Preview"
    >
      <div
        className="mb-4 flex items-center justify-between border-b pb-3 text-xs"
        style={{ borderColor: full ? `${theme.secondary}` : "rgba(255,255,255,0.12)", boxShadow: full ? `0 6px 18px -12px ${theme.secondary}` : undefined }}
      >
        <span className="font-bold tracking-widest">MMH</span>
        <span className="opacity-70">Menu · Cart</span>
      </div>
      <p className="mb-3 text-sm font-bold" style={{ textShadow: full ? `0 0 14px ${theme.secondary}` : undefined }}>
        Best sellers
      </p>
      <div className="grid grid-cols-3 gap-2">
        {["$10", "$25", "$50"].map((label, i) => (
          <div
            key={label}
            className="rounded-lg border px-2 py-3 text-center text-sm font-bold"
            style={{
              background: "rgba(255,255,255,0.05)",
              borderColor: i === 1 ? theme.primary : full ? `${theme.secondary}99` : "rgba(255,255,255,0.12)",
              boxShadow: i === 1 && glow ? `0 0 16px -3px ${theme.primary}` : full ? `0 0 14px -8px ${theme.secondary}` : undefined,
            }}
          >
            {label}
          </div>
        ))}
      </div>
      <div
        className="mt-4 rounded-lg py-2 text-center text-sm font-semibold"
        style={{ background: theme.primary, color: "#17182b", boxShadow: full ? `0 0 20px -4px ${theme.primary}` : undefined }}
      >
        Buy now
      </div>
    </div>
  );
}

function ColorInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState({ for: value, text: value });
  const text = draft.for === value ? draft.text : value;
  const setText = (next: string) => setDraft({ for: value, text: next });
  return (
    <FormField label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-[var(--clicks-border)] bg-white p-0.5"
        />
        <input
          id={id}
          className={cn(adminInputClass, "font-mono uppercase")}
          value={text}
          maxLength={7}
          onChange={(e) => {
            const next = e.target.value;
            if (/^#[0-9a-f]{6}$/i.test(next)) {
              setDraft({ for: next.toLowerCase(), text: next });
              onChange(next.toLowerCase());
            } else setText(next);
          }}
        />
      </div>
    </FormField>
  );
}

/* ─── Section editor dialogs ─── */

function ProductsDialog({
  initial,
  categories,
  products,
  onClose,
  onSave,
}: {
  initial: ProductsSection;
  categories: AdminCategory[];
  products: AdminProduct[];
  onClose: () => void;
  onSave: (s: ProductsSection) => void;
}) {
  const [s, setS] = useState(initial);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const set = <K extends keyof ProductsSection>(key: K, value: ProductsSection[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const nameOf = useMemo(() => new Map(products.map((p) => [p.slug, p.name_en || p.slug])), [products]);
  const matches = products
    .filter((p) => !s.products.includes(p.slug))
    .filter((p) => !query || `${p.name_en} ${p.name_ar ?? ""} ${p.slug}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  function save() {
    if (!s.title_en.trim() && !s.title_ar.trim()) return setError("Give the row a title.");
    if (s.source === "category" && !s.category) return setError("Pick a category.");
    if (s.source === "products" && !s.products.length) return setError("Add at least one product.");
    onSave({ ...s, title_en: s.title_en.trim(), title_ar: s.title_ar.trim() });
  }

  return (
    <AdminModal open title={initial.title_en || initial.title_ar ? "Edit product row" : "Add a product row"} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Title (English)" htmlFor="row-title-en">
            <input id="row-title-en" className={adminInputClass} value={s.title_en} onChange={(e) => set("title_en", e.target.value)} placeholder="e.g. PlayStation deals" />
          </FormField>
          <FormField label="Title (Arabic)" htmlFor="row-title-ar">
            <input id="row-title-ar" dir="rtl" className={adminInputClass} value={s.title_ar} onChange={(e) => set("title_ar", e.target.value)} placeholder="مثال: عروض بلايستيشن" />
          </FormField>
        </div>
        <FormField label="Which products?" htmlFor="row-source">
          <select id="row-source" className={adminInputClass} value={s.source} onChange={(e) => set("source", e.target.value as ProductsSection["source"])}>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
        {s.source === "category" ? (
          <FormField label="Category" htmlFor="row-category" hint="Includes its sub-categories.">
            <select id="row-category" className={adminInputClass} value={s.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name_en}
                </option>
              ))}
            </select>
          </FormField>
        ) : null}
        {s.source === "products" ? (
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-[var(--clicks-text)]">Products, in the order shown</p>
            {s.products.length ? (
              <ol className="divide-y divide-[var(--clicks-border)] rounded-lg border border-[var(--clicks-border)]">
                {s.products.map((slug, i) => (
                  <li key={slug} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                    <span className="w-5 text-[var(--clicks-muted)] tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{nameOf.get(slug) ?? slug}</span>
                    <button type="button" className={ICON_BTN} aria-label="Move up" onClick={() => set("products", moveSection(s.products, i, -1))} disabled={i === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className={ICON_BTN} aria-label="Move down" onClick={() => set("products", moveSection(s.products, i, 1))} disabled={i === s.products.length - 1}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className={ICON_BTN} aria-label="Remove" onClick={() => set("products", s.products.filter((x) => x !== slug))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12px] text-[var(--clicks-muted)]">No products yet. Search below to add some.</p>
            )}
            <input className={adminInputClass} placeholder="Search products to add…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search products to add" />
            <div className="flex flex-wrap gap-1.5">
              {matches.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--clicks-border)] px-2.5 py-1 text-[12px] hover:border-[var(--clicks-blue)] hover:text-[var(--clicks-blue)]"
                  onClick={() => set("products", [...s.products, p.slug].slice(0, 24))}
                >
                  <Plus className="h-3 w-3" /> {p.name_en}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Show up to" htmlFor="row-limit">
            <select id="row-limit" className={adminInputClass} value={s.limit} onChange={(e) => set("limit", Number(e.target.value))}>
              {[4, 6, 8, 12, 16, 24].map((n) => (
                <option key={n} value={n}>
                  {n} products
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Layout" htmlFor="row-style">
            <select id="row-style" className={adminInputClass} value={s.style} onChange={(e) => set("style", e.target.value as ProductsSection["style"])}>
              <option value="row">Sliding row</option>
              <option value="grid">Grid</option>
            </select>
          </FormField>
        </div>
        {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-[var(--clicks-border)] pt-4">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="admin-btn admin-btn-primary" onClick={save}>
            Done
          </button>
        </div>
      </div>
    </AdminModal>
  );
}

function ImageDialog({ initial, token, onClose, onSave }: { initial: ImageSection; token?: string; onClose: () => void; onSave: (s: ImageSection) => void }) {
  const toast = useAdminToast();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState<"" | "image" | "image_mobile">("");
  const [error, setError] = useState("");
  const set = <K extends keyof ImageSection>(key: K, value: ImageSection[K]) => setS((prev) => ({ ...prev, [key]: value }));

  async function upload(key: "image" | "image_mobile", file: File | undefined) {
    if (!file || !token) return;
    setBusy(key);
    try {
      const res = await uploadDesignImage(token, file);
      set(key, res.url);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Upload failed"), "error");
    } finally {
      setBusy("");
    }
  }

  function save() {
    if (!s.image) return setError("Upload a picture.");
    if (s.href && !/^(\/(?!\/)|https:\/\/)/.test(s.href.trim())) return setError("The link must start with / (a store page) or https://");
    onSave({ ...s, href: s.href.trim() });
  }

  const picker = (key: "image" | "image_mobile", label: string, hint: string) => (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-[var(--clicks-text)]">{label}</p>
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--clicks-border)] bg-[var(--clicks-bg)]">
          {s[key] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolveMediaUrl(s[key])} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-5 w-5 text-[var(--clicks-muted)]" />
          )}
        </div>
        <div className="space-y-1">
          <label className="admin-btn admin-btn-secondary cursor-pointer">
            {busy === key ? "Uploading…" : s[key] ? "Replace" : "Upload"}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => upload(key, e.target.files?.[0])} />
          </label>
          {s[key] && key === "image_mobile" ? (
            <button type="button" className="block text-[12px] text-[var(--clicks-muted)] underline" onClick={() => set(key, "")}>
              Use the wide picture on phones
            </button>
          ) : null}
          <p className="text-[11px] text-[var(--clicks-muted)]">{hint}</p>
        </div>
      </div>
    </div>
  );

  return (
    <AdminModal open title={initial.image ? "Edit picture banner" : "Add a picture banner"} onClose={onClose} wide>
      <div className="space-y-4">
        {picker("image", "Picture", "Wide picture, e.g. 1600 × 500.")}
        {picker("image_mobile", "Phone picture (optional)", "Taller picture for phones, e.g. 800 × 600.")}
        <FormField label="Link (optional)" htmlFor="img-href" hint="A store page like /category/playstation-section or a full https:// address.">
          <input id="img-href" className={adminInputClass} value={s.href} onChange={(e) => set("href", e.target.value)} placeholder="/category/…" />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Description (English)" htmlFor="img-alt-en" hint="Read out by screen readers.">
            <input id="img-alt-en" className={adminInputClass} value={s.alt_en} onChange={(e) => set("alt_en", e.target.value)} />
          </FormField>
          <FormField label="Description (Arabic)" htmlFor="img-alt-ar">
            <input id="img-alt-ar" dir="rtl" className={adminInputClass} value={s.alt_ar} onChange={(e) => set("alt_ar", e.target.value)} />
          </FormField>
        </div>
        {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-[var(--clicks-border)] pt-4">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="admin-btn admin-btn-primary" onClick={save} disabled={Boolean(busy)}>
            Done
          </button>
        </div>
      </div>
    </AdminModal>
  );
}

/* ─── Page ─── */

export function StoreDesignClient() {
  const { data: settings, loading, error, reload, token, setData } = useAdminQuery((tok) => getSiteSettings(tok));
  const { data: catalog } = useAdminQuery(async (tok) => {
    const [categories, products] = await Promise.all([
      fetchAllPages<AdminCategory>((params) => listCategories(tok, params)),
      fetchAllPages<AdminProduct>((params) => listProducts(tok, params)),
    ]);
    return { categories, products };
  });
  const [round, setRound] = useState(0);
  return (
    <div className="pb-24">
      <PageHeader
        title="Store design"
        description="Colours, neon glow and what the home page shows, in which order. Changes go live when you save."
        actions={
          <a href={STORE_URL} target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn-secondary inline-flex items-center gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" /> View store
          </a>
        }
      />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading ? <div className="h-48 animate-pulse rounded-xl border border-[var(--clicks-border)] bg-white" /> : null}
      {!loading && settings ? (
        <DesignEditor
          key={`${settings.updated_at ?? ""}-${round}`}
          settings={settings}
          token={token}
          categories={(catalog?.categories ?? []).filter((c) => c.status !== "ARCHIVED")}
          products={(catalog?.products ?? []).filter((p) => p.status === "PUBLISHED")}
          onSaved={setData}
          onUndo={() => setRound((n) => n + 1)}
        />
      ) : null}
    </div>
  );
}

function DesignEditor({
  settings,
  token,
  categories,
  products,
  onSaved,
  onUndo,
}: {
  settings: SiteSettings;
  token?: string;
  categories: AdminCategory[];
  products: AdminProduct[];
  onSaved: (s: SiteSettings) => void;
  onUndo: () => void;
}) {
  const toast = useAdminToast();
  const [theme, setTheme] = useState<StoreTheme>(() => normalizeTheme(settings.theme));
  const [layout, setLayout] = useState<HomeSection[]>(() => normalizeHomeLayout(settings.home_layout));
  const [saved] = useState(() => JSON.stringify({ t: normalizeTheme(settings.theme), l: normalizeHomeLayout(settings.home_layout) }));
  const [editing, setEditing] = useState<{ index: number; section: ProductsSection | ImageSection } | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify({ t: theme, l: layout }) !== saved;
  const categoryName = (slug: string) => categories.find((c) => c.slug === slug)?.name_en ?? slug;
  const missingBuiltins = BUILTIN_SECTIONS.filter((key) => !layout.some((s) => s.type === key));
  const tooLight = isBackgroundTooLight(theme.background);

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  async function save() {
    if (!token || tooLight) return;
    setSaving(true);
    try {
      const next = await updateSiteSettings(token, { theme, home_layout: layout });
      onSaved(next);
      toast.push("Design saved. The store shows it now.", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Save failed"), "error");
    } finally {
      setSaving(false);
    }
  }

  function commit(section: ProductsSection | ImageSection) {
    if (!editing) return;
    setLayout((prev) => (editing.index < 0 ? [...prev, section] : prev.map((s, i) => (i === editing.index ? section : s))));
    setEditing(null);
  }

  const activePreset = THEME_PRESETS.find(
    (p) => p.theme.primary === theme.primary && p.theme.secondary === theme.secondary && p.theme.background === theme.background && p.theme.neon === theme.neon,
  )?.key;

  return (
    <>
      {(
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* Theme */}
          <section className="admin-card space-y-5 p-5" aria-labelledby="theme-title">
            <div>
              <h2 id="theme-title" className="text-[15px] font-semibold text-[var(--clicks-navy)]">
                Look &amp; colours
              </h2>
              <p className="mt-0.5 text-[12px] text-[var(--clicks-muted)]">Start from a ready-made look, then adjust any colour.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  aria-pressed={activePreset === preset.key}
                  onClick={() => setTheme(preset.theme)}
                  className={cn(
                    "rounded-lg border p-2 text-start text-[12px] font-medium transition",
                    activePreset === preset.key ? "border-[var(--clicks-blue)] ring-2 ring-[var(--clicks-blue)]/25" : "border-[var(--clicks-border)] hover:border-[var(--clicks-blue)]/50",
                  )}
                >
                  <span className="mb-1.5 flex h-6 overflow-hidden rounded" style={{ background: preset.theme.background }}>
                    <span className="m-1 w-4 rounded-sm" style={{ background: preset.theme.primary, boxShadow: preset.theme.neon === "full" ? `0 0 8px ${preset.theme.primary}` : undefined }} />
                    <span className="my-1 w-4 rounded-sm" style={{ background: preset.theme.secondary }} />
                  </span>
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <ColorInput id="c-primary" label="Main colour (buttons, prices)" value={theme.primary} onChange={(v) => setTheme({ ...theme, primary: v })} />
              <ColorInput id="c-secondary" label="Second colour (glow, highlights)" value={theme.secondary} onChange={(v) => setTheme({ ...theme, secondary: v })} />
              <ColorInput id="c-background" label="Background" value={theme.background} onChange={(v) => setTheme({ ...theme, background: v })} />
            </div>
            {tooLight ? (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                This background is too light. The store&apos;s text is white, so it would be hard to read. Pick a darker background.
              </p>
            ) : null}
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[12px] font-medium text-[var(--clicks-text)]">Neon glow</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {NEON_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      "cursor-pointer rounded-lg border p-3 text-[12px] transition",
                      theme.neon === opt.value ? "border-[var(--clicks-blue)] bg-[var(--clicks-blue)]/5" : "border-[var(--clicks-border)]",
                    )}
                  >
                    <input type="radio" name="neon" value={opt.value} checked={theme.neon === opt.value} onChange={() => setTheme({ ...theme, neon: opt.value })} className="sr-only" />
                    <span className="block font-semibold text-[var(--clicks-navy)]">{opt.title}</span>
                    <span className="text-[var(--clicks-muted)]">{opt.body}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <ThemePreview theme={theme} />
          </section>

          {/* Home page */}
          <section className="admin-card space-y-4 p-5" aria-labelledby="home-title">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="home-title" className="text-[15px] font-semibold text-[var(--clicks-navy)]">
                  Home page sections
                </h2>
                <p className="mt-0.5 text-[12px] text-[var(--clicks-muted)]">Top to bottom, as customers see them. Use the arrows to move a section.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="admin-btn admin-btn-secondary inline-flex items-center gap-1.5" onClick={() => setEditing({ index: -1, section: emptyProducts() })}>
                  <LayoutList className="h-3.5 w-3.5" /> Add product row
                </button>
                <button type="button" className="admin-btn admin-btn-secondary inline-flex items-center gap-1.5" onClick={() => setEditing({ index: -1, section: emptyImage() })}>
                  <ImagePlus className="h-3.5 w-3.5" /> Add picture banner
                </button>
              </div>
            </div>
            <ol className="space-y-2">
              {layout.map((section, i) => {
                const custom = section.type === "products" || section.type === "image";
                return (
                  <li
                    key={section.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                      section.visible ? "border-[var(--clicks-border)] bg-white" : "border-dashed border-[var(--clicks-border)] bg-[var(--clicks-bg)] opacity-70",
                    )}
                  >
                    <span className="w-5 text-center text-[12px] text-[var(--clicks-muted)] tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[var(--clicks-navy)]">
                        {sectionTitle(section)}
                        {custom ? <span className="ms-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Added</span> : null}
                        {!section.visible ? <span className="ms-2 text-[11px] font-normal text-[var(--clicks-muted)]">Hidden</span> : null}
                      </p>
                      <p className="truncate text-[11px] text-[var(--clicks-muted)]">{sectionSummary(section, categoryName)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" className={ICON_BTN} aria-label={`Move ${sectionTitle(section)} up`} disabled={i === 0} onClick={() => setLayout(moveSection(layout, i, -1))}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" className={ICON_BTN} aria-label={`Move ${sectionTitle(section)} down`} disabled={i === layout.length - 1} onClick={() => setLayout(moveSection(layout, i, 1))}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className={ICON_BTN}
                        aria-label={section.visible ? `Hide ${sectionTitle(section)}` : `Show ${sectionTitle(section)}`}
                        title={section.visible ? "Hide" : "Show"}
                        onClick={() => setLayout(layout.map((s, j) => (j === i ? { ...s, visible: !s.visible } : s)))}
                      >
                        {section.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                      {custom ? (
                        <>
                          <button type="button" className={ICON_BTN} aria-label={`Edit ${sectionTitle(section)}`} onClick={() => setEditing({ index: i, section: section as ProductsSection | ImageSection })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" className={ICON_BTN} aria-label={`Remove ${sectionTitle(section)}`} onClick={() => setLayout(layout.filter((_, j) => j !== i))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
            {missingBuiltins.length ? (
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-[var(--clicks-muted)]">Removed sections:</span>
                {missingBuiltins.map((key) => (
                  <button key={key} type="button" className="rounded-full border border-[var(--clicks-border)] px-2.5 py-1 hover:border-[var(--clicks-blue)]" onClick={() => setLayout([...layout, { id: key, type: key, visible: true }])}>
                    <Plus className="me-1 inline h-3 w-3" />
                    {BUILTIN_LABELS[key].title}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="text-[12px] text-[var(--clicks-muted)] underline hover:text-[var(--clicks-text)]"
              onClick={() => setLayout(normalizeHomeLayout([]))}
            >
              Reset to the original home page
            </button>
          </section>
        </div>
      )}

      {dirty ? (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-xl bg-[var(--clicks-navy)] px-4 py-2.5 text-[13px] text-white shadow-lg">
            <span>Unsaved design changes</span>
            <button type="button" className="rounded-md px-2 py-1 text-white/80 hover:text-white" onClick={onUndo}>
              Undo
            </button>
            <button type="button" className="rounded-md bg-white px-3 py-1 font-semibold text-[var(--clicks-navy)]" onClick={save} disabled={saving || tooLight} title={tooLight ? "Pick a darker background first" : undefined}>
              {saving ? "Saving…" : "Save & publish"}
            </button>
          </div>
        </div>
      ) : null}

      {editing?.section.type === "products" ? (
        <ProductsDialog initial={editing.section} categories={categories} products={products} onClose={() => setEditing(null)} onSave={commit} />
      ) : null}
      {editing?.section.type === "image" ? <ImageDialog initial={editing.section} token={token} onClose={() => setEditing(null)} onSave={commit} /> : null}
    </>
  );
}
