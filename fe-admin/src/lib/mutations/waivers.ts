"use client";

import { setState, getAdminState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";

export function resetWaiver(clientId: string, reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("Reason required");
  const before = getAdminState().clients.find((c) => c.id === clientId);
  if (!before) throw new Error("Client not found");
  const after = { ...before, waiverSigned: false, waiverSignedAt: null, waiverVersion: null };
  setState((s) => ({
    ...s,
    clients: s.clients.map((c) => (c.id === clientId ? after : c)),
  }));
  appendAuditEntry({
    action: "waiver.reset",
    entityType: "Client",
    entityId: clientId,
    before,
    after,
    note: trimmed,
  });
}

export function resetAllWaivers(reason: string): number {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("Reason required");
  const before = getAdminState().clients;
  let count = 0;
  setState((s) => ({
    ...s,
    clients: s.clients.map((c) => {
      if (!c.waiverSigned) return c;
      count++;
      return { ...c, waiverSigned: false, waiverSignedAt: null, waiverVersion: null };
    }),
  }));
  // Single audit event noting the bulk action; the per-client trail is implied.
  appendAuditEntry({
    action: "waiver.reset",
    entityType: "ClientBatch",
    entityId: "bulk",
    before: { signed: before.filter((c) => c.waiverSigned).map((c) => c.id) },
    after: { resetCount: count },
    note: `Bulk waiver reset (${count} clients): ${trimmed}`,
  });
  return count;
}
