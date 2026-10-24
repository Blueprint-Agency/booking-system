import type { EventState } from "@/types";

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
