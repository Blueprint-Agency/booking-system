# Spec — Scheduled-event roster, occupancy and write-permission seam

Covers architecture review candidates **A** (roster module), **C** (occupancy scan) and **E** (write-permission seam). All three sit on the same set of write paths — classes, PT sessions, workshops, corporate sessions — so they ship together.

Status: ready for agent. Source: architecture review 2026-08-09.

## Problem Statement

Admins schedule and later edit four kinds of scheduled event — classes, PT sessions, workshops and corporate sessions. Today those four write paths were each built separately, and three problems fall out of that:

1. **Payroll pay silently disappears.** An admin prices a supporting instructor on the Payroll page. Later, another admin (or the same one) edits that class's roster from the Schedule page. The pay is silently reset to unpriced. Nobody is told. The next payroll run under-reports that instructor, and the only way to notice is to remember what the number used to be.
2. **Instructors can be double-booked.** "An instructor is in one place at a time" is enforced when a PT session is created and when a corporate session is created or rescheduled — and nowhere else. Creating a class, editing a class, and rescheduling a PT session all skip the check entirely. An admin can put the same instructor in two rooms at the same hour and the system accepts it.
3. **A blocked admin can act anyway.** Cancelling a workshop is blocked for the `admin` role on one path and allowed on another, because the two paths were mounted under different gates. An admin who is told "you don't have permission" on one screen succeeds by taking a different route to the same action.

Underneath all three: the rule "who is on this event, and what are they paid" is written five times, the "do these two bookings overlap" scan is written three times, and neither has a single place a developer or agent can read to learn the rule.

## Solution

One **roster** module owns instructor assignment and per-instructor pay for every kind of scheduled event. One **occupancy** module answers "is this room or this instructor already busy in this window". Write permission is checked where the action's implementation lives, not on a path prefix.

From the admin's side, the visible changes are:

- Editing a class, PT session or workshop roster no longer wipes pay entered on the Payroll page. Pay follows the instructor across a roster edit; it only changes when someone deliberately changes it.
- Attempting to schedule or move an event onto an instructor who is already booked is refused, with the same message and the same status code on every kind of event.
- Every write action is gated identically no matter which screen reaches it.

## User Stories

1. As an admin, I want a supporting instructor's pay to survive a roster edit, so that a number I entered on the Payroll page is not silently lost.
2. As an admin, I want to add a supporting instructor to a class without disturbing the pay already recorded for the others, so that one edit does not undo another.
3. As an admin, I want to remove a supporting instructor from a class and see only that instructor's pay removed, so that removal is precise.
4. As an admin, I want to change a class's main instructor and be told what happens to the recorded pay, so that the outcome is not a surprise at payroll time.
5. As an admin, I want the same roster editing behaviour on classes, PT sessions, workshops and corporate sessions, so that I do not have to remember which screen behaves differently.
6. As an admin, I want to be refused when I put the same instructor in two overlapping events, so that I do not discover the clash on the day.
7. As an admin, I want that refusal when I *create* a class, not only when I create a PT session, so that the protection is not path-dependent.
8. As an admin, I want that refusal when I *edit* an event's time, room or instructor, so that rescheduling is as safe as scheduling.
9. As an admin, I want rescheduling an event to not report a clash with itself, so that moving an event by ten minutes is possible.
10. As an admin, I want the clash message to name the instructor and the conflicting event, so that I can resolve it without hunting.
11. As an admin, I want room clashes and instructor clashes reported in the same shape, so that the screen can present both the same way.
12. As an admin, I want an event whose room is free but whose instructor is busy to be refused, so that a partial check does not read as approval.
13. As an admin restricted to read-only on an entity, I want every path to that entity's write actions to refuse me, so that the restriction means what it says.
14. As a superadmin, I want an admin's blocked action to stay blocked regardless of which screen they came from, so that the role model is trustworthy.
15. As an instructor, I want my schedule to never contain two overlapping assignments, so that I am not expected in two places.
16. As an instructor, I want the pay recorded against my assignments to persist across admin edits to the event, so that my payroll total is stable.
17. As a member, I want the class I booked to have a real, un-clashed instructor, so that the class actually runs.
18. As an admin, I want to be told plainly when a roster edit would drop recorded pay, rather than it happening silently, so that I can decide.
19. As an admin, I want a main instructor who cannot also be listed as supporting, enforced identically everywhere, so that the roster cannot contradict itself.
20. As an admin, I want duplicate supporting instructors collapsed rather than rejected, so that a double-click does not produce an error.
21. As an admin editing a class that does not exist, I want a clear "not found", so that I do not see a generic server error.
22. As an admin, I want the same error identity for the same mistake across all four event kinds, so that the screens can share one message table.
23. As a developer, I want one module to read to learn how instructor assignment works, so that I do not have to compare five implementations.
24. As a developer, I want one module to read to learn how overlap is decided, so that a change to the rule cannot land in two of three places.
25. As a developer, I want the roster and occupancy rules exercisable without a live database, so that a mistake in the rule is caught before deploy.
26. As a developer, I want adding a fifth kind of scheduled event to require editing one module, so that the cost of a new event kind is bounded.
27. As an agent working in this repo, I want the roster rule to exist in one named module, so that I do not have to guess which of five copies is authoritative.
28. As an admin, I want the older request shape that omits pay to stop meaning "set pay to nothing", so that a client that has not been updated does not destroy data.
29. As an admin, I want workshop instructor edits to preserve the main-instructor row rather than deleting and recreating the whole roster, so that pay and role survive.
30. As an admin, I want a cancelled or archived event excluded from clash checks, so that past and cancelled events do not block new scheduling.

## Implementation Decisions

### Roster module

- A single roster module becomes the only code that writes instructor assignment rows and per-instructor pay for classes, PT sessions, workshops and corporate sessions. The four scheduling modules and the payroll module call it; none of them write those tables directly any more.
- Interface, kept deliberately small: read the roster for one or many events; replace a roster; set pay for one instructor on one event. Everything else — deduplication, the main-cannot-also-be-supporting rule, the numeric storage format, and role handling — is implementation, not interface.
- **Pay carries over a roster replace.** Replacing a roster merges against the existing rows: an instructor who was already on the event keeps their recorded pay unless the caller supplies a new value. Pay is only cleared when an instructor leaves the roster, or when the caller explicitly sets it to unpriced. This is the decision that closes the data-loss defect and it is the module's central invariant.
- The older request shape that carries only instructor ids (and therefore no pay) is treated as "these are the instructors, leave pay alone", not as "these are the instructors, pay is nothing". This is a behaviour change to that shape and is intentional.
- Workshops model the main instructor as a role on an assignment row while the other three kinds model it as a column on the event. The roster module absorbs that asymmetry; callers see one shape and stop re-deriving the combined instructor list. The nine sites that currently derive that combined list are replaced by reads from this module.
- One error vocabulary for the whole module, expressed with the project's existing typed errors so the error middleware maps them to correct statuses. The bare `Error` throws in the class scheduling module are replaced; a missing class must produce a 404, not a 500.

### Occupancy module

- One module answers occupancy for both subjects — room and instructor — over all four event tables.
- Interface: a check taking the subject (room or instructor plus id), the time window, and an exclusion for the event being edited. It returns either "free" or the conflicting event's identity and window.
- Self-exclusion is uniform: every kind of event can be excluded by its own id, so rescheduling never conflicts with itself. The current asymmetry (corporate has exclusion, PT does not) disappears.
- Cancelled and non-active events are excluded from the scan, consistently across all four tables. The instructor archive check that currently omits the "future only" term is brought in line.
- The overlap decision itself is a pure function over two windows, called by the module and independently checkable. The database query narrows candidates; the pure function states the rule.
- Every create and every edit on all four event kinds calls this module for both room and instructor. Specifically, class create, class edit, and PT session edit gain the instructor check they lack today.
- Conflict responses use one error identity and one payload shape for both subjects.

### Write-permission seam

- The read-only restriction for a role is decided per action, at the action's own module, not by matching a path prefix during routing. Mounting the same action under a second path can no longer re-open it.
- The duplicate mount of workshop cancellation is removed; one path, one response shape. If both paths must remain for client compatibility, both delegate to the same guarded module and return the same shape.
- Applying this pattern to the remaining prefix-gated entities is in scope only insofar as the workshop case requires; a sweep of every entity is not.

### Sequencing

Occupancy and the permission seam are independent of the roster work and can land first. The roster module lands before the payroll spec's work, because the payroll module becomes one of its callers.

## Testing Decisions

- **What a good test is here:** it states a rule in terms an admin would recognise and does not name the internals. "Replacing a roster keeps pay for an instructor who stays" is a test. "The merge helper is called with three arguments" is not.
- **Prior art:** the repo's only existing check is the name-splitting self-check in the backend's shared library — a plain file using `node:assert`, run with `tsx`. That pattern is the model. No test framework is introduced.
- A `check` script is added to the backend that runs every `*.test.ts` under `src` using Node's built-in test runner with the `tsx` import hook. This needs no new dependency — `tsx` is already a dev dependency.
- **What gets checked, because it is pure and decidable without a database:**
  - the roster merge — pay carried over, pay cleared on departure, pay overridden when supplied, duplicates collapsed, main-as-supporting rejected;
  - the overlap predicate — touching-but-not-overlapping windows, containment in both directions, identical windows, zero-length windows;
  - self-exclusion — an event never conflicts with itself.
- **What is not unit-checked, deliberately:** the database queries themselves. They are verified by typecheck and by exercising the flows in the running app. The design requirement is that no *rule* lives only inside a query — the query narrows, the pure function decides.
- Verification for anything not covered by a check remains `tsc --noEmit` in the backend plus manual exercise of the four scheduling flows in the portal.
- Regression to demonstrate by hand before calling this done: price a supporting instructor on Payroll, edit that class's roster from Schedule, confirm the pay is still there.

## Out of Scope

- The frontend work in the portal review (candidates F, G, I) — separate spec.
- The credit ledger and payroll aggregation work (candidates B, D) — separate spec.
- Collapsing the near-clone editors in the portal's event detail screen (candidate H) — still under exploration.
- An SGD money module (candidate J) — deferred, no defect traced to it.
- Introducing a test framework, an integration-test database, or CI test execution.
- Changing the database schema. The pay columns, the assignment tables and the capacity columns stay as they are; only the code that writes them changes.
- Reconciling the three meanings of "capacity" across read paths. Noted in the review, not addressed here.
- Notifying instructors or members when an event is edited.

## Further Notes

- The pay-loss defect is live on `staging` today and needs no unusual setup to reproduce, so it is worth reproducing once before the fix to confirm the mechanism, and once after.
- The permission bypass is the smallest change in this spec — potentially a single deleted mount — and closing it does not depend on any of the roster work. It should not wait.
- The review found a related but separate gap: changing a PT session's type between one-to-one and two-to-one via edit does not reconcile credits, attendees or bookings. That belongs to the credit ledger spec, but the roster work touches the same edit path, so expect the two to meet there.
- The class scheduling module currently throws bare errors that surface as 500s. Fixing that is part of this work, not a follow-up, because the whole point of one roster module is one error contract.
- No ADRs exist in this repo, so nothing here contradicts a recorded decision. If the "pay carries over a roster replace" rule is later reversed, that reversal is worth recording as the project's first ADR.
