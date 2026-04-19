"use client";

import { setState, getAdminState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { AuditAction, RefundRequest } from "@/types";

function update(id: string, patch: Partial<RefundRequest>, action: AuditAction, note: string) {
  const before = getAdminState().refundRequests.find((r) => r.id === id);
  if (!before) throw new Error("Refund request not found");
  const after: RefundRequest = { ...before, ...patch };
  setState((s) => ({
    ...s,
    refundRequests: s.refundRequests.map((r) => (r.id === id ? after : r)),
  }));
  appendAuditEntry({
    action,
    entityType: "RefundRequest",
    entityId: id,
    before,
    after,
    note,
  });
  return after;
}

export function markRefundResolved(id: string, reason: string): RefundRequest {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("Reason required");
  return update(
    id,
    { status: "resolved", resolvedAt: new Date().toISOString(), resolutionNote: trimmed },
    "refund.resolve",
    trimmed,
  );
}

export function markRefundDeclined(id: string, reason: string): RefundRequest {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("Reason required");
  return update(
    id,
    { status: "declined", resolvedAt: new Date().toISOString(), resolutionNote: trimmed },
    "refund.decline",
    trimmed,
  );
}
