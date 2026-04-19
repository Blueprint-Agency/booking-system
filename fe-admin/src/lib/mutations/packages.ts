"use client";

import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { ClientPackage } from "@/types";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface GrantCreditsInput {
  clientId: string;
  productId: string;
  sessions: number;
  expiresAt: string | null;
  note: string;
}

export function grantCredits(input: GrantCreditsInput): ClientPackage {
  const note = input.note.trim();
  if (!note) throw new Error("Audit note required");
  if (input.sessions <= 0) throw new Error("Sessions must be positive");

  const pkg: ClientPackage = {
    id: newId("pkg"),
    clientId: input.clientId,
    productId: input.productId,
    sessionsRemaining: input.sessions,
    sessionsTotal: input.sessions,
    purchasedAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
    status: "active",
  };

  setState((s) => ({ ...s, clientPackages: [pkg, ...s.clientPackages] }));
  appendAuditEntry({
    action: "credit.grant",
    entityType: "ClientPackage",
    entityId: pkg.id,
    before: null,
    after: pkg,
    note,
  });
  return pkg;
}

export interface AdjustPackageInput {
  packageId: string;
  delta: number;
  note: string;
}

export function adjustPackage(input: AdjustPackageInput): ClientPackage {
  const note = input.note.trim();
  if (!note) throw new Error("Audit note required");
  if (input.delta === 0) throw new Error("Delta cannot be zero");

  let before: ClientPackage | null = null;
  let after: ClientPackage | null = null;

  setState((s) => {
    const pkg = s.clientPackages.find((p) => p.id === input.packageId);
    if (!pkg) return s;
    before = pkg;
    const remaining = Math.max(0, pkg.sessionsRemaining + input.delta);
    const total = Math.max(remaining, pkg.sessionsTotal + (input.delta > 0 ? input.delta : 0));
    after = { ...pkg, sessionsRemaining: remaining, sessionsTotal: total };
    return {
      ...s,
      clientPackages: s.clientPackages.map((p) => (p.id === pkg.id ? after! : p)),
    };
  });

  if (!before || !after) throw new Error("Package not found");
  appendAuditEntry({
    action: "credit.adjust",
    entityType: "ClientPackage",
    entityId: input.packageId,
    before,
    after,
    note,
  });
  return after;
}

export interface ExtendPackageExpiryInput {
  packageId: string;
  newExpiryIso: string | null;
  note: string;
}

export function extendPackageExpiry(input: ExtendPackageExpiryInput): ClientPackage {
  const note = input.note.trim();
  if (!note) throw new Error("Audit note required");

  let before: ClientPackage | null = null;
  let after: ClientPackage | null = null;

  setState((s) => {
    const pkg = s.clientPackages.find((p) => p.id === input.packageId);
    if (!pkg) return s;
    before = pkg;
    after = { ...pkg, expiresAt: input.newExpiryIso };
    return {
      ...s,
      clientPackages: s.clientPackages.map((p) => (p.id === pkg.id ? after! : p)),
    };
  });

  if (!before || !after) throw new Error("Package not found");
  appendAuditEntry({
    action: "package.extend",
    entityType: "ClientPackage",
    entityId: input.packageId,
    before,
    after,
    note,
  });
  return after;
}
