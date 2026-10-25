"use client";

import { getSession, signIn, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LOGIN_ERROR_MESSAGES, loginErrorMessage, safeAdminRedirect } from "@/components/admin/ops/auth-helpers";

export function AdminLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="clicks-shell flex min-h-screen items-center justify-center bg-[var(--clicks-bg)] p-6">
      <form
        className="admin-card w-full max-w-[400px] p-7 shadow-[var(--admin-shadow-hover)]"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError("");
          const data = new FormData(event.currentTarget);
          let result: Awaited<ReturnType<typeof signIn>> | undefined;
          try {
            result = await signIn("credentials", {
              email: String(data.get("email") ?? ""),
              password: String(data.get("password") ?? ""),
              portal: "admin",
              redirect: false,
            });
          } catch {
            setPending(false);
            setError("Sign-in is not available right now. Try again in a minute.");
            return;
          }
          // next-auth reports failures in `error` / `code` (ok can still be true).
          if (!result || result.error || !result.ok) {
            setPending(false);
            setError(loginErrorMessage(result));
            return;
          }

          const session = await getSession();
          if (session?.user?.kind !== "ADMIN") {
            await signOut({ redirect: false });
            setPending(false);
            setError(LOGIN_ERROR_MESSAGES.not_staff);
            return;
          }

          setPending(false);
          router.push(safeAdminRedirect(params.get("from")));
          router.refresh();
        }}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--admin-radius-sm)] bg-[var(--clicks-blue)] text-[11px] font-bold text-white">
            MMH
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--clicks-muted)]">
              MMH Commerce
            </p>
            <p className="text-[13px] font-semibold text-[var(--clicks-navy)]">Admin Panel</p>
          </div>
        </div>
        <h1 className="mt-6 text-[1.25rem] font-semibold tracking-tight text-[var(--clicks-navy)]">Sign in</h1>
        <p className="mt-1 text-[13px] text-[var(--clicks-muted)]">Use your staff e-mail and password.</p>
        <label className="mt-6 block text-[12px] font-medium text-[var(--clicks-text)]">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="admin-input mt-1.5"
          />
        </label>
        <label className="mt-4 block text-[12px] font-medium text-[var(--clicks-text)]">
          Password
          <span className="relative mt-1.5 block">
            <input
              name="password"
              type={passwordVisible ? "text" : "password"}
              required
              autoComplete="current-password"
              className="admin-input admin-input--trail-action"
            />
            <button
              type="button"
              className="absolute end-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[var(--clicks-blue)]"
              aria-label={passwordVisible ? "Hide password" : "Show password"}
              onClick={() => setPasswordVisible((value) => !value)}
            >
              {passwordVisible ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-[var(--clicks-error)]">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending} className="admin-btn admin-btn-primary mt-6 h-10 w-full">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
