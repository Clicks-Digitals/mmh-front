"use server";

import { z } from "zod";
import { auth, unstable_update, type SessionUpdate } from "@/auth";
import { changePassword, updateMe } from "@/lib/api/auth";
import { ApiError, apiFieldErrors } from "@/lib/api/client";
import { normalizePhone } from "@/lib/validation";
import { profileFromMe, type CustomerProfile } from "@/server/account/profile";

async function customerAccessToken(): Promise<string | null> {
  const session = await auth();
  if (session?.user?.kind !== "CUSTOMER" || !session.user.accessToken) return null;
  return session.user.accessToken;
}

type Fields = Record<string, string[]>;

export type ProfileResult =
  | { ok: true; profile: CustomerProfile }
  | { ok: false; error: "signed_out" | "validation" | "throttled" | "unavailable"; fields: Fields };

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(150),
  lastName: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(40).optional(),
});

/** D15: edit name / phone (PATCH auth/me/). */
export async function updateProfileAction(input: unknown): Promise<ProfileResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path?.[0] ?? "firstName");
    return { ok: false, error: "validation", fields: { [field === "firstName" ? "first_name" : field]: [] } };
  }
  const phoneRaw = parsed.data.phone ?? "";
  const phone = phoneRaw ? normalizePhone(phoneRaw) : "";
  if (phoneRaw && !phone) return { ok: false, error: "validation", fields: { phone: [] } };
  const token = await customerAccessToken();
  if (!token) return { ok: false, error: "signed_out", fields: {} };
  try {
    const me = await updateMe(token, {
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName ?? "",
      phone,
    });
    const profile = profileFromMe(me);
    await unstable_update({ mmhName: profile.name } as SessionUpdate as never);
    return { ok: true, profile };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return { ok: false, error: "signed_out", fields: {} };
      if (error.status === 429) return { ok: false, error: "throttled", fields: {} };
      if (error.status === 400) return { ok: false, error: "validation", fields: apiFieldErrors(error) };
    }
    return { ok: false, error: "unavailable", fields: {} };
  }
}

export type PasswordResult =
  | { ok: true }
  | { ok: false; error: "signed_out" | "validation" | "throttled" | "unavailable"; fields: Fields };

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

/** D15: change password; the backend revokes other sessions and returns new tokens for this one. */
export async function changePasswordAction(input: unknown): Promise<PasswordResult> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation", fields: {} };
  const token = await customerAccessToken();
  if (!token) return { ok: false, error: "signed_out", fields: {} };
  try {
    const result = await changePassword(token, {
      current_password: parsed.data.currentPassword,
      new_password: parsed.data.newPassword,
    });
    if (result.access && result.refresh) {
      await unstable_update({ mmhTokens: { access: result.access, refresh: result.refresh } } as SessionUpdate as never);
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return { ok: false, error: "signed_out", fields: {} };
      if (error.status === 429) return { ok: false, error: "throttled", fields: {} };
      if (error.status === 400) return { ok: false, error: "validation", fields: apiFieldErrors(error) };
    }
    return { ok: false, error: "unavailable", fields: {} };
  }
}
