# Every date and time is on the studio's own clock

**Status**: accepted (2026-10-30). Decided in #506. It binds the backend, the member app and the
staff portal, so it lives in the root `docs/adr/`. The backend half is built
(`be/src/lib/studio-time.ts`); the frontends follow in their own slices.

## Why

The platform is multi-tenant, and a studio's zone was already its own data (`tenants.timezone`), yet
half the system read a hard-coded Singapore clock (a fixed UTC+8 offset), the browser's zone or the
server process's zone. For a studio in Singapore whose staff sit in Singapore all three agree, so
nobody noticed. A studio in Sydney would have had its leave days run from 02:00 to 02:00, its
private-session window counted from Singapore's midnight, its Receipts dated the day before and its
emails printing Singapore times.

## The decision

**One clock per studio, read everywhere.** The zone is the IANA `timezone` on the Tenant's row. It is
picked from the zone list when the studio is created, required (no platform default), and **not
changed after**: neither the super portal nor a studio's Admins can edit it. Every calendar day,
wall-clock time, day boundary, "today", "N days ahead", email date and on-screen time is the
studio's, for everyone: a member, an Admin or a Platform administrator acting as one sees the
studio's clock, not their device's.

**Daylight saving is the zone's rules on the date, never a stored offset.**

- A wall time in a spring-forward gap resolves one hour later.
- A wall time that occurs twice at fall-back resolves to the first occurrence.
- A day is the half-open window from local midnight to the next local midnight, so 23 or 25 hours
  long on a transition day.
- "N days ahead" (Book in advance, Leave notice, Term warnings) counts calendar days, not multiples
  of 24 hours.
- The Half Day boundary is 13:00 wall time.
- A daily job that targets an hour a zone skips that day does not run that day.

**Nothing stored is rewritten.** Instants (classes, sessions, purchases, Receipts, package expiries)
keep their moment; plain dates (a Leave Request's days, a Class Series' dates, a private-session
slot's date and time, the Term) keep their calendar day, read on the studio's clock. This only
matters should a zone edit ever be added.

**In the backend**, one module, `lib/studio-time.ts`, takes the zone as an argument and is the only
place instants turn into the studio's clock and back. No service has a default zone or a `UTC`
fallback: a missing zone is a bug that shows. A service is handed the zone or reads it once through
the cached Tenant row (`tenantTimezone`). **In each frontend**, one date module takes the zone, which
arrives with the slug lookup the proxies already make and is carried on the brand object.

**The server process's own zone is no part of any of this.** Tests run in `TZ=UTC`; production's
`TZ` is set to UTC last, as its own small deploy, once a search for zone-less calls is clean.

## What it replaced

The fixed-offset `lib/time.ts` (`sgToday`, `sgDayWindow`, `sgInstant`, `sgFormat`), and the zone
arithmetic repeated in Class Series dates, Term dates and the attention formatter.

## Out of scope

Currency and locale (every studio sells in Singapore dollars and formats with `en-SG` and `en-GB`),
more than one zone per studio, and showing the device's zone beside the studio's for a travelling
member.
