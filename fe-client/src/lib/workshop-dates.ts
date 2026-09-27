/**
 * A workshop's dates as a member reads them, always with the year:
 *
 *   one day                  "Fri, 5 Mar 2027"
 *   consecutive days         "Fri, 5 – Sun, 7 Mar 2027"
 *   across a month           "Sat, 30 Mar – Mon, 1 Apr 2027"
 *   days with gaps between   "Sat, 15 – Sun, 16 Aug · Sat, 22 – Sun, 23 Aug 2026"
 *
 * Dates are the studio's (Singapore time), so a day starting just after
 * midnight there is the date its own calendar says, on any device.
 */

const STUDIO_TZ = "Asia/Singapore";

type PlainDate = { y: number; m: number; d: number };

/** An instant's calendar day in Singapore. */
function studioDate(iso: string): PlainDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  const [y, m, d] = parts.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

const dayNumber = (p: PlainDate) => Date.UTC(p.y, p.m - 1, p.d) / 86_400_000;

function fmt(p: PlainDate, opts: Intl.DateTimeFormatOptions): string {
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString("en-SG", { timeZone: "UTC", ...opts });
}

/** One run of consecutive days, naming the month once where both ends share it. */
function formatRun(from: PlainDate, to: PlainDate, withYear: boolean): string {
  const year = withYear ? { year: "numeric" as const } : {};
  const full = { weekday: "short" as const, day: "numeric" as const, month: "short" as const, ...year };
  if (dayNumber(from) === dayNumber(to)) return fmt(from, full);
  const sameMonth = from.y === to.y && from.m === to.m;
  const sameYear = from.y === to.y;
  // Built by hand: Intl drops the comma when a weekday stands beside a bare day.
  const head = sameMonth
    ? `${fmt(from, { weekday: "short" })}, ${from.d}`
    : fmt(from, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : year) });
  return `${head} – ${fmt(to, full)}`;
}

/**
 * `dayStarts` are the starts of the workshop's days, when known: they show
 * where the gaps are. Without them the workshop reads as one run from its
 * start to its end.
 */
export function formatWorkshopDates(
  startsAt: string | null,
  endsAt: string | null,
  dayStarts?: string[],
): string {
  if (!startsAt) return "TBA";

  let runs: [PlainDate, PlainDate][];
  if (dayStarts && dayStarts.length > 0) {
    const dates = [...new Map(dayStarts.map((s) => studioDate(s)).map((p) => [dayNumber(p), p])).entries()]
      .sort(([a], [b]) => a - b)
      .map(([, p]) => p);
    runs = [];
    for (const p of dates) {
      const last = runs[runs.length - 1];
      if (last && dayNumber(p) === dayNumber(last[1]) + 1) last[1] = p;
      else runs.push([p, p]);
    }
  } else {
    const from = studioDate(startsAt);
    const to = endsAt ? studioDate(endsAt) : from;
    runs = [[from, dayNumber(to) < dayNumber(from) ? from : to]];
  }

  // One year for the lot: named once, at the end. Otherwise each run its own.
  const oneYear = runs.every(([a, b]) => a.y === runs[0]![0].y && b.y === runs[0]![0].y);
  if (!oneYear) return runs.map(([a, b]) => formatRun(a, b, true)).join(" · ");
  const text = runs.map(([a, b]) => formatRun(a, b, false)).join(" · ");
  return `${text} ${runs[0]![0].y}`;
}
