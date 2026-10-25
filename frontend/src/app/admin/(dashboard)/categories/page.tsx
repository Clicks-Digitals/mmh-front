import { CategoriesListClient } from "@/components/admin/modules/categories-list-client";
import { requireAdmin } from "@/server/auth/require-admin";
import { Suspense } from "react";

export default async function Page() {
  await requireAdmin("catalog.read");
  return (
    <Suspense fallback={<div className="admin-card h-48 animate-pulse" />}>
      <CategoriesListClient />
    </Suspense>
  );
}
