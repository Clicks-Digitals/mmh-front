"use client";

import { cn } from "@/lib/cn";
import { Search, X } from "lucide-react";

export type FilterOption = { value: string; label: string };

export function Filters({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  onClear,
  className,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: {
    key: string;
    label: string;
    value: string;
    options: FilterOption[];
    onChange: (value: string) => void;
  }[];
  onClear?: () => void;
  className?: string;
}) {
  const hasActive =
    Boolean(search) || Boolean(filters?.some((f) => f.value && f.value !== "all" && f.value !== ""));

  return (
    <div
      className={cn(
        "admin-card mb-4 flex flex-col gap-2.5 p-2.5 sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      {onSearchChange ? (
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--clicks-muted)]" />
          <input
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
          onChange={(e) => filter.onChange(e.target.value)}
          className="admin-input w-auto min-w-[132px]"
        >
          {filter.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ))}
      {hasActive && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="admin-btn admin-btn-ghost h-9 gap-1 text-xs"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
