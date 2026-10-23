"use client";

import { getPayPalConfig, type PayPalConfig } from "@/lib/api/paypal";
import { useEffect, useState } from "react";

let pending: Promise<PayPalConfig | null> | null = null;

function loadConfig() {
  if (!pending) {
    pending = getPayPalConfig().catch(() => {
      pending = null;
      return null;
    });
  }
  return pending;
}

/** Public PayPal config (enabled, currency, fx_rate). Shared across components. */
export function usePayPalConfig(): PayPalConfig | null {
  const [config, setConfig] = useState<PayPalConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadConfig().then((value) => {
      if (!cancelled) setConfig(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
