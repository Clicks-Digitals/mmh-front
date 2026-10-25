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
      <AdminLoginForm
        notice={
          reason === "session"
            ? "You were signed out because your session expired or your account was changed. Please sign in again."
            : ""
        }
      />
    </Suspense>
  );
}
