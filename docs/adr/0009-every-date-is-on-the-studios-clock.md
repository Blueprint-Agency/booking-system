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
changed after**: neither the super portal nor a studio's Admins can edit it. Until slice 5 the
`tenants.timezone` column still carries its `Asia/Singapore` default, and the provisioning service
names that default for a studio created without a zone; no rule reads either as a fallback. Every calendar day,
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
place instants turn into the studio's clock and back, and every date or time a service words goes
through its cached formatter (`zoneFormat`). No rule or service has a default zone or a `UTC`
fallback: a missing studio, or a zone the runtime cannot read, is an error that shows. A service is handed the zone or reads it once through
the cached Tenant row (`tenantTimezone`). **In each frontend**, one date module takes the zone, which
arrives with the slug lookup the proxies already make and is carried on the brand object.

**The server process's own zone is no part of any of this.** Tests run in `TZ=UTC`; production's
`TZ` is set to UTC last, as its own small deploy, once a search for zone-less calls is clean.

## Where the new rules can differ from what was stored

The gap and repeat rules are now one, for every caller. A Class Series in a zone with daylight
saving that is extended through a repeated hour (02:30 at fall-back) produces its new occurrence at
the **first** 02:30, where the older series code produced the second; occurrences already stored are
never moved. A ClassPass booking email names a wall-clock time, so the booking is matched to the
class by the studio's local wall time and finds the class at either occurrence of a repeated hour.
The ClassPass roster check still keys a roster's class by its instant (the first occurrence), so a
class stored at the second occurrence of a repeated hour is reported as not found in that check, one
hour a year in a zone with daylight saving.

## What it replaced

The fixed-offset `lib/time.ts` (`sgToday`, `sgDayWindow`, `sgInstant`, `sgFormat`), and the zone
arithmetic repeated in Class Series dates, Term dates and the attention formatter.

## Out of scope

Currency and locale (every studio sells in Singapore dollars and formats with `en-SG` and `en-GB`),
more than one zone per studio, and showing the device's zone beside the studio's for a travelling
member.
