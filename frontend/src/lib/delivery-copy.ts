export const DELIVERY_AFTER_PAYMENT = {
  en: "Delivered after payment confirmation",
  ar: "يُسلَّم بعد تأكيد الدفع",
} as const;

export const TOPUP_AFTER_PAYMENT = {
  en: "Delivered to your game account after payment",
  ar: "يُضاف إلى حساب اللعبة بعد الدفع",
} as const;

const INSTANT_RE = /\binstant(ly)?\b|فور(ي|ا|اً|ًا)?\b|فوري/i;

export function claimsInstant(text: string | null | undefined): boolean {
  return INSTANT_RE.test(String(text ?? ""));
}

/** A delivery estimate we can show: the product's own text unless it promises instant delivery. */
export function safeDeliveryEstimate(
  text: string | null | undefined,
  locale: "en" | "ar",
  topup = false,
): string {
  const value = String(text ?? "").trim();
  if (!value || claimsInstant(value)) return topup ? TOPUP_AFTER_PAYMENT[locale] : DELIVERY_AFTER_PAYMENT[locale];
  return value;
}

/** Remove "instant(ly)" claims from free text such as product descriptions. */
export function stripInstantClaims(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/\s*\binstantly\b/gi, "")
    .replace(/\binstant\s+/gi, "")
    .replace(/\s*\bin an instant\b/gi, "")
    .replace(/\s*فوراً|\s*فورًا|\s*فورا/g, "")
    .replace(/\s*(ال)?فوري(ة)?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type CartDeliveryNoteKey = "cart.digitalNote" | "cart.topupNote" | "cart.mixedNote";

/**
 * ST-19: cart / drawer delivery note depends on what is in the cart — codes only, top-ups only
 * (DIRECT_TOPUP, sent to the entered player ID) or a mix. Unknown/empty → codes copy.
 */
export function cartDeliveryNoteKey(fulfillmentTypes: ReadonlyArray<string | null | undefined>): CartDeliveryNoteKey {
  const known = fulfillmentTypes.filter((type): type is string => Boolean(type)).map((type) => type.toLowerCase());
  if (!known.length) return "cart.digitalNote";
  const topups = known.filter((type) => type === "direct_topup").length;
  if (topups === 0) return "cart.digitalNote";
  return topups === known.length ? "cart.topupNote" : "cart.mixedNote";
}
