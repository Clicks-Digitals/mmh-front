import { CouponsListClient } from "@/components/admin/modules/coupons-list-client";
import { requireAdmin } from "@/server/auth/require-admin";

export default async function Page({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  await requireAdmin("orders.read");
  const { search } = await searchParams;
  return <CouponsListClient initialSearch={search ?? ""} />;
}
