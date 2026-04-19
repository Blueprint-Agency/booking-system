"use client";

import { useMemo } from "react";
import { Users, DollarSign, RotateCcw, HeartPulse } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { PageHeader } from "@/components/ui";
import { StatCard } from "@/components/domain/reports/stat-card";
import { formatCurrency } from "@/lib/formatters";

export default function SuperOverview() {
  const clients = useAdminState((s) => s.clients);
  const instructors = useAdminState((s) => s.instructors);
  const invoices = useAdminState((s) => s.invoices);
  const refundRequests = useAdminState((s) => s.refundRequests);

  const todayRevenue = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return invoices
      .filter((i) => i.status === "paid" && i.issuedAt.startsWith(today))
      .reduce((sum, i) => sum + i.amountCents, 0);
  }, [invoices]);

  const pendingRefunds = refundRequests.filter((r) => r.status === "open").length;

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Yoga Sadhana — single-studio super-admin."
      />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clients" value={String(clients.length)} icon={Users} />
        <StatCard label="Instructors" value={String(instructors.length)} icon={Users} />
        <StatCard label="Today's revenue" value={formatCurrency(todayRevenue)} icon={DollarSign} />
        <StatCard label="Pending refunds" value={String(pendingRefunds)} icon={RotateCcw} />
      </div>
      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <HeartPulse className="h-4 w-4 text-success" /> System health
        </h2>
        <p className="mt-2 text-sm text-muted">All services nominal.</p>
      </div>
    </>
  );
}
