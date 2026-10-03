import { CustomerOrders } from "@/components/account/customer-account";
import { requireCustomer } from "@/server/auth/require-customer";
import { loadCustomerOrders } from "@/server/orders/customer";

export const metadata = { title: "Orders" };

export default async function OrdersPage() {
  const user = await requireCustomer("/account/orders");
  return <CustomerOrders orders={await loadCustomerOrders(user.accessToken)} />;
}
