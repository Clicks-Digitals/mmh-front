import { AdministratorsListClient } from "@/components/admin/modules/administrators-list-client";
import { requireAdmin } from "@/server/auth/require-admin";

export default async function Page({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  await requireAdmin("admins.read");
  const { search } = await searchParams;
  return <AdministratorsListClient initialSearch={search ?? ""} />;
}
