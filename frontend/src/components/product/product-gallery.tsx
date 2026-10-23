import { ProductCover } from "@/components/product/product-artwork";
import { cn } from "@/lib/cn";
import type { Product } from "@/types";

export function ProductGallery({ product, className }: { product: Product; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[16px] border border-line bg-[#17182B]", className)}>
      <ProductCover product={product} shot="hero" className="aspect-[4/5] sm:aspect-square" />
    </div>
  );
}
