"use client";

import { useMemo } from "react";
import { useAdminState } from "@/lib/admin-state";
import { formatRelative } from "@/lib/formatters";

interface AuditTimelineProps {
  targetId?: string;
  entityType?: string;
  limit?: number;
}

export function AuditTimeline({ targetId, entityType, limit = 25 }: AuditTimelineProps) {
  const auditLog = useAdminState((s) => s.auditLog);
  const adminUsers = useAdminState((s) => s.adminUsers);
  const entries = useMemo(() => {
    let rows = auditLog;
    if (targetId) rows = rows.filter((e) => e.entityId === targetId);
    if (entityType) rows = rows.filter((e) => e.entityType === entityType);
    return rows.slice(0, limit);
  }, [auditLog, targetId, entityType, limit]);
  const userById = useMemo(() => {
    const map: Record<string, string> = {};
    adminUsers.forEach((u) => (map[u.id] = u.name));
    return map;
  }, [adminUsers]);

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-paper/40 px-4 py-6 text-center text-xs text-muted">
        No audit entries yet.
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3">
          <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
          <div className="min-w-0 flex-1 border-b border-border pb-3 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="font-medium text-ink">{e.action}</span>
              <span className="text-xs text-muted">on {e.entityType}</span>
              <span className="ml-auto text-[11px] text-muted">{formatRelative(e.ts)}</span>
            </div>
            <div className="mt-1 text-xs text-muted">
              by {userById[e.actorId] ?? e.actorId}
              {e.impersonatingTenantId && (
                <span className="ml-1 text-warning">
                  (originator {userById[e.impersonatingTenantId] ?? e.impersonatingTenantId})
                </span>
              )}
            </div>
            {e.note && <div className="mt-1 text-xs text-ink">{e.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
