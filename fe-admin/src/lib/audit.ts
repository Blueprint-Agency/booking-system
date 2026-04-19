"use client";
import { setState, STUDIO_TENANT_ID } from "./admin-state";
import type { AuditAction, AuditEntry } from "@/types";

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  note?: string | null;
}

function newId(): string {
  return `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function appendAuditEntry(input: AuditInput) {
  setState((s) => {
    const user = s.auth.userId ? s.adminUsers.find((u) => u.id === s.auth.userId) : null;
    if (!user) return s;
    const originatorId = s.auth.originatorUserId;
    const entry: AuditEntry = {
      id: newId(),
      ts: new Date().toISOString(),
      actorId: user.id,
      actorRole: user.role,
      tenantId: STUDIO_TENANT_ID,
      impersonatingTenantId: originatorId ?? undefined,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      note: input.note ?? null,
    };
    return { ...s, auditLog: [entry, ...s.auditLog] };
  });
}
