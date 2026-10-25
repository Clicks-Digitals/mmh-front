"use client";

import { CategoryArtwork } from "@/components/product/product-artwork";
import { cn } from "@/lib/cn";
import { drawnArtworkKey, entityImageSources, type ArtworkSource } from "@/lib/builtin-artwork";
import { useState } from "react";

/**
 * The picture of a category / platform / home tile: the picture uploaded in the admin panel, else
 * the entity's built-in picture (by its built-in key or web address), else the drawn placeholder.
 * When a picture fails to load the next one is tried (ST-30). Never another entity's photo.
 */
export function CategoryTileImage({
  entity,
  alt,
  className,
  fit = "cover",
}: {
  entity: ArtworkSource;
  alt: string;
  className?: string;
  /** "contain" keeps the whole picture visible (no cropping) on non-square tiles. */
  fit?: "cover" | "contain";
}) {
  const sources = entityImageSources(entity);
  const key = sources.join("|");
  const [failed, setFailed] = useState<{ key: string; count: number }>({ key, count: 0 });
  const failedCount = failed.key === key ? failed.count : 0;
  const current = sources[failedCount];
  if (current) {
    return (
      <div className={cn("relative overflow-hidden bg-[#17182B]", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current}
          src={current}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn(
            "h-full w-full transition-transform duration-300 group-hover:scale-[1.03]",
            fit === "contain" ? "object-contain p-2" : "object-cover",
          )}
          onError={() => setFailed({ key, count: failedCount + 1 })}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#17182B]/80 via-transparent to-transparent" />
      </div>
    );
  }
  return <CategoryArtwork artworkKey={drawnArtworkKey(entity)} className={className} />;
}
