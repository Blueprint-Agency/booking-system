import {
  classInstances,
  workshops,
  ptSessions,
  bookings,
  classTypes,
  instructors,
  locations,
  clients,
} from "@/data";
import { computeEventState } from "./event-state";
import { maxCapacity } from "./capacity";
import type {
  ClassInstance,
  Workshop,
  WorkshopDay,
  WorkshopTier,
  PtSession,
  EventState,
} from "@/types";

export type ScheduleEntry =
  | {
      kind: "class";
      id: string;
      label: string;
      classTypeId: string;
      instructorIds: string[];
      locationId: string;
      startsAt: string;
      endsAt: string;
      capacity: number;
      bookedCount: number;
      eventState: EventState;
      raw: ClassInstance;
    }
  | {
      kind: "workshop";
      id: string;
      label: string;
      classTypeId: string;
      instructorIds: string[];
      locationId: string;
      startsAt: string;
      endsAt: string;
      capacity: number;
      bookedCount: number;
      eventState: EventState;
      raw: Workshop;
      tiers: WorkshopTier[];
      day: WorkshopDay;
      dayIndex: number;
      dayCount: number;
    }
  | {
      kind: "pt";
      id: string;
      label: string;
      classTypeId: null;
      instructorIds: string[];
      locationId: string | null;
      startsAt: string;
      endsAt: string;
      capacity: number;
      bookedCount: number;
      eventState: EventState;
      raw: PtSession;
    };

function classLabel(c: ClassInstance): string {
  return classTypes.find((ct) => ct.id === c.classTypeId)?.name ?? "Class";
}

function workshopLabel(w: Workshop): string {
  return w.name;
}

function ptLabel(s: PtSession): string {
  const names = s.clientIds
    .map((id) => clients.find((c) => c.id === id)?.name.split(" ")[0])
    .filter(Boolean);
  return `Private · ${names.join(" + ") || "Unknown"}`;
}

function classBookedCount(classId: string): number {
  return bookings.filter((b) => b.classId === classId && b.state === "confirmed").length;
}

function workshopBookedCount(workshopId: string): number {
  return bookings.filter((b) => b.workshopId === workshopId && b.state === "confirmed").length;
}

function dayStartIso(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

function dayEndIso(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

export function buildScheduleEntries(): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];

  for (const c of classInstances) {
    entries.push({
      kind: "class",
      id: c.id,
      label: classLabel(c),
      classTypeId: c.classTypeId,
      instructorIds: [c.instructorId],
      locationId: c.locationId,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      capacity: maxCapacity(c.capacity),
      bookedCount: classBookedCount(c.id),
      eventState: computeEventState({
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        lifecycle: c.lifecycle,
      }),
      raw: c,
    });
  }

  for (const w of workshops) {
    w.days.forEach((day, idx) => {
      const startsAt = dayStartIso(day.date, day.startTime);
      const endsAt = dayEndIso(day.date, day.endTime);
      entries.push({
        kind: "workshop",
        id: `${w.id}__${day.id}`,
        label: workshopLabel(w),
        classTypeId: w.classTypeId,
        instructorIds: w.instructorIds,
        locationId: w.locationId,
        startsAt,
        endsAt,
        capacity: maxCapacity(day.capacity),
        bookedCount: workshopBookedCount(w.id),
        eventState: computeEventState({ startsAt, endsAt, lifecycle: w.lifecycle }),
        raw: w,
        tiers: w.tiers,
        day,
        dayIndex: idx + 1,
        dayCount: w.days.length,
      });
    });
  }

  for (const s of ptSessions) {
    if (s.lifecycle !== "active") continue;
    entries.push({
      kind: "pt",
      id: s.id,
      label: ptLabel(s),
      classTypeId: null,
      instructorIds: [s.instructorId],
      locationId: s.locationId,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      capacity: maxCapacity(s.capacity),
      bookedCount: s.clientIds.length,
      eventState: computeEventState({
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        lifecycle: "active",
      }),
      raw: s,
    });
  }

  entries.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return entries;
}

export function instructorName(id: string): string {
  return instructors.find((i) => i.id === id)?.name ?? "Unknown";
}

export function locationName(id: string | null): string {
  if (!id) return "—";
  return locations.find((l) => l.id === id)?.name ?? "Unknown";
}

export function classTypeName(id: string | null): string {
  if (!id) return "—";
  return classTypes.find((c) => c.id === id)?.name ?? "Unknown";
}
