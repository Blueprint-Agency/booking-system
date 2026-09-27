// Class Series: a weekly repeating class, defined once, that creates ordinary
// classes. Shapes mirror the /portal/{admin,instructor}/schedule/series routes
// in be/src/routes/portal/{admin,instructor}/schedule.ts. Create and extend are
// both a preview (every date with its clashes) followed by a commit of the same
// input. Staff create one from the class screen's Repeat weekly switch; only an
// admin extends or ends one.

import { ApiError, type Api } from "@/lib/api";
import { scheduleErrorMessage } from "@/lib/schedule";
import type { NamedPackageRule, PackageRuleInput } from "@/lib/package-rule";

/** ISO weekday: Monday 1 … Sunday 7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: { value: IsoWeekday; label: string; plural: string }[] = [
  { value: 1, label: "Monday", plural: "Mondays" },
  { value: 2, label: "Tuesday", plural: "Tuesdays" },
  { value: 3, label: "Wednesday", plural: "Wednesdays" },
  { value: 4, label: "Thursday", plural: "Thursdays" },
  { value: 5, label: "Friday", plural: "Fridays" },
  { value: 6, label: "Saturday", plural: "Saturdays" },
  { value: 7, label: "Sunday", plural: "Sundays" },
];

/** The weekday a `YYYY-MM-DD` calendar day falls on. */
export function weekdayOf(date: string): IsoWeekday {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (js === 0 ? 7 : js) as IsoWeekday;
}

/** "Every Tuesday": the weekday a Repeat weekly class takes from its first date. */
export function repeatsEvery(firstDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) return null;
  const day = WEEKDAYS.find((w) => w.value === weekdayOf(firstDate));
  return day ? `Every ${day.label}` : null;
}

/** "Mondays 19:00–20:00". */
export function seriesCadence(s: { weekday: number; start_time: string; end_time: string }): string {
  const day = WEEKDAYS.find((w) => w.value === s.weekday)?.plural ?? "Weekly";
  return `${day} ${s.start_time}–${s.end_time}`;
}

export interface SeriesInput {
  class_type_id: string;
  main_instructor_id: string;
  /** null = Unpriced, priced later from Finance's Needs pay filter. */
  instructor_pay_sgd: number | null;
  supporting_instructors: { instructor_id: string; pay_sgd: number | null }[];
  location_id: string;
  room_id: string;
  weekday: IsoWeekday;
  start_time: string;
  end_time: string;
  capacity_online: number;
  capacity_waitlist: number;
  capacity_buffer: number;
  credit_cost: number;
  /** Copied onto every class the series creates; null = the studio's window. */
  cancel_window_hours?: number | null;
  /** Copied onto every class the series creates and extends; omitted = accepts all. */
  package_rule?: PackageRuleInput;
  first_date: string;
  last_date: string;
  excluded_dates: string[];
}

/**
 * An instructor's series: no instructors and no pay. The route makes the caller
 * the main instructor and leaves pay for an admin to set.
 */
export type OwnSeriesInput = Omit<
  SeriesInput,
  "main_instructor_id" | "instructor_pay_sgd" | "supporting_instructors"
>;

export type SeriesRole = "admin" | "instructor";

/** A series as it is read back: its Package rule comes named. */
export interface Series extends Omit<SeriesInput, "package_rule"> {
  package_rule: NamedPackageRule;
  id: string;
  ended_from: string | null;
  created_at: string;
}

export interface SeriesClash {
  subject: "room" | "instructor";
  subject_id: string;
  /** Ready-made sentence: who is taken, and by what. */
  message: string;
}

export interface PreviewDate {
  date: string;
  starts_at: string;
  ends_at: string;
  clashes: SeriesClash[];
}

export interface Preview {
  dates: PreviewDate[];
  clash_count: number;
}

export interface EndResult {
  ended_from: string;
  cancelled_class_ids: string[];
  booked_classes: { class_id: string; starts_at: string; booked_count: number }[];
}

const BASE = "/portal/admin/schedule/series";

/** The create routes for either role: an admin sends a `SeriesInput`, an instructor an `OwnSeriesInput`. */
const createBase = (role: SeriesRole) => `/portal/${role}/schedule/series`;

export const previewSeries = (api: Api, role: SeriesRole, input: SeriesInput | OwnSeriesInput) =>
  api.post<Preview>(`${createBase(role)}/preview`, input);

export const createSeries = (api: Api, role: SeriesRole, input: SeriesInput | OwnSeriesInput) =>
  api.post<{ series: Series; class_ids: string[] }>(createBase(role), input);

export const getSeries = (api: Api, id: string) => api.get<Series>(`${BASE}/${id}`);

export const previewExtend = (api: Api, id: string, lastDate: string, excluded: string[]) =>
  api.post<Preview>(`${BASE}/${id}/extend/preview`, { last_date: lastDate, excluded_dates: excluded });

export const extendSeries = (api: Api, id: string, lastDate: string, excluded: string[]) =>
  api.post<{ series: Series; class_ids: string[] }>(`${BASE}/${id}/extend`, {
    last_date: lastDate,
    excluded_dates: excluded,
  });

/**
 * Replace the series' Package rule. It reaches only the classes the series makes
 * from now on (every class an Extend adds); the classes it already made keep
 * their own rule, changed one by one on the class editor — so nothing is
 * cancelled and there is nothing to preview.
 */
export const updateSeriesRule = (api: Api, id: string, rule: PackageRuleInput) =>
  api.put<Series>(`${BASE}/${id}/package-rule`, rule);

export const endSeries = (api: Api, id: string, fromDate: string) =>
  api.post<EndResult>(`${BASE}/${id}/end`, { from_date: fromDate });

const SERIES_ERROR_COPY: Record<string, string> = {
  series_conflict: "Some dates clash. Skip them or fix the clash, then preview again.",
  series_range_too_long: "A series can cover at most one year at a time. Pick an earlier last date.",
  series_has_no_dates: "That range has no dates on this weekday. Check the dates.",
  series_ended: "This series has ended and can't be extended.",
  first_date_in_past: "The first date can't be in the past.",
  last_date_before_first_date: "The last date must be on or after the first date.",
  end_time_before_start_time: "End time must be after start time.",
  duplicate_supporting_instructor: "Each supporting instructor can only be added once.",
  class_type_not_found: "That class type no longer exists. Reload and pick again.",
  series_not_found: "Series not found.",
  room_archived: "That room is archived.",
};

/** Admin-readable copy for a failed series call; falls back to the schedule copy. */
export function seriesErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const code = (err.body as { error?: string } | null)?.error;
    if (code && SERIES_ERROR_COPY[code]) return SERIES_ERROR_COPY[code];
  }
  return scheduleErrorMessage(err, fallback);
}
