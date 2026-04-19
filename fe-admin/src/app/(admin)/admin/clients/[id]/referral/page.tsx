"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useAdminState } from "@/lib/admin-state";
import { StatusBadge } from "@/components/ui";
import { formatRelative, formatCurrency } from "@/lib/formatters";

export default function ClientReferralPage() {
  const { id } = useParams<{ id: string }>();
  const allCodes = useAdminState((s) => s.referralCodes);
  const allEvents = useAdminState((s) => s.referralEvents);
  const code = useMemo(
    () => allCodes.find((c) => c.ownerClientId === id),
    [allCodes, id],
  );
  const events = useMemo(
    () => allEvents.filter((e) => e.referrerClientId === id || e.refereeClientId === id),
    [allEvents, id],
  );

  if (!code) {
    return (
      <div className="rounded-md border border-dashed border-border bg-paper/40 px-4 py-6 text-center text-xs text-muted">
        No referral code for this client.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs uppercase tracking-wider text-muted">Referral code</div>
        <div className="mt-1 font-mono text-lg font-semibold text-ink">{code.code}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span>Discount: {formatCurrency(code.discountCents)}</span>
          <span>Used: {code.usedCount}/{code.usageCap}</span>
          <span>Status: {code.status}</span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Events</h3>
        {events.length === 0 ? (
          <p className="text-xs text-muted">No referral events yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <div className="font-medium text-ink">
                    {e.referrerClientId === id ? "Referred a friend" : "Joined via referral"}
                  </div>
                  <div className="text-xs text-muted">{formatRelative(e.createdAt)}</div>
                </div>
                <StatusBadge status={e.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
