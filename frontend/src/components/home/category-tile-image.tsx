"use client";

import { CategoryArtwork } from "@/components/product/product-artwork";
import { cn } from "@/lib/cn";
import { useState } from "react";

/**
 * A category picture. `src` may be a list of candidates (best first): when one fails to load the
 * next is tried, and the drawn placeholder is shown only when none loads (ST-30).
 */
export function CategoryTileImage({
  src,
  alt,
  artworkKey,
  className,
  fit = "cover",
}: {
  src?: string | ReadonlyArray<string | undefined>;
  alt: string;
  artworkKey: string;
  className?: string;
  /** "contain" keeps the whole product art visible (no cropping) on non-square tiles. */
  fit?: "cover" | "contain";
}) {
  const sources = (Array.isArray(src) ? src : [src]).filter((item): item is string => Boolean(item));
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
  return <CategoryArtwork artworkKey={artworkKey} className={className} />;
}
