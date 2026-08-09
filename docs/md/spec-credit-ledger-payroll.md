# Spec — Credit ledger and payroll aggregation

Covers architecture review candidates **B** (credit ledger module) and **D** (payroll aggregation out of the route files). Both are money paths in the backend and share the same testing approach, so they ship together.

Status: ready for agent. Source: architecture review 2026-08-09.

## Problem Statement

**Credits can be refunded into an unusable state.** A member's credit bundle is marked inactive when it runs to zero. Two of the four code paths that return credits — cancelling a class booking, and an admin cancelling a whole class — add the credits back but never re-evaluate that flag. The booking path only spends from bundles that are still flagged active. The result: a member cancels a class, sees their credit returned, and cannot spend it. Nothing surfaces the contradiction; support has to find it by hand.

**Rescheduling a PT session can leave the books wrong.** Editing a PT session's type between one-to-one and two-to-one changes its capacity but touches nothing else — no credit is debited or returned, no partner attendee is added or removed, no partner booking is created or cancelled. The session looks internally consistent and is externally wrong.

**Payroll money is added up in two different places, two different ways.** The admin payroll screen and the instructor payroll screen each total pay inside their own route file, in different shapes, against the project's own rule that route files should not hold domain rules. The two can drift, and an instructor's own total is computed by code no admin screen ever exercises. Separately, the routine that saves a payroll amount reports six distinct failures as a single boolean, so the screen cannot tell "no such session" from "that instructor isn't on it" and shows the same message for both.

## Solution

One **credit ledger** module becomes the only code that changes a member's remaining credits. It owns the active flag, so a refund cannot leave a bundle with credits it refuses to spend, and PT rescheduling reconciles credits, attendees and bookings through it.

One **payroll** module owns totalling, row formatting and the save routine. Both payroll screens read from it, so admin and instructor totals cannot disagree, and the save routine reports *why* it failed.

From the user's side: refunded credits are always spendable; changing a PT session's type adjusts the member's balance and the partner's booking correctly; an instructor's own payroll total matches what the admin sees; and failed payroll edits explain themselves.

## User Stories

1. As a member, I want a credit returned by cancelling a class to be spendable on my next booking, so that a refund is a real refund.
2. As a member, I want a credit returned when an admin cancels my class to be spendable, so that a cancellation I did not cause does not cost me.
3. As a member, I want my bundle to become usable again the moment credits return to it, so that I do not have to contact support.
4. As a member, I want my bundle to stay unusable if it has expired even though credits returned to it, so that expiry still means expiry.
5. As a member, I want my balance shown after a cancellation to match what I can actually spend, so that the number is trustworthy.
6. As a member, I want the credit cost of a PT session to match the session I actually attend, so that an admin's edit does not overcharge me.
7. As a member upgraded from a one-to-one to a two-to-one session, I want the extra credit debited once, so that my balance is correct.
8. As a member downgraded from a two-to-one to a one-to-one session, I want the extra credit returned, so that I am not charged for a partner who is not attending.
9. As a member removed from a PT session as the partner, I want my booking cancelled and my credit returned, so that I am not marked as attending.
10. As an admin, I want changing a PT session's type to update attendees and bookings, so that the attendance list is right on the day.
11. As an admin, I want to be refused if changing a session type would overdraw a member's balance, so that a negative balance cannot be created.
12. As an admin, I want every credit movement recorded, so that a disputed balance can be explained.
13. As an admin, I want my payroll totals to match what the instructor sees on their own screen, so that a pay conversation starts from one number.
14. As an admin, I want unpriced assignments counted and shown separately from the total, so that a low total is distinguishable from an incomplete one.
15. As an admin, I want session duration shown consistently on both payroll screens, so that the two screens agree.
16. As an admin, I want a failed payroll edit to tell me whether the session was not found or the instructor is not on it, so that I know what to fix.
17. As an admin, I want a payroll edit against a session that no longer exists to fail cleanly, so that I do not think it saved.
18. As an admin, I want manual payroll entries to total the same way as session-derived pay, so that the sum is the payout.
19. As an instructor, I want my payroll page to compute my total the same way the admin's does, so that I can trust it.
20. As an instructor, I want unpriced assignments visible on my own page, so that I can ask about them before payday.
21. As an instructor, I want my payroll filtered to the period I choose and totalled for exactly that period, so that the number matches the dates shown.
22. As a developer, I want one module to read to learn how credits move, so that I do not have to compare four call sites.
23. As a developer, I want it to be impossible to change a balance without going through that module, so that the active-flag rule cannot be bypassed again.
24. As a developer, I want payroll totalling exercisable without a database, so that a rounding or grouping mistake is caught before deploy.
25. As a developer, I want route files to contain no money arithmetic, so that the project's own convention holds.
26. As an agent working in this repo, I want the credit rule in one named module, so that I do not reproduce the bypass when adding the next cancellation path.
27. As an admin, I want a partially-completed PT edit to leave nothing behind, so that a failure does not produce a half-charged session.
28. As a member, I want a cancellation that fails to leave my balance untouched, so that a retry does not double-refund me.

## Implementation Decisions

### Credit ledger module

- One module becomes the sole writer of a member's remaining credits and the active flag on their bundles. The four existing movement paths — booking a class, cancelling a class booking, an admin cancelling a class, PT request and PT cancellation — call it. No other code writes those columns.
- Interface: debit and refund, each taking the bundle, the amount, and the reason for the movement. Everything else is implementation: the arithmetic, re-evaluating the active flag from remaining credits and expiry, and refusing to overdraw.
- The active flag is recomputed on **every** movement, using the existing validity rule. This is the invariant the module exists to protect; the two raw SQL updates that currently skip it are replaced.
- Refusing to overdraw moves inside the module, so every caller gets the same refusal rather than each checking first.
- The module participates in the caller's transaction rather than opening its own, so a movement and the booking change it accompanies commit or roll back together.
- Whether each movement writes an audit row is decided during implementation: if a credit ledger table already exists it is used; if not, adding one is in scope only if it costs little, and otherwise deferred — the active-flag invariant is the required outcome, the audit trail is the desirable one.

### PT session reconciliation

- Editing a PT session's type is reconciled through the same module: the difference between the old and new credit cost is debited or refunded, the partner attendee row is added or removed, and the partner's booking is created or cancelled, all in one transaction.
- If the member cannot cover an increase, the edit is refused with a typed error rather than partially applied.
- The one-to-one versus two-to-one cost rule stays in the small existing module that already names it; the reschedule path starts calling it instead of ignoring it.

### Payroll module

- Totalling, unpriced accounting, row formatting including derived duration, and the mapping from a payroll row kind to the record it belongs to all move out of the two route files and into the payroll module.
- Interface: one call returning rows plus totals for a given filter and audience. Both the admin screen and the instructor screen use it; the instructor case is the same call scoped to one instructor, not a second implementation.
- The route files return to parse, call, format — matching the project's stated convention.
- The save routine returns a typed reason rather than a boolean, distinguishing at minimum: record not found, instructor not assigned to that record, and invalid amount. Route files map those to statuses; they stop inferring the reason.
- Grouping and totalling are separated from the queries so they can be exercised directly.

### Sequencing

The roster module from the scheduled-event spec is a prerequisite for the payroll work, because payroll's per-instructor pay writes become roster calls. The credit ledger is independent and can land first.

## Testing Decisions

- **What a good test is here:** it states a money or credit rule the way a member or admin would experience it. "A refund into an empty bundle makes it spendable again" is a test. "The update statement sets two columns" is not.
- **Prior art:** the backend's existing name-splitting self-check — a plain file using `node:assert`, run with `tsx`. That remains the pattern; no test framework is introduced. The `check` script added in the scheduled-event spec runs these too.
- **What gets checked, because it is pure:**
  - the active-flag rule across the cases that matter — refund into a zero bundle, refund into an expired bundle, debit to exactly zero, debit below zero refused;
  - PT type-change reconciliation arithmetic — the credit delta for each direction, and the refusal when the balance cannot cover an increase;
  - payroll grouping and totalling — per-instructor sums, unpriced rows excluded from the total but counted, manual entries included, duration derivation, ordering.
- **Two existing pure functions get a check in the same pass**, because they decide what a member is charged and currently have none: the promotion price selection including its tie-break rule, and the workshop tier effective price including early-bird versus promotion precedence. Neither needs restructuring to be checkable.
- **Not unit-checked:** the queries and the transactions. Verified by typecheck and by exercising the flows in the running app.
- Regressions to demonstrate by hand: cancel a class booking that empties-then-refills a bundle and confirm the credit can be spent; change a PT session from one-to-one to two-to-one and confirm the balance, attendee list and bookings all move together; compare an instructor's own payroll total against the admin view for the same period.

## Out of Scope

- The frontend payroll screens beyond what the changed response shape requires. Reworking the portal's read modules is a separate spec.
- An SGD money module. Deferred; no defect has been traced to the current convention.
- Refund of money (as opposed to credits) through Stripe, and the refund endpoints still stubbed in the backend.
- Waitlist promotion when a cancellation frees a seat.
- Reconciling the three different meanings of "capacity" across read paths.
- Marking payroll as paid, which remains an unbuilt gap outside this work.
- Introducing a test framework or an integration-test database.

## Further Notes

- The stranded-credit defect is reachable today: any member whose bundle hits zero and then has a class cancelled ends up holding credits the booking path will not spend. Worth reproducing once before the fix.
- The PT reschedule gap and the roster work touch the same edit path. Expect the two specs to meet there; land the roster module first if both are in flight.
- The instructor payroll screen is the less-exercised of the two. When the shared module lands, check that screen specifically — it is the one most likely to have been quietly wrong.
- No ADRs exist in this repo. If "the credit ledger is the only writer of balances" is later relaxed, that is worth recording.
