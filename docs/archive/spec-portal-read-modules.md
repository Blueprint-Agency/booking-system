# Spec — Portal local-day rule, surface reads, and deletions

Covers architecture review candidates **F** (local-day rule), **G** (one module per portal surface) and **I** (delete before deepening), plus the three small extractions that survived the exploration of candidate **H**. All are `fe-portal` changes with no backend counterpart.

Status: ready for agent. Source: architecture review 2026-08-09; H exploration 2026-08-09.

## Problem Statement

**Dates land on the wrong day.** Converting between a calendar day the admin sees and the timestamp the backend stores is written nine times across the portal under six different names, with four different conventions for what time of day a date means. One of those copies was fixed recently to stop a date shifting by a day; three others still carry the original defect. A workshop day added near midnight, a promotion window, and a PT session created from a request can each land on the wrong date depending on the hour the admin is working.

**Every screen re-learns the backend.** The portal has one good place for talking to the backend — it handles the token, parses the response and reports failures — but everything above it is copied per screen: route strings, response shapes (41 hand-written shape declarations across 27 screens), the rule that archived instructors are filtered out (copied six times, and missed in one place), the mapping from a backend error code to the sentence an admin reads (copied four times), and three different response envelope conventions that a caller must simply know. A backend shape change means finding every copy. A missed copy is a silent wrong screen.

**Some of the code describes a system that no longer exists.** One shared type file mirrors a markdown design document rather than the live backend: it declares fields the backend never sends (which screens fabricate to satisfy the type), fills a date field with an empty string, and never learned that "blocked client" is expressed differently now. One helper file has no importers at all and still pulls in mock fixtures. Nine shipping screens still read mock fixtures with nothing marking them as such. For a developer — and for an agent reading this repo — these are confident, wrong answers.

## Solution

One **local-day** module owns the calendar-day ↔ timestamp conversion, with one convention, exported so it can be checked.

One module **per portal surface** — catalog reads, schedule edits, payroll — owns the route, the response shape, the archived filter and the error copy for that surface. Screens call named reads instead of assembling URLs and re-declaring shapes. These modules take the backend handle as a parameter, so a screen's behaviour can be exercised without a live login.

Dead and drifted files are deleted rather than deepened.

From the admin's side: dates stop shifting, error messages read the same everywhere, archived instructors stop appearing where they shouldn't, and two live form defects found during exploration are fixed.

## User Stories

1. As an admin, I want a workshop day I add to keep the date I picked, so that the schedule shows the day I meant.
2. As an admin working late in the evening, I want dates to behave the same as they do in the morning, so that the hour I work does not change the result.
3. As an admin, I want a promotion window to start and end on the days I chose, so that a promotion does not open or close a day early.
4. As an admin, I want a payroll date range to include both endpoint days in full, so that sessions on the boundary are not missed.
5. As an admin, I want a session scheduled from a request to land on the requested date, so that the member is not moved a day.
6. As an admin, I want the payroll calendar to bucket a late-evening session on the day it happened locally, so that the calendar matches the schedule.
7. As an admin, I want a date I see in a list to equal the date shown when I open that record, so that list and detail agree.
8. As an admin, I want the same wording for the same failure on every screen, so that I learn one set of messages.
9. As an admin, I want a room clash explained the same way whether I am editing a class, a PT session or a workshop, so that the message is recognisable.
10. As an admin, I want archived instructors excluded from every instructor picker, so that I cannot assign someone who has left.
11. As an admin, I want archived instructors excluded from workshop screens too, so that the exclusion is not screen-dependent.
12. As an admin, I want a save button that is disabled when a required field is empty, so that clicking it does not silently do nothing.
13. As an admin, I want a corporate session's client name required before saving, so that I cannot create an unnamed session.
14. As an admin, I want failures reported the same way — a message where I am looking — rather than sometimes a toast and sometimes inline, so that I do not miss one.
15. As an admin, I want a screen that fails to load to say why, so that I can tell a permission problem from an outage.
16. As an admin, I want pay entry on workshop instructors to accept cents from a phone keypad, so that mobile entry matches desktop.
17. As an admin, I want the supporting-instructor editor to behave identically on class edit, PT edit and new class, so that muscle memory transfers.
18. As a developer, I want one module to read to learn how a calendar day becomes a timestamp, so that I do not pick the wrong one of six.
19. As a developer, I want that conversion exported and checked, so that the day-shift defect cannot come back unnoticed.
20. As a developer, I want one module per portal surface to own its routes and shapes, so that a backend change is one edit.
21. As a developer, I want the backend handle passed in rather than reached for, so that a screen's behaviour is exercisable without a live login.
22. As a developer, I want no type in the repo describing a backend that no longer exists, so that types can be trusted.
23. As a developer, I want files with no importers deleted, so that reading the repo does not mean reading dead paths.
24. As a developer, I want screens that read mock fixtures to be obvious, so that I do not mistake a fixture for live data.
25. As an agent working in this repo, I want one authoritative shape per backend response, so that I do not propagate a drifted copy.
26. As an agent, I want each shape declaration to name the backend file it mirrors, so that I can check it against the source.
27. As an admin, I want existing screens to keep working unchanged through this cleanup, so that a refactor is invisible to me.

## Implementation Decisions

### Local-day module

- One exported module owns the conversion in both directions: a local calendar day from a timestamp, a timestamp from a local day plus a time, and a full-day range for a local day.
- **One convention, stated once:** a bare calendar day means local midnight to the last instant of that local day. The noon workaround currently used on the payroll screen to dodge the shift is removed — with the conversion correct, it is unnecessary.
- All existing copies are replaced, including the three that still slice a UTC timestamp and therefore still carry the defect, and the one declared inside a render loop.
- The two explanatory comments that currently document the convention at call sites become the module's own documentation.
- The module is pure and takes an explicit clock where "today" is involved, so it is checkable.

### Surface modules

- One module per portal surface. At minimum: catalog reads (instructors, rooms, locations, class types), schedule edits (class, PT, corporate detail and patch), and payroll. Each owns its routes, its response shapes, its response-envelope handling, and its error copy.
- **The archived-instructor filter lives in the catalog module**, not in each caller. This removes six copies and fixes the workshop screen that currently omits it.
- **One error-copy mapping for the schedule surface.** The two byte-identical mappings on the class and PT paths collapse to one; the corporate mapping already exists as its own module and is the pattern being followed. Message wording is unified to the more specific of the existing variants.
- Each surface module takes the backend handle as a parameter rather than reaching for context. The payroll manual-entry dialog already does this and is the prior art.
- Screens stop declaring their own response shapes for anything a surface module covers. Shapes that remain local are annotated with the backend file they mirror, following the convention the payroll helper file already uses.
- Migration is incremental and per surface: catalog first (highest copy count, lowest risk), then schedule, then payroll. Screens not yet migrated keep working.

### Deletions

- The unimported schedule helper file is deleted outright.
- The shared domain type file is reduced to what screens actually import — mostly enumerations. Shapes that describe fields the backend does not send are removed rather than corrected, and their consumers move to the relevant surface module. Fabricated placeholder values disappear with them.
- The dead back-compat re-export in the workshop editor is removed.
- Mock fixtures remain in place for screens that are not yet wired to the backend, but each such screen gets a single explicit marker comment naming it as fixture-backed, so the distinction is visible without tracing imports.

### Extractions carried over from candidate H

Exploration concluded the three event editors should **not** be collapsed into one module — see Out of Scope. Three smaller extractions from that exploration are in scope here:

- **One supporting-instructor editor module** covering the three copies that are genuinely the same: class edit, PT edit, and new class. Its interface is the instructor list, the current rows, a change handler and a disabled flag. The corporate and workshop variants are deliberately excluded — they have no pay input and a different markup shape, and including them would widen the interface to the point where the module stops paying for itself.
- **One shared schedule error-copy module**, replacing the duplicated class and PT mappings.
- **One location-and-room selection module** covering the identical cluster on five screens: active locations, rooms filtered to the selected location, and clearing the room when the location changes. **The PT scheduling dialog is excluded** — it auto-selects the first room instead of clearing, and unifying it would change which room a PT session is booked into.

Two one-line defects found during that exploration are fixed in the same pass: the corporate editor's save button is enabled when the client name is empty (producing a silent no-op), and the workshop detail screen loads instructors without the archived filter every other screen applies.

## Testing Decisions

- **What a good test is here:** it states a rule an admin would recognise. "A timestamp late on the 9th in Singapore is the 9th, not the 10th" is a test. "The formatter calls `getDate`" is not.
- **Prior art:** the backend's name-splitting self-check — a plain file using `node:assert`. The portal has no test setup at all today, so this spec adds the smallest thing that runs: `tsx` as a dev dependency and a `check` script using Node's built-in test runner. No test framework, no rendering harness, no browser driver.
- **What gets checked:**
  - the local-day conversion — a timestamp late in the local evening, a timestamp early in the local morning, round-tripping a day through both directions, the full-day range including both endpoints, and a day derived from an explicit clock;
  - the schedule error-copy mapping — each known backend error code produces its message, and an unknown code falls back rather than showing a bare status.
- **What is not checked:** rendering, form state and effects. The portal has no rendering harness and this spec does not introduce one; the surface modules are shaped so that a harness could be added later without redesigning them, but that is not this work.
- Verification for everything else is `npm run typecheck` in the portal (note: the portal's lint script is unreliable — do not gate on it) plus a build, and manual exercise of the affected screens.
- Regressions to demonstrate by hand, ideally in the evening local time: add a workshop day and confirm the date; set a promotion window and confirm both endpoints; filter payroll by a range and confirm boundary sessions appear.

## Out of Scope

- **Collapsing the three event editors into one module.** Explored and rejected: the three share a frame but diverge on state shape, payload keys, validation, error copy and where cancellation lives. A single module covering all three would need an interface nearly as wide as the implementations it replaces, and the exploration identified three concrete silent-failure regressions it would risk — a changed instructor key on the PT patch, a cancellation posted against the wrong identifier, and pay fields newly sent on the corporate patch. The duplication has good locality; the abstraction would not. The three targeted extractions above capture the value that is real.
- **Workshops joining any unified event editor.** Workshop timing, room and capacity are per-day and saving is a multi-request sequence; the variation is the whole model, not a field.
- Regenerating portal types from the backend automatically, or introducing a shared package between the two. The apps stay decoupled.
- Rendering tests, browser tests, or a component harness.
- Wiring the fixture-backed screens to the backend.
- Any backend change. Where a portal screen currently works around a backend shape, it keeps working around it; changing the backend response is a separate decision.
- The client-facing app.

## Further Notes

- The local-day module is the smallest diff of anything in the three specs and fixes three live defects. It is the sensible first commit.
- The exploration of candidate H is worth preserving as reasoning: the "don't collapse" conclusion is the kind of thing a future architecture review will re-suggest unless it is recorded. This repo has no `docs/adr/`; if one is created, this is a good first entry.
- The portal's `lint` script is known to be unreliable in this project — gate on `typecheck` and `build`.
- Six copies of supporting-instructor markup exist; this spec unifies three. The remaining three are deliberately left alone, and that decision should not be quietly reversed by a later sweep.
