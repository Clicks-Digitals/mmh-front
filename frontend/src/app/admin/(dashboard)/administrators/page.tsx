import { AdministratorsListClient } from "@/components/admin/modules/administrators-list-client";
import { requireAdmin } from "@/server/auth/require-admin";
import { Suspense } from "react";

export default async function Page() {
  await requireAdmin("admins.read");
  // Search, role filter and page live in the URL (read on the client).
  return (
    <Suspense>
      <AdministratorsListClient />
    </Suspense>
  );
}
