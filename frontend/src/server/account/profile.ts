import { me, type MeResponse } from "@/lib/api/auth";
import { isSessionEnded, sessionEndedRedirect } from "@/server/orders/load";

export type CustomerProfile = { firstName: string; lastName: string; name: string; email: string; phone: string };

export function profileFromMe(me: MeResponse): CustomerProfile {
  const firstName = (me.first_name ?? "").trim();
  const lastName = (me.last_name ?? "").trim();
  return {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(" ") || me.email,
    email: me.email,
    phone: (me.phone ?? "").trim(),
  };
}

/** D15: the signed-in customer's profile from GET auth/me/ (null when the API is unreachable). */
export async function loadCustomerProfile(token: string, callbackUrl = "/account"): Promise<CustomerProfile | null> {
  try {
    return profileFromMe(await me(token));
  } catch (error) {
    if (isSessionEnded(error)) sessionEndedRedirect(callbackUrl);
    return null;
  }
}
