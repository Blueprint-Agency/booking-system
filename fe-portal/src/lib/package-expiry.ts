import { localDay, localDayRange } from "./local-day";

/**
 * The Edit expiry dialog's two conversions, both on the studio's calendar day
 * (lib/local-day.ts, the rule every other date field in the portal uses).
 *
 * A package picked to expire "2 Nov" ends at the last instant of 2 Nov on the
 * studio's clock, so the profile's "Valid until" reads 2 Nov. Stamping
 * 23:59:59 UTC would end it at 07:59 the next morning in Singapore and at
 * 10:59 in Sydney. Ends already stamped that way are left as they are:
 * reopening one shows the later day.
 */

/**
 * The last instant the API accepts: a year-10000 ISO string ("+010000-…") is
 * refused, and the dialog's latest pick (31 Dec 9999) ends there west of UTC.
 */
const LATEST_INSTANT = "9999-12-31T23:59:59.999Z";

/** The instant a package picked to expire on `day` (`YYYY-MM-DD`) ends. Blank is Dormant: no end. */
export function expiryInstant(timezone: string, day: string): string | null {
  if (!day) return null;
  const end = localDayRange(timezone, day).end;
  // Compared as instants: a year-10000 ISO string sorts before "9999-…".
  return end.getTime() > Date.parse(LATEST_INSTANT) ? LATEST_INSTANT : end.toISOString();
}

/** The studio's day the date input opens on for a stored end, matching "Valid until" on the profile. */
export function expiryDay(timezone: string, expiresAt: string | null): string {
  return expiresAt ? localDay(timezone, expiresAt) : "";
}
