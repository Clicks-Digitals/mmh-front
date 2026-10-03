import { apiFetch } from "@/lib/api/client";

export type PayPalConfig = {
  enabled: boolean;
  environment: string;
  client_id: string;
  currency: string;
  sdk_url: string;
  fx_rate: string;
  order_currency: string;
};

export type PayPalOrderResult = {
  paypal_order_id: string;
  payment_status: string;
};

export type PayPalCaptureResult = {
  payment_status: string;
  order_number: string;
  paypal_order_id: string;
  paypal_capture_id: string;
};

export function getPayPalConfig() {
  return apiFetch<PayPalConfig>("/payments/paypal/config/");
}

export function createPayPalOrder(orderNumber: string, checkoutToken: string) {
  return apiFetch<PayPalOrderResult>("/payments/paypal/create-order/", {
    method: "POST",
    body: JSON.stringify({
      order_number: orderNumber,
      checkout_token: checkoutToken,
    }),
  });
}

export function capturePayPalOrder(paypalOrderId: string) {
  return apiFetch<PayPalCaptureResult>("/payments/paypal/capture-order/", {
    method: "POST",
    body: JSON.stringify({ paypal_order_id: paypalOrderId }),
  });
}
