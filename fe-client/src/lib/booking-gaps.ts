/**
 * Which of a member's booking sources could not be read, and how to say so
 * (#500). A page that draws a member's bookings from several reads (My
 * bookings, a day of My activity, Up next) keeps only the class reads
 * essential: the others settle independently, and one that failed must be
 * named on the page, never drawn as "none" — a member with a private session
 * tomorrow would read a list without it as a cancellation.
 *
 * Pure, so `node --test` loads it: no `@/` imports.
 */

/** The optional reads: private sessions, workshops, corporate requests, the waitlist, and (Up next) past classes. */
export type BookingKind = "pt" | "workshops" | "corporate" | "waitlist" | "past";

/** The order kinds are named in, whatever order the reads settled in. */
const ORDER: readonly BookingKind[] = ["pt", "workshops", "corporate", "waitlist", "past"];

const NAMES: Record<BookingKind, string> = {
  pt: "private sessions",
  workshops: "workshops",
  corporate: "corporate requests",
  waitlist: "waitlist",
  past: "past classes",
};

export type SettledReads = Partial<Record<BookingKind, PromiseSettledResult<unknown>>>;

/**
 * From the reads that settled, the values of those that loaded and the kinds
 * that are missing. An empty answer is a loaded one.
 */
export function partitionReads(reads: SettledReads): {
  loaded: Partial<Record<BookingKind, unknown>>;
  missing: BookingKind[];
} {
  const loaded: Partial<Record<BookingKind, unknown>> = {};
  const missing: BookingKind[] = [];
  for (const kind of ORDER) {
    const read = reads[kind];
    if (!read) continue;
    if (read.status === "fulfilled") loaded[kind] = read.value;
    else missing.push(kind);
  }
  return { loaded, missing };
}

/** "Couldn't load your private sessions and workshops.", or null when nothing is missing. */
export function missingSentence(missing: readonly BookingKind[]): string | null {
  if (missing.length === 0) return null;
  const names = ORDER.filter((k) => missing.includes(k)).map((k) => NAMES[k]);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Couldn't load your ${list}.`;
}
