/**
 * The words and layout of "My practice" (`/account/practice`, #340), from
 * `GET /me/bookings/attendance`. The backend decides the timeframe, its
 * buckets, what counts as a session and every figure; this only says them and
 * lays the month out as a calendar.
 *
 * A session is a group class or a private session. Workshops are said on a
 * line of their own and never counted in.
 *
 * Pure, so `practice.test.ts` runs it under `node --test`.
 */

export type PracticePeriod = "month" | "quarter" | "year" | "all";

export interface PracticeBucket {
  /** The bucket's first day, `YYYY-MM-DD`, on the studio's calendar. */
  starts_on: string;
  attended: number;
  /** Sessions held in the bucket that have not started yet. */
  booked: number;
}

export interface PracticeData {
  period: PracticePeriod;
  from: string;
  to: string;
  attended: number;
  attended_classes: number;
  attended_pt: number;
  attended_workshops: number;
  previous_attended: number | null;
  buckets: PracticeBucket[];
  minutes: number;
  streak_weeks: number;
  /** ISO weekday (Monday 1) and start hour, 0–23; null under three sessions. */
  usual_slot: { weekday: number; hour: number } | null;
  top_class_types: { name: string; attended: number }[];
  lifetime: { attended: number; since: string | null };
  last_attended_at: string | null;
}

// Written out rather than asked of `Intl`: runtimes disagree on "Sep" and
// "Sept", and a plain date must never be shifted by the viewer's zone.
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A plain date's month, read off the string. */
const monthOf = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1]!;
const previousMonthOf = (d: string) => MONTHS[(Number(d.slice(5, 7)) + 10) % 12]!;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The big number and the words after it: "13" "sessions in September". */
export function headline(s: PracticeData): { count: number; label: string } {
  return { count: s.attended, label: `${s.attended === 1 ? "session" : "sessions"} in ${monthOf(s.from)}` };
}

/** "11 classes · 2 private sessions", leaving out a part that is zero. */
export function breakdownLine(classes: number, pt: number): string | null {
  const parts = [
    classes > 0 ? plural(classes, "class", "classes") : null,
    pt > 0 ? plural(pt, "private session", "private sessions") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "3 more than August", "Same as August", "2 fewer than August". */
export function comparisonLine(s: PracticeData): string | null {
  if (s.previous_attended === null) return null;
  const before = previousMonthOf(s.from);
  const diff = s.attended - s.previous_attended;
  if (diff === 0) return `Same as ${before}`;
  return `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than ${before}`;
}

/** "Also 1 workshop in September"; none when there were none. */
export function workshopLine(s: PracticeData): string | null {
  if (s.attended_workshops === 0) return null;
  return `Also ${plural(s.attended_workshops, "workshop", "workshops")} in ${monthOf(s.from)}`;
}

/** "13 h 45 m", "2 h", "45 m". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/** "Tue · 7am"; a dash when there is no habit yet. */
export function usualSlotLabel(slot: PracticeData["usual_slot"]): string {
  if (!slot) return "—";
  const h = slot.hour % 12 === 0 ? 12 : slot.hour % 12;
  return `${WEEKDAYS[slot.weekday - 1]} · ${h}${slot.hour < 12 ? "am" : "pm"}`;
}

export function streakLabel(current: boolean): string {
  return current ? "Weeks in a row" : "Longest run of weeks";
}

export const rangeLabel = (s: PracticeData) => `${monthOf(s.from)} ${s.from.slice(0, 4)}`;

export const emptyLine = (s: PracticeData) => `No sessions in ${monthOf(s.from)} yet.`;

/** The calendar's text equivalent: the count and the period. */
export function rhythmSummary(s: PracticeData): string {
  const booked = s.buckets.reduce((n, b) => n + b.booked, 0);
  const attended = `${plural(s.attended, "session", "sessions")} attended in ${rangeLabel(s)}`;
  return booked > 0 ? `${attended}, and ${booked} booked.` : `${attended}.`;
}

export interface MonthDay {
  date: string;
  day: number;
  attended: number;
  booked: number;
  today: boolean;
  /** After today: a day with nothing booked is drawn blank, not as an empty mat. */
  future: boolean;
}

/** ISO weekday of a plain date, Monday 1. */
function isoWeekday(d: string): number {
  const js = new Date(`${d}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
}

/**
 * The month as a calendar, Monday first: the blanks before the 1st, then a
 * cell per day with what was attended and booked on it.
 */
export function monthGrid(s: PracticeData, today: string): { leading: number; days: MonthDay[] } {
  return {
    leading: isoWeekday(s.from) - 1,
    days: s.buckets.map((b) => ({
      date: b.starts_on,
      day: Number(b.starts_on.slice(8, 10)),
      attended: b.attended,
      booked: b.booked,
      today: b.starts_on === today,
      future: b.starts_on > today,
    })),
  };
}

/**
 * "What you practised": the class types, then private sessions as one bar
 * when there are any, each as a share of the largest.
 */
export function practiceBars(s: PracticeData): { name: string; attended: number; share: number }[] {
  const rows = [...s.top_class_types];
  if (s.attended_pt > 0) rows.push({ name: s.attended_pt === 1 ? "Private session" : "Private sessions", attended: s.attended_pt });
  const max = Math.max(1, ...rows.map((r) => r.attended));
  return rows.map((r) => ({ ...r, share: r.attended / max }));
}

/** "164 sessions since March 2025", or the promise of the first. */
export function lifetimeLine(lifetime: PracticeData["lifetime"]): string {
  if (lifetime.attended === 0 || !lifetime.since) return "Your first class will show here";
  return `${plural(lifetime.attended, "session", "sessions")} since ${monthOf(lifetime.since)} ${lifetime.since.slice(0, 4)}`;
}

/** The account overview's line under the greeting; nothing before the first session. */
export function overviewLine(s: PracticeData): string | null {
  if (s.lifetime.attended === 0) return null;
  return `${plural(s.lifetime.attended, "session", "sessions")} · ${s.attended} this month`;
}

/** Today's date on the studio's calendar, as every date the app shows is. */
export function studioToday(nowMs: number): string {
  return new Date(nowMs).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}
