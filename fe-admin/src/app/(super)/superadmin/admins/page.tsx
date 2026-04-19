"use client";

import { useMemo } from "react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader, Avatar, Badge } from "@/components/ui";

export default function SuperAdminsPage() {
  const adminUsers = useAdminState((s) => s.adminUsers);
  const users = useMemo(() => adminUsers.filter((u) => u.role === "admin"), [adminUsers]);

  return (
    <>
      <PageHeader
        title="Studio admins"
        description="Accounts with full studio-admin access. Add, edit, or disable from this list."
      />
      <div className="mt-6 rounded-lg border border-border bg-card">
        {users.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No studio admins.</p>
        ) : (
          <ul className="divide-y divide-border">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={u.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{u.name}</div>
                  <div className="text-xs text-muted">{u.email}</div>
                </div>
                <Badge tone="sage">{u.role}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
