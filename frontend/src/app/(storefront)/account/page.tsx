import { noIndexMeta } from "@/lib/seo";
import { CustomerAccount } from "@/components/account/customer-account";
import { requireCustomer } from "@/server/auth/require-customer";
import { loadCustomerProfile } from "@/server/account/profile";
import { loadCustomerOrders } from "@/server/orders/customer";

export const metadata = noIndexMeta("Account");

export default async function AccountPage() {
  const sessionUser = await requireCustomer();
  const token = sessionUser.accessToken!;
  const [profile, orders] = await Promise.all([loadCustomerProfile(token), loadCustomerOrders(token)]);
  return (
    <CustomerAccount
      profile={
        profile ?? {
          firstName: sessionUser.name ?? "",
          lastName: "",
          name: sessionUser.name ?? sessionUser.email,
          email: sessionUser.email,
          phone: "",
        }
      }
      orders={orders}
    />
  );
}
