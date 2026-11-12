import type { ScheduleEntry } from "./schedule-entry";

export interface MyScheduleViewer {
  staffId: string | null;
  canScheduleClasses: boolean;
}

export interface MyScheduleRow {
  href: string | null;
  cancelled: boolean;
  canCancel: boolean;
}

/**
 * What an Instructor can do with an entry on My schedule, on the calendar and
 * in the List alike: open a class they lead or a private session they run, and
 * cancel a class they lead that has not finished, with Schedule classes on. A
 * class they support, a workshop or a corporate session shows but opens nothing.
 */
export function myScheduleRow(e: ScheduleEntry, viewer: MyScheduleViewer): MyScheduleRow {
  const me = viewer.staffId;
  const leadsClass = e.kind === "class" && me !== null && e.mainInstructorId === me;
  const runsPt = e.kind === "pt" && me !== null && e.instructorIds.includes(me);
  const cancelled = e.eventState === "cancelled";
  return {
    href: leadsClass
      ? `/instructor/schedule/class/${e.id}`
      : runsPt
        ? `/instructor/schedule/pt/${e.id}`
        : null,
    cancelled,
    canCancel: viewer.canScheduleClasses && leadsClass && !cancelled && e.eventState !== "completed",
  };
}

/** Where an entry on an Instructor's calendar opens (`myScheduleRow`), or null. */
export function myCalendarHref(e: ScheduleEntry, staffId: string | null): string | null {
  return myScheduleRow(e, { staffId, canScheduleClasses: false }).href;
}
