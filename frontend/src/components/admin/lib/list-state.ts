/**
 * List filters/search/sort/page kept in the URL (CA-26, OR-13) so a filtered list can be
 * bookmarked, shared and survives reloads. Pure helpers; see hooks/use-admin-url-state.ts.
 */

export type ListState = Record<string, string>;

type ParamsLike = { get(name: string): string | null };

/** Read every key of `defaults` from the query string ("" / missing -> default). */
export function parseListState<T extends ListState>(params: ParamsLike | null | undefined, defaults: T): T {
  const out = { ...defaults };
  if (!params) return out;
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const raw = params.get(key);
    if (raw != null && raw !== "") out[key] = raw as T[typeof key];
  }
  if ("page" in out) {
    const page = Number(out.page);
    (out as ListState).page = Number.isInteger(page) && page >= 1 ? String(page) : (defaults.page ?? "1");
  }
  return out;
}

/**
 * Query string for `state`, leaving out values equal to their default. Keys of the
 * existing query that are not part of the list state are preserved.
 */
export function serializeListState<T extends ListState>(
  state: T,
  defaults: T,
  existing?: string | URLSearchParams | null,
): string {
  const sp = new URLSearchParams(existing ? existing.toString() : "");
  for (const key of Object.keys(defaults)) {
    const value = state[key] ?? "";
    if (value === "" || value === defaults[key]) sp.delete(key);
    else sp.set(key, value);
  }
  const q = sp.toString();
  return q ? `?${q}` : "";
}

/**
 * Apply a patch. Changing anything other than `page` (search, a filter, the sort) jumps back
 * to page 1 so the user never lands on an empty page.
 */
export function patchListState<T extends ListState>(state: T, patch: Partial<T>, defaults: T): T {
  const next = { ...state, ...patch } as T;
  const touchesOther = Object.keys(patch).some((key) => key !== "page" && patch[key] !== state[key]);
  if (touchesOther && "page" in defaults && !("page" in patch)) (next as ListState).page = defaults.page;
  return next;
}

/** True when any filter/search differs from its default (page and ordering do not count). */
export function hasActiveFilters<T extends ListState>(state: T, defaults: T, ignore: string[] = ["page", "ordering"]): boolean {
  return Object.keys(defaults).some((key) => !ignore.includes(key) && (state[key] ?? "") !== (defaults[key] ?? ""));
}

/* ─── Sorting (DRF `ordering`) ─── */

export type SortDirection = "asc" | "desc" | null;

/** Direction of `key` in a DRF ordering string ("-created_at" -> desc for created_at). */
export function sortDirection(ordering: string | null | undefined, key: string): SortDirection {
  const value = (ordering ?? "").split(",")[0]?.trim() ?? "";
  if (value === key) return "asc";
  if (value === `-${key}`) return "desc";
  return null;
}

/**
 * Next ordering after clicking the `key` header: unsorted -> first direction -> other
 * direction -> back to the list default. Dates/amounts usually start descending.
 */
export function nextOrdering(
  ordering: string | null | undefined,
  key: string,
  opts: { firstDirection?: "asc" | "desc"; fallback?: string } = {},
): string {
  const first = opts.firstDirection ?? "asc";
  const fallback = opts.fallback ?? "";
  const current = sortDirection(ordering, key);
  if (current === null) return first === "asc" ? key : `-${key}`;
  if (current === first) return first === "asc" ? `-${key}` : key;
  // Back to the default — unless the default *is* this sort, then start over.
  if (fallback === (ordering ?? "")) return first === "asc" ? key : `-${key}`;
  return fallback;
}
