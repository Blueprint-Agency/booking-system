"use client";

import { setState } from "@/lib/admin-state";
import { appendAuditEntry } from "@/lib/audit";
import type { Session, WorkshopTier } from "@/types";

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newTier(): WorkshopTier {
  return {
    id: newId("tier"),
    label: "",
    priceCents: 0,
    cutoffDate: null,
    active: true,
  };
}

export interface CreateWorkshopInput {
  tenantId: string;
  name: string;
  description: string;
  level: Session["level"];
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  duration: number;
  capacity: number;
  locationId: string | null;
  instructorId: string;
  heroImage: string;
  featured: boolean;
  published: boolean;
  tiers: WorkshopTier[];
}

export function createWorkshop(input: CreateWorkshopInput): Session {
  const session: Session = {
    id: newId("wsh"),
    tenantId: input.tenantId,
    locationId: input.locationId,
    name: input.name.trim(),
    category: "Workshop",
    level: input.level,
    type: "workshop",
    instructorId: input.instructorId,
    capacity: input.capacity,
    bookedCount: 0,
    waitlistCount: 0,
    date: input.date,
    time: input.time,
    duration: input.duration,
    price: input.tiers[0]?.priceCents ?? 0,
    status: "scheduled",
    recurrence: null,
    waitlistEnabled: true,
    waitlistMaxSize: 5,
    lateCutoffMinutes: null,
    packageEligible: false,
    description: input.description,
    workshopTiers: input.tiers,
    workshopHeroImage: input.heroImage || undefined,
    workshopFeatured: input.featured,
    workshopPublished: input.published,
  };
  setState((s) => ({ ...s, sessions: [session, ...s.sessions] }));
  appendAuditEntry({
    action: "session.create",
    entityType: "Session",
    entityId: session.id,
    before: null,
    after: session,
    note: `Created workshop ${session.name}`,
  });
  return session;
}

export interface UpdateWorkshopInput
  extends Partial<Omit<CreateWorkshopInput, "tenantId">> {
  id: string;
}

export function updateWorkshop(input: UpdateWorkshopInput): Session {
  let beforeRef: Session | null = null;
  let afterRef: Session | null = null;
  setState((s) => {
    const sess = s.sessions.find((x) => x.id === input.id);
    if (!sess) return s;
    beforeRef = sess;
    const next: Session = {
      ...sess,
      name: input.name ?? sess.name,
      description: input.description ?? sess.description,
      level: input.level ?? sess.level,
      date: input.date ?? sess.date,
      time: input.time ?? sess.time,
      duration: input.duration ?? sess.duration,
      capacity: input.capacity ?? sess.capacity,
      locationId: input.locationId ?? sess.locationId,
      instructorId: input.instructorId ?? sess.instructorId,
      workshopHeroImage: input.heroImage ?? sess.workshopHeroImage,
      workshopFeatured: input.featured ?? sess.workshopFeatured,
      workshopPublished: input.published ?? sess.workshopPublished,
      workshopTiers: input.tiers ?? sess.workshopTiers,
      price: (input.tiers ?? sess.workshopTiers)?.[0]?.priceCents ?? sess.price,
    };
    afterRef = next;
    return { ...s, sessions: s.sessions.map((x) => (x.id === sess.id ? next : x)) };
  });
  const before = beforeRef as Session | null;
  const after = afterRef as Session | null;
  if (!before || !after) throw new Error("Workshop not found");
  appendAuditEntry({
    action: "session.update",
    entityType: "Session",
    entityId: input.id,
    before,
    after,
    note: `Updated workshop ${after.name}`,
  });
  return after;
}
