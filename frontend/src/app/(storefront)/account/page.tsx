import { CustomerAccount } from "@/components/account/customer-account";
import { requireCustomer } from "@/server/auth/require-customer";
import { loadCustomerOrders } from "@/server/orders/customer";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const sessionUser = await requireCustomer();
  const orders = await loadCustomerOrders(sessionUser.accessToken);
  return (
    <CustomerAccount
      profile={{
        name: sessionUser.name ?? sessionUser.email,
        email: sessionUser.email,
        phone: "",
      }}
      orders={orders}
    />
  );
}
