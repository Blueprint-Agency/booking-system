/**
 * How the workshops page lays out its list: what is running now first, then
 * what is coming, a month at a time, then anything still without a date. A
 * workshop that has ended is left out, because there is nothing left to book.
 *
 * Months are the studio's calendar months (Singapore time, as every date on
 * the page is shown), so a workshop starting just after midnight on the 1st
 * sits in the month its date says.
 */

const STUDIO_TZ = "Asia/Singapore";

export interface WorkshopTiming {
  starts_at: string | null;
  ends_at: string | null;
}

export interface WorkshopGroup<T> {
  /** Stable across renders: "now", "tba", or the month as "YYYY-MM". */
  key: string;
  label: string;
  items: T[];
}

/** A workshop's own end, or its start when it has no end. */
function lastMoment(w: WorkshopTiming): number | null {
  const at = w.ends_at ?? w.starts_at;
  return at ? new Date(at).getTime() : null;
}

export function isEnded(w: WorkshopTiming, nowMs: number): boolean {
  const last = lastMoment(w);
  return last !== null && last < nowMs;
}

export function isHappeningNow(w: WorkshopTiming, nowMs: number): boolean {
  if (!w.starts_at || isEnded(w, nowMs)) return false;
  return new Date(w.starts_at).getTime() <= nowMs;
}

function monthParts(ms: number): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-SG", {
    year: "numeric",
    month: "numeric",
    timeZone: STUDIO_TZ,
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month") };
}

function monthLabel(ms: number, nowMs: number): string {
  const at = monthParts(ms);
  const now = monthParts(nowMs);
  if (at.year === now.year && at.month === now.month) return "This month";
  const name = new Date(ms).toLocaleDateString("en-SG", { month: "long", timeZone: STUDIO_TZ });
  return at.year === now.year ? name : `${name} ${at.year}`;
}

export function groupWorkshops<T extends WorkshopTiming>(
  workshops: readonly T[],
  nowMs: number,
): WorkshopGroup<T>[] {
  const byStart = (a: T, b: T) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime();

  const now: T[] = [];
  const tba: T[] = [];
  const upcoming: T[] = [];
  for (const w of workshops) {
    if (!w.starts_at) tba.push(w);
    else if (isEnded(w, nowMs)) continue;
    else if (isHappeningNow(w, nowMs)) now.push(w);
    else upcoming.push(w);
  }

  const groups: WorkshopGroup<T>[] = [];
  if (now.length) groups.push({ key: "now", label: "Happening now", items: now.sort(byStart) });

  for (const w of upcoming.sort(byStart)) {
    const ms = new Date(w.starts_at!).getTime();
    const { year, month } = monthParts(ms);
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(w);
    else groups.push({ key, label: monthLabel(ms, nowMs), items: [w] });
  }

  if (tba.length) groups.push({ key: "tba", label: "Dates to be announced", items: tba });
  return groups;
}
