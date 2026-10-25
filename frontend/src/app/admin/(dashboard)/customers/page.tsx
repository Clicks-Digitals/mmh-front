import { CustomersListClient } from "@/components/admin/modules/customers-list-client";
import { requireAdmin } from "@/server/auth/require-admin";

export default async function Page({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  await requireAdmin("customers.read");
  const { search } = await searchParams;
  return <CustomersListClient initialSearch={search ?? ""} />;
}
