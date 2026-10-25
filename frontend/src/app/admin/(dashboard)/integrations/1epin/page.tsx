import { OneEpinOverviewClient } from "@/components/admin/oneepin/overview-client";
import { requireAdmin } from "@/server/auth/require-admin";

export default async function Page() {
  await requireAdmin("suppliers.read");
  return <OneEpinOverviewClient />;
}
