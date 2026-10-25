"use client";

import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { resolveAdminMediaUrl } from "@/components/admin/lib/media-url";
import { CategoryArtwork } from "@/components/product/product-artwork";
import { builtinArtwork, builtinArtworkImage, drawnArtworkKey, effectiveArtworkKey, type ArtworkSource } from "@/lib/builtin-artwork";
import { cn } from "@/lib/cn";
import { useState } from "react";

/** Same limits as the backend (catalog/services/media.py). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const IMAGE_ACCEPT = IMAGE_TYPES.join(",");

/** Client-side check before uploading; the server re-checks (file signature, size, decoding). */
export function imageFileError(file: Pick<File, "type" | "size" | "name">): string {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `“${file.name}” is not a JPEG, PNG, WEBP or GIF picture.`;
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return `“${file.name}” is ${(file.size / (1024 * 1024)).toFixed(1)} MB — pictures can be at most 5 MB.`;
  }
  if (file.size === 0) return `“${file.name}” is empty.`;
  return "";
}

function readSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof URL.createObjectURL !== "function") return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/**
 * Upload / replace / remove the single picture of an entity (category, platform, home tile, logo…).
 * Shows exactly what the store shows: the uploaded picture, else the built-in fallback.
 */
export function EntityImageField({
  label,
  recommended,
  minEdge = 256,
  imageUrl,
  fallback,
  fallbackUrl,
  shape = "square",
  canWrite,
  disabledReason,
  removeDescription,
  onUpload,
  onRemove,
}: {
  label: string;
  /** e.g. "Square, 512 × 512 px" */
  recommended: string;
  /** smaller pictures get a "may look blurry" warning */
  minEdge?: number;
  /** current uploaded picture (absolute or /media/ path); empty = none */
  imageUrl?: string | null;
  /** built-in artwork used when nothing is uploaded */
  fallback?: ArtworkSource;
  /** or a fixed bundled default (logo, home picture) */
  fallbackUrl?: string;
  shape?: "square" | "wide" | "tall";
  canWrite: boolean;
  /** shown instead of the buttons, e.g. "Save the category first, then upload its picture." */
  disabledReason?: string;
  removeDescription?: string;
  onUpload: (file: File) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const uploaded = resolveAdminMediaUrl(imageUrl);
  const builtinKey = fallback ? effectiveArtworkKey(fallback) : "";
  const builtinUrl = fallbackUrl || (fallback ? builtinArtworkImage(fallback) : "");
  const builtinLabel = fallbackUrl
    ? "the store's default picture"
    : builtinArtwork(builtinKey)?.label
      ? `the built-in “${builtinArtwork(builtinKey)?.label}” picture`
      : "a drawn placeholder";
  const aspect = shape === "wide" ? "aspect-[16/7]" : shape === "tall" ? "aspect-[4/5]" : "aspect-square";

  async function pick(file: File) {
    setError("");
    setWarning("");
    const problem = imageFileError(file);
    if (problem) {
      setError(problem);
      return;
    }
    const size = await readSize(file);
    setBusy("upload");
    try {
      await onUpload(file);
      if (size && Math.min(size.width, size.height) < minEdge) {
        setWarning(`Uploaded, but the picture is small (${size.width} × ${size.height} px) and may look blurry. Recommended: ${recommended}.`);
      }
    } catch (err) {
      setError(adminErrorMessage(err, "Upload failed — please try another picture."));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setError("");
    setWarning("");
    setBusy("remove");
    try {
      await onRemove();
      setConfirmRemove(false);
    } catch (err) {
      setError(adminErrorMessage(err, "Could not remove the picture."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--clicks-border)] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div
          className={cn(
            "relative w-full shrink-0 overflow-hidden rounded-md bg-[#17182B] sm:w-36",
            shape === "wide" && "sm:w-56",
            aspect,
          )}
        >
          {uploaded ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploaded} alt="" className="h-full w-full object-cover" />
          ) : builtinUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolveAdminMediaUrl(builtinUrl)} alt="" className="h-full w-full object-cover opacity-90" />
          ) : (
            <CategoryArtwork artworkKey={fallback ? drawnArtworkKey(fallback) : "gift"} className="h-full w-full" />
          )}
          <span
            className={cn(
              "absolute start-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
              uploaded ? "bg-emerald-600 text-white" : "bg-white/90 text-[var(--clicks-navy)]",
            )}
          >
            {uploaded ? "Uploaded" : "Built-in"}
          </span>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[12px] font-medium">{label}</p>
          <p className="text-[11px] text-[var(--clicks-muted)]">
            {uploaded
              ? "This picture is shown on the store."
              : `No picture uploaded — the store shows ${builtinLabel}.`}
          </p>
          <p className="text-[11px] text-[var(--clicks-muted)]">
            Recommended: {recommended}. JPEG, PNG, WEBP or GIF, up to 5 MB. Very large pictures are resized automatically.
          </p>
          {disabledReason ? (
            <p className="text-[11px] font-medium text-[var(--clicks-navy)]">{disabledReason}</p>
          ) : canWrite ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <label className={cn("admin-btn admin-btn-secondary h-8 cursor-pointer text-xs", busy && "pointer-events-none opacity-50")}>
                {busy === "upload" ? "Uploading…" : uploaded ? "Replace picture" : "Upload picture"}
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  className="hidden"
                  disabled={Boolean(busy)}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void pick(file);
                  }}
                />
              </label>
              {uploaded ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  className="admin-btn admin-btn-ghost h-8 text-xs text-[var(--clicks-error)] disabled:opacity-50"
                  onClick={() => setConfirmRemove(true)}
                >
                  Remove picture
                </button>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-[11px] text-[var(--clicks-error)]">
              {error}
            </p>
          ) : null}
          {warning ? <p className="text-[11px] text-amber-700">{warning}</p> : null}
        </div>
      </div>
      <ConfirmDialog
        open={confirmRemove}
        title="Remove this picture?"
        description={removeDescription ?? `The store will show ${builtinLabel} instead.`}
        danger
        pending={busy === "remove"}
        confirmLabel="Remove picture"
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
