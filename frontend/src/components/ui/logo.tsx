import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

export function Logo({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5", className)} aria-label="MMH home">
      <Image
        src="/brand/IMG_4556.png"
        alt="MMH"
        width={size}
        height={size}
        className="brand-mark rounded-full object-contain"
        style={{ width: size, height: size }}
        priority
      />
      <span className="truncate text-[15px] font-semibold tracking-[0.14em] text-fg sm:text-[17px] sm:tracking-[0.18em]">
        MMH
      </span>
    </Link>
  );
}
