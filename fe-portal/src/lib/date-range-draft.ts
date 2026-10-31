import { isFilterDay } from "./formatters";

/**
 * What a date-range filter's From and To inputs hold while someone types.
 *
 * A date input fires `input` for every key: typing the year 2025 passes through
 * 0002-…, 0020-… and 0202-…. A controlled input given the old value back after
 * each of those wipes the typing, so what is typed is kept as a draft and shown,
 * and the filter (and the request behind it) moves only once the draft is a day
 * `isFilterDay` accepts.
 */

type Range = { from: string; to: string } | null;
type Endpoint = "from" | "to";

/** Drafts are valid for the period they were typed against (`base`), and drop when it changes. */
export type EndpointDrafts = { base: Range; from?: string; to?: string };

export function noDrafts(base: Range): EndpointDrafts {
  return { base };
}

function sameRange(a: Range, b: Range): boolean {
  if (a === null || b === null) return a === b;
  return a.from === b.from && a.to === b.to;
}

/** The drafts that still apply to `range`: none once it has changed under them. */
function liveDrafts(range: Range, drafts: EndpointDrafts): EndpointDrafts {
  return sameRange(drafts.base, range) ? drafts : noDrafts(range);
}

/** Forget what was half-typed, e.g. when the input loses focus. */
export function dropDrafts(range: Range): EndpointDrafts {
  return noDrafts(range);
}

/** What an endpoint's input shows: its draft, else the committed day. */
export function shownDay(range: Range, drafts: EndpointDrafts, which: Endpoint): string {
  return liveDrafts(range, drafts)[which] ?? range?.[which] ?? "";
}

/**
 * The input fired with `typed`. `commit` is the period to hand the filter, or
 * undefined when `typed` is not yet a day it may filter by and only the draft moves.
 */
export function typeDay(
  range: Range,
  drafts: EndpointDrafts,
  which: Endpoint,
  typed: string,
): { drafts: EndpointDrafts; commit: Range | undefined } {
  if (!isFilterDay(typed)) {
    return { drafts: { ...liveDrafts(range, drafts), base: range, [which]: typed }, commit: undefined };
  }
  // Editing either endpoint keeps the other; falling back to the typed date
  // covers editing while "All time" is selected and there's no range yet.
  const base = range ?? { from: typed, to: typed };
  const next = { ...base, [which]: typed };
  // Keep the range ordered if the user picks a start after the end.
  const commit = next.from > next.to ? { from: next.to, to: next.from } : next;
  return { drafts: noDrafts(commit), commit };
}
