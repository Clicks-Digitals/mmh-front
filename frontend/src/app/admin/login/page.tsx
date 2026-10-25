import { AdminLoginForm } from "@/components/admin/login-form";
import { auth } from "@/auth";
import { getAdminMe } from "@/lib/api/admin";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

/** True when the signed-in admin's API token is still accepted by the backend. */
async function tokenStillValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const me = await getAdminMe(token);
    return !me.kind || me.kind === "ADMIN";
  } catch {
    // Rejected (401 token_revoked / disabled) or API unreachable: show the sign-in form.
    return false;
  }
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const session = await auth();
  const signedInAsAdmin = session?.user?.kind === "ADMIN";

  if (signedInAsAdmin) {
    // RO-16: `reason=session` comes from a rejected token. If the session is in fact fine
    // (stale link, back button), go to the panel instead of showing a misleading banner.
    if (reason !== "session" || (await tokenStillValid(session.user.accessToken))) redirect("/admin");
  }

  return (
    <Suspense>
      {reason === "session" ? (
        <p
          role="status"
          className="fixed inset-x-0 top-4 z-10 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900"
        >
          You were signed out — your session expired or your account was changed. Please sign in again.
        </p>
      ) : null}
      <AdminLoginForm />
    </Suspense>
  );
}
