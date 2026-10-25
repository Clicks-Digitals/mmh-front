"use client";

import { ConfirmDialog } from "@/components/admin/ui/confirm-dialog";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type Guard = { message: string };

type NavigationGuardValue = {
  /** register (or clear with null) the unsaved-changes guard of one editor */
  setGuard: (id: string, guard: Guard | null) => void;
  /** run `action` now, or after the user agrees to discard unsaved changes */
  confirmDiscard: (action: () => void, opts?: { title?: string; confirmLabel?: string }) => void;
  /** client-side navigation that respects the guard */
  navigate: (href: string) => void;
  isGuarded: () => boolean;
};

const NavigationGuardContext = createContext<NavigationGuardValue | null>(null);

function isPlainLeftClick(e: MouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

/**
 * CA-04: blocks in-app navigation away from an editor with unsaved changes. Clicks on any
 * same-origin link (sidebar, breadcrumb, top bar, in-page links) and guarded actions
 * (Duplicate, Archive, command menu) ask "Discard changes?" first. Full reloads/tab close
 * are covered by the editors' own `beforeunload` handler.
 */
export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const guards = useRef(new Map<string, Guard>());
  const [pending, setPending] = useState<{
    action: () => void;
    title?: string;
    confirmLabel?: string;
    message?: string;
  } | null>(null);

  const currentMessage = useCallback(() => guards.current.values().next().value?.message, []);

  const isGuarded = useCallback(() => guards.current.size > 0, []);

  const setGuard = useCallback((id: string, guard: Guard | null) => {
    if (guard) guards.current.set(id, guard);
    else guards.current.delete(id);
  }, []);

  const confirmDiscard = useCallback<NavigationGuardValue["confirmDiscard"]>((action, opts) => {
    if (!guards.current.size) {
      action();
      return;
    }
    setPending({ action, ...opts, message: currentMessage() });
  }, [currentMessage]);

  const navigate = useCallback(
    (href: string) => confirmDiscard(() => router.push(href)),
    [confirmDiscard, router],
  );

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!guards.current.size || !isPlainLeftClick(e)) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.dataset.skipGuard !== undefined) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ action: () => router.push(`${url.pathname}${url.search}${url.hash}`), message: currentMessage() });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router, currentMessage]);

  const value = useMemo(() => ({ setGuard, confirmDiscard, navigate, isGuarded }), [setGuard, confirmDiscard, navigate, isGuarded]);
  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.title ?? "Discard unsaved changes?"}
        description={pending?.message ?? "You have changes that are not saved yet. If you continue, they will be lost."}
        cancelLabel="Keep editing"
        confirmLabel={pending?.confirmLabel ?? "Discard changes"}
        danger
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const action = pending?.action;
          guards.current.clear();
          setPending(null);
          action?.();
        }}
      />
    </NavigationGuardContext.Provider>
  );
}

const FALLBACK: NavigationGuardValue = {
  setGuard: () => {},
  confirmDiscard: (action) => action(),
  navigate: (href) => {
    window.location.href = href;
  },
  isGuarded: () => false,
};

export function useNavigationGuard(): NavigationGuardValue {
  return useContext(NavigationGuardContext) ?? FALLBACK;
}

/** Register an editor's dirty state with the guard (and the browser's leave-page prompt). */
export function useUnsavedChangesGuard(id: string, dirty: boolean, message?: string) {
  const { setGuard } = useNavigationGuard();
  useEffect(() => {
    setGuard(id, dirty ? { message: message ?? "You have changes that are not saved yet. If you leave now, they will be lost." } : null);
    return () => setGuard(id, null);
  }, [id, dirty, message, setGuard]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
