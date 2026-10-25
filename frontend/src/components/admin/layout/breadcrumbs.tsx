"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type BreadcrumbValue = {
  labels: Record<string, string>;
  setLabel: (path: string, label: string | null) => void;
};

const BreadcrumbContext = createContext<BreadcrumbValue | null>(null);

export function AdminBreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const setLabel = useCallback((path: string, label: string | null) => {
    setLabels((prev) => {
      if (label == null) {
        if (!(path in prev)) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      }
      return prev[path] === label ? prev : { ...prev, [path]: label };
    });
  }, []);
  const value = useMemo<BreadcrumbValue>(() => ({ labels, setLabel }), [labels, setLabel]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

export function useBreadcrumbLabels(): Record<string, string> {
  return useContext(BreadcrumbContext)?.labels ?? {};
}

/**
 * Show a readable name instead of the URL segment for the current page in the top-bar
 * breadcrumb, e.g. the product name instead of its slug, or "MMH-1042" instead of "17".
 */
export function useAdminBreadcrumbLabel(label: string | null | undefined) {
  const pathname = usePathname();
  const setLabel = useContext(BreadcrumbContext)?.setLabel;
  useEffect(() => {
    if (!setLabel) return;
    setLabel(pathname, label || null);
    return () => setLabel(pathname, null);
  }, [pathname, label, setLabel]);
}
