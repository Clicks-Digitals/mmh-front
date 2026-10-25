"use client";

import { getSession, signIn, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LOGIN_ERROR_MESSAGES, loginErrorMessage, safeAdminRedirect } from "@/components/admin/ops/auth-helpers";

const STORE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.mmhcard.com";

const fieldClass =
  "admin-login-input block h-11 w-full rounded-[10px] border border-[#d5dae6] bg-white px-3.5 text-[14px] text-[#1c2434] placeholder:text-[#9aa1b2] transition focus:border-[var(--clicks-blue)] focus:shadow-[0_0_0_3px_var(--clicks-blue-soft)] focus:outline-none";

export function AdminLoginForm({ notice = "" }: { notice?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="clicks-shell admin-login grid bg-[var(--clicks-bg)] lg:grid-cols-[1.05fr_1fr]" style={{ minHeight: "100dvh" }}>
      <aside className="relative hidden overflow-hidden bg-[var(--clicks-navy)] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -end-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-[var(--clicks-blue)] opacity-25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -start-24 h-[24rem] w-[24rem] rounded-full bg-[#4f7bff] opacity-15 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--clicks-blue)] text-[12px] font-bold">MMH</span>
          <span className="text-[15px] font-semibold tracking-tight">MMH Admin</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-[2rem] font-semibold leading-tight tracking-tight">Run your store from one place.</h2>
          <p className="mt-4 text-[15px] leading-7 text-white/70">
            Orders, code delivery, products, customers and payments — everything your team needs to keep MMH running.
          </p>
        </div>
        <p className="relative text-[12px] text-white/45">Staff access only. All sign-ins are recorded.</p>
      </aside>

      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--clicks-blue)] text-[12px] font-bold text-white">MMH</span>
            <span className="text-[15px] font-semibold text-[var(--clicks-navy)]">MMH Admin</span>
          </div>

          <h1 className="text-[1.6rem] font-semibold tracking-tight text-[var(--clicks-navy)]">Sign in</h1>
          <p className="mt-1.5 text-[14px] text-[var(--clicks-muted)]">Use your staff email and password.</p>

          {notice && !error ? (
            <div role="status" className="mt-6 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] leading-5 text-amber-900">
              {notice}
            </div>
          ) : null}

          <form
            className="mt-8 space-y-5"
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
            {error ? (
              <div
                role="alert"
                className="rounded-[10px] border border-[#f3c5c5] bg-[#fdf2f2] px-3.5 py-3 text-[13px] leading-5 text-[#b42318]"
              >
                {error}
              </div>
            ) : null}

            <div>
              <label htmlFor="admin-email" className="mb-1.5 block text-[13px] font-medium text-[var(--clicks-text)]">
                Email
              </label>
              <input
                id="admin-email"
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="you@mmhcard.com"
                className={fieldClass}
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="mb-1.5 block text-[13px] font-medium text-[var(--clicks-text)]">
                Password
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  name="password"
                  type={passwordVisible ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="Your password"
                  className={`${fieldClass} pe-16`}
                />
                <button
                  type="button"
                  className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1.5 text-[12px] font-semibold text-[var(--clicks-blue)] hover:bg-[var(--clicks-blue-soft)]"
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  onClick={() => setPasswordVisible((value) => !value)}
                >
                  {passwordVisible ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={pending}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--clicks-blue)] text-[14px] font-semibold text-white transition hover:bg-[var(--clicks-blue-bright)] disabled:cursor-wait disabled:opacity-70"
            >
              {pending ? (
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : null}
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-[13px] text-[var(--clicks-muted)]">
            Forgot your password? Ask the store owner to reset it from Administrators.
          </p>
          <a href={STORE_URL} className="mt-8 inline-flex text-[13px] font-medium text-[var(--clicks-blue)] hover:underline">
            ← Back to the store
          </a>
        </div>
      </main>
    </div>
  );
}
