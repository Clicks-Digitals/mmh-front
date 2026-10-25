"use client";

import { getProductById } from "@/data/products";
import { lineLimits, linePrice } from "@/lib/cart";
import { cartTotals, toFils, type AppliedCoupon } from "@/lib/coupon";
import { uid } from "@/lib/id";
import { clampQuantity, mergeQuantity, quantityLimits } from "@/lib/quantity";
import { STORAGE_KEYS } from "@/lib/storage";
import {
  needsRevalidation,
  normalizeCouponCode,
  parseStoredCoupon,
  storedCoupon,
  type CouponReason,
  type StoredCoupon,
} from "@/lib/coupon-storage";
import { useHydrated, useLocalStorage } from "@/hooks/use-local-storage";
import type { CartDigitalMeta, CartItem } from "@/types";
import type { CouponCheckResult } from "@/server/actions/checkout";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

interface AddPayload {
  productId: string;
  quantity?: number;
  digital?: CartDigitalMeta;
}

export interface AddResult {
  capped: boolean;
  max: number;
}

export type PromoResult = "ok" | CouponReason;

interface CartContextValue {
  items: CartItem[];
  hydrated: boolean;
  addItem: (payload: AddPayload) => AddResult;
  removeItem: (lineId: string) => void;
  updateQty: (lineId: string, quantity: number) => void;
  updateItemDigital: (lineId: string, digital: CartDigitalMeta) => void;
  clear: () => void;
  itemCount: number;
  /** JOD amounts for display. */
  subtotal: number;
  discount: number;
  total: number;
  subtotalFils: number;
  discountFils: number;
  totalFils: number;
  /** Applied coupon code ("" when none applies to the current subtotal). */
  promoCode: string;
  /** Saved coupon still being re-validated (ST-03). */
  promoPending: string;
  promoError: CouponReason | null;
  promoChecking: boolean;
  /** D6: the applied coupon makes the order free. */
  freeOrder: boolean;
  /** A saved/applied coupon was dropped after re-validation (shown once, then dismissed). */
  couponNotice: CouponReason | null;
  dismissCouponNotice: () => void;
  applyPromo: (code: string, email?: string) => Promise<PromoResult>;
  /** Re-check the coupon for this checkout email (per-customer limits, OR-25). */
  setCouponEmail: (email: string) => void;
  removePromo: () => void;
  lastAddedId: string | null;
}

type AppliedQuote = AppliedCoupon & { email: string; freeOrder: boolean };

async function quoteCoupon(code: string, subtotalFils: number, email: string): Promise<CouponCheckResult> {
  const { validateStorefrontCoupon } = await import("@/server/actions/checkout");
  return validateStorefrontCoupon({ code, subtotalFils, email });
}

const CartContext = createContext<CartContextValue | null>(null);
const EMPTY_CART: CartItem[] = [];

function sameLine(item: CartItem, payload: AddPayload) {
  return (
    item.productId === payload.productId &&
    item.digital?.denominationId === payload.digital?.denominationId &&
    item.digital?.regionId === payload.digital?.regionId &&
    JSON.stringify(item.digital?.customerFields ?? {}) === JSON.stringify(payload.digital?.customerFields ?? {})
  );
}

function limitsFor(productId: string, denominationId?: string) {
  const product = getProductById(productId);
  const denomination = product?.digitalOptions.denominations.find((entry) => entry.id === denominationId);
  return quantityLimits(denomination?.minQuantity, denomination?.maxQuantity, denomination?.availableQuantity);
}

const NO_COUPON: StoredCoupon | null = null;

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useLocalStorage<CartItem[]>(STORAGE_KEYS.cart, EMPTY_CART);
  const hydrated = useHydrated();
  const [storedRaw, setStored] = useLocalStorage<StoredCoupon | null>(STORAGE_KEYS.coupon, NO_COUPON);
  const stored = useMemo(() => parseStoredCoupon(storedRaw), [storedRaw]);
  const [coupon, setCoupon] = useState<AppliedQuote | null>(null);
  const [promoError, setPromoError] = useState<CouponReason | null>(null);
  const [couponNotice, setCouponNotice] = useState<CouponReason | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  const addItem = useCallback(
    (payload: AddPayload): AddResult => {
      const limits = limitsFor(payload.productId, payload.digital?.denominationId);
      const wanted = payload.quantity ?? limits.min;
      const existing = items.find((item) => sameLine(item, payload));
      if (existing) {
        const merged = mergeQuantity(existing.quantity, wanted, limits);
        setItems((current) =>
          current.map((item) => (item.lineId === existing.lineId ? { ...item, quantity: merged.quantity } : item)),
        );
        return { capped: merged.capped, max: limits.max };
      }
      const quantity = clampQuantity(wanted, limits);
      const line: CartItem = {
        lineId: uid("line"),
        productId: payload.productId,
        quantity,
        digital: payload.digital,
        addedAt: new Date().toISOString(),
      };
      setLastAddedId(line.lineId);
      setItems((current) => [...current, line]);
      return { capped: quantity < wanted, max: limits.max };
    },
    [items, setItems],
  );

  const removeItem = useCallback(
    (lineId: string) => setItems((current) => current.filter((item) => item.lineId !== lineId)),
    [setItems],
  );

  const updateQty = useCallback(
    (lineId: string, quantity: number) => {
      setItems((current) =>
        current
          .map((item) => {
            if (item.lineId !== lineId) return item;
            const product = getProductById(item.productId);
            const limits = product ? lineLimits(item, product) : quantityLimits();
            return { ...item, quantity: quantity <= 0 ? 0 : clampQuantity(quantity, limits) };
          })
          .filter((item) => item.quantity > 0),
      );
    },
    [setItems],
  );

  const updateItemDigital = useCallback(
    (lineId: string, digital: CartDigitalMeta) => {
      setItems((current) => current.map((item) => (item.lineId === lineId ? { ...item, digital } : item)));
    },
    [setItems],
  );

  const removePromo = useCallback(() => {
    setCoupon(null);
    setStored(null);
    setPromoError(null);
  }, [setStored]);

  const clear = useCallback(() => {
    setItems([]);
    setCoupon(null);
    setStored(null);
    setPromoError(null);
  }, [setItems, setStored]);

  const subtotalFils = useMemo(
    () =>
      items.reduce((sum, item) => {
        const product = getProductById(item.productId);
        return product ? sum + toFils(linePrice(item, product)) : sum;
      }, 0),
    [items],
  );

  const applyPromo = useCallback(
    async (code: string, email = ""): Promise<PromoResult> => {
      const normalized = normalizeCouponCode(code);
      if (!normalized) {
        setPromoError("invalid_coupon");
        return "invalid_coupon";
      }
      setPromoChecking(true);
      try {
        const result = await quoteCoupon(normalized, subtotalFils, email);
        if (result.valid) {
          setCoupon({ ...result, email: email.trim().toLowerCase() });
          setStored(storedCoupon(result.code, email));
          setPromoError(null);
          setCouponNotice(null);
          return "ok";
        }
        setPromoError(result.reason);
        return result.reason;
      } catch {
        setPromoError("unavailable");
        return "unavailable";
      } finally {
        setPromoChecking(false);
      }
    },
    [setStored, subtotalFils],
  );

  const setCouponEmail = useCallback(
    (email: string) => {
      const normalized = email.trim().toLowerCase();
      if (!stored || stored.email === normalized) return;
      setStored(storedCoupon(stored.code, normalized));
    },
    [stored, setStored],
  );

  // ST-03: the saved coupon is re-validated on load and whenever the subtotal or checkout email changes.
  const checking = useRef("");
  useEffect(() => {
    if (!hydrated || !stored) return;
    if (subtotalFils <= 0) return;
    if (!needsRevalidation(stored, coupon, subtotalFils)) return;
    const key = `${stored.code}|${stored.email}|${subtotalFils}`;
    if (checking.current === key) return;
    checking.current = key;
    void quoteCoupon(stored.code, subtotalFils, stored.email)
      .then((result) => {
        if (checking.current !== key) return;
        if (result.valid) {
          setCoupon({ ...result, email: stored.email });
          return;
        }
        if (result.reason === "unavailable") return;
        setCoupon(null);
        setStored(null);
        setCouponNotice(result.reason);
      })
      .catch(() => undefined)
      .finally(() => {
        if (checking.current === key) checking.current = "";
      });
  }, [hydrated, stored, coupon, subtotalFils, setStored]);

  const dismissCouponNotice = useCallback(() => setCouponNotice(null), []);

  const totals = cartTotals(subtotalFils, coupon);
  const itemCount = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      hydrated,
      addItem,
      removeItem,
      updateQty,
      updateItemDigital,
      clear,
      itemCount,
      subtotal: totals.subtotalFils / 1000,
      discount: totals.discountFils / 1000,
      total: totals.totalFils / 1000,
      subtotalFils: totals.subtotalFils,
      discountFils: totals.discountFils,
      totalFils: totals.totalFils,
      promoCode: totals.code,
      promoPending: !totals.code && stored ? stored.code : "",
      promoError,
      promoChecking,
      freeOrder: Boolean(totals.code) && totals.subtotalFils > 0 && totals.totalFils === 0,
      couponNotice,
      dismissCouponNotice,
      applyPromo,
      setCouponEmail,
      removePromo,
      lastAddedId,
    }),
    [
      items,
      hydrated,
      addItem,
      removeItem,
      updateQty,
      updateItemDigital,
      clear,
      itemCount,
      totals.subtotalFils,
      totals.discountFils,
      totals.totalFils,
      totals.code,
      stored,
      promoError,
      promoChecking,
      couponNotice,
      dismissCouponNotice,
      applyPromo,
      setCouponEmail,
      removePromo,
      lastAddedId,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}
