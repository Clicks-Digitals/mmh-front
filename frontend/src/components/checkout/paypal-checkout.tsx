"use client";

import { useLanguage } from "@/context/language-context";
import { ApiError } from "@/lib/api/client";
import { capturePayPalOrder, getPayPalConfig, type PayPalConfig } from "@/lib/api/paypal";
import { useEffect, useRef, useState } from "react";

type PayPalSdk = {
  findEligibleMethods: (options: { currencyCode: string }) => Promise<{
    isEligible: (method: string) => boolean;
  }>;
  createPayPalOneTimePaymentSession: (options: {
    onApprove: (data: { orderId?: string }) => Promise<void> | void;
    onCancel?: (data?: unknown) => void;
    onError?: (error: unknown) => void;
  }) => {
    start: (
      presentation: { presentationMode: "auto" },
      order: Promise<{ orderId: string }>,
    ) => Promise<void>;
  };
};

declare global {
  interface Window {
    paypal?: {
      createInstance: (options: {
        clientId: string;
        components: string[];
        pageType?: string;
        locale?: string;
      }) => Promise<PayPalSdk>;
    };
  }
}

const sdkLoads = new Map<string, Promise<void>>();

function loadPayPalSdk(src: string) {
  const pending = sdkLoads.get(src);
  if (pending) return pending;
  const promise = new Promise<void>((resolve, reject) => {
    const selector = `script[data-paypal-sdk-src="${CSS.escape(src)}"]`;
    const existing = document.querySelector(selector);
    if (existing instanceof HTMLScriptElement && existing.dataset.loaded === "true" && window.paypal) {
      resolve();
      return;
    }
    const script = existing instanceof HTMLScriptElement ? existing : document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.paypalSdkSrc = src;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      sdkLoads.delete(src);
      reject(new Error("PayPal failed to load"));
    };
    if (!existing) document.head.appendChild(script);
  });
  sdkLoads.set(src, promise);
  return promise;
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message && error.message !== "ALREADY_PAID") return error.message;
  return fallback;
}

export function PayPalCheckout({
  currencyCode,
  createOrder,
  onPaid,
  onCancel,
  onError,
}: {
  currencyCode: string;
  createOrder: () => Promise<{ orderId: string }>;
  onPaid: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const { t, locale } = useLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const createOrderRef = useRef(createOrder);
  const onPaidRef = useRef(onPaid);
  const onCancelRef = useRef(onCancel);
  const onErrorRef = useRef(onError);
  createOrderRef.current = createOrder;
  onPaidRef.current = onPaid;
  onCancelRef.current = onCancel;
  onErrorRef.current = onError;
  const [config, setConfig] = useState<PayPalConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPayPalConfig()
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch((error) => {
        if (!cancelled) setConfigError(errorText(error, t("checkout.paypalUnavailable")));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!config?.enabled || !currencyCode) return;
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const busy = { current: false };

    void (async () => {
      try {
        await loadPayPalSdk(config.sdk_url);
        if (cancelled || !window.paypal) return;
        const sdk = await window.paypal.createInstance({
          clientId: config.client_id,
          components: ["paypal-payments"],
          pageType: "checkout",
          locale: locale === "ar" ? "ar-JO" : "en-US",
        });
        if (cancelled) return;
        try {
          const methods = await sdk.findEligibleMethods({ currencyCode });
          if (!methods.isEligible("paypal")) {
            onErrorRef.current(t("checkout.paypalUnavailable"));
            return;
          }
        } catch {
          // Eligibility is advisory. The server still prices the PayPal order.
        }
        if (cancelled) return;
        const session = sdk.createPayPalOneTimePaymentSession({
          async onApprove(data) {
            if (!data?.orderId) {
              onErrorRef.current(t("checkout.paypalUnavailable"));
              return;
            }
            try {
              const result = await capturePayPalOrder(data.orderId);
              if (result.payment_status !== "PAID") {
                onErrorRef.current(t("checkout.paypalUnavailable"));
                return;
              }
              onPaidRef.current();
            } catch (error) {
              onErrorRef.current(errorText(error, t("checkout.paypalUnavailable")));
            }
          },
          onCancel() {
            onCancelRef.current();
          },
          onError(error) {
            onErrorRef.current(errorText(error, t("checkout.paypalUnavailable")));
          },
        });
        if (cancelled) return;
        const button = document.createElement("paypal-button");
        button.setAttribute("type", "pay");
        button.addEventListener("click", () => {
          if (busy.current) return;
          busy.current = true;
          void session
            .start({ presentationMode: "auto" }, createOrderRef.current())
            .catch((error: unknown) => {
              if (error instanceof Error && error.message === "ALREADY_PAID") return;
              onErrorRef.current(errorText(error, t("checkout.paypalUnavailable")));
            })
            .finally(() => {
              busy.current = false;
            });
        });
        container.replaceChildren(button);
        if (!cancelled) setReady(true);
      } catch (error) {
        if (!cancelled) onErrorRef.current(errorText(error, t("checkout.paypalUnavailable")));
      }
    })();

    return () => {
      cancelled = true;
      container.replaceChildren();
      setReady(false);
    };
  }, [config, currencyCode, locale, t]);

  if (configError) return <p className="text-sm text-danger">{configError}</p>;
  if (!config) return <p className="text-sm text-muted">{t("common.loading")}</p>;
  if (!config.enabled) return <p className="text-sm text-danger">{t("checkout.paypalUnavailable")}</p>;

  return (
    <div className="space-y-3">
      {config.environment === "sandbox" ? <p className="text-xs leading-5 text-amber">{t("checkout.paypalSandbox")}</p> : null}
      <div ref={containerRef} className="min-h-12" />
      {ready ? null : <p className="text-xs text-muted">{t("common.loading")}</p>}
    </div>
  );
}
