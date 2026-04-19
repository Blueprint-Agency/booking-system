import { RRule, rrulestr, Weekday } from "rrule";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// JS day-of-week (0=Sun..6=Sat) → RRule Weekday (MO..SU; 0=Mon..6=Sun)
function jsDayToRRuleWeekday(d: number): Weekday {
  const map: Weekday[] = [
    RRule.SU,
    RRule.MO,
    RRule.TU,
    RRule.WE,
    RRule.TH,
    RRule.FR,
    RRule.SA,
  ];
  return map[d];
}

function rruleWeekdayToJsDay(w: Weekday): number {
  // RRule.MO.weekday === 0, SU === 6
  const map: Record<number, number> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 0 };
  return map[w.weekday];
}

export function parseRRule(str: string): RRule {
  const r = rrulestr(str);
  if (r instanceof RRule) return r;
  throw new Error("Expected single RRULE, got RRuleSet");
}

export function formatRRule(r: RRule): string {
  const opts = r.options;
  if (opts.freq !== RRule.WEEKLY) {
    return r.toText();
  }
  const days = (opts.byweekday ?? []).map((w) => rruleWeekdayToJsDay(typeof w === "number" ? new Weekday(w) : (w as Weekday)));
  if (days.length === 0) return "Weekly";
  const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const labels = sorted.map((d) => WEEKDAY_LABELS[d]).join(", ");
  let out = `Every ${labels}`;
  if (opts.count) {
    out += ` · ${opts.count} occurrences`;
  } else if (opts.until) {
    const u = opts.until;
    out += ` · until ${u.getUTCFullYear()}-${String(u.getUTCMonth() + 1).padStart(2, "0")}-${String(u.getUTCDate()).padStart(2, "0")}`;
  }
  return out;
}

export function expandOccurrences(r: RRule, start: Date, end: Date): Date[] {
  return r.between(start, end, true);
}

export interface BuildWeeklyOptions {
  days: number[]; // JS day-of-week: 0=Sun..6=Sat
  count?: number;
  until?: Date;
  dtstart?: Date;
}

export function buildWeeklyRRule(opts: BuildWeeklyOptions): string {
  const byweekday = opts.days.map(jsDayToRRuleWeekday);
  const r = new RRule({
    freq: RRule.WEEKLY,
    byweekday,
    count: opts.count,
    until: opts.until,
    dtstart: opts.dtstart,
  });
  // Strip DTSTART line; we want just the RRULE clause.
  const str = r.toString();
  const lines = str.split("\n").filter((l) => l.startsWith("RRULE:"));
  if (lines.length === 0) {
    return str.replace(/^RRULE:/, "");
  }
  return lines[0].replace(/^RRULE:/, "");
}

export const WEEKDAY_OPTIONS: { value: number; label: string; short: string }[] = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 0, label: "Sunday", short: "Sun" },
];
