import { CodesListClient } from "@/components/admin/modules/codes-list-client";
import { requireAdmin } from "@/server/auth/require-admin";

export default async function Page({ searchParams }: { searchParams: Promise<{ variant?: string; status?: string }> }) {
  await requireAdmin("codes.read");
  const sp = await searchParams;
  return <CodesListClient initialVariant={sp.variant ?? ""} initialStatus={sp.status ?? ""} />;
}
