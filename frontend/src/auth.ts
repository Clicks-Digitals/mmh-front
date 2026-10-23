import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { login as djangoLogin, logout as djangoLogout, refreshAccessToken } from "@/lib/api/auth";
import { accessTokenNeedsRefresh, jwtExpiry } from "@/lib/auth-tokens";
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
 * Keep the Django access token fresh: refresh shortly before it expires and always store the
 * rotated refresh token. On failure the tokens are cleared, so API calls are treated as signed out.
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
  kind?: string;
  role?: AdminRole | null;
  permissions?: string[];
};

export const { handlers, auth, signIn, signOut } = NextAuth({
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
      },
      authorize: async (credentials) => {
        const email = String(credentials?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? "");

        if (!email || !password) return null;

        try {
          const token = await djangoLogin(email, password);
          const user = token.user as AuthUserPayload | undefined;
          const kind = (user?.kind as "CUSTOMER" | "ADMIN") || "CUSTOMER";
          return {
            id: String(user?.id ?? email),
            email: user?.email ?? email,
            name: user?.first_name || email,
            kind,
            role: (user?.role as AdminRole | null) ?? null,
            permissions: user?.permissions ?? [],
            accessToken: token.access,
            refreshToken: token.refresh,
          };
        } catch {
          return null;
        }
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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.kind = (user as { kind?: string }).kind;
        token.role = (user as { role?: AdminRole | null }).role;
        token.permissions = (user as { permissions?: string[] }).permissions ?? [];
        token.accessToken = (user as { accessToken?: string }).accessToken;
        token.refreshToken = (user as { refreshToken?: string }).refreshToken;
        token.accessExpiresAt = jwtExpiry(token.accessToken as string | undefined);
        return token;
      }
      return refreshIfNeeded(token);
    },
    session({ session, token }) {
      session.user.id = String(token.id ?? "");
      session.user.email = session.user.email ?? "";
      session.user.kind = (token.kind as "CUSTOMER" | "ADMIN") ?? "CUSTOMER";
      session.user.role = (token.role as AdminRole | null) ?? null;
      session.user.permissions = (token.permissions as string[] | undefined) ?? [];
      session.user.accessToken = token.accessToken as string | undefined;
      return session;
    },
  },
});
