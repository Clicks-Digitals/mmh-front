"use client";

import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { adminInputClass } from "@/components/admin/ui/form-field";
import { useAdminToast } from "@/components/admin/ui/toast";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import {
  deleteMediaAsset,
  reorderProductMedia,
  updateMediaAsset,
  uploadProductMedia,
  type AdminMediaAsset,
} from "@/lib/api/admin";
import { remainingAfterDelete, resolveAdminMediaUrl } from "@/components/admin/lib/media-url";
import { useState } from "react";

export function MediaTab({
  token,
  slug,
  media,
  setMedia,
  canWrite,
}: {
  token?: string;
  slug: string;
  media: AdminMediaAsset[];
  setMedia: (next: AdminMediaAsset[]) => void;
  canWrite: boolean;
}) {
  const toast = useAdminToast();
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminMediaAsset | null>(null);

  async function upload(files: File[]) {
    if (!token) return;
    setBusy(true);
    let current = [...media];
    let ok = 0;
    for (const file of files) {
      try {
        const asset = await uploadProductMedia(token, slug, file, { is_primary: !current.some((m) => m.is_primary) });
        current = [...current, asset];
        ok += 1;
      } catch (err) {
        toast.push(`${file.name}: ${adminErrorMessage(err, "Upload failed")}`, "error");
      }
    }
    setMedia(current);
    if (ok) toast.push(`${ok} image${ok === 1 ? "" : "s"} uploaded`, "success");
    setBusy(false);
  }

  async function setPrimary(asset: AdminMediaAsset) {
    if (!token) return;
    setBusy(true);
    try {
      const updated = await updateMediaAsset(token, asset.id, { is_primary: true });
      setMedia(media.map((m) => ({ ...m, is_primary: String(m.id) === String(updated.id) })));
      toast.push("Main photo set — it is shown first on the store", "success");
    } catch (err) {
      toast.push(adminErrorMessage(err, "Could not set primary image"), "error");
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
      // The server promotes the next photo when the main one is deleted (CA-14); mirror it.
      setMedia(remainingAfterDelete(media, deleteTarget));
      toast.push("Photo deleted", "success");
      setDeleteTarget(null);
    } catch (err) {
      toast.push(adminErrorMessage(err, "Delete failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--clicks-navy)]">Photos</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-[var(--clicks-muted)]">
            The main photo is shown on product cards and first in the product gallery; the others follow in this order.
            JPG, PNG, WebP or GIF. Changes here are saved immediately (no need to press Save).
          </p>
        </div>
        {canWrite ? (
          <label className={`admin-btn admin-btn-primary cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy ? "Working…" : "Add photos"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) void upload(files);
              }}
            />
          </label>
        ) : null}
      </div>
      {media.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {media.map((asset, idx) => (
            <div key={String(asset.id)} className="overflow-hidden rounded-xl border border-[var(--clicks-border)]">
              <div className="relative aspect-square bg-[var(--clicks-bg)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resolveAdminMediaUrl(asset.url)} alt={asset.alt || ""} className="h-full w-full object-cover" />
                {asset.is_primary ? (
                  <span className="absolute start-2 top-2 rounded bg-[var(--clicks-navy)] px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                    Main photo
                  </span>
                ) : null}
              </div>
              <div className="space-y-2 p-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[var(--clicks-text)]">Description (alt text)</span>
                  <input
                    className={adminInputClass}
                    placeholder="e.g. PlayStation Store $10 gift card"
                    defaultValue={asset.alt || ""}
                    disabled={!canWrite}
                    maxLength={255}
                    onBlur={(e) => void saveAlt(asset, e.target.value)}
                  />
                  <span className="block text-[10px] text-[var(--clicks-muted)]">
                    Read aloud to blind shoppers and used by search engines. Saved when you leave the box.
                  </span>
                </label>
                {canWrite ? (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {!asset.is_primary ? (
                      <button type="button" disabled={busy} className="font-medium text-[var(--clicks-blue)]" onClick={() => void setPrimary(asset)}>
                        Make main photo
                      </button>
                    ) : null}
                    <button type="button" disabled={busy || idx === 0} className="font-medium disabled:opacity-40" onClick={() => void move(idx, -1)}>
                      ← Earlier
                    </button>
                    <button
                      type="button"
                      disabled={busy || idx === media.length - 1}
                      className="font-medium disabled:opacity-40"
                      onClick={() => void move(idx, 1)}
                    >
                      Later →
                    </button>
                    <button type="button" disabled={busy} className="ms-auto font-medium text-red-600" onClick={() => setDeleteTarget(asset)}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No photos yet" description="Upload a photo — the first one becomes the main photo." />
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete photo?"
        description={
          deleteTarget?.is_primary
            ? media.length > 1
              ? "This is the main photo. The next photo in the gallery becomes the main photo."
              : "This is the only photo. The product will show its built-in artwork (or a placeholder) until you upload another."
            : "The photo is removed from the gallery permanently."
        }
        danger
        pending={busy}
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
