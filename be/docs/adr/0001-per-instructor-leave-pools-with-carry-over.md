# Per-instructor leave Pools, with carry-over

**Status**: accepted (2026-08-12) — reverses the "no per-instructor allowances" and "no carry-forward" non-goals in `docs/md/spec-instructor-leave.md`.

Leave was built with one studio-wide pair of numbers on the global policy singleton, no per-instructor override and no carry-forward, so that a balance could be a pure derived sum — allowance minus the days on that instructor's requests — with no counter to drift and no scheduled job to reset. The owner has since decided that leave is a term of an individual instructor's engagement rather than a studio policy, and that unused annual days should not evaporate on 31 December. We are therefore moving the assigned figure onto each instructor's profile and storing each year's **Pool** (Assigned Days plus Carried Days) as a row per instructor, per Leave Type, per Leave Year.

## Why the Pool has to be stored

Carry-over makes this year's Pool depend on last year's Remaining, which depends on the year before it. Derived recursively from a mutable Assigned figure, `Remaining = Assigned × yearsEmployed − everTaken`, so editing one instructor's Assigned Days silently rewrites every year they have worked. Dropping a three-year instructor from 14 to 10 would take 12 days off their current Remaining — a change to a profile field reaching backwards through closed years. Freezing the Pool when a Leave Year first opens keeps history immutable, which is the same property the `leave_year` column on each request was added to protect.

## What this does not change

The Pool is a stored **grant**, not a stored balance. Taken and Committed stay derived by summing requests, so withdrawing, cancelling, rejecting or revoking still returns days for free — the row simply stops matching the filter. Resisting a used-days counter remains correct, and this decision does not weaken that.

## Consequences

- The Pool is materialised lazily, on the first balance read of a Leave Year, rather than by a 1 January cron job — no scheduled task, and nothing to backfill if the server was down over New Year.
- That freeze is only safe because approved leave cannot be revoked once it has started: last year's Remaining cannot move after 1 January, so the carried figure cannot go stale.
- Editing Assigned Days applies from the next Leave Year, never to the Pool already in flight. To change a live year an admin edits Remaining directly, which back-solves the Pool.
- That adjustment is bounded by **Assigned plus Carried** — the year's natural entitlement — and deliberately not by the stored Pool. Bounding by the stored Pool would make the control a one-way ratchet: an admin who mistyped a figure downwards could never restore it, because the lowered Pool would become its own ceiling. Bounding by the entitlement means a mistake is always correctable while exceeding what the instructor was actually granted still is not.
- Granting extra days within a live year therefore takes two deliberate steps: raise Assigned Days, then raise Remaining. Raising Assigned alone moves no balance — the Pool stays frozen — so a profile edit still cannot shift a live figure by itself, which is the property this ordering exists to protect.
- Medical leave does not carry over. Banking sick days year on year is not a thing the studio wants to owe.
- Global Policy keeps one leave field, the carry-over cap, and loses the two allowance fields.
- `Remaining` now subtracts pending as well as approved. It previously subtracted only approved, so an instructor with pending requests was shown more days than they could actually file.
