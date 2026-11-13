import type { ScheduleEntry } from "./schedule-entry";

/**
 * Whose timetable an Instructor's schedule page draws: their own (My schedule)
 * or the studio's whole one (Full studio schedule) — every instructor's
 * classes, private sessions, workshops and corporate sessions with their booked
 * counts, so a slot can be picked knowing what else is on.
 */
export type ScheduleScope = "mine" | "studio";

export const SCOPE_OPTIONS: { val: ScheduleScope; label: string }[] = [
  { val: "mine", label: "My schedule" },
  { val: "studio", label: "Full studio schedule" },
];

/** A scope kept for the tab, or My schedule when none is or it is unreadable. */
export function parseScope(raw: string | null): ScheduleScope {
  return raw === "studio" ? "studio" : "mine";
}

/** The Full studio schedule's filters: "all" or an id. */
export interface StudioFilters {
  instructorId: string;
  locationId: string;
}

/** Whether an entry passes the Full studio schedule's Instructor and Location filters. */
export function matchesStudioFilters(e: ScheduleEntry, f: StudioFilters): boolean {
  if (f.instructorId !== "all" && !e.instructorIds.includes(f.instructorId)) return false;
  if (f.locationId !== "all" && e.locationId !== f.locationId) return false;
  return true;
}
