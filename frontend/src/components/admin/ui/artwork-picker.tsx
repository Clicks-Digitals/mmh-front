"use client";

import { adminInputClass } from "@/components/admin/ui/form-field";
import { BUILTIN_ARTWORK, builtinArtwork, effectiveArtworkKey } from "@/lib/builtin-artwork";

/**
 * "Advanced → Built-in picture": which bundled picture the store shows when NO picture is uploaded.
 * "Automatic" picks one from the web address (e.g. playstation → PlayStation) or a drawn placeholder.
 */
export function ArtworkPicker({
  id,
  value,
  slug,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  slug?: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const auto = builtinArtwork(effectiveArtworkKey({ slug }));
  const custom = value && !builtinArtwork(value) ? value : "";
  return (
    <details className="rounded-lg border border-dashed border-[var(--clicks-border)] px-3 py-2 sm:col-span-2" open={Boolean(value)}>
      <summary className="cursor-pointer text-[12px] font-medium text-[var(--clicks-navy)]">Advanced: built-in picture</summary>
      <div className="mt-2 space-y-1.5">
        <label htmlFor={id} className="block text-[12px] font-medium">
          Built-in picture
        </label>
        <select id={id} className={adminInputClass} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Automatic — {auto ? `${auto.label} (from the web address)` : "drawn placeholder"}</option>
          {BUILTIN_ARTWORK.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
          {custom ? <option value={custom}>Other: {custom}</option> : null}
        </select>
        <p className="text-[11px] text-[var(--clicks-muted)]">
          Used only when no picture is uploaded. Uploading a picture above always wins.
        </p>
      </div>
    </details>
  );
}
