import { AdminLoginForm } from "@/components/admin/login-form";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const session = await auth();
  // `reason=session`: the stored API token was rejected (expired, revoked or disabled
  // account) — show the form instead of bouncing back to /admin in a loop.
  if (session?.user?.kind === "ADMIN" && reason !== "session") redirect("/admin");
  return (
    <Suspense>
      {reason === "session" ? (
        <p className="fixed inset-x-0 top-4 z-10 mx-auto w-fit rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          Your admin session expired or was revoked. Please sign in again.
        </p>
      ) : null}
      <AdminLoginForm />
    </Suspense>
  );
}
