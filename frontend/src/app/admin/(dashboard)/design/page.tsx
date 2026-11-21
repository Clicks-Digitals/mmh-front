import { StoreDesignClient } from "@/components/admin/modules/store-design-client";
import { requireAdmin } from "@/server/auth/require-admin";

export default async function Page() {
  await requireAdmin("settings.manage");
  return <StoreDesignClient />;
}
