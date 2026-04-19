"use client";

import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { SessionTemplate } from "@/types";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface CreateSessionTemplateInput {
  tenantId: string;
  name: string;
  category: string;
  level: SessionTemplate["level"];
  duration: number;
  defaultPriceCents: number;
  defaultInstructorId: string | null;
  locationIds: string[];
  recurrence: string | null;
  time: string;
  packageEligible: boolean;
  description: string;
}

export function createSessionTemplate(input: CreateSessionTemplateInput): SessionTemplate {
  const tmpl: SessionTemplate = {
    id: newId("tmp"),
    tenantId: input.tenantId,
    name: input.name.trim(),
    category: input.category.trim(),
    level: input.level,
    duration: input.duration,
    defaultPriceCents: input.defaultPriceCents,
    defaultInstructorId: input.defaultInstructorId,
    locationIds: input.locationIds,
    recurrence: input.recurrence,
    time: input.time,
    packageEligible: input.packageEligible,
    description: input.description.trim(),
    active: true,
  };
  setState((s) => ({ ...s, sessionTemplates: [tmpl, ...s.sessionTemplates] }));
  appendAuditEntry({
    action: "session.create",
    entityType: "SessionTemplate",
    entityId: tmpl.id,
    before: null,
    after: tmpl,
    note: `Created class template ${tmpl.name}`,
  });
  return tmpl;
}

export interface UpdateSessionTemplateInput
  extends Partial<Omit<SessionTemplate, "id" | "tenantId">> {
  id: string;
}

export function updateSessionTemplate(input: UpdateSessionTemplateInput): SessionTemplate {
  let beforeRef: SessionTemplate | null = null;
  let afterRef: SessionTemplate | null = null;
  setState((s) => {
    const tmpl = s.sessionTemplates.find((t) => t.id === input.id);
    if (!tmpl) return s;
    beforeRef = tmpl;
    const next: SessionTemplate = { ...tmpl, ...input };
    afterRef = next;
    return {
      ...s,
      sessionTemplates: s.sessionTemplates.map((t) => (t.id === tmpl.id ? next : t)),
    };
  });
  const before = beforeRef as SessionTemplate | null;
  const after = afterRef as SessionTemplate | null;
  if (!before || !after) throw new Error("Template not found");
  appendAuditEntry({
    action: "session.update",
    entityType: "SessionTemplate",
    entityId: input.id,
    before,
    after,
    note: `Updated class template ${after.name}`,
  });
  return after;
}

export function archiveSessionTemplate(id: string, note: string) {
  let before: SessionTemplate | null = null;
  let after: SessionTemplate | null = null;
  setState((s) => {
    const tmpl = s.sessionTemplates.find((t) => t.id === id);
    if (!tmpl) return s;
    before = tmpl;
    after = { ...tmpl, active: false };
    return {
      ...s,
      sessionTemplates: s.sessionTemplates.map((t) => (t.id === id ? after! : t)),
    };
  });
  if (!before || !after) throw new Error("Template not found");
  appendAuditEntry({
    action: "session.update",
    entityType: "SessionTemplate",
    entityId: id,
    before,
    after,
    note: note || "Archived class template",
  });
}
