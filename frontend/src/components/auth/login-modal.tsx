"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SignInError } from "@/components/forms/auth-forms";
import { ICON_HIT } from "@/components/ui/control";
import { useLanguage } from "@/context/language-context";
import { useEscape, useScrollLock } from "@/hooks/use-overlay";
import { isValidEmail } from "@/lib/validation";
import { signIn } from "next-auth/react";
import { User, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { cn } from "@/lib/cn";

export function LoginModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const close = useCallback(() => {
    if (loading) return;
    setError("");
    onClose();
  }, [loading, onClose]);

  useScrollLock(open);
  useEscape(open, close);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-overlay/80 backdrop-blur-sm" aria-label={t("nav.close")} onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("auth.loginTitle")}
        className="relative z-10 w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-[0_24px_80px_rgba(23,24,43,0.35)] sm:p-8"
      >
        <button type="button" className={cn(ICON_HIT, "absolute end-3 top-3")} onClick={close} aria-label={t("nav.close")}>
          <X className="h-5 w-5" />
        </button>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-line bg-elevated text-gold">
          <User className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-center text-2xl font-bold tracking-tight">{t("auth.loginTitle")}</h2>
        <p className="mt-2 text-center text-sm text-muted">{t("buy.loginHint")}</p>

        <form
          className="mt-6 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!isValidEmail(email) || !password) {
              setError("auth.short");
              return;
            }
            setLoading(true);
            setError("");
            const result = await signIn("credentials", { email, password, portal: "store", redirect: false });
            setLoading(false);
            if (result?.error) {
              setError(result.code || "invalid_credentials");
              return;
            }
            router.refresh();
            onSuccess();
          }}
        >
          <Field label={t("checkout.email")} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="your@email.com" />
          <Field label={t("auth.password")} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {error === "auth.short" ? <p className="text-sm text-danger">{t("auth.short")}</p> : error ? <SignInError code={error} /> : null}
          <div className="flex justify-end">
            <Link href="/forgot-password" className="text-sm text-accent hover:text-fg" onClick={close}>
              {t("auth.forgot")}
            </Link>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("common.loading") : t("auth.submitLogin")}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          <Link href="/register" className="font-semibold text-gold hover:text-fg" onClick={close}>
            {t("account.register")}
          </Link>
        </p>
      </div>
    </div>
  );
}
