/**
 * How the workshop form's wall-clock fields meet the instants the API stores,
 * and back. Every date and time typed into the form (a day's date and its two
 * times, a tier's early-bird cutoff) is a wall time at the studio, whatever zone
 * the browser is in, and every stored instant is shown the same way. The zone
 * is an argument (`useStudioZone()`); nothing here reads the browser's.
 */
import type { WorkshopDay } from "@/types";
import { atLocalTime } from "./local-day";
import { daysBetween, localClock, localDate } from "./studio-time";

export type WorkshopMode = "range" | "individual";

/** One consecutive run of days is a Date range; anything with a gap is Individual dates. */
export function inferMode(days: WorkshopDay[]): WorkshopMode {
  if (days.length <= 1) return "range";
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(sorted[i - 1]!.date, sorted[i]!.date) !== 1) return "individual";
  }
  return "range";
}

/** A form day's date and times as the instants the API takes. */
export function dayToApi(timezone: string, d: Pick<WorkshopDay, "date" | "startTime" | "endTime">) {
  return {
    starts_at: atLocalTime(timezone, d.date, d.startTime).toISOString(),
    ends_at: atLocalTime(timezone, d.date, d.endTime).toISOString(),
  };
}

/** A stored day's instants as the form's date and times, on the studio's clock. */
export function dayFromApi(timezone: string, startsAt: string, endsAt: string) {
  return {
    date: localDate(timezone, startsAt),
    startTime: localClock(timezone, startsAt),
    endTime: localClock(timezone, endsAt),
  };
}

/** The value a `datetime-local` input holds for a stored cutoff: the studio's wall time, `YYYY-MM-DDTHH:mm`. */
export function cutoffInputValue(timezone: string, iso: string | null): string {
  return iso ? `${localDate(timezone, iso)}T${localClock(timezone, iso)}` : "";
}

/** The instant for what was typed into a `datetime-local` input, read as a wall time at the studio; null when blank or not a time. */
export function cutoffFromInput(timezone: string, value: string): string | null {
  const [day, time] = value.split("T");
  if (!day || !time) return null;
  const at = atLocalTime(timezone, day, time.slice(0, 5));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
