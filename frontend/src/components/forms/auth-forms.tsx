"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/context/language-context";
import { passwordProblems } from "@/lib/password";
import { isValidEmail, isValidPhone } from "@/lib/validation";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

/** Only same-site relative paths are allowed as post-login destinations. */
export function safeCallbackUrl(value: string | null | undefined, fallback = "/account"): string {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (raw.startsWith("/admin") || raw.startsWith("/api")) return fallback;
  return raw;
}

/** Store sign-in failure → translation key (codes from src/auth.ts). */
export function signInErrorKey(code: string | undefined | null): string {
  switch (code) {
    case "account_disabled":
      return "auth.accountDisabled";
    case "throttled":
      return "auth.throttled";
    case "staff_account":
      return "auth.staffAccount";
    case "unavailable":
      return "auth.unavailable";
    default:
      return "auth.invalid";
  }
}

/** RO-14: staff accounts are pointed to the admin panel. */
export function SignInError({ code }: { code: string }) {
  const { t } = useLanguage();
  return (
    <p className="text-sm text-danger" role="alert">
      {t(signInErrorKey(code))}
      {code === "staff_account" ? (
        <>
          {" "}
          <a href="/admin/login" className="font-semibold underline">
            {t("auth.staffAccountLink")}
          </a>
        </>
      ) : null}
    </p>
  );
}

export function LoginForm() {
  const { t } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeCallbackUrl(params.get("callbackUrl"));
  const sessionEnded = params.get("reason") === "session";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="mx-auto w-full max-w-md space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!isValidEmail(email) || !password) {
          setError("auth.short");
          return;
        }
        setError("");
        setLoading(true);
        const result = await signIn("credentials", { email, password, portal: "store", redirect: false });
        setLoading(false);
        if (result?.error) {
          setError(result.code || "invalid_credentials");
          return;
        }
        router.push(callbackUrl);
        router.refresh();
      }}
    >
      <h1 className="text-2xl font-semibold">{t("auth.loginTitle")}</h1>
      {sessionEnded ? (
        <p className="rounded-xl border border-amber/30 bg-amber/10 p-3 text-sm text-amber" role="status">
          {t("auth.sessionEnded")}
        </p>
      ) : null}
      <Field label={t("checkout.email")} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <Field
        label={t("auth.password")}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm text-accent hover:text-fg">
          {t("auth.forgot")}
        </Link>
      </div>
      {error === "auth.short" ? (
        <p className="text-sm text-danger" role="alert">
          {t("auth.short")}
        </p>
      ) : error ? (
        <SignInError code={error} />
      ) : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("common.loading") : t("auth.submitLogin")}
      </Button>
      <p className="text-center text-sm text-muted">
        {t("auth.noAccount")}{" "}
        <Link
          href={callbackUrl !== "/account" ? `/register?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/register"}
          className="font-semibold text-accent"
        >
          {t("account.register")}
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const { t } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeCallbackUrl(params.get("callbackUrl"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="mx-auto w-full max-w-md space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const next: Record<string, string> = {};
        if (name.trim().length < 2) next.name = t("validation.required");
        if (!isValidEmail(email)) next.email = t("validation.email");
        if (phone.trim() && !isValidPhone(phone)) next.phone = t("validation.phone");
        const weak = passwordProblems(password);
        if (weak.length) next.password = weak.map((rule) => t(rule)).join(" ");
        if (password !== confirm) next.confirm = t("auth.mismatch");
        setErrors(next);
        setFormError("");
        if (Object.keys(next).length) return;
        setLoading(true);
        const { registerCustomer } = await import("@/server/actions/customer-auth");
        const registration = await registerCustomer({ name, email, phone, password });
        if (!registration.ok) {
          setLoading(false);
          if (registration.error === "validation") {
            const fields = registration.fields;
            const mapped: Record<string, string> = {};
            if (fields.email?.length) {
              mapped.email = fields.email.some((message) => /already/i.test(message)) ? t("auth.emailTaken") : fields.email[0];
            }
            if (fields.password?.length) mapped.password = fields.password.join(" ");
            if (fields.full_name?.length) mapped.name = fields.full_name[0];
            if (fields.phone?.length) mapped.phone = fields.phone[0];
            setErrors(mapped);
            if (!Object.keys(mapped).length) setFormError(Object.values(fields).flat()[0] ?? t("auth.registerUnavailable"));
            return;
          }
          setFormError(
            t(registration.error === "throttled" ? "auth.throttled" : registration.error === "invalid" ? "checkout.fixFields" : "auth.unavailable"),
          );
          return;
        }
        const result = await signIn("credentials", { email, password, portal: "store", redirect: false });
        setLoading(false);
        if (result?.error) {
          router.push("/login");
          return;
        }
        router.push(callbackUrl);
        router.refresh();
      }}
    >
      <h1 className="text-2xl font-semibold">{t("auth.registerTitle")}</h1>
      <Field label={t("checkout.name")} autoComplete="name" value={name} error={errors.name} onChange={(event) => setName(event.target.value)} />
      <Field label={t("checkout.email")} type="email" autoComplete="email" value={email} error={errors.email} onChange={(event) => setEmail(event.target.value)} />
      <Field
        label={t("checkout.phone")}
        type="tel"
        autoComplete="tel"
        placeholder="+962 79 123 4567"
        value={phone}
        error={errors.phone}
        onChange={(event) => setPhone(event.target.value)}
      />
      <Field
        label={t("auth.password")}
        type="password"
        autoComplete="new-password"
        hint={t("auth.passwordRules")}
        value={password}
        error={errors.password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Field
        label={t("auth.confirm")}
        type="password"
        autoComplete="new-password"
        value={confirm}
        error={errors.confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      {formError ? (
        <p className="text-sm text-danger" role="alert">
          {formError}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("common.loading") : t("auth.submitRegister")}
      </Button>
      <Link href="/login" className="block text-center text-sm text-accent">
        {t("account.signIn")}
      </Link>
    </form>
  );
}

export function ForgotPasswordForm() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  if (sent) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">{t("auth.forgotTitle")}</h1>
        <p className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success">{t("auth.forgotSent")}</p>
        <Link href="/login" className="block text-sm text-accent">
          {t("auth.backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form
      className="mx-auto w-full max-w-md space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!isValidEmail(email)) {
          setError(t("validation.email"));
          return;
        }
        setLoading(true);
        setError("");
        const { requestPasswordResetAction } = await import("@/server/actions/customer-auth");
        const result = await requestPasswordResetAction({ email });
        setLoading(false);
        if (result.ok) setSent(true);
        else setError(t(result.error === "throttled" ? "auth.throttled" : result.error === "invalid" ? "validation.email" : "auth.unavailable"));
      }}
    >
      <h1 className="text-2xl font-semibold">{t("auth.forgotTitle")}</h1>
      <p className="text-sm text-muted">{t("auth.forgotBody")}</p>
      <Field label={t("checkout.email")} type="email" autoComplete="email" value={email} error={error || undefined} onChange={(event) => setEmail(event.target.value)} />
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("common.loading") : t("auth.forgotSubmit")}
      </Button>
      <Link href="/login" className="block text-center text-sm text-accent">
        {t("auth.backToLogin")}
      </Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const { t } = useLanguage();
  const params = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [state, setState] = useState<"form" | "done" | "invalid">(uid && token ? "form" : "invalid");
  const [loading, setLoading] = useState(false);

  if (state !== "form") {
    return (
      <div className="mx-auto w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">{t("auth.resetTitle")}</h1>
        <p
          className={
            state === "done"
              ? "rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success"
              : "rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger"
          }
        >
          {state === "done" ? t("auth.resetDone") : uid && token ? t("auth.resetInvalid") : t("auth.resetMissing")}
        </p>
        <Button href={state === "done" ? "/login" : "/forgot-password"}>
          {state === "done" ? t("auth.submitLogin") : t("auth.forgotSubmit")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mx-auto w-full max-w-md space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const weak = passwordProblems(password);
        if (weak.length) {
          setErrors(weak.map((rule) => t(rule)));
          return;
        }
        if (password !== confirm) {
          setErrors([t("auth.mismatch")]);
          return;
        }
        setLoading(true);
        setErrors([]);
        const { confirmPasswordResetAction } = await import("@/server/actions/customer-auth");
        const result = await confirmPasswordResetAction({ uid, token, password });
        setLoading(false);
        if (result.ok) setState("done");
        else if (result.error === "invalid_token") setState("invalid");
        else if (result.error === "validation") setErrors(result.messages);
        else setErrors([t("auth.unavailable")]);
      }}
    >
      <h1 className="text-2xl font-semibold">{t("auth.resetTitle")}</h1>
      <Field
        label={t("auth.newPassword")}
        type="password"
        autoComplete="new-password"
        hint={t("auth.passwordRules")}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Field label={t("auth.confirm")} type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      {errors.length ? (
        <ul className="space-y-1 text-sm text-danger" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("common.loading") : t("auth.resetSubmit")}
      </Button>
    </form>
  );
}
