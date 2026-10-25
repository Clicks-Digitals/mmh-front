import { CodesListClient } from "@/components/admin/modules/codes-list-client";
import { requireAdmin } from "@/server/auth/require-admin";
import { Suspense } from "react";

export default async function Page() {
  await requireAdmin("codes.read");
  return (
    <Suspense fallback={<div className="admin-card h-48 animate-pulse" />}>
      <CodesListClient />
    </Suspense>
  );
}
