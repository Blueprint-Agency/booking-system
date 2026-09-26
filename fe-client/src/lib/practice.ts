/**
 * The words and layout of the member's "Your practice" card (#317), from
 * `GET /me/bookings/attendance`. The backend decides the timeframe, its
 * buckets and every count; this only says them.
 *
 * Pure, so `practice.test.ts` runs it under `node --test`.
 */

export type PracticePeriod = "month" | "quarter" | "year" | "all";

export const PRACTICE_PERIODS: { value: PracticePeriod; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "quarter", label: "3 months" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
];

export interface PracticeBucket {
  /** The bucket's first day, `YYYY-MM-DD`, on the studio's calendar. */
  starts_on: string;
  attended: number;
}

export interface PracticeData {
  period: PracticePeriod;
  from: string;
  to: string;
  attended: number;
  previous_attended: number | null;
  buckets: PracticeBucket[];
  top_class_types: { name: string; attended: number }[];
  last_attended_at: string | null;
}

/** Holes a column shows before it says "+n". */
export const HOLES_PER_COLUMN = 8;

const BEFORE: Record<Exclude<PracticePeriod, "all">, string> = {
  month: "last month",
  quarter: "the 3 months before",
  year: "last year",
};

/** "3 more than last month", "Same as last month", "2 fewer than last month". */
export function comparisonLine(period: PracticePeriod, attended: number, previous: number | null): string | null {
  if (period === "all" || previous === null) return null;
  const before = BEFORE[period];
  const diff = attended - previous;
  if (diff === 0) return `Same as ${before}`;
  return `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than ${before}`;
}

export function classNoun(n: number): string {
  return n === 1 ? "class" : "classes";
}

export function classesCount(n: number): string {
  return `${n} ${classNoun(n)}`;
}

/** How a column of `attended` is punched. */
export function punches(attended: number): { holes: number; more: number } {
  const holes = Math.min(attended, HOLES_PER_COLUMN);
  return { holes, more: attended - holes };
}

// Written out rather than asked of `Intl`: runtimes disagree on "Sep" and
// "Sept", and a column label has no room for the difference.
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

/** A plain date's month, read off the string — never shifted by the viewer's zone. */
const month = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1]!;
const shortMonth = (d: string) => month(d).slice(0, 3);
const dayMonth = (d: string) => `${Number(d.slice(8, 10))} ${shortMonth(d)}`;

/**
 * The small label under each column. Three months of weeks is thirteen or so
 * columns, too narrow for "7 Sep" under each, so it names each month once, at
 * its first week, and leaves the rest blank.
 */
export function bucketLabels(period: PracticePeriod, buckets: PracticeBucket[]): (string | null)[] {
  switch (period) {
    case "month":
      return buckets.map((b) => dayMonth(b.starts_on));
    case "quarter":
      return buckets.map((b, i) =>
        i === 0 || b.starts_on.slice(0, 7) !== buckets[i - 1]!.starts_on.slice(0, 7)
          ? shortMonth(b.starts_on)
          : null,
      );
    case "year":
      return buckets.map((b) => shortMonth(b.starts_on));
    case "all":
      return buckets.map((b) => b.starts_on.slice(0, 4));
  }
}

/** The band for a screen reader: one line per bucket, with its count. */
export function bandSummary(period: PracticePeriod, buckets: PracticeBucket[]): string[] {
  const name = (d: string) =>
    period === "month" || period === "quarter"
      ? `Week of ${dayMonth(d)}`
      : period === "year"
        ? month(d)
        : d.slice(0, 4);
  return buckets.map((b) => `${name(b.starts_on)}: ${b.attended === 0 ? "no classes" : classesCount(b.attended)}`);
}

const EMPTY: Record<PracticePeriod, string> = {
  month: "this month",
  quarter: "in the last 3 months",
  year: "this year",
  all: "yet",
};

export function emptyLine(period: PracticePeriod): string {
  return `No classes attended ${EMPTY[period]}.`;
}

/** "Last class Fri 12 Jun", in studio time like every date the app shows. */
export function lastClassLine(iso: string): string {
  const weekday = new Date(iso).toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Singapore" });
  const day = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }); // YYYY-MM-DD
  return `Last class ${weekday} ${dayMonth(day)}`;
}
