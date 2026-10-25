"use client";

import { nextOrdering, sortDirection } from "@/components/admin/lib/list-state";
import { cn } from "@/lib/cn";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  className?: string;
  headerClassName?: string;
  render: (row: T) => React.ReactNode;
  /** DRF ordering field; makes the header a sort button (needs `ordering` + `onOrderingChange`) */
  sortKey?: string;
  /** first click sorts this way (dates/amounts usually "desc") */
  sortFirst?: "asc" | "desc";
  /** phone card layout: hide this column */
  mobileHidden?: boolean;
  /** phone card layout: show this column as the card title (no label) */
  mobilePrimary?: boolean;
};

function SortHeader<T>({
  col,
  ordering,
  defaultOrdering,
  onOrderingChange,
}: {
  col: DataTableColumn<T>;
  ordering?: string;
  defaultOrdering?: string;
  onOrderingChange: (next: string) => void;
}) {
  const dir = sortDirection(ordering || defaultOrdering, col.sortKey!);
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <button
      type="button"
      className={cn(
        "-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[#EEF1F7] hover:text-[var(--clicks-navy)]",
        dir && "text-[var(--clicks-navy)]",
      )}
      onClick={() =>
        onOrderingChange(
          nextOrdering(ordering || defaultOrdering, col.sortKey!, { firstDirection: col.sortFirst, fallback: defaultOrdering }),
        )
      }
      title={`Sort by ${col.header.toLowerCase()}`}
    >
      {col.header}
      <Icon aria-hidden className={cn("h-3 w-3", !dir && "opacity-40")} />
    </button>
  );
}

/**
 * Admin list table. On phones (below `md`) rows become cards so nothing is cut off or
 * needs sideways scrolling (RO-19, CA-26); pass `mobileCards={false}` to keep the table.
 */
export function DataTable<T>({
  columns,
  rows,
  loading,
  empty,
  error,
  rowKey,
  className,
  dense,
  ordering,
  defaultOrdering,
  onOrderingChange,
  mobileCards = true,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  loading?: boolean;
  empty?: React.ReactNode;
  error?: React.ReactNode;
  rowKey: (row: T) => string;
  className?: string;
  dense?: boolean;
  /** current DRF ordering (e.g. "-created_at") */
  ordering?: string;
  /** ordering the API applies when none is sent (shown as active) */
  defaultOrdering?: string;
  onOrderingChange?: (next: string) => void;
  mobileCards?: boolean;
}) {
  if (error) return <>{error}</>;
  if (loading) {
    return (
      <div className={cn("admin-card overflow-hidden", className)} aria-busy="true">
        <div className="animate-pulse">
          <div className="h-9 bg-[#F3F5F9]" />
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex h-11 items-center border-t border-[var(--clicks-border)] px-3.5">
              <div className="h-3.5 w-2/5 rounded bg-[#E8ECF4]" />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  if (!rows.length) return <>{empty}</>;

  const sortable = Boolean(onOrderingChange);
  const primary = columns.find((c) => c.mobilePrimary) ?? columns.find((c) => c.header && !c.mobileHidden);

  return (
    <div className={cn("admin-card overflow-hidden", className)}>
      <div className={cn("overflow-x-auto", mobileCards && "hidden md:block")}>
        <table className="min-w-full text-start text-[13px]">
          <thead className="border-b border-[var(--clicks-border)] bg-[#F7F8FC]">
            <tr>
              {columns.map((col) => {
                const dir = col.sortKey ? sortDirection(ordering || defaultOrdering, col.sortKey) : null;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                    className={cn(
                      "px-3.5 py-2.5 text-start text-[11px] font-semibold tracking-[0.02em] text-[var(--clicks-muted)]",
                      col.headerClassName,
                      col.className,
                    )}
                  >
                    {sortable && col.sortKey ? (
                      <SortHeader col={col} ordering={ordering} defaultOrdering={defaultOrdering} onOrderingChange={onOrderingChange!} />
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-[var(--clicks-border)] transition-colors hover:bg-[#F8FAFD]">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(dense ? "px-3.5 py-2" : "px-3.5 py-2.5", "align-middle text-[var(--clicks-text)]", col.className)}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mobileCards ? (
        <ul className="divide-y divide-[var(--clicks-border)] md:hidden">
          {sortable && columns.some((c) => c.sortKey) ? (
            <li className="flex flex-wrap items-center gap-2 bg-[#F7F8FC] px-3.5 py-2 text-[11px] text-[var(--clicks-muted)]">
              <span>Sort:</span>
              {columns
                .filter((c) => c.sortKey)
                .map((c) => (
                  <SortHeader key={c.key} col={c} ordering={ordering} defaultOrdering={defaultOrdering} onOrderingChange={onOrderingChange!} />
                ))}
            </li>
          ) : null}
          {rows.map((row) => (
            <li key={rowKey(row)} className="space-y-1.5 px-3.5 py-3 text-[13px]">
              {columns
                .filter((c) => !c.mobileHidden)
                .map((col) => {
                  if (col === primary) {
                    return (
                      <div key={col.key} className="min-w-0 text-[14px]">
                        {col.render(row)}
                      </div>
                    );
                  }
                  if (!col.header) {
                    return (
                      <div key={col.key} className="flex flex-wrap justify-end gap-2">
                        {col.render(row)}
                      </div>
                    );
                  }
                  return (
                    <div key={col.key} className="flex items-start justify-between gap-3">
                      <span className="shrink-0 text-[11px] font-medium text-[var(--clicks-muted)]">{col.header}</span>
                      <span className="min-w-0 text-end">{col.render(row)}</span>
                    </div>
                  );
                })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
