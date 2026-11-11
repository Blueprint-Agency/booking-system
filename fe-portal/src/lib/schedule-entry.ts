import type { EventState } from "@/types";

/**
 * A timetable entry: the wire shape both portals' `GET /schedule` answer
 * (be/src/routes/portal/timetable-read.ts) and the shape the calendar draws.
 */

export type ScheduleKind = "class" | "workshop" | "pt" | "corporate";

export interface ApiScheduleEntry {
  kind: ScheduleKind;
  id: string;
  workshop_id: string | null;
  label: string;
  subtitle: string | null;
  class_type_id: string | null;
  main_instructor_id: string | null;
  supporting_instructor_ids: string[];
  instructor_ids: string[];
  location_id: string | null;
  room_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  booked_count: number | null;
  /** How many are in a class's waitlist; null for every other kind. */
  waiting?: number | null;
  event_state: EventState;
  day_index: number | null;
  day_count: number | null;
  /** The Class Series a class was created by; null for anything else, and absent on the Instructor's timetable. */
  series_id?: string | null;
}

/**
 * Shape consumed by the schedule UI. `raw` only carries what the renderer
 * needs (the workshop link uses `raw.id` for workshops).
 */
export type ScheduleEntry =
  | {
      kind: "class";
      id: string;
      label: string;
      classTypeId: string;
      /** Who leads it: an Instructor opens only the classes they lead. */
      mainInstructorId: string | null;
      instructorIds: string[];
      locationId: string;
      startsAt: string;
      endsAt: string;
      capacity: number;
      bookedCount: number;
      /** Members in the class's waitlist; the cell shows "+N waiting". */
      waiting: number;
      eventState: EventState;
      raw: { id: string };
      seriesId: string | null;
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
      raw: { id: string };
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
      raw: { id: string };
    }
  | {
      kind: "corporate";
      id: string;
      label: string;
      subtitle: string;
      classTypeId: null;
      mainInstructorId: string;
      supportingInstructorIds: string[];
      instructorIds: string[];
      locationId: string;
      roomId: string | null;
      startsAt: string;
      endsAt: string;
      capacity: null;
      bookedCount: null;
      eventState: EventState;
      raw: { id: string };
    };

export function scheduleEntryFromApi(e: ApiScheduleEntry): ScheduleEntry {
  if (e.kind === "class") {
    return {
      kind: "class",
      id: e.id,
      label: e.label,
      classTypeId: e.class_type_id ?? "",
      mainInstructorId: e.main_instructor_id,
      instructorIds: e.instructor_ids,
      locationId: e.location_id ?? "",
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      capacity: e.capacity ?? 0,
      bookedCount: e.booked_count ?? 0,
      waiting: e.waiting ?? 0,
      eventState: e.event_state,
      raw: { id: e.id },
      seriesId: e.series_id ?? null,
    };
  }
  if (e.kind === "workshop") {
    return {
      kind: "workshop",
      id: e.id,
      label: e.label,
      classTypeId: e.class_type_id ?? "",
      instructorIds: e.instructor_ids,
      locationId: e.location_id ?? "",
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      capacity: e.capacity ?? 0,
      bookedCount: e.booked_count ?? 0,
      eventState: e.event_state,
      raw: { id: e.workshop_id ?? e.id },
      dayIndex: e.day_index ?? 1,
      dayCount: e.day_count ?? 1,
    };
  }
  if (e.kind === "corporate") {
    return {
      kind: "corporate",
      id: e.id,
      label: e.label,
      subtitle: e.subtitle ?? "",
      classTypeId: null,
      mainInstructorId: e.main_instructor_id ?? "",
      supportingInstructorIds: e.supporting_instructor_ids ?? [],
      instructorIds: e.instructor_ids,
      locationId: e.location_id ?? "",
      roomId: e.room_id,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      capacity: null,
      bookedCount: null,
      eventState: e.event_state,
      raw: { id: e.id },
    };
  }
  return {
    kind: "pt",
    id: e.id,
    label: e.label,
    classTypeId: null,
    instructorIds: e.instructor_ids,
    locationId: e.location_id,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    capacity: e.capacity ?? 0,
    bookedCount: e.booked_count ?? 0,
    eventState: e.event_state,
    raw: { id: e.id },
  };
}
