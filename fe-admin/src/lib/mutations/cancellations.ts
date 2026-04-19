"use client";

import { setState, getAdminState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { CancellationRequest } from "@/types";

export function markCancellationResolved(id: string, reason: string): CancellationRequest {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("Reason required");
  const before = getAdminState().cancellationRequests.find((r) => r.id === id);
  if (!before) throw new Error("Cancellation request not found");
  const after: CancellationRequest = {
    ...before,
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    resolutionNote: trimmed,
  };
  setState((s) => ({
    ...s,
    cancellationRequests: s.cancellationRequests.map((r) => (r.id === id ? after : r)),
  }));
  appendAuditEntry({
    action: "cancellation.resolve",
    entityType: "CancellationRequest",
    entityId: id,
    before,
    after,
    note: trimmed,
  });
  return after;
}
