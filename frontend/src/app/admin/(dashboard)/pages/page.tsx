import { PagesListClient } from "@/components/admin/modules/pages-list-client";
import { requireAdmin } from "@/server/auth/require-admin";
import { Suspense } from "react";

export default async function Page() {
  await requireAdmin("content.read");
  return (
    <Suspense fallback={<div className="admin-card h-48 animate-pulse" />}>
      <PagesListClient />
    </Suspense>
  );
}
