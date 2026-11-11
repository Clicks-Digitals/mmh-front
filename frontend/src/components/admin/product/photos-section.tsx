"use client";

import { adminErrorMessage } from "@/components/admin/lib/errors";
import { remainingAfterDelete, resolveAdminMediaUrl } from "@/components/admin/lib/media-url";
import type { GeneralForm } from "@/components/admin/lib/product-form";
import { CountPill, EditorSection } from "@/components/admin/product/editor-ui";
import { ArtworkPicker } from "@/components/admin/ui/artwork-picker";
import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { adminInputClass } from "@/components/admin/ui/form-field";
import { useAdminToast } from "@/components/admin/ui/toast";
import {
  deleteMediaAsset,
  reorderProductMedia,
  updateMediaAsset,
  uploadProductMedia,
  type AdminMediaAsset,
} from "@/lib/api/admin";
import { cn } from "@/lib/cn";
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from "lucide-react";
import { useState } from "react";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export function PhotosSection({
  token,
  slug,
  media,
  setMedia,
  canWrite,
  form,
  onChange,
}: {
  token?: string;
  slug: string;
  media: AdminMediaAsset[];
  setMedia: (next: AdminMediaAsset[]) => void;
  canWrite: boolean;
  /** the built-in picture lives on the product draft (saved with Save) */
  form: GeneralForm;
  onChange: (patch: Partial<GeneralForm>) => void;
}) {
  const toast = useAdminToast();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminMediaAsset | null>(null);
  const [altTarget, setAltTarget] = useState<string | null>(null);

  async function upload(files: File[]) {
    if (!token || !canWrite) return;
    const images = files.filter((f) => ACCEPT.split(",").includes(f.type));
    if (images.length < files.length) toast.push("Only JPG, PNG, WebP or GIF pictures can be uploaded.", "error");
    if (!images.length) return;
    setBusy(true);
    let current = [...media];
    let ok = 0;
    for (const file of images) {
      try {
        const asset = await uploadProductMedia(token, slug, file, { is_primary: !current.some((m) => m.is_primary) });
        current = [...current, asset];
        ok += 1;
      } catch (err) {
        toast.push(`${file.name}: ${adminErrorMessage(err, "Upload failed")}`, "error");
      }
    }
    setMedia(current);
    if (ok) toast.push(`${ok} photo${ok === 1 ? "" : "s"} uploaded`, "success");
    setBusy(false);
  }

  async function setPrimary(asset: AdminMediaAsset) {
    if (!token) return;
    setBusy(true);
    try {
      const updated = await updateMediaAsset(token, asset.id, { is_primary: true });
      setMedia(media.map((m) => ({ ...m, is_primary: String(m.id) === String(updated.id) })));
      toast.push("Main photo changed", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Could not set the main photo"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function move(idx: number, dir: -1 | 1) {
    if (!token) return;
    const target = idx + dir;
    if (target < 0 || target >= media.length) return;
    const ids = media.map((m) => m.id);
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    setBusy(true);
    try {
      const next = await reorderProductMedia(token, slug, ids);
      setMedia([...next].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
    } catch (err) {
      toast.push(adminErrorMessage(err, "Reorder failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveAlt(asset: AdminMediaAsset, alt: string) {
    if (!token || alt === (asset.alt ?? "")) return;
    try {
      const updated = await updateMediaAsset(token, asset.id, { alt });
      setMedia(media.map((m) => (String(m.id) === String(asset.id) ? { ...m, alt: updated.alt } : m)));
      toast.push("Photo description saved", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Could not save the description"), "error");
    }
  }

  async function confirmDelete() {
    if (!token || !deleteTarget) return;
    setBusy(true);
    try {
      await deleteMediaAsset(token, deleteTarget.id);
      setMedia(remainingAfterDelete(media, deleteTarget));
      toast.push("Photo deleted", "success");
      setDeleteTarget(null);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Delete failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <input
      type="file"
      accept={ACCEPT}
      multiple
      className="sr-only"
      disabled={busy || !canWrite}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length) void upload(files);
      }}
    />
  );

  return (
    <EditorSection
      id="section-photos"
      title="Photos"
      badge={media.length ? <CountPill>{media.length}</CountPill> : null}
      description="The ★ main photo is used on product cards. Photo changes save immediately."
    >
      <div
        className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5"
        onDragOver={(e) => {
          if (!canWrite) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!canWrite) return;
          e.preventDefault();
          setDragging(false);
          void upload(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        {media.map((asset, idx) => (
          <div key={String(asset.id)} className="group relative">
            <div
              className={cn(
                "relative aspect-square overflow-hidden rounded-lg border bg-[var(--clicks-bg)]",
                asset.is_primary ? "border-[var(--clicks-blue)] shadow-[0_0_0_1px_var(--clicks-blue)]" : "border-[var(--clicks-border)]",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resolveAdminMediaUrl(asset.url)} alt={asset.alt || ""} className="h-full w-full object-cover" />
              {asset.is_primary ? (
                <span className="absolute start-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-[var(--clicks-blue)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  <Star className="h-3 w-3 fill-current" aria-hidden /> Main
                </span>
              ) : null}
              {canWrite ? (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-100 transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label="Move earlier"
                      disabled={busy || idx === 0}
                      onClick={() => void move(idx, -1)}
                      className="rounded bg-white/90 p-1 text-[var(--clicks-navy)] disabled:opacity-30"
                    >
                      <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move later"
                      disabled={busy || idx === media.length - 1}
                      onClick={() => void move(idx, 1)}
                      className="rounded bg-white/90 p-1 text-[var(--clicks-navy)] disabled:opacity-30"
                    >
                      <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                    </button>
                  </div>
                  <div className="flex gap-1">
                    {!asset.is_primary ? (
                      <button
                        type="button"
                        aria-label="Make main photo"
                        title="Make main photo"
                        disabled={busy}
                        onClick={() => void setPrimary(asset)}
                        className="rounded bg-white/90 p-1 text-[var(--clicks-navy)]"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Delete photo"
                      disabled={busy}
                      onClick={() => setDeleteTarget(asset)}
                      className="rounded bg-white/90 p-1 text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={cn("mt-1 block w-full truncate text-start text-[11px]", asset.alt ? "text-[var(--clicks-muted)]" : "text-[var(--clicks-blue)]")}
              onClick={() => setAltTarget(String(asset.id))}
              disabled={!canWrite && !asset.alt}
              title={asset.alt || "Add a description for blind shoppers and search engines"}
            >
              {asset.alt || "+ Add description"}
            </button>
            {altTarget === String(asset.id) ? (
              <input
                autoFocus
                aria-label="Photo description"
                className={cn(adminInputClass, "mt-1 h-8 text-[12px]")}
                defaultValue={asset.alt || ""}
                maxLength={255}
                disabled={!canWrite}
                placeholder="e.g. PlayStation $10 gift card"
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setAltTarget(null);
                }}
                onBlur={(e) => {
                  setAltTarget(null);
                  void saveAlt(asset, e.target.value.trim());
                }}
              />
            ) : null}
          </div>
        ))}

        {canWrite ? (
          <label
            className={cn(
              "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed text-center transition",
              dragging ? "border-[var(--clicks-blue)] bg-[var(--clicks-blue-soft)]" : "border-[var(--clicks-border-strong)] hover:border-[var(--clicks-blue)] hover:bg-[#F8FAFF]",
              busy && "pointer-events-none opacity-60",
              !media.length && "col-span-3 aspect-auto py-8 sm:col-span-4 lg:col-span-5",
            )}
          >
            <ImagePlus className="h-6 w-6 text-[var(--clicks-blue)]" aria-hidden />
            <span className="text-[12px] font-semibold text-[var(--clicks-navy)]">{busy ? "Uploading…" : media.length ? "Add photos" : "Upload photos"}</span>
            <span className="px-2 text-[11px] text-[var(--clicks-muted)]">{media.length ? "or drop here" : "Click or drop pictures here · JPG, PNG, WebP, GIF"}</span>
            {picker}
          </label>
        ) : null}
      </div>
      {!media.length && !canWrite ? <p className="text-[12px] text-[var(--clicks-muted)]">No photos uploaded.</p> : null}

      <div className="mt-4 [&>details]:col-span-1">
        <ArtworkPicker
          id="pg-artwork_key"
          value={form.artwork_key}
          slug={form.slug}
          disabled={!canWrite}
          onChange={(artwork_key) => onChange({ artwork_key })}
        />
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete photo?"
        description={
          deleteTarget?.is_primary
            ? media.length > 1
              ? "This is the main photo. The next photo becomes the main photo."
              : "This is the only photo. The product shows its built-in picture until you upload another."
            : "The photo is removed permanently."
        }
        danger
        pending={busy}
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </EditorSection>
  );
}
