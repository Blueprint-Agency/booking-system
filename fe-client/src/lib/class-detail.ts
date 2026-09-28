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
 * Where the seats stand: free, or, full, whether the line is open. Never a
 * count — how many seats a class has, or how many wait for one, is the
 * studio's. The line is only mentioned where the studio runs one.
 */
export function seatsLine(hasSeats: boolean, waitlist: Pick<ApiClassWaitlist, "enabled" | "open">): string {
  if (hasSeats) return "Available";
  if (!waitlist.enabled) return "Full";
  return waitlist.open ? "Full · waitlist open" : "Full · waitlist closed";
}
