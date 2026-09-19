// Class Series: a weekly repeating class, defined once, that creates ordinary
// classes. Shapes mirror the /portal/admin/schedule/series routes in
// be/src/routes/portal/admin/schedule.ts. Create and extend are both a preview
// (every date with its clashes) followed by a commit of the same input.

import { ApiError, type Api } from "@/lib/api";
import { scheduleErrorMessage } from "@/lib/schedule";

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

/** "Mondays 19:00–20:00". */
export function seriesCadence(s: { weekday: number; start_time: string; end_time: string }): string {
  const day = WEEKDAYS.find((w) => w.value === s.weekday)?.plural ?? "Weekly";
  return `${day} ${s.start_time}–${s.end_time}`;
}

export interface SeriesInput {
  class_type_id: string;
  main_instructor_id: string;
  instructor_pay_sgd: number;
  supporting_instructors: { instructor_id: string; pay_sgd: number }[];
  location_id: string;
  room_id: string;
  weekday: IsoWeekday;
  start_time: string;
  end_time: string;
  capacity_online: number;
  capacity_waitlist: number;
  capacity_buffer: number;
  credit_cost: number;
  first_date: string;
  last_date: string;
  excluded_dates: string[];
}

export interface Series extends SeriesInput {
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

export const previewSeries = (api: Api, input: SeriesInput) =>
  api.post<Preview>(`${BASE}/preview`, input);

export const createSeries = (api: Api, input: SeriesInput) =>
  api.post<{ series: Series; class_ids: string[] }>(BASE, input);

export const getSeries = (api: Api, id: string) => api.get<Series>(`${BASE}/${id}`);

export const previewExtend = (api: Api, id: string, lastDate: string, excluded: string[]) =>
  api.post<Preview>(`${BASE}/${id}/extend/preview`, { last_date: lastDate, excluded_dates: excluded });

export const extendSeries = (api: Api, id: string, lastDate: string, excluded: string[]) =>
  api.post<{ series: Series; class_ids: string[] }>(`${BASE}/${id}/extend`, {
    last_date: lastDate,
    excluded_dates: excluded,
  });

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
