import { OrdersListClient } from "@/components/admin/modules/orders-list-client";
import { requireAdmin } from "@/server/auth/require-admin";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ payment_status?: string; fulfillment_status?: string; search?: string }>;
}) {
  await requireAdmin("orders.read");
  const sp = await searchParams;
  return (
    <OrdersListClient
      initialPaymentStatus={sp.payment_status ?? ""}
      initialFulfillmentStatus={sp.fulfillment_status ?? ""}
    />
  );
}
