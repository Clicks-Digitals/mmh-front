import { OneEpinMappingsClient } from "@/components/admin/oneepin/mappings-client";
import { requireAdmin } from "@/server/auth/require-admin";
import { Suspense } from "react";

export default async function Page() {
  await requireAdmin("suppliers.read");
  return (
    <Suspense>
      <OneEpinMappingsClient />
    </Suspense>
  );
}
