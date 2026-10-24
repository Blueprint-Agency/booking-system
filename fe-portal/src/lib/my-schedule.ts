// An Instructor's My schedule: one row per class, workshop, private or
// corporate session they teach. Shapes mirror the instructor schedule read in
// be/src/routes/portal/instructor/schedule.ts.

import type { EventState } from "@/types";

export interface MyScheduleEntry {
  kind: "class" | "workshop" | "pt" | "corporate";
  id: string;
  label: string;
  subtitle: string | null;
  main_instructor_id: string | null;
  /** Everyone teaching it; a private session's one instructor is here, not above. */
  instructor_ids: string[];
  location_id: string | null;
  room_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  booked_count: number | null;
  /** How many are in a class's waitlist; null for every other kind. */
  waiting: number | null;
  event_state: EventState;
}

export interface MyScheduleViewer {
  staffId: string | null;
  /** The Schedule classes permission: New class, Repeat weekly and Cancel. */
  canSchedule: boolean;
}

export interface MyScheduleRow {
  /** The session page the label opens, or null when it is not theirs to run. */
  href: string | null;
  cancelled: boolean;
  canCancel: boolean;
}

export function myScheduleRow(e: MyScheduleEntry, viewer: MyScheduleViewer): MyScheduleRow {
  const me = viewer.staffId;
  // Supporting on someone else's class grants neither its page nor its cancel.
  const leadsClass = e.kind === "class" && me !== null && e.main_instructor_id === me;
  const runsPt = e.kind === "pt" && me !== null && e.instructor_ids.includes(me);
  const cancelled = e.event_state === "cancelled";
  return {
    href: leadsClass
      ? `/instructor/schedule/class/${e.id}`
      : runsPt
        ? `/instructor/schedule/pt/${e.id}`
        : null,
    cancelled,
    canCancel: viewer.canSchedule && leadsClass && !cancelled && e.event_state !== "completed",
  };
}
