"use client";

import type { AdminState } from "@/lib/admin-state";
import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import { expandOccurrences, parseRRule } from "@/lib/rrule";
import type { Session, SessionTemplate } from "@/types";

export interface ScheduleOccurrence {
  id: string; // `${templateId}@YYYY-MM-DD` OR concrete session id
  templateId: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  duration: number;
  name: string;
  category: string;
  level: Session["level"];
  type: Session["type"];
  instructorId: string;
  locationId: string | null;
  capacity: number;
  bookedCount: number;
  waitlistCount: number;
  price: number;
  packageEligible: boolean;
  status: Session["status"];
  description: string;
  isMaterialized: boolean;
  materializedSessionId: string | null;
}

function dateOnly(iso: Date | string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function occurrenceIdFor(templateId: string, date: string): string {
  return `${templateId}@${date}`;
}

function fromTemplate(
  template: SessionTemplate,
  date: string,
): ScheduleOccurrence {
  return {
    id: occurrenceIdFor(template.id, date),
    templateId: template.id,
    date,
    time: template.time,
    duration: template.duration,
    name: template.name,
    category: template.category,
    level: template.level,
    type: "regular",
    instructorId: template.defaultInstructorId ?? "",
    locationId: template.locationIds[0] ?? null,
    capacity: 20,
    bookedCount: 0,
    waitlistCount: 0,
    price: template.defaultPriceCents,
    packageEligible: template.packageEligible,
    status: "scheduled",
    description: template.description,
    isMaterialized: false,
    materializedSessionId: null,
  };
}

function fromSession(session: Session, templateId: string | null): ScheduleOccurrence {
  return {
    id: session.id,
    templateId,
    date: session.date,
    time: session.time,
    duration: session.duration,
    name: session.name,
    category: session.category,
    level: session.level,
    type: session.type,
    instructorId: session.instructorId,
    locationId: session.locationId,
    capacity: session.capacity,
    bookedCount: session.bookedCount,
    waitlistCount: session.waitlistCount,
    price: session.price,
    packageEligible: session.packageEligible,
    status: session.status,
    description: session.description,
    isMaterialized: true,
    materializedSessionId: session.id,
  };
}

export interface ExpandWeekParams {
  tenantId: string | null;
  fromIso: string; // YYYY-MM-DD start day inclusive
  days: number; // window length in days
}

export function expandSchedule(
  state: AdminState,
  params: ExpandWeekParams,
): ScheduleOccurrence[] {
  const { tenantId, fromIso, days } = params;
  if (!tenantId) return [];

  const start = new Date(`${fromIso}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + days);

  const out: ScheduleOccurrence[] = [];
  const sessionByTemplateDate = new Map<string, Session>();
  for (const sess of state.sessions) {
    if (sess.tenantId !== tenantId) continue;
    if (sess.id.includes("@")) {
      sessionByTemplateDate.set(sess.id, sess);
    }
  }

  for (const tmpl of state.sessionTemplates) {
    if (tmpl.tenantId !== tenantId || !tmpl.active || !tmpl.recurrence) continue;
    let dates: Date[] = [];
    try {
      const rule = parseRRule(tmpl.recurrence);
      dates = expandOccurrences(rule, start, end);
    } catch {
      continue;
    }
    for (const d of dates) {
      const dateStr = dateOnly(d);
      const occId = occurrenceIdFor(tmpl.id, dateStr);
      const materialized = sessionByTemplateDate.get(occId);
      if (materialized) {
        out.push(fromSession(materialized, tmpl.id));
      } else {
        out.push(fromTemplate(tmpl, dateStr));
      }
    }
  }

  // Concrete (non-template-derived) sessions — workshops, one-offs
  for (const sess of state.sessions) {
    if (sess.tenantId !== tenantId) continue;
    if (sess.id.includes("@")) continue;
    const startMs = new Date(`${sess.date}T${sess.time}:00`).getTime();
    if (startMs >= start.getTime() && startMs < end.getTime()) {
      out.push(fromSession(sess, null));
    }
  }

  out.sort((a, b) => {
    const aMs = new Date(`${a.date}T${a.time}:00`).getTime();
    const bMs = new Date(`${b.date}T${b.time}:00`).getTime();
    return aMs - bMs;
  });
  return out;
}

export function materializeOccurrence(
  state: AdminState,
  occurrenceId: string,
): Session {
  const existing = state.sessions.find((s) => s.id === occurrenceId);
  if (existing) return existing;
  const [templateId, date] = occurrenceId.split("@");
  const tmpl = state.sessionTemplates.find((t) => t.id === templateId);
  if (!tmpl) throw new Error(`No template for ${occurrenceId}`);
  return {
    id: occurrenceId,
    tenantId: tmpl.tenantId,
    locationId: tmpl.locationIds[0] ?? null,
    name: tmpl.name,
    category: tmpl.category,
    level: tmpl.level,
    type: "regular",
    instructorId: tmpl.defaultInstructorId ?? "",
    capacity: 20,
    bookedCount: 0,
    waitlistCount: 0,
    date,
    time: tmpl.time,
    duration: tmpl.duration,
    price: tmpl.defaultPriceCents,
    status: "scheduled",
    recurrence: tmpl.recurrence,
    waitlistEnabled: true,
    waitlistMaxSize: 5,
    lateCutoffMinutes: 5,
    packageEligible: tmpl.packageEligible,
    description: tmpl.description,
  };
}

export function ensureMaterialized(occurrenceId: string): Session {
  let result: Session | null = null;
  setState((s) => {
    if (!occurrenceId.includes("@")) {
      result = s.sessions.find((x) => x.id === occurrenceId) ?? null;
      return s;
    }
    const existing = s.sessions.find((x) => x.id === occurrenceId);
    if (existing) {
      result = existing;
      return s;
    }
    const sess = materializeOccurrence(s, occurrenceId);
    result = sess;
    return { ...s, sessions: [sess, ...s.sessions] };
  });
  if (!result) throw new Error(`Cannot materialize ${occurrenceId}`);
  return result;
}

export interface OverrideInput {
  occurrenceId: string;
  patch: Partial<Pick<Session, "instructorId" | "capacity" | "status" | "cancelReason">>;
  note: string;
  action: "session.update" | "session.cancel";
}

export function overrideOccurrence(input: OverrideInput): Session {
  const note = input.note.trim();
  if (!note) throw new Error("Audit note required");
  ensureMaterialized(input.occurrenceId);

  let beforeRef: Session | null = null;
  let afterRef: Session | null = null;
  setState((s) => {
    const sess = s.sessions.find((x) => x.id === input.occurrenceId);
    if (!sess) return s;
    beforeRef = sess;
    const next: Session = { ...sess, ...input.patch };
    if (input.patch.status === "cancelled" && !next.cancelledAt) {
      next.cancelledAt = new Date().toISOString();
    }
    afterRef = next;
    return { ...s, sessions: s.sessions.map((x) => (x.id === sess.id ? next : x)) };
  });
  const before = beforeRef as Session | null;
  const after = afterRef as Session | null;
  if (!before || !after) throw new Error("Session not found");
  appendAuditEntry({
    action: input.action,
    entityType: "Session",
    entityId: input.occurrenceId,
    before,
    after,
    note,
  });
  return after;
}
