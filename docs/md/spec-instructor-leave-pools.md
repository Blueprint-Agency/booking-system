# Spec — Per-instructor leave Pools, with carry-over

Supersedes the allowance model in `spec-instructor-leave.md`. See `be/docs/adr/0001-per-instructor-leave-pools-with-carry-over.md` for why the Pool is stored, and `be/CONTEXT.md` for the vocabulary used throughout — **Assigned Days**, **Carried Days**, **Pool**, **Committed**, **Taken**, **Remaining** are all defined there and are not interchangeable with the words they replaced.

> **Partly superseded (2026-08-17).** This document was written when there were two Leave Types, annual and medical. A third, **study**, has shipped — one more Assigned figure (`instructors.study_leave_days`, default 7), one more row in the Pool triple per instructor per Leave Year, drawn from and Committed against by exactly the machinery this document describes. Study never carries, same as medical. Nothing about *how* a Pool is built, materialised or spent changed — the carry function, the lazy-open-on-first-read, the per-instructor row lock and the derived Committed/Taken/Remaining are all unchanged and apply to study as a third row rather than a special case. Everywhere below that names "annual and medical" as the two types, read it as "the type list", now three long. Full detail on study leave, the Leave Cap and the Leave Conflicts it ships alongside is `docs/md/spec-pre-launch-batch.md` §16–§17.

## Problem Statement

Leave at Yoga Sadhana is a term of an individual instructor's engagement, not a studio-wide policy. Today it is the opposite: one pair of numbers on the global policy singleton gives every instructor the same 14 annual and 14 medical days, and the only way to give one person a different figure is for an admin to exercise judgement at approval time and let them go over. That is invisible, unauditable, and it means the number an instructor sees is not the number they actually have.

Three further things are wrong with the current model:

- **Unused annual days evaporate on 31 December.** An instructor who works through a quiet year loses the leave they did not take, which is not what the studio intends to promise.
- **Only a superadmin can change the figure**, on a screen an admin cannot open, so the person who approves the leave cannot adjust the person's entitlement.
- **The Remaining figure on the instructor's own page is wrong.** It subtracts approved days but not pending ones, so an instructor with 14 days and 5 pending is shown "14 of 14 days left" and only discovers otherwise when a submission is refused.

## Solution

Assigned Days move onto each instructor's own profile, defaulting to 14 for annual, 14 for medical, and (added with the third Leave Type — see the banner above) 7 for study, editable by any admin or superadmin. Each Leave Year an instructor is given a **Pool** — their Assigned Days plus any Carried Days from the previous year — and every Leave Request draws from that Pool. Unused annual days carry into the following year up to a studio-wide cap; medical and study days do not carry and reset flat each year.

Because a live year's Pool is already part-spent, editing Assigned Days applies from the next 1 January rather than moving a balance mid-flight. When an admin needs to change a live year they edit the instructor's **Remaining** figure directly, which is bounded by that year's Pool.

The Remaining figure is corrected everywhere to subtract Committed days — pending and approved — so the number on screen is the number an instructor can actually apply for. There is no held, reserved, or on-hold state: a pending Leave Request has already drawn down the Pool, and withdrawing, cancelling, rejecting or revoking it returns the days automatically because Committed is derived by summing requests, never stored.

## User Stories

### Instructor — seeing what they have

1. As an instructor, I want to see how many annual and medical days I have left this Leave Year, so that I can plan before I ask.
2. As an instructor, I want my Remaining figure to subtract my pending requests as well as my approved ones, so that the number on screen is the number I can actually apply for.
3. As an instructor, I want to see my Taken and pending days broken out beneath the Remaining figure, so that I can understand why the number is what it is.
4. As an instructor, I want to see how many days I carried in from last year, so that I can tell the difference between my yearly Assigned Days and a one-off surplus.
5. As an instructor, I want to see my Pool for the year alongside my Remaining, so that I know what the ceiling was before I started taking leave.
6. As an instructor, I want my annual and medical figures kept entirely separate, so that being ill does not eat into my holiday.
7. As an instructor, I want half days to show as halves in my Remaining figure, so that 0.5 taken reads as 0.5 and not as a rounded whole day.
8. As an instructor whose Remaining has gone negative because an admin lowered my figures, I want to see the negative number rather than a zero, so that I am not misled about where I stand.

### Instructor — applying

9. As an instructor, I want to be stopped at submission if I am asking for more days than I have left, so that I do not file a request that was never going to be approvable.
10. As an instructor, I want the refusal to tell me how many days I actually have and that pending requests count too, so that I understand the number rather than having to guess.
11. As an instructor, I want my pending requests counted against my Remaining, so that I cannot accidentally over-commit by submitting twice in a row.
12. As an instructor, I want two simultaneous submissions never to together exceed my Pool, so that a race cannot put me over.
13. As an instructor, I want withdrawing a pending request to return the days immediately, so that I can correct a mistake and resubmit.
14. As an instructor, I want cancelling approved leave that has not started to return the days immediately, so that changing my plans costs me nothing.
15. As an instructor, I want a rejected request to return its days, so that a refusal does not quietly cost me leave.
16. As an instructor, I want leave revoked by an admin to return its days, so that reversing a decision restores my position exactly.

### Instructor — the year boundary

17. As an instructor, I want unused annual days to carry into the next Leave Year, so that a quiet year is not a wasted one.
18. As an instructor, I want my carried days to be capped at a known limit, so that I understand the ceiling rather than assuming it is unlimited.
19. As an instructor, I want my medical days to reset to my Assigned figure each year, so that the pool for being ill is the same every January.
20. As an instructor, I want last year's leave counts to stay as they were when my Assigned Days change, so that my history does not move underneath me.
21. As an instructor who joined mid-year, I want a full Assigned figure rather than a pro-rated one, so that the number is simple and predictable.
22. As an instructor, I want the new year to open without anyone having to run anything, so that January is not blocked on an administrative ritual.

### Admin — setting the numbers

23. As an admin, I want to set an individual instructor's Assigned annual days on their profile, so that I can honour what was agreed with that person.
24. As an admin, I want to set an individual instructor's Assigned medical days on their profile, so that the two pools can differ per person.
25. As an admin, I want every newly onboarded instructor to start at 14 and 14 without my doing anything, so that the common case needs no action.
26. As an admin, I want to change an instructor's Assigned Days and have it apply from the next Leave Year, so that a profile edit cannot silently move a balance that is already half spent.
27. As an admin, I want to adjust an instructor's Remaining for the current Leave Year directly, so that I can correct a live figure without waiting for January.
28. As an admin, I want to be refused when I set a Remaining figure above that year's Pool, so that granting extra days is a deliberate act rather than a typo.
29. As an admin, I want the Remaining I type to be what the instructor then sees, so that I am not doing arithmetic in my head against days already taken.
30. As an admin, I want to see an instructor's Assigned, Carried, Pool and Remaining figures when I open their profile, so that I can see the whole picture before changing anything.
31. As an admin, I want the leave figures to appear only for instructors, so that a staff profile that can never take leave is not cluttered with numbers that mean nothing.
32. As a superadmin, I want to set the studio-wide carry-over cap on the Global Policy screen, so that there is one place that decides how much surplus anyone can bank.
33. As a superadmin, I want the carry-over cap expressed in days, so that I do not have to reason about multipliers.
34. As an admin, I want changing the carry-over cap to affect future year boundaries only, so that Pools already opened do not move.

### Admin — approving

35. As an admin, I want to approve and reject leave, so that the queue clears.
36. As an admin, I want rejecting to require a reason that is emailed to the instructor, so that a refusal is never unexplained.
37. As an admin, I want to revoke leave I approved that has not yet started, so that I can reverse a decision when the schedule changes.
38. As an admin, I want to be refused when I try to revoke leave that has already started, so that days already lived are never un-approved and the year boundary stays trustworthy.
39. As an admin, I want revoking to return the days to the instructor's Pool with no further action, so that there is no settlement step to forget.
40. As an admin, I want to see who approved a piece of leave even after it has been revoked, so that the original decision is not erased by its reversal.
41. As an admin, I want approving leave to make the absence binding on the schedule, so that nobody is rostered while away.

### Access and permissions

42. As an admin, I want to reach the staff page and edit staff profiles, so that I can maintain the people I already manage the leave of.
43. As an admin, I want to be refused when I try to edit a superadmin's profile, so that the account that outranks me cannot be rewritten from below.
44. As a superadmin, I want role changes and location grants to remain mine alone, so that an admin cannot promote themselves.
45. As a superadmin, I want archiving, unarchiving and deleting staff to remain mine alone, so that account lifecycle stays with the people accountable for it.
46. As a superadmin, I want the Global Policy screen to stay superadmin-only, so that studio-wide settings keep the gating every other setting on it has.
47. As an instructor, I want to be unable to see or change my own Assigned Days, so that entitlement is set by the studio rather than negotiated in the app.

### Correctness and history

48. As a developer, I want each Leave Request to record the Leave Year it counted against, so that changing a figure later cannot rewrite a closed year.
49. As a developer, I want each year's Pool frozen when the year first opens, so that editing Assigned Days cannot reach backwards through every year an instructor has worked.
50. As a developer, I want Taken and Committed to stay derived by summing requests, so that no counter can drift out of step with the rows it counts.
51. As a developer, I want the Pool materialised on first read rather than by a scheduled job, so that there is no 1 January cron to fail and nothing to backfill if the server was down.
52. As a developer, I want Pool materialisation to be idempotent under concurrent reads, so that two simultaneous requests on 1 January cannot create two Pools.
53. As a developer, I want every new calculation to be a pure function in the leave rules module, so that all of it is covered by the existing test seam.
54. As a developer, I want pending and approved leave to keep Occupying an instructor's schedule exactly as before, so that this change touches balances without touching scheduling.

## Implementation Decisions

### Vocabulary

The glossary in `be/CONTEXT.md` is binding on identifiers, API fields and UI copy. In particular `allowance` and `entitlement` are retired: the yearly figure on the profile is **Assigned Days**, and the thing leave is drawn from is the **Pool**. `balance` is retired in favour of **Remaining**. The words *held*, *reserved* and *on hold* must not appear — a pending Leave Request is **Committed**, and no such state exists.

### Schema

- The `instructors` table gains `annual_leave_days` and `medical_leave_days`, integer, not null, default 14, validated 0–365 in line with the existing policy validation. These are the Assigned Days. They live on `instructors` rather than `staff_users` because leave is keyed to instructors throughout and a non-instructor staff member has no leave concept at all. (A third column, `study_leave_days`, default 7, landed alongside the same validation when the third Leave Type shipped — see the banner above.)
- A new table holds one Pool per instructor, per Leave Type, per Leave Year, with a uniqueness constraint on that triple. Its day count is **numeric with one decimal place**, not an integer: back-solving a Pool from a Remaining figure when half days have been taken produces halves.
- `global_policy` gains a carry-over cap in days, integer, not null, default 14, and loses `annual_leave_days` and `medical_leave_days`.
- No column stores Taken, Committed or Remaining. The Pool is a stored *grant*, not a stored balance.

### Migration

Add the two Assigned columns to `instructors` and backfill every existing row from the current `global_policy` values rather than from the literal 14, so that no instructor's position changes on deploy day; then drop the two `global_policy` leave columns. Separately, create the Pool table and add the carry-over cap column.

The Pool table is **not** backfilled. Lazy materialisation reaches the identical numbers on first read — Carried is 0 for the current Leave Year because there is no prior year to carry from — so a backfill would write exactly the rows the read path is about to write anyway. Every existing Leave Request is in the current Leave Year, and the first real rollover is 1 January 2027.

### Where the arithmetic lives

Every calculation is a pure function in the leave rules module. The additions are: capping and clamping Carried Days from a previous year's Remaining; composing a Pool from Assigned and Carried; shaping the balance figures an instructor sees; back-solving a Pool from a desired Remaining and the days already Committed; and validating an admin's Remaining adjustment against that year's Pool.

Medical and study Leave Types carry zero, always. That is a property of the carry function, not a branch at its call sites.

`Remaining` changes meaning: it is Pool minus **Committed**, where Committed is pending plus approved. The submission check already measured against Committed and is unchanged in substance — what changes is that the displayed figure now agrees with it. Taken remains approved-only and is surfaced separately.

Remaining is not clamped. An Assigned figure lowered below what is already Committed leaves an instructor negative, and that is shown rather than hidden.

### Pool materialisation

The Pool for a Leave Year is created the first time a balance for that year is read, not by a scheduled job. The materialisation reads the previous year's Pool and requests, calls the pure carry and pool functions, and inserts — **it performs no arithmetic of its own**. It runs inside a transaction taking the same per-instructor row lock the submission path already takes, and the insert tolerates a conflict on the uniqueness triple and re-reads, so concurrent first-reads on 1 January cannot produce two Pools.

This is safe only because approved leave cannot be revoked once it has started: the previous year's Remaining cannot move after 1 January, so a carried figure cannot go stale. That coupling is deliberate and is recorded in the ADR.

Where no previous year's Pool exists — a newly onboarded instructor, or the first rollover — Carried Days are zero and the Pool equals Assigned Days. There is no pro-rating for mid-year joiners.

### API contracts

- The admin staff update endpoint accepts the two Assigned figures and two Remaining figures for instructors. Assigned values are stored as-is and take effect from the next Leave Year. Remaining values are back-solved against the current Leave Year's Pool and Committed days, and are refused above that Pool or below zero. Sending leave figures for a non-instructor staff member is refused.
- The admin staff read path returns Assigned, Carried, Pool and Remaining for instructors so the edit form can prefill without a second call. Non-instructors omit them entirely rather than returning nulls.
- The global policy endpoint loses the two allowance keys and gains the carry-over cap.
- The instructor leave read path replaces `allowance` in each balance with Assigned, Carried and Pool, keeping Taken, pending and Remaining. This is a breaking response change consumed only by the portal, which ships in the same change.

### Permissions

- The staff page and the staff profile edit become available to admin as well as superadmin, including the leave figures.
- Editing a staff member of higher rank is refused at the service, not merely hidden in the UI. Admins may edit instructors and other admins; superadmin profiles remain superadmin-only.
- Role changes and location grants stay superadmin-only at the route, refused for admin callers even though the form does not offer them — the endpoint accepts them today and opening the route without this guard is a privilege-escalation path.
- Archive, unarchive and delete stay superadmin-only.
- Global Policy stays superadmin-only in full.

### Portal surfaces

- The staff profile edit gains a leave section, rendered only for instructors: Assigned and Remaining for each of the three Leave Types (annual, medical, study), with Pool and Carried shown as read-only context so an admin can see the ceiling they are editing against.
- The Global Policy screen's "Instructor leave allowance" section becomes a carry-over section with a single day-count field. The two allowance inputs are removed.
- The instructor balance card keeps its shape and corrects its numbers, reading as "9 of 24 days left" over "3 approved, 2 awaiting a decision", with carried days named when non-zero. The existing shared leave presentation module remains the only place the portal formats leave, and nothing is calculated there.

## Testing Decisions

A good test here asserts external behaviour of a pure function: given a previous year's Remaining, a cap and a Leave Type, what is carried; given a Pool and a set of request rows, what is Remaining. It does not assert how the function is structured, and it does not reach for a database. Tests are added to the existing leave rules test file and run by the existing `check` script under `node:test` with `node:assert` — no framework, no fixtures, no test database, matching the prior art of the 572 lines already there.

Everything new is testable because everything new is pure. The only untested code is the Pool materialisation wrapper and the persistence in the requests module, which are untested today for the same reason: there is no test database. Keeping those wrappers arithmetic-free is what makes that acceptable, and a reviewer should reject any calculation that appears in them.

Cases that must be covered:

- Carried Days at the cap, one below it and one above it; a previous Remaining of zero; a negative previous Remaining clamping to zero rather than carrying a debt.
- Medical and study carrying zero regardless of previous Remaining or cap.
- A Pool composed from Assigned plus Carried, and from Assigned alone when no previous year exists.
- Remaining subtracting pending as well as approved, kept separate from Taken which subtracts only approved.
- Remaining going negative when a Pool is below what is Committed, and being reported negative rather than clamped.
- Back-solving a Pool from a desired Remaining with whole days, with half days already taken, and with nothing taken.
- An adjustment above that year's Pool refused, at the Pool accepted, below zero refused, at zero accepted.
- Halves summing exactly — three half days totalling 1.5, not a floating-point approximation. The existing sum-in-halves approach must be preserved.
- Leave Years and Leave Types kept separate throughout.

The portal is verified as the repo already verifies it: `tsc --noEmit`, a production build, and manual exercise of the two screens. There is no frontend test infrastructure and this spec does not introduce any.

## Out of Scope

- Leave for admins, superadmins or any non-instructor staff.
- Accrual, and pro-rating for mid-year joiners. An instructor gets their full Assigned figure on day one and on every 1 January.
- Carry-over for medical or study leave.
- A per-instructor carry-over cap. One studio-wide cap covers everyone; an exception is handled by adjusting that person's Remaining.
- **The Leave Cap** (`study_leave_cap`) and the **Leave Conflicts** (`leave_conflicts`) that ship alongside study leave. The cap lives on Global Policy beside the carry-over cap this document adds and shares its "studio-wide, admin-set, minimum-bounded" shape; the conflicts are declared on the same screen but are a list of instructor pairs rather than a number. Both refuse a *submission* on a peak-across-instructors rule rather than governing what one instructor's own Pool holds — a different axis entirely. Not this document's concern; see `spec-instructor-leave.md` "Study leave, the Leave Cap and Leave Conflicts" and `spec-pre-launch-batch.md` §17.
- Editing a closed Leave Year's Pool. History is frozen once the year has passed.
- Any link to pay or payroll. Leave days generate no payroll entries and no money is computed anywhere.
- Public-holiday and working-pattern awareness. Every calendar date in a range still consumes a day, weekends included.
- Half days at the ends of a multi-day range.
- Un-approving leave that has already started, in any form.
- Admins gaining role management, location grants, or the staff account lifecycle.
- The known gap that workshop write paths never adopted the occupancy module and therefore do not check leave. Unchanged by this spec.

## Further Notes

The cheap half of this change is the half the request appeared to be about. "Deduct from the pool on submit, refund it when an admin un-approves" needs no new code at all: Committed is a derived sum, so a pending row already draws the Pool down and a revoked one already gives it back. The only defect in that area is the displayed Remaining figure disagreeing with the submission check, which is a single expression.

Carry-over is the expensive half. It is what forces a stored Pool, and it undoes the property the original design was built around — that a balance was one number minus one sum, with no state to drift and no job to run. The Pool is a stored grant rather than a stored balance, which preserves the important half of that property: refunds still cost nothing. A future change that stores Taken or Remaining would give that up entirely and should be resisted.

`spec-instructor-leave.md` still describes the old model in its Allowance-and-balance section, its Portal-surfaces section, user story 44 and its Out of Scope list, and `spec-instructor-leave-remediation.md` records a correction stating that allowances are superadmin-only. Both need rewriting as part of this work, not afterwards.
