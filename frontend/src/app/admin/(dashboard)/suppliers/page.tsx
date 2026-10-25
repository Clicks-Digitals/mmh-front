import { SuppliersListClient } from "@/components/admin/modules/suppliers-list-client";
import { requireAdmin } from "@/server/auth/require-admin";
import { Suspense } from "react";

export default async function Page() {
  await requireAdmin("suppliers.read");
  return (
    <Suspense fallback={<div className="admin-card h-48 animate-pulse" />}>
      <SuppliersListClient />
    </Suspense>
  );
}
