/**
 * The words and layout of "My practice" (`/account/practice`, #340), from
 * `GET /me/bookings/attendance`. The backend decides the timeframe, its
 * buckets, what counts as a session, how far back and forward the member can
 * step and every figure; this only says them and lays the week out as seven
 * days, the month as a calendar and the year as twelve columns.
 *
 * A period is current while there is no later one to step to (`has_next`).
 *
 * A session is a group class or a private session. Workshops are said on a
 * line of their own and never counted in.
 *
 * Pure, so `practice.test.ts` runs it under `node --test`.
 */

export type PracticePeriod = "week" | "month" | "quarter" | "year" | "all";

/** A session in a week, attended or still to come. */
export interface PracticeSession {
  kind: "class" | "pt";
  /** The class type's name, or "Private session". */
  name: string;
  starts_at: string;
  status: "attended" | "booked";
}

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
  /** An earlier period to step back to, and a later one (none past today's). */
  has_previous: boolean;
  has_next: boolean;
  attended: number;
  attended_classes: number;
  attended_pt: number;
  attended_workshops: number;
  previous_attended: number | null;
  buckets: PracticeBucket[];
  /** `week` alone: its sessions, oldest first. */
  sessions?: PracticeSession[];
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
const yearOf = (d: string) => d.slice(0, 4);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Whether the period is the one containing today: there is no later one to step to. */
export const isCurrent = (s: PracticeData) => !s.has_next;

/** The period as the end of a sentence: "this week", "that week", "in September", "in 2026". */
function inPeriod(s: PracticeData): string {
  if (s.period === "week") return isCurrent(s) ? "this week" : "that week";
  if (s.period === "year") return `in ${yearOf(s.from)}`;
  return `in ${monthOf(s.from)}`;
}

/** What the period is compared with: "last week", "the week before", "August", "2025". */
function periodBefore(s: PracticeData): string {
  if (s.period === "week") return isCurrent(s) ? "last week" : "the week before";
  if (s.period === "year") return String(Number(yearOf(s.from)) - 1);
  return previousMonthOf(s.from);
}

/** The big number and the words after it: "13" "sessions in September". */
export function headline(s: PracticeData): { count: number; label: string } {
  return { count: s.attended, label: `${s.attended === 1 ? "session" : "sessions"} ${inPeriod(s)}` };
}

/** "11 classes · 2 private sessions", leaving out a part that is zero. */
export function breakdownLine(classes: number, pt: number): string | null {
  const parts = [
    classes > 0 ? plural(classes, "class", "classes") : null,
    pt > 0 ? plural(pt, "private session", "private sessions") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "3 more than last week", "Same as August", "2 fewer than 2025". */
export function comparisonLine(s: PracticeData): string | null {
  if (s.previous_attended === null) return null;
  const before = periodBefore(s);
  const diff = s.attended - s.previous_attended;
  if (diff === 0) return `Same as ${before}`;
  return `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than ${before}`;
}

/** "Also 1 workshop in September"; none when there were none. */
export function workshopLine(s: PracticeData): string | null {
  if (s.attended_workshops === 0) return null;
  return `Also ${plural(s.attended_workshops, "workshop", "workshops")} ${inPeriod(s)}`;
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

/** "3 Sep", from a plain date. */
const dayMonth = (d: string) => `${Number(d.slice(8, 10))} ${monthOf(d).slice(0, 3)}`;

/**
 * The period's dates: "21 – 27 Sep", "28 Sep – 4 Oct", "29 Dec 2025 – 4 Jan
 * 2026" for a week; "September 2026"; "2026".
 */
export function rangeLabel(s: PracticeData): string {
  if (s.period === "year") return yearOf(s.from);
  if (s.period !== "week") return `${monthOf(s.from)} ${yearOf(s.from)}`;
  if (yearOf(s.from) !== yearOf(s.to)) return `${dayMonth(s.from)} ${yearOf(s.from)} – ${dayMonth(s.to)} ${yearOf(s.to)}`;
  if (s.from.slice(5, 7) !== s.to.slice(5, 7)) return `${dayMonth(s.from)} – ${dayMonth(s.to)}`;
  return `${Number(s.from.slice(8, 10))} – ${dayMonth(s.to)}`;
}

/**
 * The day to ask for when stepping back (-1) or forward (1): the day before
 * this period opens, or the day after it closes. Whether there is a period
 * there is the backend's to say (`has_previous`, `has_next`).
 */
export function stepAnchor(s: PracticeData, direction: -1 | 1): string {
  const edge = new Date(`${direction < 0 ? s.from : s.to}T00:00:00Z`);
  edge.setUTCDate(edge.getUTCDate() + direction);
  return edge.toISOString().slice(0, 10);
}

/** "No sessions this week yet." — or, for a period that has passed, "No sessions in August." */
export const emptyLine = (s: PracticeData) => `No sessions ${inPeriod(s)}${isCurrent(s) ? " yet" : ""}.`;

/** The chart's text equivalent: the count and the period. */
export function rhythmSummary(s: PracticeData): string {
  const booked = s.buckets.reduce((n, b) => n + b.booked, 0);
  const period = s.period === "week" ? `the week of ${rangeLabel(s)}` : rangeLabel(s);
  const attended = `${plural(s.attended, "session", "sessions")} attended in ${period}`;
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

export interface WeekDay {
  date: string;
  /** "Mon" … "Sun". */
  weekday: string;
  attended: number;
  booked: number;
  today: boolean;
  /** After today: a day with nothing booked is drawn blank. */
  future: boolean;
}

/** The week's seven days, Monday first, each with what was attended and booked on it. */
export function weekDays(s: PracticeData, today: string): WeekDay[] {
  return s.buckets.map((b) => ({
    date: b.starts_on,
    weekday: WEEKDAYS[isoWeekday(b.starts_on) - 1]!,
    attended: b.attended,
    booked: b.booked,
    today: b.starts_on === today,
    future: b.starts_on > today,
  }));
}

// A session's weekday and start on the studio's clock, as every time the app shows is.
const STUDIO_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Singapore",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Mon" and "7:00am" for an instant, on the studio's clock. */
function studioStart(iso: string): { day: string; time: string } {
  const parts = Object.fromEntries(STUDIO_CLOCK.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return { day: parts.weekday!, time: `${h}:${parts.minute}${hour < 12 ? "am" : "pm"}` };
}

/** The week's sessions as its list reads them: "Mon · Vinyasa Flow", "7:00am", booked ones marked. */
export function weekSessions(
  s: PracticeData,
): { key: string; day: string; name: string; time: string; booked: boolean }[] {
  return (s.sessions ?? []).map((session, i) => ({
    key: `${session.starts_at}-${i}`,
    ...studioStart(session.starts_at),
    name: session.name,
    booked: session.status === "booked",
  }));
}

export interface YearColumn {
  /** The month's first day. */
  month: string;
  /** "J" … "D", for the column's foot. */
  initial: string;
  name: string;
  attended: number;
  booked: number;
  /** The month today is in. */
  current: boolean;
  /** A month not yet reached: drawn empty, not as a zero. */
  future: boolean;
}

/** The year as twelve columns, a month each. */
export function yearColumns(s: PracticeData, today: string): YearColumn[] {
  const thisMonth = `${today.slice(0, 7)}-01`;
  return s.buckets.map((b) => {
    const name = monthOf(b.starts_on);
    return {
      month: b.starts_on,
      initial: name[0]!,
      name,
      attended: b.attended,
      booked: b.booked,
      current: b.starts_on === thisMonth,
      future: b.starts_on > thisMonth,
    };
  });
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
