"use client";

import { useBrandAssets } from "@/context/brand-assets-context";
import { cn } from "@/lib/cn";
import Link from "next/link";

/** Store logo — uploaded in Admin → Settings (bundled MMH mark until then). */
export function Logo({ className, size = 40 }: { className?: string; size?: number }) {
  const { logoUrl } = useBrandAssets();
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5", className)} aria-label="MMH home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt="MMH"
        width={size}
        height={size}
        className="brand-mark rounded-full object-contain"
        style={{ width: size, height: size }}
        decoding="async"
      />
      <span className="truncate text-[15px] font-semibold tracking-[0.14em] text-fg sm:text-[17px] sm:tracking-[0.18em]">
        MMH
      </span>
    </Link>
  );
}
