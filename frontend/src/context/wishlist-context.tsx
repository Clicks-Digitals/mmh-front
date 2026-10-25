"use client";

import { STORAGE_KEYS } from "@/lib/storage";
import { useHydrated, useLocalStorage } from "@/hooks/use-local-storage";
import type { WishlistItem } from "@/types";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

interface WishlistContextValue {
  items: WishlistItem[];
  hydrated: boolean;
  has: (productId: string) => boolean;
  toggle: (productId: string) => void;
  /** Add only (never removes) — used by "Move to wishlist" (ST-14). */
  add: (productId: string) => void;
  remove: (productId: string) => void;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useLocalStorage<WishlistItem[]>(STORAGE_KEYS.wishlist, []);
  const hydrated = useHydrated();

  const has = useCallback(
    (productId: string) => items.some((item) => item.productId === productId),
    [items],
  );

  const toggle = useCallback(
    (productId: string) => {
      setItems((current) => {
        if (current.some((item) => item.productId === productId)) {
          return current.filter((item) => item.productId !== productId);
        }
        return [...current, { productId, addedAt: new Date().toISOString() }];
      });
    },
    [setItems],
  );

  const add = useCallback(
    (productId: string) => {
      setItems((current) =>
        current.some((item) => item.productId === productId)
          ? current
          : [...current, { productId, addedAt: new Date().toISOString() }],
      );
    },
    [setItems],
  );

  const remove = useCallback(
    (productId: string) => {
      setItems((current) => current.filter((item) => item.productId !== productId));
    },
    [setItems],
  );

  const value = useMemo(
    () => ({ items, hydrated, has, toggle, add, remove }),
    [items, hydrated, has, toggle, add, remove],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) throw new Error("useWishlist must be used within WishlistProvider");
  return context;
}
