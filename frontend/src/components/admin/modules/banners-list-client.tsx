"use client";

import { useAdminAccess } from "@/components/admin/admin-access";
import { ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { AdminModal } from "@/components/admin/ui/admin-modal";
import { Badge } from "@/components/admin/ui/badge";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { DataTable } from "@/components/admin/ui/data-table";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { ErrorState } from "@/components/admin/ui/error-state";
import { Filters } from "@/components/admin/ui/filters";
import { FormField, adminInputClass } from "@/components/admin/ui/form-field";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Pagination } from "@/components/admin/ui/pagination";
import { useAdminToast } from "@/components/admin/ui/toast";
import { isoToLocalInput, localInputToIso, localTimeZoneLabel } from "@/components/admin/lib/datetime";
import { adminErrorMessage, adminFieldErrors } from "@/components/admin/lib/errors";
import { formatAdminDateTime } from "@/lib/admin/format";
import { useAdminUrlResource } from "@/hooks/use-admin-url-resource";
import {
  asList,
  createBanner,
  deleteBanner,
  deleteBannerImage,
  listBanners,
  updateBanner,
  uploadBannerImage,
  type Banner,
} from "@/lib/api/admin";
import { resolveAdminMediaUrl } from "@/components/admin/lib/media-url";
import { useState } from "react";

const PLACEMENTS = [
  { value: "HOME", label: "Home page" },
  { value: "SHOP", label: "Shop page" },
  { value: "CATEGORY", label: "Category pages" },
  { value: "PROMO", label: "Promo strip" },
];

const TONES = [
  { value: "gold", label: "Gold" },
  { value: "blue", label: "Blue" },
];

const emptyForm = {
  title_en: "",
  title_ar: "",
  subtitle_en: "",
  subtitle_ar: "",
  kicker: "",
  href: "/",
  tone: "gold",
  placement: "HOME",
  sort_order: "0",
  start_at: "",
  end_at: "",
  published: false,
};

type Form = typeof emptyForm;

/** CA-24: status computed by the API (falls back to the published flag for older responses). */
export const BANNER_STATUS: Record<string, { label: string; tone: "success" | "info" | "neutral" | "warning"; hint: string }> = {
  live: { label: "Live", tone: "success", hint: "Showing on the store now" },
  scheduled: { label: "Scheduled", tone: "info", hint: "Published — starts showing at its start time" },
  expired: { label: "Expired", tone: "warning", hint: "Published, but its end time has passed — no longer shown" },
  unpublished: { label: "Unpublished", tone: "neutral", hint: "Hidden — tick Published to show it" },
};

export function bannerStatusKey(b: Pick<Banner, "status" | "published">): string {
  const key = String(b.status ?? "").toLowerCase();
  if (key in BANNER_STATUS) return key;
  return b.published ? "live" : "unpublished";
}

function windowLabel(b: Banner) {
  if (!b.start_at && !b.end_at) return "Always";
  return `${b.start_at ? formatAdminDateTime(b.start_at) : "now"} → ${b.end_at ? formatAdminDateTime(b.end_at) : "no end"}`;
}

function ImageSlot({
  label,
  hint,
  url,
  disabled,
  busy,
  onFile,
  onRemove,
}: {
  label: string;
  hint: string;
  url?: string;
  disabled?: boolean;
  busy?: boolean;
  onFile: (file: File) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--clicks-border)] p-3">
      <p className="text-[12px] font-medium">{label}</p>
      <p className="text-[11px] text-[var(--clicks-muted)]">{hint}</p>
      <div className="mt-2 flex aspect-[16/7] items-center justify-center overflow-hidden rounded-md bg-[var(--clicks-bg)]">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolveAdminMediaUrl(url)} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[11px] text-[var(--clicks-muted)]">No image</span>
        )}
      </div>
      <label
        className={`admin-btn admin-btn-secondary mt-2 h-8 cursor-pointer text-xs ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        {busy ? "Uploading…" : url ? "Replace image" : "Upload image"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
      </label>
      {url && onRemove ? (
        <button
          type="button"
          disabled={disabled}
          className="admin-btn admin-btn-ghost ms-2 mt-2 h-8 text-xs text-[var(--clicks-error)] disabled:opacity-50"
          onClick={onRemove}
        >
          Remove image
        </button>
      ) : null}
    </div>
  );
}

export function BannersListClient() {
  const toast = useAdminToast();
  const { can } = useAdminAccess();
  const canWrite = can("content.write");
  const { state, set: setList, reset, page, token, items, count, loading, error, reload } = useAdminUrlResource<
    Banner,
    { search: string; placement: string }
  >({ search: "", placement: "" }, async (tok, s) =>
    asList(
      await listBanners(tok, {
        page: Number(s.page) || 1,
        page_size: ADMIN_LIST_PAGE_SIZE,
        search: s.search || undefined,
        placement: s.placement || undefined,
      }),
    ),
  );
  const [removeTarget, setRemoveTarget] = useState<"desktop" | "mobile" | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Banner | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState<"desktop" | "mobile" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Banner | null>(null);

  function open(row: Banner | null) {
    setEditing(row);
    setErrors({});
    setForm(
      row
        ? {
            title_en: row.title_en,
            title_ar: row.title_ar ?? "",
            subtitle_en: row.subtitle_en ?? "",
            subtitle_ar: row.subtitle_ar ?? "",
            kicker: row.kicker ?? "",
            href: row.href,
            tone: row.tone ?? "gold",
            placement: row.placement ?? "HOME",
            sort_order: String(row.sort_order ?? 0),
            start_at: isoToLocalInput(row.start_at),
            end_at: isoToLocalInput(row.end_at),
            published: row.published,
          }
        : emptyForm,
    );
    setModalOpen(true);
  }

  async function save() {
    if (!token) return;
    const local: Record<string, string> = {};
    if (!form.title_en.trim()) local.title_en = "Required";
    if (!form.href.trim()) local.href = "Required";
    else if (!/^(\/|https?:\/\/)/.test(form.href.trim())) local.href = "Start with / or https://";
    const start = localInputToIso(form.start_at);
    const end = localInputToIso(form.end_at);
    if (start && end && end <= start) local.end_at = "Must be after the start";
    setErrors(local);
    if (Object.keys(local).length) return;
    setPending(true);
    try {
      const body: Partial<Banner> = {
        title_en: form.title_en.trim(),
        title_ar: form.title_ar.trim(),
        subtitle_en: form.subtitle_en.trim(),
        subtitle_ar: form.subtitle_ar.trim(),
        kicker: form.kicker.trim(),
        href: form.href.trim(),
        tone: form.tone,
        placement: form.placement,
        sort_order: Number(form.sort_order) || 0,
        start_at: start,
        end_at: end,
        published: form.published,
      };
      const saved = editing ? await updateBanner(token, editing.id, body) : await createBanner(token, body);
      toast.push(editing ? "Banner updated" : "Banner created — you can now upload images", "success");
      setEditing(saved);
      reload();
      if (editing) setModalOpen(false);
    } catch (err) {
      setErrors(adminFieldErrors(err));
      toast.push(adminErrorMessage(err, "Save failed"), "error");
    } finally {
      setPending(false);
    }
  }

  async function upload(target: "desktop" | "mobile", file: File) {
    if (!token || !editing) return;
    setUploading(target);
    try {
      const updated = await uploadBannerImage(token, editing.id, file, target);
      setEditing(updated);
      toast.push(`${target === "desktop" ? "Desktop" : "Mobile"} image uploaded`, "success");
      reload();
    } catch (err) {
      toast.push(adminErrorMessage(err, "Upload failed"), "error");
    } finally {
      setUploading(null);
    }
  }

  async function removeImage(target: "desktop" | "mobile") {
    if (!token || !editing) return;
    setUploading(target);
    try {
      const updated = await deleteBannerImage(token, editing.id, target);
      setEditing(updated);
      toast.push(`${target === "desktop" ? "Desktop" : "Mobile"} image removed`, "success");
      setRemoveTarget(null);
      reload();
    } catch (err) {
      toast.push(adminErrorMessage(err, "Could not remove the image"), "error");
    } finally {
      setUploading(null);
    }
  }

  async function togglePublish(row: Banner) {
    if (!token) return;
    try {
      await updateBanner(token, row.id, { published: !row.published });
      toast.push(row.published ? "Banner unpublished" : "Banner published", "success");
      reload();
    } catch (err) {
      toast.push(adminErrorMessage(err, "Update failed"), "error");
    }
  }

  async function confirmDelete() {
    if (!token || !deleteTarget) return;
    setPending(true);
    try {
      await deleteBanner(token, deleteTarget.id);
      toast.push("Banner deleted", "success");
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast.push(adminErrorMessage(err, "Delete failed"), "error");
    } finally {
      setPending(false);
    }
  }

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div>
      <PageHeader
        title="Banners"
        description="Promotional banners on the store. A banner shows only when it is published and the current time is inside its “Show from / until” window. Status: Live = showing now, Scheduled = starts later, Expired = end time passed."
        actions={
          canWrite ? (
            <button type="button" onClick={() => open(null)} className="admin-btn admin-btn-primary">
              New banner
            </button>
          ) : null
        }
      />
      <Filters
        search={state.search}
        onSearchChange={(v) => setList({ search: v })}
        searchPlaceholder="Search banners…"
        filters={[
          {
            key: "placement",
            label: "Placement",
            value: state.placement,
            onChange: (v) => setList({ placement: v }),
            options: [{ value: "", label: "All placements" }, ...PLACEMENTS],
          },
        ]}
        onClear={reset}
      />
      <DataTable
        columns={[
          {
            key: "img",
            header: "",
            render: (r) =>
              r.desktop_image_url || r.desktop_image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveAdminMediaUrl(r.desktop_image_url || r.desktop_image)}
                  alt=""
                  className="h-10 w-20 rounded object-cover"
                />
              ) : (
                <span className="inline-block h-10 w-20 rounded bg-[var(--clicks-bg)]" />
              ),
          },
          {
            key: "title",
            header: "Title",
            mobilePrimary: true,
            render: (r) => (
              <div>
                <p className="font-medium">{r.title_en}</p>
                <p className="text-xs text-[var(--clicks-muted)]">{r.href}</p>
              </div>
            ),
          },
          {
            key: "placement",
            header: "Placement",
            render: (r) => PLACEMENTS.find((p) => p.value === r.placement)?.label ?? r.placement,
          },
          { key: "window", header: "Shown", render: (r) => <span className="text-xs">{windowLabel(r)}</span> },
          {
            key: "status",
            header: "Status",
            render: (r) => {
              const st = BANNER_STATUS[bannerStatusKey(r)];
              return (
                <span title={st.hint}>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </span>
              );
            },
          },
          { key: "sort", header: "Sort", className: "tabular-nums", render: (r) => r.sort_order ?? 0 },
          ...(canWrite
            ? [
                {
                  key: "actions",
                  header: "",
                  render: (r: Banner) => (
                    <div className="flex justify-end gap-3">
                      <button type="button" className="text-xs font-medium text-[var(--clicks-blue)]" onClick={() => open(r)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--clicks-muted)]"
                        onClick={() => void togglePublish(r)}
                      >
                        {r.published ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-[var(--clicks-error)]"
                        onClick={() => setDeleteTarget(r)}
                      >
                        Delete
                      </button>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
        rows={items}
        loading={loading}
        rowKey={(r) => String(r.id)}
        empty={<EmptyState title="No banners" />}
        error={error ? <ErrorState message={error} onRetry={reload} /> : null}
      />
      <Pagination page={page} pageSize={ADMIN_LIST_PAGE_SIZE} total={count} onPageChange={(p) => setList({ page: String(p) })} />

      <AdminModal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? "Edit banner" : "New banner"} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Title (EN)" htmlFor="bn-title-en" required error={errors.title_en}>
            <input id="bn-title-en" className={adminInputClass} value={form.title_en} onChange={set("title_en")} />
          </FormField>
          <FormField label="Title (AR)" htmlFor="bn-title-ar" error={errors.title_ar}>
            <input id="bn-title-ar" dir="rtl" className={adminInputClass} value={form.title_ar} onChange={set("title_ar")} />
          </FormField>
          <FormField label="Subtitle (EN)" htmlFor="bn-sub-en" error={errors.subtitle_en}>
            <input id="bn-sub-en" className={adminInputClass} value={form.subtitle_en} onChange={set("subtitle_en")} />
          </FormField>
          <FormField label="Subtitle (AR)" htmlFor="bn-sub-ar" error={errors.subtitle_ar}>
            <input id="bn-sub-ar" dir="rtl" className={adminInputClass} value={form.subtitle_ar} onChange={set("subtitle_ar")} />
          </FormField>
          <FormField label="Kicker" htmlFor="bn-kicker" hint="Small label above the title, e.g. “Limited offer”." error={errors.kicker}>
            <input id="bn-kicker" className={adminInputClass} value={form.kicker} onChange={set("kicker")} maxLength={120} />
          </FormField>
          <FormField label="Link" htmlFor="bn-href" required hint="Where the banner goes, e.g. /category/playstation." error={errors.href}>
            <input id="bn-href" className={`${adminInputClass} font-mono`} value={form.href} onChange={set("href")} />
          </FormField>
          <FormField label="Placement" htmlFor="bn-place" hint="Which store page shows the banner." error={errors.placement}>
            <select id="bn-place" className={adminInputClass} value={form.placement} onChange={set("placement")}>
              {PLACEMENTS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Tone" htmlFor="bn-tone" hint="Accent colour." error={errors.tone}>
              <select id="bn-tone" className={adminInputClass} value={form.tone} onChange={set("tone")}>
                {TONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Sort order" htmlFor="bn-sort" hint="Lower first." error={errors.sort_order}>
              <input id="bn-sort" type="number" className={adminInputClass} value={form.sort_order} onChange={set("sort_order")} />
            </FormField>
          </div>
          <FormField label="Show from" htmlFor="bn-start" hint={`Your time zone (${localTimeZoneLabel()}). Empty = now.`} error={errors.start_at}>
            <input id="bn-start" type="datetime-local" className={adminInputClass} value={form.start_at} onChange={set("start_at")} />
          </FormField>
          <FormField label="Show until" htmlFor="bn-end" hint="Empty = no end date." error={errors.end_at}>
            <input id="bn-end" type="datetime-local" className={adminInputClass} value={form.end_at} onChange={set("end_at")} />
          </FormField>
          <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))}
            />
            Published
          </label>
        </div>

        <div className="mt-4 border-t border-[var(--clicks-border)] pt-4">
          <p className="text-[12px] font-semibold text-[var(--clicks-navy)]">Images</p>
          {editing ? (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <ImageSlot
                label="Desktop image"
                hint="Wide image, about 1600 × 700 px."
                url={editing.desktop_image_url || editing.desktop_image}
                busy={uploading === "desktop"}
                disabled={Boolean(uploading)}
                onFile={(f) => void upload("desktop", f)}
                onRemove={() => setRemoveTarget("desktop")}
              />
              <ImageSlot
                label="Mobile image"
                hint="Taller image, about 800 × 800 px. Falls back to desktop."
                url={editing.mobile_image_url || editing.mobile_image}
                busy={uploading === "mobile"}
                disabled={Boolean(uploading)}
                onFile={(f) => void upload("mobile", f)}
                onRemove={() => setRemoveTarget("mobile")}
              />
            </div>
          ) : (
            <p className="mt-1 text-[12px] text-[var(--clicks-muted)]">Save the banner first, then upload desktop and mobile images.</p>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setModalOpen(false)}>
            {editing ? "Close" : "Cancel"}
          </button>
          <button type="button" disabled={pending} onClick={() => void save()} className="admin-btn admin-btn-primary disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </AdminModal>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove this image?"
        description={
          removeTarget === "mobile"
            ? "Phones will show the desktop image instead."
            : "The banner will show without a desktop image (phones keep their own image if one is set)."
        }
        danger
        pending={Boolean(uploading)}
        confirmLabel="Remove image"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && void removeImage(removeTarget)}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete banner?"
        description={deleteTarget ? `Permanently delete “${deleteTarget.title_en}”.` : undefined}
        danger
        pending={pending}
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
