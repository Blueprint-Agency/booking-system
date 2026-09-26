# Instructor Pay is optional when scheduling; Needs pay is how it gets priced

**Status**: accepted (2026-09-26) — supersedes the section "Instructor Pay becomes required" of `0002-finance-replaces-payroll.md`. The rest of 0002 stands: Finance is the one pay surface, instructors never see rates and their own classes stay Unpriced, corporate sessions have no pay at all.

ADR 0002 made Instructor Pay required when an admin schedules a session and when anyone joins a roster, because an Unpriced session makes Net read better than the studio did. It weighed the alternative — pay optional, with a "Needs pay" filter to clear the backlog — and chose required, on the grounds that a warning to act on later is a warning that gets ignored.

The rule put the pay rate in the scheduling path, and the person scheduling does not always have it: a session is often set up before the rate is agreed, and one supporting instructor's unknown rate blocked the whole schedule. The only way round the block is to type a placeholder figure, and a placeholder 0 is worse than blank — S$0 is a price, so the session drops out of Needs pay and Net is understated with no warning at all. A required field invites exactly the invented figure the rule was meant to prevent.

## Decision

Instructor Pay is optional on every scheduling and roster path, for both audiences:

- An admin may create a class, weekly series, PT session or workshop without the main instructor's pay, and may add supporting instructors — at scheduling or later on the roster — without theirs.
- A blank pay is stored `null`: **Unpriced**, never S$0. An explicit 0 is a price and is stored as one.
- Every Unpriced assignment appears under Finance's Needs pay filter once its session is held, and is priced there.

The roster module's single gate (`instructor_pay_required`) is removed and the code retired. `class_series_supporting_instructors.pay_sgd` loses its `NOT NULL`, so a series can carry an Unpriced supporting instructor onto every class it makes.

## Why this is safe now

0002's worry was that nothing would make anyone go back. What makes them now is that Unpriced is never silent: it is excluded from every total rather than counted as zero, Net carries the Unpriced warning while any remain in the period, and Needs pay lists exactly those rows. The backlog has one place to be cleared from, and it is the page the owner reads the month's figures on.

## Consequences

- Unpriced sessions are ordinary again, not rare. The Unpriced warning on Net is load-bearing, and so is the Needs pay filter.
- The pay fields say they are optional ("· optional", with "Leave blank to set it later in Finance."), and a cleared field is sent as `null`, never `0`.
- The instructor paths are unchanged: an instructor scheduling their own class or PT session is never shown or asked for pay, and it lands Unpriced as before.
- `unpricedArrivals` in `services/schedule/roster-merge.ts` has no production caller any more; it stays as the pure statement of who newly joined a roster unpriced.
- Existing Unpriced sessions are still never backfilled.
