"use client";

import { resolveAdminMediaUrl } from "@/components/admin/lib/media-url";
import { CategoryArtwork } from "@/components/product/product-artwork";
import { builtinArtworkImage, drawnArtworkKey } from "@/lib/builtin-artwork";
import { cn } from "@/lib/cn";

/** Small list thumbnail: uploaded picture, else the built-in fallback the store shows (dimmed). */
export function EntityThumb({
  imageUrl,
  artworkKey,
  slug,
  className,
}: {
  imageUrl?: string | null;
  artworkKey?: string | null;
  slug?: string | null;
  className?: string;
}) {
  const uploaded = resolveAdminMediaUrl(imageUrl);
  const builtin = builtinArtworkImage({ artworkKey, slug });
  const title = uploaded ? "Uploaded picture" : "Built-in picture (nothing uploaded)";
  return (
    <span
      title={title}
      className={cn("relative block h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[#17182B]", !uploaded && "opacity-60", className)}
    >
      {uploaded || builtin ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={uploaded || builtin} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <CategoryArtwork artworkKey={drawnArtworkKey({ artworkKey, slug })} className="h-full w-full [&_p]:hidden" />
      )}
      <span className="sr-only">{title}</span>
    </span>
  );
}
