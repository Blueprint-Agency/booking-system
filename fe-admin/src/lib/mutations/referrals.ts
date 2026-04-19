"use client";

import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { ReferralCode, ReferralEvent } from "@/types";

function newCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function approveReferral(eventId: string, note: string): ReferralEvent {
  const trimmed = note.trim();
  let beforeRef: ReferralEvent | null = null;
  let afterRef: ReferralEvent | null = null;
  setState((s) => {
    const ev = s.referralEvents.find((x) => x.id === eventId);
    if (!ev) return s;
    beforeRef = ev;
    const next: ReferralEvent = { ...ev, status: "credited" };
    afterRef = next;
    return {
      ...s,
      referralEvents: s.referralEvents.map((x) => (x.id === ev.id ? next : x)),
    };
  });
  const before = beforeRef as ReferralEvent | null;
  const after = afterRef as ReferralEvent | null;
  if (!before || !after) throw new Error("Referral not found");
  appendAuditEntry({
    action: "referral.approve",
    entityType: "ReferralEvent",
    entityId: eventId,
    before,
    after,
    note: trimmed || "Approved referral",
  });
  return after;
}

export function denyReferral(eventId: string, reason: string): ReferralEvent {
  const r = reason.trim();
  if (!r) throw new Error("Reason required");
  let beforeRef: ReferralEvent | null = null;
  let afterRef: ReferralEvent | null = null;
  setState((s) => {
    const ev = s.referralEvents.find((x) => x.id === eventId);
    if (!ev) return s;
    beforeRef = ev;
    const next: ReferralEvent = { ...ev, status: "denied" };
    afterRef = next;
    return {
      ...s,
      referralEvents: s.referralEvents.map((x) => (x.id === ev.id ? next : x)),
    };
  });
  const before = beforeRef as ReferralEvent | null;
  const after = afterRef as ReferralEvent | null;
  if (!before || !after) throw new Error("Referral not found");
  appendAuditEntry({
    action: "referral.deny",
    entityType: "ReferralEvent",
    entityId: eventId,
    before,
    after,
    note: r,
  });
  return after;
}

export function rotateClientCode(clientId: string, tenantId: string): ReferralCode {
  const code = newCode();
  let resultRef: ReferralCode | null = null;
  setState((s) => {
    const existing = s.referralCodes.find((c) => c.ownerClientId === clientId);
    if (existing) {
      const next: ReferralCode = { ...existing, code };
      resultRef = next;
      return {
        ...s,
        referralCodes: s.referralCodes.map((c) => (c.code === existing.code ? next : c)),
      };
    }
    const next: ReferralCode = {
      code,
      tenantId,
      ownerClientId: clientId,
      discountCents: 1000,
      usageCap: 10,
      usedCount: 0,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    resultRef = next;
    return { ...s, referralCodes: [next, ...s.referralCodes] };
  });
  const result = resultRef as ReferralCode | null;
  if (!result) throw new Error("Could not rotate code");
  return result;
}

export function disableClientCode(code: string) {
  setState((s) => ({
    ...s,
    referralCodes: s.referralCodes.map((c) =>
      c.code === code ? { ...c, status: "disabled" } : c,
    ),
  }));
}
