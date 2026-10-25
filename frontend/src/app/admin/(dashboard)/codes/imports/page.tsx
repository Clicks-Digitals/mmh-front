import { CodeImportsListClient } from "@/components/admin/modules/code-imports-list-client";
import { requireAdmin } from "@/server/auth/require-admin";
import { Suspense } from "react";

export default async function Page() {
  await requireAdmin("codes.manage");
  return (
    <Suspense fallback={<div className="admin-card h-48 animate-pulse" />}>
      <CodeImportsListClient />
    </Suspense>
  );
}
