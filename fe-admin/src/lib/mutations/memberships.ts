"use client";

import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { Membership } from "@/types";

export interface PauseInput {
  membershipId: string;
  resumeAt: string; // ISO date YYYY-MM-DD
  note: string;
}

export function pauseMembership(input: PauseInput): Membership {
  const note = input.note.trim();
  if (!note) throw new Error("Audit note required");
  let beforeRef: Membership | null = null;
  let afterRef: Membership | null = null;
  setState((s) => {
    const m = s.memberships.find((x) => x.id === input.membershipId);
    if (!m) return s;
    beforeRef = m;
    const next: Membership = { ...m, status: "paused", pausedUntil: input.resumeAt };
    afterRef = next;
    return { ...s, memberships: s.memberships.map((x) => (x.id === m.id ? next : x)) };
  });
  const before = beforeRef as Membership | null;
  const after = afterRef as Membership | null;
  if (!before || !after) throw new Error("Membership not found");
  appendAuditEntry({
    action: "membership.pause",
    entityType: "Membership",
    entityId: input.membershipId,
    before,
    after,
    note,
  });
  return after;
}

export interface CancelMembershipInput {
  membershipId: string;
  effectiveAt: string;
  reason: string;
}

export function cancelMembership(input: CancelMembershipInput): Membership {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Reason required");
  let beforeRef: Membership | null = null;
  let afterRef: Membership | null = null;
  setState((s) => {
    const m = s.memberships.find((x) => x.id === input.membershipId);
    if (!m) return s;
    beforeRef = m;
    const next: Membership = { ...m, status: "cancelled" };
    afterRef = next;
    return { ...s, memberships: s.memberships.map((x) => (x.id === m.id ? next : x)) };
  });
  const before = beforeRef as Membership | null;
  const after = afterRef as Membership | null;
  if (!before || !after) throw new Error("Membership not found");
  appendAuditEntry({
    action: "membership.cancel",
    entityType: "Membership",
    entityId: input.membershipId,
    before,
    after,
    note: `${reason} (effective ${input.effectiveAt})`,
  });
  return after;
}

export interface ChangePlanInput {
  membershipId: string;
  newProductId: string;
  note: string;
}

export function changeMembershipPlan(input: ChangePlanInput): Membership {
  const note = input.note.trim();
  if (!note) throw new Error("Audit note required");
  let beforeRef: Membership | null = null;
  let afterRef: Membership | null = null;
  setState((s) => {
    const m = s.memberships.find((x) => x.id === input.membershipId);
    if (!m) return s;
    const newProduct = s.products.find((p) => p.id === input.newProductId);
    if (!newProduct) throw new Error("Product not found");
    beforeRef = m;
    const next: Membership = {
      ...m,
      productId: input.newProductId,
      sessionsPerMonth: newProduct.sessionsPerMonth ?? m.sessionsPerMonth,
    };
    afterRef = next;
    return { ...s, memberships: s.memberships.map((x) => (x.id === m.id ? next : x)) };
  });
  const before = beforeRef as Membership | null;
  const after = afterRef as Membership | null;
  if (!before || !after) throw new Error("Membership not found");
  appendAuditEntry({
    action: "membership.changePlan",
    entityType: "Membership",
    entityId: input.membershipId,
    before,
    after,
    note,
  });
  return after;
}
