import { CustomerOrders } from "@/components/account/customer-account";
import { requireCustomer } from "@/server/auth/require-customer";
import { loadCustomerOrders } from "@/server/orders/customer";

export const metadata = { title: "Digital codes" };

export default async function CodesPage() {
  const user = await requireCustomer("/account/codes");
  return <CustomerOrders orders={await loadCustomerOrders(user.accessToken)} mode="codes" />;
}
