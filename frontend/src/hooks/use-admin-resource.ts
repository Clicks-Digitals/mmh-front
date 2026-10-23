"use client";

import { ApiError } from "@/lib/api/client";
import { useAdminToken } from "@/hooks/use-admin-token";
import { useEffect, useRef, useState } from "react";

/**
 * Paginated admin list loader. Search resets to page 1 via the returned setter
 * (no setState-in-effect for page resets).
 */
export function useAdminResource<T>(
  loader: (token: string, page: number, search: string) => Promise<{ items: T[]; count: number }>,
  /** extra values (e.g. filters) that trigger a reload when they change */
  deps: unknown[] = [],
) {
  const depsKey = JSON.stringify(deps);
  const token = useAdminToken();
  const [page, setPage] = useState(1);
  const [search, setSearchState] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        await Promise.resolve();
        if (cancelled) return;
        setItems([]);
        setCount(0);
        setError("Missing admin session token. Sign in again.");
        setLoading(false);
        return;
      }
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const result = await loaderRef.current(token, page, debouncedSearch);
        if (cancelled) return;
        setItems(result.items);
        setCount(result.count);
      } catch (err) {
        if (cancelled) return;
        setItems([]);
        setCount(0);
        setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, page, debouncedSearch, reloadTick, depsKey]);

  function setSearch(value: string) {
    setSearchState(value);
    setPage(1);
  }

  return {
    token,
    page,
    setPage,
    search,
    setSearch,
    items,
    count,
    loading,
    error,
    reload: () => setReloadTick((n) => n + 1),
  };
}
