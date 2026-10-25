import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Crumb {
  href?: string;
  label: string;
}

export function Breadcrumbs({
  items,
  tone = "default",
  className,
}: {
  items: Crumb[];
  tone?: "default" | "onAccent";
  className?: string;
}) {
  const onAccent = tone === "onAccent";
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "mb-5 flex flex-wrap items-center gap-1 overflow-hidden text-xs sm:mb-6 sm:text-sm",
        onAccent ? "mb-0 text-white/70 sm:mb-0" : "text-muted",
        className,
      )}
    >
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="inline-flex max-w-full items-center gap-1">
            {item.href && !last ? (
              <Link
                href={item.href}
                className={cn(
                  "font-medium hover:text-fg",
                  onAccent ? "text-white/85 hover:text-gold" : "text-gold",
                )}
              >
                {item.label}
              </Link>
            ) : (
              <span className={cn(last && "line-clamp-1", last && (onAccent ? "text-white" : "text-fg"))}>
                {item.label}
              </span>
            )}
            {!last ? (
              <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 rtl-flip", onAccent && "text-white/45")} />
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}
