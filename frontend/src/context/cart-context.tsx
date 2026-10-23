"use client";

import { getProductById } from "@/data/products";
import { lineLimits, linePrice } from "@/lib/cart";
import { cartTotals, toFils, type AppliedCoupon } from "@/lib/coupon";
import { uid } from "@/lib/id";
import { clampQuantity, mergeQuantity, quantityLimits } from "@/lib/quantity";
import { STORAGE_KEYS } from "@/lib/storage";
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

export type PromoResult = "ok" | "invalid" | "unavailable";

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
  promoCode: string;
  promoError: PromoResult | null;
  promoChecking: boolean;
  applyPromo: (code: string, email?: string) => Promise<PromoResult>;
  removePromo: () => void;
  lastAddedId: string | null;
}

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
  return quantityLimits(denomination?.minQuantity, denomination?.maxQuantity);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useLocalStorage<CartItem[]>(STORAGE_KEYS.cart, EMPTY_CART);
  const hydrated = useHydrated();
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [couponEmail, setCouponEmail] = useState("");
  const [promoError, setPromoError] = useState<PromoResult | null>(null);
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
    setPromoError(null);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setCoupon(null);
    setPromoError(null);
  }, [setItems]);

  const subtotalFils = useMemo(
    () =>
      items.reduce((sum, item) => {
        const product = getProductById(item.productId);
        return product ? sum + toFils(linePrice(item, product)) : sum;
      }, 0),
    [items],
  );

  const applyQuote = useCallback((result: CouponCheckResult): PromoResult => {
    if (result.valid) {
      setCoupon({
        code: result.code,
        subtotalFils: result.subtotalFils,
        discountFils: result.discountFils,
        totalFils: result.totalFils,
      });
      setPromoError(null);
      return "ok";
    }
    if (result.reason === "invalid") {
      setCoupon(null);
      setPromoError("invalid");
      return "invalid";
    }
    setPromoError("unavailable");
    return "unavailable";
  }, []);

  const checkCoupon = useCallback(
    async (code: string, subtotal: number, email: string) => applyQuote(await quoteCoupon(code, subtotal, email)),
    [applyQuote],
  );

  const applyPromo = useCallback(
    async (code: string, email = "") => {
      const normalized = code.trim().toUpperCase();
      if (!normalized) {
        setPromoError("invalid");
        return "invalid" as const;
      }
      setPromoChecking(true);
      setCouponEmail(email);
      try {
        return await checkCoupon(normalized, subtotalFils, email);
      } catch {
        setPromoError("unavailable");
        return "unavailable" as const;
      } finally {
        setPromoChecking(false);
      }
    },
    [checkCoupon, subtotalFils],
  );

  // Re-quote the coupon whenever the cart subtotal changes (the old quote no longer applies).
  const requoting = useRef(false);
  useEffect(() => {
    if (!coupon || coupon.subtotalFils === subtotalFils || requoting.current) return;
    requoting.current = true;
    const run =
      subtotalFils > 0
        ? quoteCoupon(coupon.code, subtotalFils, couponEmail).then((result) => {
            applyQuote(result);
          })
        : Promise.resolve().then(() => setCoupon(null));
    void run
      .catch(() => undefined)
      .finally(() => {
        requoting.current = false;
      });
  }, [coupon, subtotalFils, couponEmail, applyQuote]);

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
      promoError,
      promoChecking,
      applyPromo,
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
      promoError,
      promoChecking,
      applyPromo,
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
