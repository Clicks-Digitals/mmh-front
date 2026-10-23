export interface CheckoutAttempt {
  fingerprint: string;
  key: string;
}

/** Stable fingerprint of everything that defines a checkout attempt. */
export function checkoutFingerprint(input: {
  email: string;
  fullName?: string;
  phone?: string;
  coupon?: string;
  items: Array<{ productId: string; variantId?: string | number; quantity: number; fields?: Record<string, string> }>;
}): string {
  const items = input.items.map((item) => {
    const fields = Object.keys(item.fields ?? {})
      .sort()
      .map((key) => [key, (item.fields ?? {})[key]?.trim() ?? ""]);
    return [item.productId, String(item.variantId ?? ""), item.quantity, fields];
  });
  return JSON.stringify([
    input.email.trim().toLowerCase(),
    (input.fullName ?? "").trim(),
    (input.phone ?? "").replace(/[\s-]/g, ""),
    (input.coupon ?? "").trim().toUpperCase(),
    items,
  ]);
}

export function randomKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Reuse the previous key only when the attempt is identical (a retry); any change starts a new attempt.
 */
export function resolveAttempt(
  previous: CheckoutAttempt | null,
  fingerprint: string,
  generate: () => string = randomKey,
): CheckoutAttempt {
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { fingerprint, key: generate() };
}
