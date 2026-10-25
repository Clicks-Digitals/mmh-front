import { AdminShell } from "@/components/admin/admin-shell";
import { AdminSession } from "@/components/admin/admin-session";
import { requireAdmin } from "@/server/auth/require-admin";

export const dynamic = "force-dynamic";

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const name = user.name || user.email;

  return (
    <AdminSession>
      <AdminShell userId={user.id} name={name} email={user.email} role={user.role} permissions={user.permissions}>
        {children}
      </AdminShell>
    </AdminSession>
  );
}
