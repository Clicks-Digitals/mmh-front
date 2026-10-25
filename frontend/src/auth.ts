import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { login as djangoLogin, logout as djangoLogout, refreshAccessToken } from "@/lib/api/auth";
import { ApiError, apiErrorCode } from "@/lib/api/client";
import { accessTokenNeedsRefresh, jwtExpiry, jwtUserId } from "@/lib/auth-tokens";
import type { JWT } from "next-auth/jwt";

export type AdminRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "CATALOG_MANAGER"
  | "ORDER_MANAGER"
  | "CONTENT_MANAGER"
  | "SUPPORT_AGENT"
  | "VIEWER";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      kind: "CUSTOMER" | "ADMIN";
      role: AdminRole | null;
      permissions?: string[];
      accessToken?: string;
    };
  }
}

/**
 * Sign-in failures, surfaced to `signIn("credentials", { redirect: false })` as `result.code`:
 *
 * - `invalid_credentials` — wrong email or password (backend 401 / 400)
 * - `account_disabled`    — correct password, but the account is disabled (backend 403)
 * - `throttled`           — too many attempts (backend 429)
 * - `not_staff`           — a customer account used on the admin login (`portal: "admin"`)
 * - `staff_account`       — a staff account used on the store login (`portal: "store"`)
 * - `unavailable`         — the API could not be reached / server error
 */
export type SignInErrorCode =
  | "invalid_credentials"
  | "account_disabled"
  | "throttled"
  | "not_staff"
  | "staff_account"
  | "unavailable";

class InvalidCredentials extends CredentialsSignin {
  code = "invalid_credentials";
}
class AccountDisabled extends CredentialsSignin {
  code = "account_disabled";
}
class Throttled extends CredentialsSignin {
  code = "throttled";
}
class NotStaff extends CredentialsSignin {
  code = "not_staff";
}
class StaffAccount extends CredentialsSignin {
  code = "staff_account";
}
class ServiceUnavailable extends CredentialsSignin {
  code = "unavailable";
}

function loginFailure(error: unknown): CredentialsSignin {
  if (error instanceof ApiError) {
    const code = apiErrorCode(error);
    if (error.status === 429 || code === "throttled") return new Throttled();
    if (code === "account_disabled" || error.status === 403) return new AccountDisabled();
    if (error.status === 401 || error.status === 400 || code === "invalid_credentials") return new InvalidCredentials();
  }
  return new ServiceUnavailable();
}

/**
 * Keep the Django access token fresh: refresh shortly before it expires and always store the
 * rotated refresh token. On failure (expired, blacklisted, token_revoked, disabled) the tokens are
 * cleared, so API calls are treated as signed out.
 */
async function refreshIfNeeded(token: JWT): Promise<JWT> {
  const access = token.accessToken as string | undefined;
  const refresh = token.refreshToken as string | undefined;
  if (!access) return token;
  const expiresAt = (token.accessExpiresAt as number | null | undefined) ?? jwtExpiry(access);
  if (!accessTokenNeedsRefresh(expiresAt)) return token;
  if (!refresh) return clearTokens(token);
  try {
    const next = await refreshOnce(refresh);
    token.accessToken = next.access;
    token.refreshToken = next.refresh ?? refresh;
    token.accessExpiresAt = jwtExpiry(next.access);
    return token;
  } catch {
    return clearTokens(token);
  }
}

/** Parallel requests share one refresh call per refresh token (rotation blacklists the old one). */
const inflight = new Map<string, Promise<{ access: string; refresh?: string }>>();

function refreshOnce(refresh: string) {
  const pending = inflight.get(refresh);
  if (pending) return pending;
  const promise = refreshAccessToken(refresh).then(
    (result) => {
      // Server components cannot persist the rotated cookie; reuse the result for later requests that still carry the old token.
      setTimeout(() => inflight.delete(refresh), 10 * 60_000);
      return result;
    },
    (error: unknown) => {
      inflight.delete(refresh);
      throw error;
    },
  );
  inflight.set(refresh, promise);
  return promise;
}

function clearTokens(token: JWT): JWT {
  delete token.accessToken;
  delete token.refreshToken;
  delete token.accessExpiresAt;
  token.authError = "RefreshFailed";
  return token;
}

type AuthUserPayload = {
  id?: string | number;
  email?: string;
  first_name?: string;
  last_name?: string;
  kind?: string;
  role?: AdminRole | null;
  permissions?: string[];
};

/** Data a server action may pass to `unstable_update` after a password change / profile edit (D15). */
export type SessionUpdate = {
  mmhTokens?: { access: string; refresh: string };
  mmhName?: string;
};

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  trustHost: true,
  pages: { signIn: "/login" },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
    },
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // "admin" (panel login) or "store" (storefront login). Omitted = no account-type check.
        portal: { label: "Portal", type: "text" },
      },
      authorize: async (credentials) => {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");
        const portal = String(credentials?.portal ?? "");

        if (!email || !password) throw new InvalidCredentials();

        let token: Awaited<ReturnType<typeof djangoLogin>>;
        try {
          token = await djangoLogin(email, password, portal === "admin" ? "admin" : undefined);
        } catch (error) {
          throw loginFailure(error);
        }
        const user = token.user as AuthUserPayload | undefined;
        const kind = (user?.kind as "CUSTOMER" | "ADMIN") || "CUSTOMER";
        if ((portal === "admin" && kind !== "ADMIN") || (portal === "store" && kind === "ADMIN")) {
          // Do not leave a usable Django session behind for the wrong portal.
          await djangoLogout(token.refresh).catch(() => undefined);
          throw portal === "admin" ? new NotStaff() : new StaffAccount();
        }
        const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
        return {
          id: String(user?.id ?? email),
          email: user?.email ?? email,
          name: name || email,
          kind,
          role: (user?.role as AdminRole | null) ?? null,
          permissions: user?.permissions ?? [],
          accessToken: token.access,
          refreshToken: token.refresh,
        };
      },
    }),
  ],
  events: {
    async signOut(message) {
      // Blacklist the Django refresh token so it cannot be reused after sign-out.
      const token = "token" in message ? message.token : null;
      const refresh = token?.refreshToken as string | undefined;
      if (refresh) await djangoLogout(refresh).catch(() => undefined);
    },
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.kind = (user as { kind?: string }).kind;
        token.role = (user as { role?: AdminRole | null }).role;
        token.permissions = (user as { permissions?: string[] }).permissions ?? [];
        token.accessToken = (user as { accessToken?: string }).accessToken;
        token.refreshToken = (user as { refreshToken?: string }).refreshToken;
        token.accessExpiresAt = jwtExpiry(token.accessToken as string | undefined);
        delete token.authError;
        return token;
      }
      if (trigger === "update" && session && typeof session === "object") {
        const update = session as SessionUpdate;
        const next = update.mmhTokens;
        // New tokens after a password change (other sessions were revoked). Only accept tokens
        // that belong to the same user.
        if (next?.access && next.refresh) {
          const owner = jwtUserId(next.access);
          if (!owner || owner === String(token.id ?? "")) {
            token.accessToken = next.access;
            token.refreshToken = next.refresh;
            token.accessExpiresAt = jwtExpiry(next.access);
            delete token.authError;
          }
        }
        if (typeof update.mmhName === "string" && update.mmhName.trim()) token.name = update.mmhName.trim().slice(0, 160);
        return token;
      }
      return refreshIfNeeded(token);
    },
    session({ session, token }) {
      session.user.id = String(token.id ?? "");
      session.user.email = session.user.email ?? "";
      if (typeof token.name === "string") session.user.name = token.name;
      session.user.kind = (token.kind as "CUSTOMER" | "ADMIN") ?? "CUSTOMER";
      session.user.role = (token.role as AdminRole | null) ?? null;
      session.user.permissions = (token.permissions as string[] | undefined) ?? [];
      session.user.accessToken = token.accessToken as string | undefined;
      return session;
    },
  },
});
