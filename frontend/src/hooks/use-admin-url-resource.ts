"use client";

import type { ListState } from "@/components/admin/lib/list-state";
import { adminErrorMessage } from "@/components/admin/lib/errors";
import { useAdminToken } from "@/hooks/use-admin-token";
import { useAdminUrlState } from "@/hooks/use-admin-url-state";
import { useEffect, useRef, useState } from "react";

/**
 * Paginated admin list whose search / filters / sort / page live in the URL (CA-26).
 * `defaults` must contain every key (use "" for "not set"); `page` is added if missing.
 * The page must be rendered inside a <Suspense> boundary (useSearchParams).
 */
export function useAdminUrlResource<T, S extends ListState>(
  defaults: S,
  loader: (token: string, state: S & { page: string }) => Promise<{ items: T[]; count: number }>,
) {
  const token = useAdminToken();
  const url = useAdminUrlState<S & { page: string }>({ page: "1", ...defaults });
  const [items, setItems] = useState<T[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  });

  const key = JSON.stringify(url.debounced);
  useEffect(() => {
    let cancelled = false;
    const state = JSON.parse(key) as S & { page: string };
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!token) {
        setItems([]);
        setCount(0);
        setError("Your session has expired. Sign in again.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await loaderRef.current(token, state);
        if (cancelled) return;
        setItems(result.items);
        setCount(result.count);
      } catch (err) {
        if (cancelled) return;
        setItems([]);
        setCount(0);
        setError(adminErrorMessage(err, "Failed to load"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, key, tick]);

  return {
    ...url,
    token,
    items,
    count,
    loading,
    error,
    reload: () => setTick((n) => n + 1),
  };
}
