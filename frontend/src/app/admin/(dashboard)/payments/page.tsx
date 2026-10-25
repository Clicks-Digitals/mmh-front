import { PaymentsListClient } from "@/components/admin/modules/payments-list-client";
import { requireAdmin } from "@/server/auth/require-admin";

export default async function Page() {
  await requireAdmin("orders.read");
  return <PaymentsListClient />;
}
