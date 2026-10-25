import { PaymentsListClient } from "@/components/admin/modules/payments-list-client";
import { requireAdmin } from "@/server/auth/require-admin";
import { Suspense } from "react";

export default async function Page() {
  await requireAdmin("orders.read");
  // Filters, search, sorting and page live in the URL (read on the client).
  return (
    <Suspense>
      <PaymentsListClient />
    </Suspense>
  );
}
