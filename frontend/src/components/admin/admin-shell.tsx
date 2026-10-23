"use client";

import { AdminAccessProvider } from "@/components/admin/admin-access";
import { AdminCommandMenu } from "@/components/admin/command-menu";
import { AdminSidebar } from "@/components/admin/layout/sidebar";
import { AdminTopbar } from "@/components/admin/layout/topbar";
import { AdminToastProvider } from "@/components/admin/ui/toast";
import { useState } from "react";

export function AdminShell({
  children,
  userId,
  name,
  role,
  permissions = [],
}: {
  children: React.ReactNode;
  userId: string;
  name: string;
  role: string;
  permissions?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AdminAccessProvider userId={userId} role={role} permissions={permissions}>
    <AdminToastProvider>
      <div className="clicks-shell flex h-svh overflow-hidden">
        <AdminSidebar
          open={open}
          onClose={() => setOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AdminTopbar name={name} role={role} menuOpen={open} onMenuOpen={() => setOpen(true)} />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">{children}</div>
          </main>
        </div>
        <AdminCommandMenu />
      </div>
    </AdminToastProvider>
    </AdminAccessProvider>
  );
}
