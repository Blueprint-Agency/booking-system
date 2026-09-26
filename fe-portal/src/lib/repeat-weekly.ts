// The class screen's Repeat weekly switch (admin and instructor): on, the
// screen describes a Class Series instead of one class. What a series is and
// its API live in lib/series.ts; this module is only the screen's own rules,
// and imports nothing, so the server-side redirect from the retired series
// screen can use it.

/**
 * The class screen's submit: "Create class", or with Repeat weekly on, how many
 * classes the click makes once the dates are previewed (`null` before then).
 */
export function createClassesLabel(repeat: boolean, count: number | null): string {
  if (!repeat) return "Create class";
  if (count === null) return "Create classes";
  return `Create ${count} ${count === 1 ? "class" : "classes"}`;
}

/** Days one create or extend may span; be/src/services/schedule/series.ts MAX_RANGE_DAYS. */
const MAX_RANGE_DAYS = 366;

/**
 * The latest last date for a first date: one year on, as far as one create may
 * reach. "" (no limit) until there is a first date.
 */
export function lastDateLimit(firstDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) return "";
  const d = new Date(`${firstDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + MAX_RANGE_DAYS - 1);
  return d.toISOString().slice(0, 10);
}

const REPEAT_PARAM = "repeat";

/** Where the retired series screen's URL goes: the class screen, Repeat weekly on, slot kept. */
export function repeatWeeklyHref(params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.set(REPEAT_PARAM, "weekly");
  return `/admin/schedule/new/class?${next.toString()}`;
}

/** Whether the class screen opens with Repeat weekly on. */
export function repeatWeeklyFromParams(params: URLSearchParams): boolean {
  return params.get(REPEAT_PARAM) === "weekly";
}
