"use client";

import {
  hasActiveFilters,
  parseListState,
  patchListState,
  serializeListState,
  type ListState,
} from "@/components/admin/lib/list-state";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * List state (search, filters, sort, page) mirrored into the URL query string.
 *
 * `state` updates immediately (inputs stay responsive); `debounced` follows after
 * `debounceMs` when a typed key (default: `search`) changed, otherwise at once, and is
 * what loaders should depend on. The URL is updated with `router.replace` (no history
 * entries, no scroll jump); other query keys are kept.
 */
export function useAdminUrlState<T extends ListState>(
  defaults: T,
  opts: { debounceKeys?: string[]; debounceMs?: number } = {},
) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [base] = useState<T>(defaults);
  const [state, setState] = useState<T>(() => parseListState(params, defaults));
  const [debounced, setDebounced] = useState<T>(state);
  const previous = useRef<T>(state);
  const paramsRef = useRef(params);
  const debounceKeys = (opts.debounceKeys ?? ["search"]).join(",");
  const debounceMs = opts.debounceMs ?? 300;

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    const typed = debounceKeys.split(",").some((key) => key && state[key] !== previous.current[key]);
    previous.current = state;
    const t = window.setTimeout(
      () => {
        setDebounced(state);
        const current = paramsRef.current?.toString() ?? "";
        const qs = serializeListState(state, base, current);
        if (qs !== (current ? `?${current}` : "")) router.replace(`${pathname}${qs}`, { scroll: false });
      },
      typed ? debounceMs : 0,
    );
    return () => window.clearTimeout(t);
  }, [state, base, debounceKeys, debounceMs, pathname, router]);

  const set = useCallback((patch: Partial<T>) => setState((prev) => patchListState(prev, patch, base)), [base]);
  const reset = useCallback(() => setState({ ...base }), [base]);

  return {
    state,
    debounced,
    set,
    reset,
    page: Number(state.page ?? 1) || 1,
    hasFilters: hasActiveFilters(state, base),
  };
}
