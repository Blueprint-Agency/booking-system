"use client";

import { useMemo, useState } from "react";
import { useAdminState } from "@/lib/admin-state";
import { useWithTenant } from "@/lib/tenant-scope";
import { Avatar, EmptyState, Select } from "@/components/ui";

interface Row {
  clientId: string;
  name: string;
  credited: number;
  pending: number;
}

function withinMonth(iso: string, monthValue: string): boolean {
  if (!monthValue) return true;
  return iso.startsWith(monthValue);
}

export function ReferralLeaderboard() {
  const events = useWithTenant(useAdminState((s) => s.referralEvents));
  const clients = useAdminState((s) => s.clients);
  const [month, setMonth] = useState<string>("");

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) set.add(e.createdAt.slice(0, 7));
    return [...set].sort().reverse();
  }, [events]);

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
    for (const e of events) {
      if (!withinMonth(e.createdAt, month)) continue;
      const c = clients.find((x) => x.id === e.referrerClientId);
      const r =
        map.get(e.referrerClientId) ??
        ({
          clientId: e.referrerClientId,
          name: c?.name ?? e.referrerClientId,
          credited: 0,
          pending: 0,
        } as Row);
      if (e.status === "credited") r.credited++;
      else if (e.status === "pending" || e.status === "joined") r.pending++;
      map.set(e.referrerClientId, r);
    }
    return [...map.values()].sort((a, b) => b.credited - a.credited).slice(0, 10);
  }, [events, clients, month]);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <h3 className="text-sm font-semibold text-ink">Top referrers</h3>
        <label className="flex items-center gap-1 text-xs text-muted">
          Month
          <Select value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-32">
            <option value="">All time</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No referrals yet" description="Top referrers will appear here." />
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {rows.map((r, idx) => (
            <li key={r.clientId} className="flex items-center gap-3 px-4 py-3">
              <span className="w-6 text-center font-mono text-xs tabular-nums text-muted">
                #{idx + 1}
              </span>
              <Avatar name={r.name} size={32} />
              <div className="flex-1">
                <div className="font-medium text-ink">{r.name}</div>
                <div className="text-xs text-muted">
                  {r.pending} pending · {r.credited} credited
                </div>
              </div>
              <div className="font-mono text-lg font-semibold tabular-nums text-accent">
                {r.credited}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
