import { localDay, localDayRange } from "./local-day";

/**
 * The Edit expiry dialog's two conversions, both on the studio's local calendar
 * day (lib/local-day.ts, the rule every other date field in the portal uses).
 *
 * A package picked to expire "2 Nov" ends at the last instant of 2 Nov on the
 * local clock, so the profile's "Valid until" reads 2 Nov. The dialog used to
 * stamp 23:59:59 UTC, which in Singapore is 07:59 the next morning. Ends that
 * were stamped that way are left as they are: reopening one shows the later day.
 */

/** The instant a package picked to expire on `day` (`YYYY-MM-DD`) ends. Blank is Dormant: no end. */
export function expiryInstant(day: string): string | null {
  return day ? localDayRange(day).end.toISOString() : null;
}

/** The local day the date input opens on for a stored end, matching "Valid until" on the profile. */
export function expiryDay(expiresAt: string | null): string {
  return expiresAt ? localDay(expiresAt) : "";
}
