import { OneEpinLogsPageClient } from "@/components/admin/oneepin/logs-client";
import { requireAdmin } from "@/server/auth/require-admin";
import { Suspense } from "react";

export default async function Page() {
  await requireAdmin("suppliers.read");
  return (
    <Suspense>
      <OneEpinLogsPageClient />
    </Suspense>
  );
}
