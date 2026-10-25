"use client";

import { cn } from "@/lib/cn";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type OpsColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  /** backend ordering field; makes the header a sort button */
  sortField?: string;
  className?: string;
  /** shown as the card title on small screens */
  primary?: boolean;
  /** hide on the small-screen card (e.g. row actions rendered elsewhere) */
  hideOnCard?: boolean;
};

/**
 * Table with sortable headers on desktop and a stacked card list on phones
 * (OR-13, OR-27, RO-19). Use for operations lists instead of the plain DataTable.
 */
export function OpsTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  error,
  ordering,
  onSort,
  cardActions,
}: {
  columns: OpsColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: React.ReactNode;
  error?: React.ReactNode;
  /** current ordering, e.g. "-created_at" */
  ordering?: string;
  onSort?: (field: string) => void;
  /** extra content at the bottom of each card (small screens) */
  cardActions?: (row: T) => React.ReactNode;
}) {
  if (error) return <>{error}</>;
  if (loading) {
    return (
      <div className="admin-card overflow-hidden">
        <div className="animate-pulse">
          <div className="h-9 bg-[#F3F5F9]" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex h-11 items-center border-t border-[var(--clicks-border)] px-3.5">
              <div className="h-3.5 w-2/5 rounded bg-[#E8ECF4]" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!rows.length) return <>{empty}</>;

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnCard);

  return (
    <>
      <div className="admin-card hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full text-start text-[13px]">
            <thead className="border-b border-[var(--clicks-border)] bg-[#F7F8FC]">
              <tr>
                {columns.map((col) => {
                  const active = ordering === col.sortField || ordering === `-${col.sortField}`;
                  const desc = ordering === `-${col.sortField}`;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={col.sortField && active ? (desc ? "descending" : "ascending") : undefined}
                      className={cn(
                        "px-3.5 py-2.5 text-start text-[11px] font-semibold tracking-[0.02em] text-[var(--clicks-muted)]",
                        col.className,
                      )}
                    >
                      {col.sortField && onSort ? (
                        <button
                          type="button"
                          onClick={() => onSort(col.sortField as string)}
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-[var(--clicks-navy)]",
                            active && "text-[var(--clicks-navy)]",
                          )}
                          title={`Sort by ${col.header.toLowerCase()}`}
                        >
                          {col.header}
                          {active ? (
                            desc ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUp className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-50" />
                          )}
                        </button>
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
                    <td key={col.key} className={cn("px-3.5 py-2.5 align-middle text-[var(--clicks-text)]", col.className)}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="admin-card p-3 text-[13px]">
            <div className="font-medium text-[var(--clicks-navy)]">{primary.render(row)}</div>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5">
              {rest.map((col) =>
                col.header ? (
                  <div key={col.key} className="contents">
                    <dt className="text-[11px] text-[var(--clicks-muted)]">{col.header}</dt>
                    <dd className="min-w-0 break-words">{col.render(row)}</dd>
                  </div>
                ) : (
                  <div key={col.key} className="col-span-2">
                    {col.render(row)}
                  </div>
                ),
              )}
            </dl>
            {cardActions ? <div className="mt-2">{cardActions(row)}</div> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** "Sort by" select for phones, where headers are not visible. */
export function MobileSortSelect({
  ordering,
  options,
  onChange,
}: {
  ordering: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mb-3 flex items-center gap-2 text-[12px] text-[var(--clicks-muted)] md:hidden">
      Sort
      <select className="admin-input h-9 flex-1" value={ordering} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
