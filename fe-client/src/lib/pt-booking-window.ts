/**
 * The studio's Book in advance window for private sessions: the days after
 * today, on the studio's Singapore calendar, a member may propose a time on.
 * No sooner than `minDays`, no later than `maxDays` — the server refuses
 * either side (`slot_date_too_soon`, `slot_date_too_far`), so the form says so
 * up front, caps its date picker to match, and words a refusal the same way.
 */

export interface PtBookingWindow {
  minDays: number;
  maxDays: number;
}

/** The public read, `GET /public/pt-booking-config`. */
export interface PtBookingConfigResponse {
  min_book_in_advance_days: number;
  book_in_advance_days: number;
}

export function fromPtBookingConfig(r: PtBookingConfigResponse): PtBookingWindow {
  return { minDays: r.min_book_in_advance_days, maxDays: r.book_in_advance_days };
}

const SG_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

/** The Singapore calendar date `days` after today, as YYYY-MM-DD. */
export function sgDatePlus(days: number, now: number = Date.now()): string {
  return new Date(now + SG_OFFSET_MS + days * DAY_MS).toISOString().slice(0, 10);
}

/** The first and last dates a member may propose, as YYYY-MM-DD. */
export function ptWindowDates(w: PtBookingWindow, now: number = Date.now()): { earliest: string; latest: string } {
  return { earliest: sgDatePlus(w.minDays, now), latest: sgDatePlus(w.maxDays, now) };
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** "at least 3 days ahead, up to 7 days", or "from tomorrow, up to 7 days" at a minimum of one. */
export function ptWindowPhrase(w: PtBookingWindow): string {
  const from = w.minDays === 1 ? "from tomorrow" : `at least ${days(w.minDays)} ahead`;
  return `${from}, up to ${days(w.maxDays)} ahead`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Wed 1 Oct" for a YYYY-MM-DD date. Spelled out rather than through `Intl`,
 * whose punctuation differs between browsers' locale data.
 */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The chip over the times: the rule, and the dates it allows today. */
export function ptWindowNotice(w: PtBookingWindow, now: number = Date.now()): string {
  const { earliest, latest } = ptWindowDates(w, now);
  const phrase = ptWindowPhrase(w);
  const range = earliest === latest ? shortDate(earliest) : `${shortDate(earliest)} – ${shortDate(latest)}`;
  return `Book ${phrase} (${range}).`;
}

/** What is wrong with one proposed date, or null. `slot` is 1-based, for the message. */
export function ptSlotDateProblem(
  date: string,
  slot: number,
  w: PtBookingWindow,
  now: number = Date.now(),
): string | null {
  const { earliest, latest } = ptWindowDates(w, now);
  if (date < earliest) return `Time ${slot}: pick a date from ${shortDate(earliest)}.`;
  if (date > latest) return `Time ${slot}: pick a date up to ${shortDate(latest)}.`;
  return null;
}

/** The sheet's line for a server refusal of a date, or null for any other code. */
export function ptWindowRefusal(code: string | null, w: PtBookingWindow): string | null {
  if (code !== "slot_date_too_soon" && code !== "slot_date_too_far") return null;
  return `Private sessions are booked ${ptWindowPhrase(w)}. Change any time outside that.`;
}
