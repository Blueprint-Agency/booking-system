// How the leave calendar lays absences out: one bar per absence per week row,
// stacked into lanes, and one colour per person. Pure — every date here is a
// plain `YYYY-MM-DD`, compared and counted without ever becoming an instant, so
// no timezone can shift a bar by a day.

export interface LaidOutAbsence {
  staff: { id: string; name: string };
  start_date: string;
  end_date: string;
}

export interface WeekSegment<E extends LaidOutAbsence> {
  entry: E;
  /** 0 = Monday. */
  startCol: number;
  span: number;
  /** The absence began before this week — the bar's left end is cut, not rounded. */
  continuesBefore: boolean;
  /** The absence runs on past this week. */
  continuesAfter: boolean;
  lane: number;
}

export interface WeekLayout<E extends LaidOutAbsence> {
  /** Only the segments in a shown lane. */
  segments: WeekSegment<E>[];
  /** How many lanes are drawn: every lane used, capped at `maxLanes`. */
  laneCount: number;
  /** Per weekday, how many absences on that day fell below the cap. */
  hidden: number[];
}

const DAY_MS = 86_400_000;

function utc(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function dayDiff(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

/**
 * Lay one week out. Absences are stacked in the order they began, the longer
 * first on the same day, each in the lowest lane free for all of its days — so
 * an absence carried over from last week sits at the top, where it was. Anyone
 * named in `first` is laid out before everyone else, so a person picked out on
 * the roster is never the one pushed under the cap.
 */
export function layoutWeek<E extends LaidOutAbsence>(
  entries: readonly E[],
  weekStart: string,
  opts: { maxLanes?: number; first?: string | null } = {},
): WeekLayout<E> {
  const maxLanes = opts.maxLanes ?? Infinity;
  const inWeek = entries
    .map((entry) => ({
      entry,
      from: dayDiff(weekStart, entry.start_date),
      to: dayDiff(weekStart, entry.end_date),
    }))
    .filter((s) => s.to >= 0 && s.from <= 6)
    .sort(
      (a, b) =>
        Number(b.entry.staff.id === opts.first) - Number(a.entry.staff.id === opts.first) ||
        a.from - b.from ||
        b.to - a.to ||
        a.entry.staff.name.localeCompare(b.entry.staff.name),
    );

  // lanes[l][col] — whether that lane is taken on that weekday.
  const lanes: boolean[][] = [];
  const hidden = [0, 0, 0, 0, 0, 0, 0];
  const segments: WeekSegment<E>[] = [];

  for (const s of inWeek) {
    const startCol = Math.max(0, s.from);
    const endCol = Math.min(6, s.to);
    let lane = 0;
    while (lanes[lane]?.slice(startCol, endCol + 1).some(Boolean)) lane++;
    lanes[lane] ??= [false, false, false, false, false, false, false];
    for (let c = startCol; c <= endCol; c++) lanes[lane][c] = true;

    if (lane >= maxLanes) {
      for (let c = startCol; c <= endCol; c++) hidden[c]++;
      continue;
    }
    segments.push({
      entry: s.entry,
      startCol,
      span: endCol - startCol + 1,
      continuesBefore: s.from < 0,
      continuesAfter: s.to > 6,
      lane,
    });
  }

  return { segments, laneCount: Math.min(lanes.length, maxLanes), hidden };
}

/**
 * Hues far enough apart to tell people apart at a glance, ordered so that
 * neighbours differ — a clash probes to the next one.
 */
export const PERSON_PALETTE = [
  "#3b5bdb", // blue
  "#e8590c", // orange
  "#0c8599", // teal
  "#c2255c", // raspberry
  "#2f9e44", // green
  "#7048e8", // violet
  "#b8860b", // goldenrod
  "#ae3ec9", // magenta
  "#5c940d", // olive
  "#8b5a2b", // brown
  "#495057", // graphite
] as const;

function hash(s: string): number {
  // FNV-1a: stable across sessions, so a person keeps their colour.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A colour for each person, no two alike. Each person starts from the palette
 * slot their id hashes to, so they keep the same colour from month to month
 * unless someone else in view already holds it. Past the palette, hues are
 * spread by the golden angle.
 */
export function personColours(staffIds: Iterable<string>): Map<string, string> {
  const ids = [...new Set(staffIds)].sort();
  const taken = new Set<number>();
  const out = new Map<string, string>();
  let extra = 0;
  for (const id of ids) {
    if (taken.size >= PERSON_PALETTE.length) {
      out.set(id, `hsl(${Math.round((extra++ * 137.508 + 17) % 360)} 55% 42%)`);
      continue;
    }
    let slot = hash(id) % PERSON_PALETTE.length;
    while (taken.has(slot)) slot = (slot + 1) % PERSON_PALETTE.length;
    taken.add(slot);
    out.set(id, PERSON_PALETTE[slot]);
  }
  return out;
}
