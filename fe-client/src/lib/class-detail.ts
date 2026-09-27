/**
 * What the class detail overlay says about a class that the schedule row has
 * no room for: how long it runs, and where its seats and line stand. Pure, so
 * each line can be tested against the class that produces it.
 */
import type { ApiClassWaitlist } from "./waitlist.ts";

const MINUTE_MS = 60_000;

/** "60 min", "1 hr 30 min", "2 hr" — from the class's own start and end. */
export function classLength(startsAt: string, endsAt: string): string {
  const minutes = Math.max(0, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / MINUTE_MS));
  if (minutes <= 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * Where the seats stand: how many are left, or, full, whether the line is open
 * and how long it is. The line is only mentioned where the studio runs one.
 */
export function seatsLine(spotsLeft: number, waitlist: Pick<ApiClassWaitlist, "enabled" | "open" | "waiting">): string {
  if (spotsLeft > 0) return `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`;
  if (!waitlist.enabled) return "Full";
  if (!waitlist.open) return "Full · waitlist closed";
  return waitlist.waiting > 0 ? `Full · waitlist open, ${waitlist.waiting} waiting` : "Full · waitlist open";
}
