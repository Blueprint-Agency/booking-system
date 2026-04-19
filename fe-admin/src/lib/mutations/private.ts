"use client";

import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { PrivateRequest } from "@/types";

function patchAndAudit(
  id: string,
  patch: Partial<PrivateRequest>,
  action: "private.accept" | "private.decline" | "private.proposeAlt",
  note: string,
): PrivateRequest {
  let beforeRef: PrivateRequest | null = null;
  let afterRef: PrivateRequest | null = null;
  setState((s) => {
    const r = s.privateRequests.find((x) => x.id === id);
    if (!r) return s;
    beforeRef = r;
    const next: PrivateRequest = { ...r, ...patch };
    afterRef = next;
    return {
      ...s,
      privateRequests: s.privateRequests.map((x) => (x.id === r.id ? next : x)),
    };
  });
  const before = beforeRef as PrivateRequest | null;
  const after = afterRef as PrivateRequest | null;
  if (!before || !after) throw new Error("Request not found");
  appendAuditEntry({
    action,
    entityType: "PrivateRequest",
    entityId: id,
    before,
    after,
    note,
  });
  return after;
}

export function acceptPrivateRequest(id: string, note: string) {
  return patchAndAudit(id, { status: "accepted", responseNote: note }, "private.accept", note);
}

export function declinePrivateRequest(id: string, reason: string) {
  if (!reason.trim()) throw new Error("Reason required");
  return patchAndAudit(
    id,
    { status: "declined", responseNote: reason },
    "private.decline",
    reason,
  );
}

export function proposeAlternative(id: string, newSlotIso: string, note: string) {
  if (!newSlotIso) throw new Error("Pick a new slot");
  return patchAndAudit(
    id,
    { status: "alt_proposed", proposedSlotIso: newSlotIso, responseNote: note },
    "private.proposeAlt",
    note || `Proposed ${newSlotIso}`,
  );
}
