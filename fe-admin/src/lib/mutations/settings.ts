"use client";

import { setState, getAdminState, type StudioSettings } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { AdminUser, Location, PolicyState } from "@/types";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function updatePolicy(patch: Partial<PolicyState>) {
  const before = getAdminState().policy;
  const after: PolicyState = { ...before, ...patch };
  setState((s) => ({ ...s, policy: after }));
  appendAuditEntry({
    action: "policy.edit",
    entityType: "PolicyState",
    entityId: "policy",
    before,
    after,
    note: "Policy updated",
  });
  return after;
}

export function updateWaiver(text: string) {
  const before = getAdminState().studio;
  const after: StudioSettings = { ...before, waiverText: text };
  setState((s) => ({ ...s, studio: after }));
  appendAuditEntry({
    action: "policy.edit",
    entityType: "StudioSettings",
    entityId: "studio",
    before: { waiverText: before.waiverText },
    after: { waiverText: after.waiverText },
    note: "Waiver updated",
  });
}

export function updateBranding(patch: Partial<Pick<StudioSettings, "name" | "logoEmoji" | "logoUrl" | "coverGradient">>) {
  const before = getAdminState().studio;
  const after: StudioSettings = { ...before, ...patch };
  setState((s) => ({ ...s, studio: after }));
  appendAuditEntry({
    action: "policy.edit",
    entityType: "StudioSettings",
    entityId: "studio",
    before,
    after,
    note: "Branding updated",
  });
}

export interface UpsertLocationInput {
  id?: string;
  tenantId?: string;
  name: string;
  shortName: string;
  address: string;
  area: string;
  mapUrl?: string;
  phone?: string;
}

export function upsertLocation(input: UpsertLocationInput): Location {
  let result: Location | null = null;
  setState((s) => {
    if (input.id) {
      const existing = s.locations.find((l) => l.id === input.id);
      if (existing) {
        const next: Location = { ...existing, ...input, tenantId: existing.tenantId };
        result = next;
        return { ...s, locations: s.locations.map((l) => (l.id === input.id ? next : l)) };
      }
    }
    const next: Location = {
      id: input.id ?? newId("loc"),
      tenantId: input.tenantId ?? "studio",
      name: input.name,
      shortName: input.shortName,
      address: input.address,
      area: input.area,
      mapUrl: input.mapUrl,
      phone: input.phone,
    };
    result = next;
    return { ...s, locations: [next, ...s.locations] };
  });
  if (!result) throw new Error("Could not save location");
  return result;
}

export function deleteLocation(id: string) {
  setState((s) => ({ ...s, locations: s.locations.filter((l) => l.id !== id) }));
}

export function updateAdminProfile(patch: Partial<AdminUser>) {
  setState((s) => {
    const uid = s.auth.userId;
    if (!uid) return s;
    return {
      ...s,
      adminUsers: s.adminUsers.map((u) => (u.id === uid ? { ...u, ...patch } : u)),
    };
  });
}
