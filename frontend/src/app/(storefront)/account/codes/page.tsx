import { noIndexMeta } from "@/lib/seo";
import { CustomerOrders } from "@/components/account/customer-account";
import { requireCustomer } from "@/server/auth/require-customer";
import { loadCustomerOrders } from "@/server/orders/customer";

export const metadata = noIndexMeta("Digital codes");

/** D1: only paid (incl. partially / fully refunded) orders appear on the Codes page. */
export default async function CodesPage() {
  const user = await requireCustomer("/account/codes");
  const orders = await loadCustomerOrders(user.accessToken, { paidOnly: true, callbackUrl: "/account/codes" });
  return <CustomerOrders orders={orders} mode="codes" />;
}
