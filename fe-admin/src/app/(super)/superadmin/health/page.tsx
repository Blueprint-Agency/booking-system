"use client";

import { useAdminState } from "@/lib/admin-state";
import { PageHeader } from "@/components/ui";
import { StatCard } from "@/components/domain/reports/stat-card";
import { Activity, Database, ListChecks, AlertTriangle } from "lucide-react";

export default function SystemHealthPage() {
  const clients = useAdminState((s) => s.clients);
  const auditLog = useAdminState((s) => s.auditLog);
  const sessions = useAdminState((s) => s.sessions);

  const errors24h = 0; // mock
  const queueDepth = 0; // mock
  const dbSizeMb = Math.round((clients.length + sessions.length + auditLog.length) * 0.4);

  return (
    <>
      <PageHeader title="System health" description="Mock metrics for v1." />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clients" value={String(clients.length)} icon={Activity} />
        <StatCard label="DB size (MB)" value={String(dbSizeMb)} icon={Database} />
        <StatCard label="Queue depth" value={String(queueDepth)} icon={ListChecks} />
        <StatCard label="Errors (24h)" value={String(errors24h)} icon={AlertTriangle} />
      </div>
      <p className="mt-4 text-xs text-muted">
        Connect to your observability provider (Grafana / Datadog) for real numbers.
      </p>
    </>
  );
}
