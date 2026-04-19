"use client";

import { useAdminState } from "@/lib/admin-state";
import { useCurrentTenantId } from "@/lib/admin-auth";
import { withTenant } from "@/lib/tenant-scope";
import { PageHeader } from "@/components/ui";
import { AuditLogTable } from "@/components/domain/audit/audit-log-table";

export default function AuditLogPage() {
  const entries = useAdminState((s) => s.auditLog);
  const adminUsers = useAdminState((s) => s.adminUsers);
  const tid = useCurrentTenantId();
  const scoped = withTenant(entries, tid);
  const tenantActors = withTenant(adminUsers, tid);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every money, credit, and access event — who did it, when, and what changed."
      />
      <div className="mt-6">
        <AuditLogTable rows={scoped} actors={tenantActors} />
      </div>
    </>
  );
}
