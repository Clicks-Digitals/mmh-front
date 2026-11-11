"use client";

import { AdminAccessProvider } from "@/components/admin/admin-access";
import { AdminCommandMenu } from "@/components/admin/command-menu";
import { AdminBreadcrumbProvider } from "@/components/admin/layout/breadcrumbs";
import { MaintenanceBar } from "@/components/admin/layout/maintenance-bar";
import { NavigationGuardProvider } from "@/components/admin/layout/navigation-guard";
import { AdminSidebar } from "@/components/admin/layout/sidebar";
import { AdminTopbar } from "@/components/admin/layout/topbar";
import { AdminToastProvider } from "@/components/admin/ui/toast";
import { useState } from "react";

export function AdminShell({
  children,
  userId,
  name,
  email = "",
  role,
  permissions = [],
}: {
  children: React.ReactNode;
  userId: string;
  name: string;
  email?: string;
  role: string;
  permissions?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AdminAccessProvider userId={userId} role={role} permissions={permissions}>
      <AdminToastProvider>
        <NavigationGuardProvider>
          <AdminBreadcrumbProvider>
            <div className="clicks-shell relative flex h-svh overflow-hidden">
              <AdminSidebar
                open={open}
                onClose={() => setOpen(false)}
                collapsed={collapsed}
                onToggleCollapse={() => setCollapsed((v) => !v)}
                name={name}
                email={email}
              />
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <AdminTopbar name={name} role={role} menuOpen={open} onMenuOpen={() => setOpen(true)} />
                <MaintenanceBar />
                {/* relative: keeps absolutely positioned helpers (sr-only labels, file inputs) inside the scroll area instead of stretching the page */}
                <main className="relative min-h-0 flex-1 overflow-y-auto">
                  <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">{children}</div>
                </main>
              </div>
              <AdminCommandMenu />
            </div>
          </AdminBreadcrumbProvider>
        </NavigationGuardProvider>
      </AdminToastProvider>
    </AdminAccessProvider>
  );
}
