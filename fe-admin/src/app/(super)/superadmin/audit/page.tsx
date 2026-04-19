"use client";

import { useAdminState } from "@/lib/admin-state";
import { PageHeader } from "@/components/ui";
import { AuditLogTable } from "@/components/domain/audit/audit-log-table";

export default function SuperAuditPage() {
  const entries = useAdminState((s) => s.auditLog);
  const adminUsers = useAdminState((s) => s.adminUsers);

  return (
    <>
      <PageHeader
        title="Audit (super)"
        description="Read-only mirror of the studio audit log. Useful for cross-checking impersonation events."
      />
      <div className="mt-6">
        <AuditLogTable rows={entries} actors={adminUsers} />
      </div>
    </>
  );
}
