import { OneEpinCatalogClient } from "@/components/admin/oneepin/catalog-client";
import { requireAdmin } from "@/server/auth/require-admin";
import { Suspense } from "react";

export default async function Page() {
  await requireAdmin("suppliers.read");
  // Search, filters and page live in the URL (read on the client).
  return (
    <Suspense>
      <OneEpinCatalogClient />
    </Suspense>
  );
}
