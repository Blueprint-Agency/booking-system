# Spec — Instructor leave, and instructor-initiated class cancellation

Two features that only make sense together: instructors can apply for leave, and instructors can cancel their own classes. The second exists because the first hard-blocks a leave request that clashes with an assignment, and without a cancel action the instructor has no way to clear the clash himself.

Status: ready for agent. Source: grilling session 2026-08-10.

## Problem Statement

Instructors have no way to tell the studio, inside the system, that they will be away.

An instructor who needs a day off tells an admin over WhatsApp. Nothing records it. The admin who schedules next month's timetable has no idea, assigns that instructor to a class on a day he already said he was away, and the collision surfaces days later — or on the morning itself, when nobody turns up to teach. There is no record of how many days anyone has taken, so "have you used your leave already?" is answered from memory.

The morning-of case is worse. An instructor who wakes up ill has nothing he can do in the portal at all: he cannot mark himself away, and he cannot cancel the class he is about to miss — the entire instructor surface is *view my schedule* and *create a class*. Only an admin can cancel a class, so a sick instructor at 6am is dependent on an admin being awake and reachable.

Meanwhile the system already knows how to answer "is this instructor busy" — it refuses to double-book one — but "on leave" is not one of the ways it understands an instructor can be unavailable.

## Solution

Instructors apply for leave in the portal. Two types, annual and medical, each with a yearly allowance in days. An admin or superadmin approves or rejects. Approved leave is not a note on a calendar — it makes the instructor genuinely unavailable, enforced by the same rule that already stops an instructor being booked into two places at once, so every scheduling screen refuses him for those dates without any screen having to know that leave exists.

The guarantee runs both ways. Leave cannot be requested for a date the instructor is already assigned to teach — the request is refused and names the events in the way. To clear them he cancels his own classes, which he can now do.

From each person's side:

- **An instructor** sees his two balances, applies for leave over a date range or a single half-day, attaches a medical certificate if he has one, withdraws or cancels his own requests, and cancels his own classes when he must.
- **An admin** works a pending-leave queue, approves or rejects with a reason, sees the whole studio's leave on a calendar, and cannot accidentally schedule someone who is away — the instructor is greyed out and labelled, and the save is refused regardless.
- **Any staff member** can see who is away and when, and nothing more: leave type, the stated reason and any medical certificate are admin-only.
- **A member** never sees any of it, and never turns up to a class whose instructor is on approved leave.

No money is involved anywhere. Instructors are paid per class, so a leave day pays nothing; a balance is permission to be absent, not an entitlement to be paid.

## User Stories

1. As an instructor, I want to apply for leave in the portal, so that my absence is recorded somewhere the studio actually looks.
2. As an instructor, I want to choose between annual and medical leave, so that a sick day is not counted against my holiday.
3. As an instructor, I want to apply for a range of dates in one request, so that a week off is not seven submissions.
4. As an instructor, I want to apply for a half day, morning or afternoon, so that a mid-day appointment does not cost me a whole day.
5. As an instructor, I want to see how many annual and medical days I have left this year, so that I can plan before I ask.
6. As an instructor, I want to be stopped at submission if I am asking for more days than I have left, so that I do not wait for a rejection I could have predicted.
7. As an instructor, I want my pending requests counted against my remaining balance, so that I cannot accidentally over-commit by submitting twice.
8. As an instructor, I want to give a reason with my request, so that the admin has the context to decide.
9. As an instructor, I want to attach a medical certificate to a medical leave request, so that I can evidence a sick day.
10. As an instructor, I want the certificate to be optional, so that being ill at 6am does not block me from filing.
11. As an instructor, I want my medical certificate visible only to admins, so that a document about my health is not shown to colleagues.
12. As an instructor, I want to file medical leave for days that have already passed, so that I can record an illness after the fact rather than before it.
13. As an instructor, I want annual leave to have to start in the future, so that the rule about planning ahead is explicit rather than assumed.
14. As an instructor, I want to be told at submission if the dates I want clash with classes I am teaching, so that I do not discover it at approval.
15. As an instructor, I want that refusal to name the clashing classes and their dates, so that I know exactly what to clear.
16. As an instructor, I want to cancel my own class, so that I can clear a clash and take the leave I need.
17. As an instructor, I want to give a reason when I cancel a class, so that the studio understands why rather than just seeing it vanish.
18. As an instructor, I want to be able to cancel a class at short notice, so that the morning I am too ill to teach is not the one case the system refuses.
19. As an instructor, I want cancelling my class to refund the members who booked it, so that nobody loses a credit because I could not teach.
20. As an instructor, I want to withdraw a leave request that is still pending, so that a change of plan does not need an admin.
21. As an instructor, I want to cancel leave that was already approved but has not started, so that returning early is possible.
22. As an instructor, I want cancelling or withdrawing leave to give me those days back, so that my balance reflects what I actually took.
23. As an instructor, I want to see my colleagues' leave dates, so that I can judge whether asking for the same week is realistic.
24. As an instructor, I want my colleagues to see only that I am away and not why, so that my medical absences stay private.
25. As an instructor, I want an email when my request is approved or rejected, so that I am not refreshing the portal to find out.
26. As an instructor, I want a rejection to come with a reason, so that I know whether to ask again for different dates.
27. As an instructor, I want to be blocked from scheduling myself into a class on my own approved leave, so that the system does not let me contradict myself.
28. As an admin, I want a queue of pending leave requests, so that I can see what needs a decision without hunting a calendar.
29. As an admin, I want a calendar of all instructor leave, so that I can see coverage across the studio at a glance.
30. As an admin, I want to approve a leave request, so that the instructor's absence becomes binding on the schedule.
31. As an admin, I want to reject a leave request with a reason, so that the instructor understands the decision.
32. As an admin, I want to revoke leave that was approved but has not started, so that a mistaken approval can be undone.
33. As an admin, I want to be refused when I assign an instructor to a class on a date he has approved leave, so that I cannot create a class with nobody to teach it.
34. As an admin, I want that same refusal for private sessions and corporate sessions, so that the protection does not depend on which kind of event I am creating.
35. As an admin, I want that refusal when I *edit* an event's date or instructor, not only when I create it, so that rescheduling is as safe as scheduling.
36. As an admin, I want an instructor on leave to appear greyed out and labelled in the instructor picker once I have chosen a date, so that I understand why he is unavailable instead of wondering where he went.
37. As an admin, I want the picker to show everyone when no date has been chosen yet, so that the list does not appear broken before I have said when.
38. As an admin, I want the refusal enforced on save regardless of what the picker showed, so that a stale screen cannot slip an assignment through.
39. As an admin, I want a pending request to block assignment just as an approved one does, so that a request cannot become impossible to approve between submission and decision.
40. As an admin, I want to see the leave type, the instructor's reason and any medical certificate, so that I can decide with the full picture.
41. As an admin, I want an email when an instructor submits a request, so that requests do not sit unread.
42. As an admin, I want an email when an instructor cancels one of his classes, so that a class disappearing from the timetable is never a surprise.
43. As an admin, I want an instructor's cancellation recorded as an instructor cancellation and not an admin one, so that the audit trail says who actually did it.
44. As a superadmin, I want to set the yearly annual and medical allowances once for everyone, so that I am not maintaining a number per instructor.
45. As an admin, I want balances to reset at the start of a calendar year without anyone running anything, so that January does not need an administrative ritual.
46. As an admin, I want last year's leave counts to stay as they were when I change this year's allowance, so that history does not move.
47. As an admin, I want backdated medical leave to record the absence without disturbing classes that already happened, so that filing an MC late does not rewrite the past.
48. As an admin, I want cancelled classes ignored when checking clashes, so that a class nobody is teaching does not block leave.
49. As a superadmin, I want the same leave powers as an admin, so that I am never the person who cannot act.
50. As a member, I want the class I booked to have an instructor who is not on leave, so that the class actually runs.
51. As a member, I want my credit returned when a class is cancelled by its instructor, so that I am not out of pocket for someone else's absence.
52. As a developer, I want "instructor is unavailable" to be decided in one module whether the cause is a clash or leave, so that a new reason for unavailability does not have to be added to six write paths.
53. As a developer, I want the date arithmetic — day counting, half-day windows, balance remaining — expressed as pure functions, so that the rules can be checked without a database.
54. As a developer, I want a leave request to record the leave year it was counted against, so that changing an allowance cannot retroactively alter past balances.
55. As an agent working in this repo, I want one named module to read to learn how leave affects scheduling, so that I do not have to guess which write path enforces it.

## Implementation Decisions

### Scope

- Instructors only. Admins and superadmins do not apply for leave in this system; their absence has no effect on the schedule.
- Two leave types: annual and medical. No unpaid type, no compassionate type.
- Quota only. Nothing in this feature reads or writes pay, payroll entries, or any money field. An instructor on leave simply has no classes, and per-class pay already handles that by producing nothing.

### Leave request model

- One new table of leave requests, keyed to the instructor (the staff user id that the instructors table extends).
- Columns carry: type (annual, medical); a start date and an end date, both plain dates in Asia/Singapore, not timestamps; a half-day marker (none, morning, afternoon); the number of days the request consumes, as a one-decimal numeric; the leave year it counts against; a status; the instructor's stated reason; the decision reason; the deciding staff user and the time of decision; and a nullable object key for a medical certificate.
- Status values: pending, approved, rejected, withdrawn, cancelled, revoked. Withdrawn is the instructor abandoning a pending request; cancelled is the instructor giving back approved leave; revoked is an admin taking approved leave away.
- The leave year is stored on the row, not derived at read time, so that changing an allowance or crossing a year boundary cannot alter what a past request counted against.
- Two new enums for type and status. The half-day marker can be an enum or a nullable column; either is acceptable so long as "no half day" is representable.

### Allowance and balance

- The yearly allowances are two integer columns on the existing global policy singleton — one for annual, one for medical — defaulting to 14 each and edited on the existing policy screen, which is superadmin-only like every other setting on it. They are global; there is deliberately no per-instructor allowance.
- The singleton's existing columns are all non-null with no defaults, so the migration must backfill the two new columns for the existing row.
- **The balance is derived, never stored.** Remaining for a type in a year is the allowance minus the sum of days on that instructor's approved requests for that type and year. There is no counter column, so nothing can drift, no restore-on-cancel logic is needed, and the new year resets itself without a scheduled job.
- Submission is refused when the requested days exceed the allowance minus approved *and pending* days. Counting pending is what stops two simultaneous requests from together exceeding the allowance.
- Medical draws from its own allowance, entirely separate from annual.

### Days and half days

- A request over a date range consumes one day per calendar date in the range, inclusive of both ends. There is no working-pattern or public-holiday data in the system, so a Sunday inside a range still consumes a day. An instructor who wants to skip a non-working day submits two requests.
- A half day is only permitted when the request covers a single date; ranges are full days only. A half day consumes 0.5.
- The morning/afternoon boundary is 13:00 Singapore time. Morning is the start of the day up to 13:00; afternoon is 13:00 to the end of the day. An event that straddles the boundary belongs to both halves and therefore clashes with either.
- All date interpretation is Asia/Singapore, matching how the rest of the scheduling code treats studio time.

### The clash rule, and where it is enforced

This is the load-bearing decision, and it reuses machinery that already exists.

- The occupancy module is already the single place the system decides whether an instructor is available, and it is already called by class create, class edit, private-session create, private-session edit, corporate-session create and corporate-session edit. **Leave becomes one more kind of thing that occupies an instructor's time**, expressed inside that module.
- Doing it there means every one of those six write paths gains leave enforcement without being modified, including the instructor's own class-create path, which routes through the same class service.
- Leave occupies an *instructor* only. It has no room, so a room-subject occupancy query never returns leave.
- Both pending and approved leave occupy. Rejected, withdrawn, cancelled and revoked leave does not.
- A leave day is converted into a time window in Singapore time — the whole day, or the half indicated — and compared with the existing overlap rule. The rule stays a pure function over two windows; only the source of one of the windows is new.
- The conflict payload gains a leave variant, and the refusal sentence gains a leave phrasing: an instructor on leave should read as "on leave on 12 Aug", not as "already booked".
- **The reverse direction uses the same function.** When an instructor submits a leave request, the system asks occupancy for that instructor's conflicts across the requested window and refuses the submission if any are found, naming them. Because occupancy already excludes cancelled and non-active events, a cancelled class correctly does not block leave.
- Only conflicts that end in the future block a submission. Backdated medical leave therefore records the absence and consumes balance without being obstructed by classes that already happened, and without disturbing them.
- **Known gap, inherited:** the workshop write paths never adopted the occupancy module — they do not call it today for double-booking either. Leave will therefore not block assigning an instructor to a workshop until those paths adopt the seam. Bringing workshops into occupancy is the natural fix and is called out in Out of Scope; if it is done, leave enforcement follows for free.

### Instructor-initiated class cancellation

- A new instructor endpoint cancels a single class, plus the corresponding action on the instructor's schedule screen in the portal.
- Permitted only for a class the caller is the **main** instructor of. Not supporting-instructor slots, and not private sessions, corporate sessions or workshops — those involve a paying counterparty or a contract and remain admin-only.
- A reason is required and stored.
- No notice window. Cancelling ten minutes before the class is allowed, because that is precisely the case the feature exists for.
- The cancellation reuses the existing class-cancellation service in full: the class lifecycle flips, every confirmed booking is cancelled, and credits are refunded to every booker exactly as an admin cancellation does. The behaviour clients experience is unchanged.
- The service gains an actor-source parameter so it can record who really acted:
  - the cancellation source enum, currently client and admin, gains **instructor**;
  - the inbox item type enum gains an **instructor class cancellation** value;
  - the ledger refund reason is free text, so it simply takes a distinct instructor-cancellation string — no enum change needed there.
- Every instructor cancellation emails all admins, and writes to the audit log. Visibility, not a time lock, is the control on this action.

### Medical certificate upload

- Optional, medical requests only. jpg, png or pdf, up to 5MB.
- **This is the first object-storage write path in the backend** — before it, the storage client existed and the presigner package was already a dependency, but nothing uploaded or signed. It is now implemented: the file is POSTed to the API, validated server-side, and written to the private bucket, with retrieval as a short-lived signed GET (see `backend-architecture.md` §6c). Instructor photo upload remains deferred.
- The certificate goes to a **private** bucket, separate from the existing public one whose public base URL is configured for instructor and workshop imagery. A medical certificate must not be reachable by URL guessing.
- Admins and superadmins read it through a short-lived signed URL generated on demand. Nobody else — including the instructor's colleagues — can retrieve it.
- A new environment variable names the private bucket. Per the repo convention this must land in the backend environment schema, the deploy workflow's required-settings comment block, the workflow's env-file writer, and the example env file, in the same change. The existing storage credentials are optional in the schema; the private bucket name follows that pattern, and upload degrades to unavailable rather than crashing boot when it is unset.

### Access and visibility

- Every staff member — admin, superadmin, instructor — can see the leave calendar, showing who is away on which dates.
- Colleagues see the person and the dates only. The leave type, the instructor's reason, the decision reason and the medical certificate are visible to admins and superadmins only, and to the instructor for his own requests.
- Approve, reject and revoke are admin and superadmin. Withdraw and cancel are the owning instructor.
- Read paths must not leak the restricted fields to instructor callers — this is a serialisation decision in the read module, not something the frontend hides.

### Notifications and audit

- Email admins when a request is submitted. Email the instructor when it is approved or rejected. Email admins when an instructor cancels a class. All of these go through the existing email template and send infrastructure; no new transport.
- A rejection reason is mandatory and is included in the instructor's email.
- Every state transition on a leave request, and every instructor class cancellation, writes an audit log entry.

### Portal surfaces

- An admin leave page: the pending queue plus a calendar, reusing the existing schedule calendar component rather than introducing a second calendar implementation.
- An instructor leave page: the two balances, the submission form, the instructor's own request history, and the same all-staff read-only calendar.
- The two allowance numbers are added to the existing policy screen, which is superadmin-only — an admin approves leave but does not set the allowances.
- A cancel action on the instructor's schedule screen, with a required reason and a confirmation that states how many members will be refunded.
- The instructor picker on scheduling screens greys out and labels an instructor who is on leave for the chosen date. Before a date is chosen, nobody is greyed. The picker is a hint; the server refusal is the enforcement.

## Testing Decisions

- **What a good test is here:** it states a rule an instructor or admin would recognise, in those terms, without naming internals. "A half-day afternoon request clashes with a class that starts at 12:30" is a test. "The window builder is called with two arguments" is not.
- **Prior art:** the backend's existing checks — the roster merge rules, the occupancy overlap predicate, the payroll totals, the private-session cost rules. Plain files using Node's built-in test runner through the existing `check` script, no framework, no fixtures, no database.
- **The rules that get checked, because they are pure and decidable without a database:**
  - day counting over a range — single date, multi-day range, inclusive endpoints, a half day counting 0.5;
  - the half-day-only-on-a-single-date restriction;
  - the half-day window in Singapore time — a morning request and an afternoon request produce the expected windows, and an event straddling 13:00 collides with both;
  - a full-day leave window covering the whole Singapore day, including that it does not bleed into the adjacent day at the UTC boundary;
  - remaining balance — allowance minus approved, pending included for the submission check, other statuses excluded, types kept separate, years kept separate;
  - the submission eligibility rule — over-balance refused, exactly-at-balance allowed;
  - the backdating rule — annual must start in the future, medical allowed up to seven days back, beyond that refused;
  - the future-only filter on clashes — a past event does not block, a future event does.
- The overlap predicate itself is already covered; the new checks feed it leave-derived windows rather than re-testing it.
- **What is deliberately not unit-checked:** the database queries, the object-storage upload and signing, the email sends, and the portal screens. These are covered by typecheck and by exercising the flows in the running app, consistent with the existing backend stance. The design requirement is that no *rule* lives only inside a query — the query narrows candidates, the pure function decides.
- Verification beyond the checks is `tsc --noEmit` in the backend, plus a manual pass: submit leave that clashes and confirm the refusal names the class; cancel that class as the instructor and confirm the member's credit returns; resubmit and confirm it is accepted; approve it; then attempt to schedule that instructor on those dates from the admin schedule screen and confirm the refusal.
- Regression to demonstrate by hand before calling this done: an instructor with an approved leave day cannot be assigned to a class, a private session, or a corporate session on that date, and cannot self-create one either.

## Out of Scope

- Leave for admins, superadmins or any non-instructor staff.
- Accrual, carry-forward, pro-rating for mid-year joiners, and year-end rollover. The allowance is a flat yearly number and unused days expire.
- Per-instructor allowances. One global pair covers everyone; an exception is handled by an admin's judgement at approval, not by data.
- Any link to pay or payroll. Leave days generate no payroll entries and no money is computed. If instructors ever become salaried, paid leave is a separate spec that must first introduce a rate.
- Half days at the ends of a multi-day range.
- Public-holiday and working-pattern awareness. The system has no roster of who works which days and is not gaining one.
- An in-app cover or reassignment flow. Because clashes hard-block submission, the instructor clears them by cancelling; finding a replacement happens outside the system. This is a known cost of the hard-block decision — see Further Notes.
- Bringing the workshop write paths into the occupancy module. It is the right fix and it would extend leave enforcement to workshops, but it is a change to existing scheduling behaviour and belongs with the roster and occupancy work, not here.
- **Folding the admin schedule page's hand-rolled month grid into the shared calendar component.** The leave calendar reuses the shared component, but that page keeps its own month grid, entangled with its day and week views and its own event model on a very large file (`fe-portal/src/app/admin/schedule/**`). No defect is traced to the duplication. Left as it is deliberately: the risk of disturbing three working views on that file outweighs the tidiness, and it is recorded here so the next reader knows it was decided rather than missed.
- Instructor cancellation of private sessions, corporate sessions and workshops.
- A notice window or cancellation cap on instructor class cancellations.
- Medical certificate retention, expiry or deletion policy.
- Instructor photo upload, even though this spec builds the first upload path it would need.
- Any member-facing surface. Members see nothing about leave.

## Further Notes

- **The hard-block decision has a cost, and it was taken deliberately.** Requiring an instructor to clear his own clashes means the only way to take a day off that already has a class on it is to cancel that class — which refunds every booked member and loses the studio that session. Reassigning the class to another qualified instructor would usually be the better outcome, and the qualification data to support it already exists. The alternative considered was allowing submission with clashes attached and making the admin resolve each one at approval, which would have permitted reassignment. It was rejected in favour of the stronger invariant that approved leave and an assignment can never coexist. If cancellations start costing real revenue, that is the decision to revisit first, and it is a change to the submission path only — the occupancy enforcement is unaffected either way.
- The two guarantees together are airtight and worth stating explicitly: no leave request can be submitted while a future assignment exists on those dates, and no assignment can be created while a pending or approved leave request exists on those dates. Neither alone is sufficient — the first without the second leaves a window between submission and approval in which an admin could schedule the instructor and make his own pending request un-approvable.
- Because the balance is derived, cancelling or revoking leave restores days with no code: the row leaves the approved set and the sum changes. This is the main reason to resist a stored counter later.
- Backdated medical leave is the only path that records leave over dates with completed classes. It intentionally changes nothing about those classes — attendance, check-ins and pay all stand.
- The instructor cancel endpoint is independently useful and has no dependency on the leave work. It can land first, and probably should, since it is small and it is the only thing a sick instructor can currently do nothing about.
- Adding the private bucket is the moment to decide whether the existing storage configuration should be non-optional in deployed environments. Today every storage variable is optional, which means a misconfigured deploy fails at upload time rather than at boot. Out of scope here, but it will be felt the first time a certificate upload fails in staging.
- No ADRs exist in this repo, so nothing here contradicts a recorded decision. The hard-block rule is the candidate worth recording if the project ever starts keeping them.
