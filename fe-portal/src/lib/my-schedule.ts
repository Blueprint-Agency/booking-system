import type { EventState } from "@/types";
import type { ScheduleEntry } from "./schedule-entry";

export interface MyScheduleEntry {
  kind: "class" | "workshop" | "pt" | "corporate";
  id: string;
  label: string;
  subtitle: string | null;
  main_instructor_id: string | null;
  instructor_ids: string[];
  location_id: string | null;
  room_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  booked_count: number | null;
  waiting: number | null;
  event_state: EventState;
}

export interface MyScheduleViewer {
  staffId: string | null;
  canScheduleClasses: boolean;
}

export interface MyScheduleRow {
  href: string | null;
  cancelled: boolean;
  canCancel: boolean;
}

export function myScheduleRow(e: MyScheduleEntry, viewer: MyScheduleViewer): MyScheduleRow {
  const me = viewer.staffId;
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
    canCancel: viewer.canScheduleClasses && leadsClass && !cancelled && e.event_state !== "completed",
  };
}

/**
 * Where an entry on an Instructor's calendar opens: the same pages as the list
 * (`myScheduleRow`), a class they lead or a private session they run. A class
 * they support, a workshop or a corporate session shows on the calendar but
 * has no Instructor page to open.
 */
export function myCalendarHref(e: ScheduleEntry, staffId: string | null): string | null {
  if (staffId === null) return null;
  if (e.kind === "class" && e.mainInstructorId === staffId) return `/instructor/schedule/class/${e.id}`;
  if (e.kind === "pt" && e.instructorIds.includes(staffId)) return `/instructor/schedule/pt/${e.id}`;
  return null;
}
