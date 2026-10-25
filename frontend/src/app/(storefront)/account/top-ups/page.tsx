import { noIndexMeta } from "@/lib/seo";
import { CustomerOrders } from "@/components/account/customer-account";
import { requireCustomer } from "@/server/auth/require-customer";
import { loadCustomerOrders } from "@/server/orders/customer";

export const metadata = noIndexMeta("Top-up orders");

export default async function TopUpsPage() {
  const user = await requireCustomer("/account/top-ups");
  const orders = await loadCustomerOrders(user.accessToken, { paidOnly: true, callbackUrl: "/account/top-ups" });
  return <CustomerOrders orders={orders} mode="topups" />;
}
