"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/context/language-context";
import { useToast } from "@/context/toast-context";
import { passwordProblems } from "@/lib/password";
import { isValidPhone } from "@/lib/validation";
import type { CustomerProfile } from "@/server/account/profile";
import { Pencil, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

function firstMessage(fields: Record<string, string[]>, ...keys: string[]): string {
  for (const key of keys) {
    const message = fields[key]?.find(Boolean);
    if (message) return message;
  }
  return "";
}

/** D15: profile with name/phone editing. */
export function ProfileCard({ profile: initial }: { profile: CustomerProfile }) {
  const { t } = useLanguage();
  const { push } = useToast();
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [phone, setPhone] = useState(initial.phone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const next: Record<string, string> = {};
    if (!firstName.trim()) next.firstName = t("validation.required");
    if (phone.trim() && !isValidPhone(phone)) next.phone = t("validation.phone");
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const { updateProfileAction } = await import("@/server/actions/account");
      const result = await updateProfileAction({ firstName, lastName, phone });
      if (result.ok) {
        setProfile(result.profile);
        setPhone(result.profile.phone);
        setEditing(false);
        push({ title: t("account.profileSaved"), tone: "success" });
        router.refresh();
        return;
      }
      if (result.error === "signed_out") {
        router.push("/login?reason=session&callbackUrl=%2Faccount");
        return;
      }
      if (result.error === "validation") {
        setErrors({
          firstName: firstMessage(result.fields, "first_name") || (result.fields.first_name ? t("validation.required") : ""),
          lastName: firstMessage(result.fields, "last_name"),
          phone: firstMessage(result.fields, "phone") || (result.fields.phone ? t("validation.phone") : ""),
          form: firstMessage(result.fields, "detail", "non_field_errors"),
        });
        return;
      }
      setErrors({ form: t(result.error === "throttled" ? "auth.throttled" : "auth.unavailable") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t("account.profile")}</h2>
        {!editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
            {t("account.editProfile")}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form
          className="mt-3 space-y-4 rounded-2xl border border-line bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("account.firstName")}
              autoComplete="given-name"
              value={firstName}
              maxLength={150}
              error={errors.firstName || undefined}
              onChange={(event) => setFirstName(event.target.value)}
            />
            <Field
              label={t("account.lastName")}
              autoComplete="family-name"
              value={lastName}
              maxLength={150}
              error={errors.lastName || undefined}
              onChange={(event) => setLastName(event.target.value)}
            />
          </div>
          <Field label={t("checkout.email")} value={profile.email} disabled hint={t("account.emailFixed")} />
          <Field
            label={t("checkout.phone")}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="+962 79 123 4567"
            value={phone}
            error={errors.phone || undefined}
            onChange={(event) => setPhone(event.target.value)}
          />
          {errors.form ? (
            <p className="text-sm text-danger" role="alert">
              {errors.form}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? t("common.loading") : t("common.save")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setErrors({});
                setFirstName(profile.firstName);
                setLastName(profile.lastName);
                setPhone(profile.phone);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex items-start gap-3 rounded-2xl border border-line bg-card p-5">
          <UserRound className="h-5 w-5 text-brand" />
          <dl className="grid gap-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted">{t("checkout.name")}:</dt>
              <dd className="font-medium">{profile.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">{t("checkout.email")}:</dt>
              <dd className="break-all">{profile.email}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">{t("account.phone")}:</dt>
              <dd dir={profile.phone ? "ltr" : undefined}>{profile.phone || t("account.noPhone")}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}

/** D15: change password; the session keeps working with the new tokens returned by the backend. */
export function ChangePasswordCard() {
  const { t } = useLanguage();
  const { push } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const problems: Record<string, string> = {};
    if (!current) problems.current = t("validation.required");
    const rules = passwordProblems(next);
    if (rules.length) problems.next = rules.map((rule) => t(rule)).join(" ");
    if (next && next === current) problems.next = t("account.passwordSame");
    if (next !== confirm) problems.confirm = t("auth.mismatch");
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy(true);
    try {
      const { changePasswordAction } = await import("@/server/actions/account");
      const result = await changePasswordAction({ currentPassword: current, newPassword: next });
      if (result.ok) {
        setOpen(false);
        setCurrent("");
        setNext("");
        setConfirm("");
        push({ title: t("account.passwordChanged"), description: t("account.passwordChangedBody"), tone: "success" });
        router.refresh();
        return;
      }
      if (result.error === "signed_out") {
        router.push("/login?reason=session&callbackUrl=%2Faccount");
        return;
      }
      if (result.error === "validation") {
        setErrors({
          current: result.fields.current_password?.length ? t("account.passwordWrong") : "",
          next: (result.fields.new_password ?? []).join(" "),
          form: firstMessage(result.fields, "detail", "non_field_errors"),
        });
        return;
      }
      setErrors({ form: t(result.error === "throttled" ? "auth.throttled" : "auth.unavailable") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t("account.security")}</h2>
        {!open ? (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            {t("account.changePassword")}
          </Button>
        ) : null}
      </div>
      {open ? (
        <form
          className="mt-3 space-y-4 rounded-2xl border border-line bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field
            label={t("account.currentPassword")}
            type="password"
            autoComplete="current-password"
            value={current}
            error={errors.current || undefined}
            onChange={(event) => setCurrent(event.target.value)}
          />
          <Field
            label={t("auth.newPassword")}
            type="password"
            autoComplete="new-password"
            hint={t("auth.passwordRules")}
            value={next}
            error={errors.next || undefined}
            onChange={(event) => setNext(event.target.value)}
          />
          <Field
            label={t("auth.confirm")}
            type="password"
            autoComplete="new-password"
            value={confirm}
            error={errors.confirm || undefined}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <p className="text-xs text-muted">{t("account.passwordOtherSessions")}</p>
          {errors.form ? (
            <p className="text-sm text-danger" role="alert">
              {errors.form}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? t("common.loading") : t("account.changePassword")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setErrors({});
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-3 rounded-2xl border border-line bg-card p-5 text-sm text-muted">{t("account.securityBody")}</p>
      )}
    </section>
  );
}
