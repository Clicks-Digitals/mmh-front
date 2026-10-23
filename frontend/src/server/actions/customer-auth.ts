"use server";

import { z } from "zod";
import { confirmPasswordReset, register as registerApi, requestPasswordReset } from "@/lib/api/auth";
import { ApiError, apiErrorCode, apiFieldErrors } from "@/lib/api/client";
import { normalizePhone } from "@/lib/validation";

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128),
  name: z.string().trim().min(2).max(120).optional(),
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().max(40).optional(),
});

export type FieldMessages = Record<string, string[]>;

export type RegisterResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "validation" | "throttled" | "unavailable"; fields: FieldMessages };

export async function registerCustomer(input: unknown): Promise<RegisterResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fields: {} };
  const fullName = parsed.data.fullName || parsed.data.name || "";
  if (!fullName) return { ok: false, error: "invalid", fields: { full_name: [] } };
  const phone = parsed.data.phone?.trim() ? normalizePhone(parsed.data.phone) : "";
  if (parsed.data.phone?.trim() && !phone) return { ok: false, error: "invalid", fields: { phone: [] } };
  try {
    await registerApi({ email: parsed.data.email, password: parsed.data.password, full_name: fullName, phone });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) return { ok: false, error: "throttled", fields: {} };
    if (error instanceof ApiError && error.status === 400) {
      const fields = apiFieldErrors(error);
      return { ok: false, error: "validation", fields: Object.keys(fields).length ? fields : { detail: [error.message] } };
    }
    return { ok: false, error: "unavailable", fields: {} };
  }
}

export async function requestPasswordResetAction(input: unknown): Promise<{ ok: boolean; error?: "invalid" | "throttled" | "unavailable" }> {
  const parsed = z.object({ email: z.string().trim().email() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    await requestPasswordReset(parsed.data.email);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) return { ok: false, error: "throttled" };
    return { ok: false, error: "unavailable" };
  }
}

export type ResetConfirmResult =
  | { ok: true }
  | { ok: false; error: "invalid_token" | "validation" | "invalid" | "unavailable"; messages: string[] };

export async function confirmPasswordResetAction(input: unknown): Promise<ResetConfirmResult> {
  const parsed = z
    .object({ uid: z.string().min(1).max(200), token: z.string().min(1).max(200), password: z.string().min(1).max(128) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", messages: [] };
  try {
    await confirmPasswordReset(parsed.data);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      if (apiErrorCode(error) === "invalid_token") return { ok: false, error: "invalid_token", messages: [] };
      const fields = apiFieldErrors(error);
      const messages = fields.password ?? Object.values(fields).flat();
      return { ok: false, error: "validation", messages: messages.length ? messages : [error.message] };
    }
    return { ok: false, error: "unavailable", messages: [] };
  }
}
