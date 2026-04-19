"use client";

import { setState, getAdminState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { Broadcast, NotificationTemplate } from "@/types";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function upsertNotificationTemplate(input: NotificationTemplate) {
  setState((s) => {
    const exists = s.notificationTemplates.find(
      (t) => t.tenantId === input.tenantId && t.slug === input.slug,
    );
    if (exists) {
      return {
        ...s,
        notificationTemplates: s.notificationTemplates.map((t) =>
          t.tenantId === input.tenantId && t.slug === input.slug ? input : t,
        ),
      };
    }
    return { ...s, notificationTemplates: [input, ...s.notificationTemplates] };
  });
}

export interface SendBroadcastInput {
  tenantId: string;
  templateSlug: string | null;
  subject: string;
  body: string;
  audience: Broadcast["audience"];
  scheduledAt?: string;
}

export function sendBroadcast(input: SendBroadcastInput): Broadcast {
  const broadcast: Broadcast = {
    id: newId("brd"),
    tenantId: input.tenantId,
    templateSlug: input.templateSlug,
    subject: input.subject,
    body: input.body,
    audience: input.audience,
    status: input.scheduledAt ? "scheduled" : "sent",
    scheduledAt: input.scheduledAt,
    sentAt: input.scheduledAt ? undefined : new Date().toISOString(),
  };
  setState((s) => ({ ...s, broadcasts: [broadcast, ...s.broadcasts] }));

  const audienceCount = computeAudienceCount(broadcast.audience, input.tenantId);
  appendAuditEntry({
    action: "broadcast.send",
    entityType: "Broadcast",
    entityId: broadcast.id,
    before: null,
    after: { ...broadcast, audienceCount },
    note: `Broadcast "${broadcast.subject}" → ${audienceCount} recipient(s)`,
  });
  return broadcast;
}

function computeAudienceCount(audience: Broadcast["audience"], tenantId: string): number {
  const clients = getAdminState().clients.filter((c) => c.tenantId === tenantId);
  if (audience.kind === "all") return clients.length;
  if (audience.kind === "tag") {
    const tag = String(audience.value ?? "");
    return clients.filter((c) => c.tags.includes(tag)).length;
  }
  if (audience.kind === "ids") {
    const ids = (audience.value as string[] | undefined) ?? [];
    return ids.length;
  }
  return 0;
}
