"use client";

import { AdminListPage, ADMIN_LIST_PAGE_SIZE } from "@/components/admin/admin-list-page";
import { Badge } from "@/components/admin/ui/badge";
import { formatAdminDateTime } from "@/lib/admin/format";
import { asList, listOneEpinLogs, type SupplierLog } from "@/lib/api/admin";

export function OneEpinLogsClient() {
  return (
    <AdminListPage<SupplierLog>
      title="OneEpin logs"
      description="Every call the panel made to OneEpin (connection checks, balance, catalog sync) and whether it worked. “Not completed” calls in test mode are expected."
      rowKey={(r) => String(r.id)}
      searchPlaceholder="Search logs…"
      loader={async (token, page, search) => {
        const data = await listOneEpinLogs(token, { page, page_size: ADMIN_LIST_PAGE_SIZE, search: search || undefined });
        return asList(data);
      }}
      columns={[
        { key: "action", header: "Action", render: (r) => r.action },
        {
          key: "status",
          header: "Status",
          render: (r) => (
            r.ok === false ? <Badge tone="warning">Not completed</Badge> : r.ok ? <Badge tone="success">OK</Badge> : <Badge status={r.status || "UNKNOWN"} />
          ),
        },
        { key: "message", header: "Message", render: (r) => r.message || "—" },
        { key: "created", header: "When", render: (r) => formatAdminDateTime(r.created_at) },
      ]}
    />
  );
}
