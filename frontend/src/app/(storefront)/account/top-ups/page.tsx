import { CustomerOrders } from "@/components/account/customer-account";
import { requireCustomer } from "@/server/auth/require-customer";
import { loadCustomerOrders } from "@/server/orders/customer";

export const metadata = { title: "Top-up orders" };

export default async function TopUpsPage() {
  const user = await requireCustomer("/account/top-ups");
  return <CustomerOrders orders={await loadCustomerOrders(user.accessToken)} mode="topups" />;
}
