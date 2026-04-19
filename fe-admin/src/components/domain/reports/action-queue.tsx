"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

interface QueueItem {
  href: string;
  label: string;
  count: number;
  tone?: "warning" | "error" | "neutral";
}

export function ActionQueue() {
  const reqs = useWithTenant(useAdminState((s) => s.privateRequests));
  const invoices = useWithTenant(useAdminState((s) => s.invoices));
  const referrals = useWithTenant(useAdminState((s) => s.referralEvents));

  const pendingPrivate = reqs.filter((r) => r.status === "pending").length;
  const overdueSla = reqs.filter(
    (r) => r.status === "pending" && Date.parse(r.slaDueAt) < Date.now(),
  ).length;
  const failedPayments = invoices.filter((i) => i.status === "failed").length;
  const pendingReferrals = referrals.filter(
    (r) => r.status === "pending" || r.status === "joined",
  ).length;

  const items: QueueItem[] = [
    { href: "/admin/private/inbox", label: "Pending private requests", count: pendingPrivate },
    {
      href: "/admin/private/inbox",
      label: "Overdue SLAs",
      count: overdueSla,
      tone: overdueSla > 0 ? "error" : "neutral",
    },
    { href: "/admin/invoices", label: "Failed payments", count: failedPayments, tone: failedPayments > 0 ? "warning" : "neutral" },
    { href: "/admin/referrals", label: "Referrals to review", count: pendingReferrals },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Action queue</h3>
        {overdueSla > 0 && (
          <Badge tone="error">
            <AlertTriangle className="mr-1 inline h-3 w-3" /> Attention
          </Badge>
        )}
      </div>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <li key={it.label}>
            <Link
              href={it.href}
              className={cn(
                "flex items-center justify-between gap-2 py-2 text-sm",
                it.count > 0 ? "text-ink hover:text-accent" : "text-muted",
              )}
            >
              <span>{it.label}</span>
              <span className="flex items-center gap-1">
                <Badge tone={it.tone ?? (it.count > 0 ? "warning" : "neutral")}>
                  {it.count}
                </Badge>
                <ChevronRight className="h-3 w-3 text-muted" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
