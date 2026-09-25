# Tickets — Class capacity and waitlist (`spec-waitlist.md`)

Five tickets (#307–#311), each sized for one agent session. Each cites the spec sections it implements; the spec is the source of truth and the ticket carries only what is needed to start. Order: T1 → T2 → (T3, T4, T5 in parallel).

---

## T1 (#307) — Seats: `bookings.seat`, one capacity module, staff booking and overbook

**Spec:** §1, §2, §7 (staff booking and overbook only), §10 (stats, seat tags, Add member), §13 step 1 and 4a, §14 (`admin-restructure.md` §7d, SCH-04).

### What to build

- Migration: `bookings.seat` enum `online | buffer | overbook`, `NOT NULL DEFAULT 'online'`; backfill is the default (every class booking today came through the member route).
- `be/src/services/bookings/seats.ts`: `countSeats(tx, tenantId, classId)` → `{ online_used, buffer_used, overbook_used, attending }` over `state = 'confirmed'`; pure `seatFor(counts, capacities, role, overbook)` → `'online' | 'buffer' | 'overbook' | refusal`.
- Replace the private counts in `bookings/book.ts`, `schedule/client-catalog.ts`, `schedule/timetable.ts`, `schedule/detail.ts` with `countSeats`. Member `spots_left` keeps its meaning (`capacity_online − online_used`). Portal `capacity` becomes attendance capacity (`online + buffer`); timetable and detail return `attendance_capacity`, `online_used`, `buffer_used`, `overbook_used`, `attending`.
- `POST /portal/admin/schedule/classes/:id/bookings { client_id, overbook?: boolean }` and the instructor equivalent (own classes only): books through the same service as the member route (`selectPackage`, debit, activation, QR) with `seat` from `seatFor`. Full → `409 class_full { waitlist_open: false, waiting: 0, capacity_waitlist }` (the waitlist fields are stubs until T2 fills them). Instructor never overbooks.
- `capacity_below_bookings` on class edit compares against `online_used`, not all confirmed.
- fe-portal session page: stats per §10 ("Booked 8 / 16", seats line, overbook count); roster rows tagged `buffer` / `overbook`; **Add member** (client search → book → on `class_full` the admin prompt "No seats left. Overbook?" / instructor "No seats left."; the "add to waitlist" half of the prompt arrives in T4). Timetable cells read `attending / attendance_capacity`. `capacity-fields.tsx` shows "Attendance capacity: N · Waitlist: M".
- Instructor session page gets the same roster and Add member (buffer only); replace the 501 `routes/portal/instructor/roster.ts` stub with the detail service scoped to the instructor's classes.
- Error codes: `class_full` body shape documented; no new code. Update `docs/md/be-portal.md` route table and `admin-restructure.md` §7d.

### Before starting (human)

- `test-scenarios.md` SCH-04 asserts max capacity 17 for 10/2/5. The spec changes it to attendance capacity 12 with 5 waiting. A human edits or approves editing that row. It is uncovered, so no test file is touched by the change.

### Acceptance criteria

- [ ] `bookings.seat` exists; existing rows are `online`; RLS policy unchanged.
- [ ] `countSeats` is the only place that counts confirmed bookings for capacity; `grep "state, 'confirmed'"` across the four call sites finds no private count.
- [ ] Member catalogue `spots_left` is unchanged for every existing test (`booking-lifecycle`, `booking-credits`, `class-series`).
- [ ] Staff booking takes a buffer seat and leaves `spots_left` unchanged (SEAT-01).
- [ ] Staff booking when buffer is full → `class_full`; admin with `overbook: true` succeeds and the row shows `overbook`; instructor with `overbook: true` still gets `class_full` (SEAT-02).
- [ ] Portal detail, timetable and member catalogue agree on the numbers for the same class (SEAT-04).
- [ ] Another studio's bookings never count toward this studio's seats (SEAT-05, in `isolation.test.ts`).
- [ ] Session page shows "Booked N / attendance capacity", seat tags, and Add member for both roles.
- [ ] `docs/md/test-scenarios.md` gains SEAT-01..05 and the approved SCH-04 wording.

### Blocked by

None.

---

## T2 (#308) — Waitlist backend: table, join/leave, promotion on cancel, expiry, flag, email

**Spec:** §3, §4, §5, §6, §8, §11, §13 steps 2–3 and 5 (backend half), §14 (`backend-architecture.md` §8 and :1190, `class-booking-lifecycle.md` G7, `be-client.md`, `be/CONTEXT.md`).

### What to build

- Migration: `waitlist_status` enum and `waitlist_entries` table per §3, with `tenant_id NOT NULL`, RLS policy like every domain table, and the partial unique index on `(class_id, client_id) WHERE status = 'waiting'`.
- `be/src/services/waitlist/`:
  - `join(tenantId, clientId, classId, now)` with the §4 checks in order, under the class row lock. Returns `{ entry_id, position }`.
  - `leave(tenantId, clientId, entryId)` → `withdrawn`; no `cancellations` row, no inbox item.
  - `positionOf` / `listForClient` / `listForClass` (read-time position by `(joined_at, id)`).
  - `promoteFromWaitlist(tx, tenantId, classId, now)` per §5: returns immediately inside the window; otherwise walks `waiting` entries in order, re-runs `sweepExpired` + `selectPackage` per entry, books through the same service as the member route with `seat = 'online'`, marks `promoted` with `booking_id`, enqueues the email; skipped entries stay `waiting`.
  - Pure `nextToPromote(entries, outcomes)` for the ordering/skip rule.
- Hook: `cancelBooking` calls `promoteFromWaitlist` after the booking flips to `cancelled`, inside the same transaction, only when the cancelled booking's `seat = 'online'`. Refund- and complimentary-driven cancels already go through `cancelBooking`, so they promote for free. `cancelClass` sets `waiting` → `removed` for the class.
- Expiry: `jobs/index.ts` gains `expireWaitlists` on the 5-minute cron (`waiting` on classes whose `starts_at` has passed → `expired`). Reads treat such rows as expired too.
- Feature flag `waitlist_enabled` via the existing `feature_flags` table and `isEnabled`; seed nothing (unset = off). `join` refuses with `waitlist_disabled` when off; promotion still runs.
- Routes: `POST /me/waitlist/classes/:classId`, `DELETE /me/waitlist/:entryId`, `GET /me/waitlist`. Catalogue (`/public/classes`, `/public/classes/:id`, `/me/classes`) adds the `waitlist { enabled, capacity, waiting, open, my_entry }` object per §9; `my_entry` is null on the public route.
- T1's `class_full` body now carries real `waitlist_open` / `waiting`.
- Notification: slug `class_waitlist_promoted` with the §11 variables, seeded in `email-copy.ts`, declared in `TEMPLATE_VARIABLES`, sent from promotion via the existing enqueue path.
- New error codes in all three catalogues (`be/src/shared/error-codes.ts`, `fe-client/src/lib/error-codes.ts`, `fe-portal/src/lib/error-codes.ts`): `waitlist_disabled`, `waitlist_closed`, `waitlist_full`, `already_waitlisted`, `class_not_full`.

### Note on tests

`be/src/test/booking-lifecycle.test.ts` proves today's behaviour ("full class refuses; freed seat is bookable"). Those assertions stay true — a member who never joined the waitlist still gets the freed seat by booking. The promotion journey from #140 is added as new tests, not by editing existing ones. If any existing assertion has to change, stop and list it for `.claude/test-edits.allow`.

### Acceptance criteria

- [ ] WTL-01..08, 10..15 from the spec's Testing Decisions pass over HTTP (join, refusals in §4 order, promotion, skip-and-stay, race, leave, expiry, class cancel, refund-driven cancel, flag off).
- [ ] WTL-09 half: cancel inside the window promotes nobody (staff Add to class is T4).
- [ ] WTL-16: a promoted booking cancels under the normal policy with credit returned.
- [ ] Promotion is inside the cancel transaction; two concurrent cancels with one waiting member yield exactly one booking and one debit.
- [ ] A cancelled `buffer` / `overbook` booking promotes nobody (SEAT-03).
- [ ] `email-copy.test.ts` slug-parity test passes with the new slug; the promotion test sees one enqueued `class_waitlist_promoted`.
- [ ] Isolation: another studio's `waiting` rows never count toward, or promote into, this studio's class.
- [ ] `be-client.md` documents the three routes and the catalogue field; `backend-architecture.md` §8 no longer says deferred.

### Blocked by

#307.

---

## T3 (#309) — Member app: Join waitlist, position, leave

**Spec:** §9, §13 step 2 (fe-client half), §14 (`fe-client-features.md` §Booking Rules and §Notifications).

### What to build

- `fe-client/src/lib/classes.ts`: add the `waitlist` object to the class type; `lib/waitlist.ts` with `joinWaitlist`, `leaveWaitlist`, `listWaitlist`.
- `class-row.tsx`: button precedence per §9 — Booked → "On waitlist · #N" (+ Leave) → Book Now → "Join waitlist" (outlined, warning tone) → Full. Join toast copy from §9. Error mapping: `waitlist_closed` → "This class starts within N hours, so the waitlist has closed."; `waitlist_full` → "The waitlist for this class is full."; `already_waitlisted` / `already_booked` → refresh the row; package-selection codes reuse the booking copy and the no-package dialog.
- My Bookings (`class-bookings.tsx`): "Waitlisted" group above Upcoming showing class, time, "#N in line", "Leave waitlist" with a confirm dialog and a "Left the waitlist." banner. Fetch via `GET /me/waitlist` alongside the existing upcoming call.
- Copy: no email on join; the toast and My Bookings are the only feedback. Update `fe-client-features.md` §Booking Rules (the "Join Waitlist" rows now describe shipped behaviour) and §Notifications (join toast; promoted email).

### Acceptance criteria

- [ ] With `waitlist.open` and `spots_left = 0`, the row shows "Join waitlist"; with the flag off or the list full it shows "Full".
- [ ] Joining updates the row to "On waitlist · #N" without a reload and shows the toast.
- [ ] Leave from the row and from My Bookings both return the row to "Join waitlist" (if still open) or "Full".
- [ ] A class the member is booked on never shows a waitlist control.
- [ ] Every new error code has member copy; unknown codes fall back to the existing generic dialog.
- [ ] Browser journey added under `e2e/` per `docs/md/e2e-journeys.md`: full class → join → position shown → leave.
- [ ] `fe-client-features.md` updated; no fe-client code imports from `be/` or `fe-portal/`.

### Blocked by

#308.

---

## T4 (#310) — Portal: waitlist panel, Add to class, Remove, overbook-or-waitlist prompt

**Spec:** §7 (promote route and the full prompt), §10 (Waitlist panel, timetable "+N waiting"), §8 (flag on the feature-flags screen and the capacity-field label), §13 step 4, §14 (`be-portal.md`).

### What to build

- Routes: `POST /portal/{admin,instructor}/schedule/classes/:id/waitlist/:entryId/promote { overbook?: boolean }` (books that entry regardless of the window: online seat if free, else buffer, else `class_full` unless admin overbook) and `DELETE …/waitlist/:entryId` (→ `removed`, `resolved_by` = staff id). Detail service returns `waitlist[]` in order with `position`, `client`, `joined_at`, `payment_status` (`pending: <package name>` | `cannot_pay: <reason>`, computed read-time with `selectPackage`, no writes).
- Session page (admin and instructor): **Waitlist** panel under the roster per §10 with Add to class / Remove per row and the "Waitlist N / M" stat; "Promoted from waitlist" hint on roster rows with a `waitlist_entries.booking_id`. Add member's full prompt: admin "No seats left. Overbook, or add to the waitlist?" (three buttons: Overbook / Add to waitlist / Cancel); instructor "No seats left. Add to the waitlist?". "Add to waitlist" from staff calls the same join service as a staff-initiated join (add a `resolved_by`-style `joined_by` if needed, or reuse `join` with the staff id in the audit column).
- Timetable cells: "+N waiting" when non-empty.
- Feature-flags screen: `waitlist_enabled` appears with a one-line description; `capacity-fields.tsx` labels the Waitlist field "(waitlists are off)" when the flag is off.
- `be-portal.md` route table updated.

### Acceptance criteria

- [ ] WTL-09 second half: inside the window, Add to class books the head of the line; the entry reads `promoted` and the roster shows the hint.
- [ ] Add to class when the member cannot pay → the package-selection error is shown inline on the row; entry stays `waiting`.
- [ ] Remove → entry `removed`, positions behind it shift, the member's app shows "Join waitlist"/"Full" on next load.
- [ ] Admin overbook from the prompt creates a booking with `seat = 'overbook'`; the instructor prompt has no overbook button and the route refuses it.
- [ ] Waitlist panel order matches `(joined_at, id)` and the member-visible positions.
- [ ] Flag off: the panel still lists and can act on existing entries; the capacity field carries the "(waitlists are off)" label.
- [ ] Browser journey under `e2e/`: staff sees the waitlist, promotes one member, removes one.

### Blocked by

#308 (#307 for the prompt's overbook half).

---

## T5 (#311) — Mindbody migration: bring the live waitlists across, and their capacity

**Spec:** §3, §8, §14. Runbook: `docs/md/mindbody-import.md` §1 (decisions), §2 (download), §3 (transform). Tooling: `be/tools/mindbody/`.

### What we know about the data

- **No Mindbody report carries the waitlist.** The Schedule at a Glance files in the full export (2024–2026, ~80k rows) hold only `Signed in`, `Completed`, `Late Cancel`, `Absent`, `No-Show` and `Reserved`; Attendance without Revenue holds `Signed in`, `No Show`, `Late Cancel`. Mindbody's own status table for classes lists Reserved / Signed-In / Absent / Late Cancel / Made-Up and nothing for a waiting client. So today's transform writes no waitlist rows and could not: `capacity_waitlist: 0` on every class, series, workshop day and PT session (`schedule.ts:192, 566`, `history.ts:361`, `workshops.ts:315`, `pt.ts:116`).
- **The studio uses waitlists.** Contact Logs (report 05, dropped from the cutover profile) shows 405 "You Have Been Added from the Waitlist" messages, 191 in 2025 and 214 in 2026 — about 20 promotions a month — plus a handful of "You've been waitlisted for <workshop>". Every one of those promotions is already a normal reservation in reports 16/17 and comes across as a booking; nothing is lost there.
- **The live waitlists exist only on Mindbody screens**: the Waitlist section at the bottom of each class's Class Sign In screen (queue order, name, payment status), and each client's Client Schedule → Waitlist (request date/time and position). Neither is exportable; both are scrapeable, and the downloader already has a `scrape` runner (Pay Rates, Online Metrics).
- The cutover questionnaire (`studio/docs/CLIENT-QUESTIONS.md` #12, in the private export folder) currently *assumes* "classes we bring across have no waitlist". This ticket turns that assumption into a real decision.

### What to build

- **Decision 21 in the runbook (§1):** waitlists on or off at launch (`feature_flags.waitlist_enabled`), the default `capacity_waitlist` for migrated classes and series, and per-Class-Type overrides — `answers.json` fields, filled by `fill` into the config like Room capacities are (decision 4). Default if the studio has no view: on, waitlist 5, because they used it in Mindbody.
- **Downloader:** a new cutover report kind `waitlists` in `report-files.json` / `download/reports.ts`, `type: 'scrape'`: for every future class on the schedule (from the Staff Schedule report the profile already downloads), open its Class Sign In screen and capture the Waitlist section — `class date, start, description, staff, client id, position, payment status` — into one `.xlsx`, one row per waiting client, in queue order. Skip classes with an empty section. `download verify` counts the rows.
- **Transform:**
  - `capacity_waitlist` on future classes and class series from the config (Class Type override, else default); history rows, workshop days and PT sessions stay 0.
  - `readWaitlists` in `readers.ts`; `waitlist_entries` rows with `status = 'waiting'`, joined to a class exactly as roster rows are (`schedule.ts:340-360`: date, start, name, teacher — or the lone class at that minute). `joined_at` is not on the screen: write `asOf − (position × 1 s)` so the order is exact and every entry predates the freeze; document that in the row comment. A waiting client who is not in the member list, or whose class did not come across, or who is already `Reserved` on the same class, is a preflight line and no row.
  - `feature_flags` row `(tenant_id, 'waitlist_enabled', enabled)` from decision 21 (the table carries `tenant_id`, so the archive already accepts it).
  - `constraints.ts` gains `waitlist_entries` rules; the live-constraint integration test will fail until it does.
  - `<studio>.ids.json` gains `waitlist_entries`; `figures.ts` / `verify` count `waitlisted` in total and per member, so a lost queue fails `verify` like a lost booking does.
  - A waiting entry on a class inside the Cancellation Window at `asOf` is still written (the member was there); promotion after import follows §5 as usual.
- **Not migrated, listed in the preflight:** past waitlist promotions as `promoted` entries (the bookings themselves are already across; the only source is 899 Contact Logs pieces), and any workshop waitlists (workshop waitlist is out of the spec's v1).
- **Docs:** runbook §1 table (decision 21), §2 (the new report and its scrape), §3 (the new rows, preflight lines, verify figures). `CLIENT-QUESTIONS.md` #12 is the studio's to answer, in the private folder, not the repo's.

### Note on tests

`be/tools/mindbody/transform/transform.test.ts` pins every `report-files.json` entry to its matcher and rules, and `download/plan.test.ts` checks the file names — both gain the new kind. Fixture rows for the new report go beside the others in `transform/fixtures/` (invented names only). `import.test.ts` gets one journey: archive with two waiting members on a full future class → import → cancel one confirmed booking → the first waiting member is promoted.

### Acceptance criteria

- [ ] `npm run mindbody:download -- --profile cutover --dry-run` lists the `waitlists` report; a real run writes one file with one row per waiting client, in order, for future classes only.
- [ ] `transform` refuses to run while decision 21 is open, like every other decision.
- [ ] Future classes and series carry the configured `capacity_waitlist`; history, workshop days and PT sessions stay 0.
- [ ] Every scraped waiting client becomes a `waiting` entry on the right class with the right order, or a named preflight line; none is silently dropped.
- [ ] The archive carries the `waitlist_enabled` flag; after import the member app shows "Join waitlist" or "Full" according to it.
- [ ] `verify` reports a difference when a waiting entry is missing after import.
- [ ] `import.test.ts` journey: an imported queue promotes on the first cancel.
- [ ] The rehearsal on staging (runbook §7) is rerun with the new report and its timing recorded.

### Blocked by

#308 (the table, the flag and promotion must exist).
