"use client";

import { cn } from "@/lib/cn";
import { Search, X } from "lucide-react";

export type FilterOption = { value: string; label: string };

/**
 * Search box + filter dropdowns above a list. Dropdowns are full width on phones and
 * size to their content on larger screens (CA-26: the `.admin-input` width rule used to
 * win over `w-auto`, so the important modifiers below are intentional).
 */
export function Filters({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  searchHint,
  filters,
  onClear,
  className,
  children,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** short help under the search box, e.g. what can be searched */
  searchHint?: string;
  filters?: {
    key: string;
    label: string;
    value: string;
    options: FilterOption[];
    onChange: (value: string) => void;
  }[];
  onClear?: () => void;
  className?: string;
  /** extra controls (e.g. a sort dropdown) */
  children?: React.ReactNode;
}) {
  const hasActive =
    Boolean(search) || Boolean(filters?.some((f) => f.value && f.value !== "all" && f.value !== ""));

  return (
    <div className={cn("admin-card mb-4 p-2.5", className)}>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        {onSearchChange ? (
          <label className="relative min-w-0 flex-1 sm:min-w-[220px]">
            <span className="sr-only">{searchPlaceholder}</span>
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--clicks-muted)]" />
            <input
              type="search"
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="admin-input admin-input--lead-icon"
            />
          </label>
        ) : null}
        {filters?.map((filter) => (
          <select
            key={filter.key}
            value={filter.value}
            aria-label={filter.label}
            title={filter.label}
            onChange={(e) => filter.onChange(e.target.value)}
            className="admin-input w-full! sm:w-auto! sm:max-w-[260px] sm:min-w-[140px]"
          >
            {filter.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ))}
        {children}
        {hasActive && onClear ? (
          <button type="button" onClick={onClear} className="admin-btn admin-btn-ghost h-9 gap-1 text-xs">
            <X className="h-3.5 w-3.5" />
            Clear filters
          </button>
        ) : null}
      </div>
      {searchHint ? <p className="mt-1.5 px-0.5 text-[11px] text-[var(--clicks-muted)]">{searchHint}</p> : null}
    </div>
  );
}
