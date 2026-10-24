"use client";

import { ProductCover } from "@/components/product/product-artwork";
import { cn } from "@/lib/cn";
import type { Product } from "@/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

export function ProductGallery({ product, className }: { product: Product; className?: string }) {
  const images = [...new Set(product.images.filter(Boolean))];
  const [index, setIndex] = useState(0);
  const active = Math.min(index, Math.max(images.length - 1, 0));
  const many = images.length > 1;
  const step = (delta: number) => setIndex((active + delta + images.length) % images.length);

  return (
    <div className={cn("space-y-3", className)}>
      <div
        className="relative overflow-hidden rounded-[16px] border border-line bg-[#17182B]"
        onKeyDown={(event) => {
          if (!many) return;
          if (event.key === "ArrowRight") step(1);
          if (event.key === "ArrowLeft") step(-1);
        }}
      >
        <ProductCover
          key={images[active] ?? "artwork"}
          product={product}
          src={images[active]}
          label={many ? `${product.name} (${active + 1}/${images.length})` : product.name}
          shot="hero"
          className="aspect-[4/5] sm:aspect-square"
        />
        {many ? (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => step(-1)}
              className="absolute start-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/65"
            >
              <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => step(1)}
              className="absolute end-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/65"
            >
              <ChevronRight className="h-5 w-5 rtl:rotate-180" />
            </button>
            <span className="absolute bottom-3 end-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white">
              {active + 1} / {images.length}
            </span>
          </>
        ) : null}
      </div>
      {many ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              aria-label={`Show image ${i + 1}`}
              aria-current={i === active}
              onClick={() => setIndex(i)}
              className={cn(
                "h-16 w-16 shrink-0 overflow-hidden rounded-[10px] border bg-[#17182B] transition sm:h-20 sm:w-20",
                i === active ? "border-gold" : "border-line opacity-70 hover:opacity-100",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
