# Spec — Class capacity: online seats, buffer seats and the waitlist

Resolves #152 ("Class waitlist: no join, no promotion — build it for v1 or keep deferred?"). The behaviour follows Mindbody's class waitlist, because it is what studio staff and members already know: online capacity fills first, staff fill the rest, a full class offers a queue, a freed seat goes to the head of the queue automatically while there is still time to cancel, and staff can override by hand. Sources are the Mindbody support articles listed under Further Notes.

**Status:** draft for human review. **Vocabulary:** `be/CONTEXT.md` § Bookings (Booking, Package, Credit, Cancellation Window). New terms are defined in §1.

---

## Problem Statement

1. **Three numbers, one of them honoured.** Every class, class series, workshop day and PT session stores `capacity_online`, `capacity_buffer` and `capacity_waitlist` (`be/src/db/schema/schedule.ts:54-56`). Booking reads only `capacity_online` (`be/src/services/bookings/book.ts:86-98`). Buffer and waitlist are numbers staff can type in and see, and nothing acts on them.
2. **"Capacity" means three different things.** The member catalogue says `spots_left = capacity_online − confirmed`. The portal timetable and detail page say `capacity = online + waitlist + buffer` (`timetable.ts:169`, `[id]/page.tsx:171`), so a class with 10 online, 6 buffer, 5 waitlist reads "Booked 3 / 21" when only 16 people can ever be in the room. `admin-restructure.md` §7d defines `max_capacity` the same wrong way, and test scenario SCH-04 asserts it.
3. **Staff cannot book anyone.** There is no admin or instructor route that books a member onto a class (`routes/portal/admin/bookings.ts` has only cancel and no-show), so the buffer — "reserved for staff / walk-ins" per §7d — has no way to be used.
4. **A full class is a dead end.** `POST /me/bookings/class` returns `409 class_full` and writes nothing. The member app shows "Full". `fe-client-features.md` §Booking Rules promises "Join Waitlist" and `prd.md` promises a waitlist toggle; neither exists.
5. **A freed seat goes to whoever refreshes first.** `cancelBooking` frees the seat by flipping the booking to `cancelled` (`cancel.ts:38`: "there is no class waitlist to promote yet — #152"). Nothing runs when a seat frees.

## Solution

**Two kinds of seat, one queue.** A class has `capacity_online` seats members book themselves and `capacity_buffer` seats only staff can fill. Attendance capacity is their sum. `capacity_waitlist` is not a seat count: it is how many members may stand in line once the online seats are gone. This is Mindbody's model (total capacity, "how many can book online", "how many can waitlist"), stored with the buffer made explicit instead of derived.

**Members join a queue, and the queue fills seats by itself.** When the online seats are full and the waitlist is open, the member app offers "Join waitlist". Joining costs nothing and takes no credit; it checks that the member *could* pay. When a confirmed online booking is cancelled outside the Cancellation Window, the first member in line whose package can still pay is booked in the same transaction — credit debited, package activated if dormant, booking `confirmed` — and emailed. Inside the window nobody is moved automatically; staff move people by hand.

**Staff see the queue and can act on it.** The session page gains a Waitlist panel in queue order with each member's payment status, "Add to class" and "Remove". Staff can also book a member directly, which takes a buffer seat, and an admin can overbook past the buffer after an explicit confirmation.

**Numbers say what they mean.** "Booked 8 / 16" is people in seats over attendance capacity; the waitlist is shown beside it as "3 waiting of 5". The member sees `spots_left` against online seats only, as today.

## User Stories

### Members

1. As a member, when a class's online seats are full and it has a waitlist, I want a "Join waitlist" button instead of a dead "Full", so that I still have a chance of attending.
2. As a member, I want to see my position ("You're #3 in line") right after joining and later under My Bookings, so that I can judge my odds.
3. As a member, I want to leave a waitlist at any time before the class starts without penalty, so that queueing is free of risk.
4. As a member, when a seat opens and I am first in line with a package that can pay, I want to be booked automatically and emailed, so that I don't have to watch my phone.
5. As a member promoted from the waitlist, I want the usual right to cancel within the policy, so that being promoted never traps me in a class I can no longer make.
6. As a member, I want to be refused from joining a waitlist that is full, closed because the class starts within the Cancellation Window, or for a class I'm already booked on or already queued for, with a clear reason.
7. As a member whose package can no longer pay when my turn comes, I want to stay in line rather than be silently dropped, so that buying a package puts me back in contention.
8. As a member, I want to see "Full" and nothing else when a class has no waitlist or the waitlist is full, so that the app never offers something it can't do.

### Staff

9. As an admin or instructor, I want the session page to show the waitlist in order with each member's join time and whether their package can pay, so that I know who gets the next seat.
10. As an admin or instructor, I want to add a member to a class from the roster, taking a buffer seat, so that walk-ins and phone bookings are recorded like everyone else.
11. As an admin, when online and buffer seats are both full, I want to be asked "Overbook, or add to the waitlist?" and to be able to overbook, so that a regular at the front desk is never turned away by software.
12. As an instructor, I want the same prompt but without the overbook option, so that only admins can exceed the room.
13. As an admin or instructor, I want "Add to class" on a waitlist row, so that inside the Cancellation Window I can still fill a freed seat by hand.
14. As an admin or instructor, I want "Remove" on a waitlist row, so that a member who phoned to say they can't make it is taken out of the line.
15. As an admin, I want to turn waitlists on or off for the whole studio, so that a studio that doesn't want queues sees plain "Full" buttons.
16. As an admin, I want reducing `capacity_waitlist` below the current line length to be allowed and to stop new joins rather than evict anyone, so that a settings change never throws members out.
17. As an admin, I want cancelling a whole class to clear its waitlist too, so that nobody is left queued for a class that won't run.

### System

18. As the system, I want promotion to run inside the cancel transaction under the class row lock, so that two simultaneous cancels can't hand one seat to two people or one person two seats.
19. As the system, I want the waitlist to close itself when the class starts, marking remaining entries expired, so that queues don't outlive their class.
20. As the system, I want a refund- or admin-driven cancel to promote exactly like a member cancel, so that `spec-pre-launch-batch.md` §580's "waitlist promotion comes free" becomes true.

### Developer and agent

21. As a developer, I want one definition of "seats used" and "seats free" in one module, so that the catalogue, timetable, roster and promotion cannot drift.
22. As an agent writing tests, I want the queue's rules (join, order, skip, promote, withdraw, expire) to be pure functions over rows, so that they can be tested without HTTP.

## Implementation Decisions

### 1. Vocabulary

| Term | Meaning |
|---|---|
| **Online seat** | One of `capacity_online`. Filled by a member booking themselves, or by a waitlist promotion. |
| **Buffer seat** | One of `capacity_buffer`. Filled only by staff booking a member. Never shown to members. |
| **Attendance capacity** | `capacity_online + capacity_buffer`. The most people the roster can hold without an overbook. |
| **Overbook** | An admin-only staff booking made when every online and buffer seat is taken. |
| **Waitlist** | The ordered line of members waiting for an online seat. Its length is capped by `capacity_waitlist`. Not a seat. |
| **Promotion** | Moving the head of the line into a freed online seat, creating a confirmed booking. |
| **Waitlist open** | Waitlists are enabled for the studio, the class is `active` and not started, `now < starts_at − class_window_hours`, and `waiting < capacity_waitlist`. |

`admin-restructure.md` §7d's `max_capacity = waitlist + online_booking + buffer` is replaced by attendance capacity. SCH-04 ("waitlist 5, online 10, buffer 2 → max capacity 17") is a spec change: the correct reading is 12, with 5 waiting. **This needs a human to approve the scenario edit** per `docs/md/test-guardrails.md`; it is uncovered today, so no test file changes.

### 2. Which seat a booking sits in

Add `bookings.seat` enum `online | buffer | overbook`, `NOT NULL`, default `online` for the backfill (every existing class booking came through `POST /me/bookings/class`).

- Member self-booking and promotion insert `seat = 'online'`.
- Staff booking inserts `seat = 'buffer'` while `buffer_used < capacity_buffer`, else `seat = 'overbook'` when the caller is an admin who passed `overbook: true`, else 409 `class_full` with `waitlist_open` in the body so the portal can offer the waitlist instead.
- Counts, all over `state = 'confirmed'`:
  - `online_used` = seats `online`
  - `buffer_used` = seats `buffer`
  - `attending` = all confirmed (the roster count staff see)
  - `spots_left` (members) = `max(0, capacity_online − online_used)` — unchanged in meaning.
- Promotion fires only when `online_used < capacity_online`. A cancelled buffer or overbook booking frees a buffer seat, which does not promote (Mindbody: staff seats are not the queue's). Staff can still "Add to class" from the waitlist into it.

All of this lives in one module, `services/bookings/seats.ts`, exporting `countSeats(tx, classId)` and pure `seatFor(counts, capacities, role, overbook)`. `book.ts`, `client-catalog.ts`, `timetable.ts`, `detail.ts` and the new waitlist service call it; none keeps a private count.

### 3. The waitlist table

```
waitlist_entries
  id            uuid pk
  tenant_id     uuid not null            -- RLS like every domain table
  client_id     uuid not null → clients
  class_id      uuid not null → classes
  status        waitlist_status not null  -- waiting | promoted | withdrawn | removed | expired
  joined_at     timestamptz not null default now()
  resolved_at   timestamptz               -- when status left 'waiting'
  booking_id    uuid → bookings           -- set on 'promoted'
  resolved_by   text                      -- 'system' | 'client' | staff id, for the audit trail
  unique (class_id, client_id) where status = 'waiting'
```

Order is `joined_at, id`. Position is `1 + count(waiting rows for the class with (joined_at, id) < mine)`. Nothing stores position. Class only in v1; workshops keep their column and their seeded template (§11).

### 4. Joining

`POST /me/waitlist/classes/:classId` → `201 { entry_id, position }`. Inside one transaction with the class row locked `FOR UPDATE`, in this order:

| Check | Error |
|---|---|
| Studio flag `waitlist_enabled` off | 409 `waitlist_disabled` |
| Class missing / not `active` | 404 `class_not_found` |
| `now ≥ starts_at − class_window_hours` | 409 `waitlist_closed` (body carries `window_hours`) |
| Member has a confirmed booking on this class | 409 `already_booked` |
| Member already `waiting` on this class | 409 `already_waitlisted` |
| `online_used < capacity_online` | 409 `class_not_full` (the app should have shown Book) |
| `waiting ≥ capacity_waitlist` | 409 `waitlist_full` |
| `selectPackage` refuses | 409 with the selection reason (`insufficient_credits`, `location_not_covered`, `plan_expires_before_class`) — same codes and same member copy as booking |

No credit is debited and no package is activated at join. Mindbody records the "pending" pricing option at join; we re-select at promotion instead, because packages change between the two moments.

The join check that the class starts outside the window is Mindbody's reason and ours: whoever is promoted must always be able to cancel free. Mindbody has a separate, shorter "waitlist lock window"; we reuse `class_window_hours` and add no new policy field.

### 5. Promotion

`promoteFromWaitlist(tx, classId, now)` is called from `cancelBooking` after the booking flips to `cancelled`, inside the same transaction, holding the class lock it already takes (`cancel.ts:92-110`). It also runs after a staff "Remove" of a confirmed booking and after a refund- or complimentary-driven cancel, which already go through `cancelBooking` (`refunds.ts:1203`, `complimentary.ts:357`).

1. If `now ≥ starts_at − class_window_hours`, return. (Mindbody's default: no auto-add inside the window. Its "First to Claim" / "Continue auto-add" modes are SMS features and out of scope.)
2. While `online_used < capacity_online`:
   - Take the first `waiting` entry in order that has not been tried in this call.
   - Run `sweepExpired` and `selectPackage` for it. If refused, leave it `waiting` and try the next (Mindbody: "Invalid" clients stay on the list and are re-checked when the next spot opens).
   - Otherwise create the booking through the same code path as `bookClass` (debit, dormant activation, QR token, `seat = 'online'`), set the entry `promoted` with `booking_id`, and enqueue the `class_waitlist_promoted` email.
3. Stop when the seats are full or the line is exhausted.

The promoted booking is a normal booking: it cancels under the normal policy and counts toward the member's cancellation cap like any other. Because promotion only happens outside the window, a promoted member always has the full window to cancel free.

### 6. Leaving, removal, expiry

- `DELETE /me/waitlist/:entryId` → `204`. Any time before `starts_at`. Sets `withdrawn`. No `cancellations` row, no inbox item, no cap effect (Mindbody: a waitlist cancel is not a cancellation).
- Staff `DELETE /portal/{admin,instructor}/schedule/classes/:id/waitlist/:entryId` → `removed`, `resolved_by` = staff id.
- Whole-class cancel (`cancel-class.ts`) sets every `waiting` entry `removed` and includes those members in whatever notification the class cancel sends.
- The existing cron sweep marks `waiting` entries `expired` once `starts_at` has passed. Reads also treat a `waiting` entry on a started class as expired, so the UI never shows a live position for a class that has begun.

### 7. Staff booking and overbooking

`POST /portal/{admin,instructor}/schedule/classes/:id/bookings { client_id, overbook?: boolean }` → `201` with the booking, or:

- 409 `class_full { waitlist_open, waiting, capacity_waitlist }` when online and buffer are full and `overbook` is not set or the caller is an instructor. The portal turns this into the Mindbody prompt: admin sees "No seats left. Overbook, or add to the waitlist?"; instructor sees "No seats left. Add to the waitlist?".
- Package selection errors as for members; a staff booking still debits (there is no "unpaid reservation" in v1).

`POST …/waitlist/:entryId/promote` → books the member exactly as §5 does for one entry, regardless of the window, into an online seat if one is free, else a buffer seat, else 409 `class_full` unless `overbook: true` from an admin. This is Mindbody's "Add to class" button.

Raising `capacity_online` on an existing class does **not** auto-promote (Mindbody: "expanding the capacity … does not automatically add people from the waitlist"). Staff use Add to class. Lowering `capacity_waitlist` below the line length is allowed; it only blocks new joins. Lowering `capacity_online` below `online_used` stays refused as today (`capacity_below_bookings`).

### 8. Studio switch

`feature_flags` row `waitlist_enabled` per tenant, edited on the existing `/portal/admin/feature-flags` route, exposed to the member catalogue as `waitlist.enabled`. Mindbody has the same site-wide "Enable Waitlists". Off means: joins refused, the button reads "Full", capacity forms keep the Waitlist field but label it "(waitlists are off)". Existing `waiting` entries still promote and can still be managed — Mindbody keeps promoting existing lines after the switch is turned off, and evicting members for a settings change is worse.

### 9. What the member app shows

`GET /public/classes`, `/me/classes` and the detail add:

```
waitlist: { enabled, capacity, waiting, open, my_entry: { id, position } | null }
```

`class-row.tsx` button, in precedence order:

| State | Button |
|---|---|
| `is_booked` | "Booked" (as today) |
| `my_entry` | "On waitlist · #N" with a secondary "Leave" |
| `spots_left > 0` | "Book Now" (as today) |
| `spots_left = 0` and `waitlist.open` | "Join waitlist" — outlined, warning tone, per `fe-client-features.md` §Booking Rules |
| `spots_left = 0` otherwise | "Full" (as today) |

Join toast: *"Class is full — you're #N on the waitlist. We'll book you in and email you if a seat opens."* No email on join (Mindbody sends none for classes). Errors map as booking errors do; `waitlist_closed` → "This class starts within N hours, so the waitlist has closed."; `waitlist_full` → "The waitlist for this class is full."

My Bookings (`class-bookings.tsx`) gains a "Waitlisted" group above Upcoming: class, time, "#N in line", "Leave waitlist". `GET /me/bookings/upcoming` returns the member's `waiting` entries alongside bookings, or a sibling `GET /me/waitlist` — whichever keeps the payload shape simplest; the page needs both in one fetch.

### 10. What the portal shows

Session detail (`[type]/[id]/page.tsx`):

- Stats: **Booked** `attending / attendance_capacity` (e.g. 8 / 16); **Seats** `online_used / capacity_online online · buffer_used / capacity_buffer buffer` and, if any, `N overbooked`; **Waitlist** `waiting / capacity_waitlist`.
- Roster: unchanged, plus a seat tag per row (`buffer` / `overbook`; online rows carry no tag) and a "Promoted from waitlist" hint on rows whose booking has a `waitlist_entries.booking_id`.
- New **Add member** control: client search → book → the prompt in §7 when full.
- New **Waitlist** panel under the roster, in order: position, name, joined time, payment status "Pending: <package name>" or "Can't pay: <reason>" (computed read-time with `selectPackage`, no writes), and per row **Add to class** / **Remove**.

Timetable cells read `attending / attendance_capacity`, with a small "+N waiting" when the line is non-empty. `capacity-fields.tsx` keeps its three inputs and shows "Attendance capacity: N · Waitlist: M" instead of "Max capacity: N+M+…".

The instructor session page gets the same roster, Add member (buffer only) and Waitlist panel; the 501 instructor roster route is replaced by the same detail service scoped to the instructor's own classes.

### 11. Notifications

- New slug `class_waitlist_promoted`, variables `client_name, class_name, date, time, location_name, instructor_name, cancel_by` (the moment the window closes). Subject: "You're in — {{class_name}}". Body says a seat opened, they've been booked, the credit used, and that they can cancel free until `{{cancel_by}}`. Seeded in `email-copy.ts`, declared in `TEMPLATE_VARIABLES`, so the slug-parity test in `email-copy.test.ts` covers it.
- No email on join, withdraw, removal, expiry, or skip. A skipped member sees "Can't pay" only through what the app already tells them when they try to book.
- `workshop_waitlist_promoted` stays seeded and unsent (workshops are §12).

### 12. Workshops and PT sessions

Out of v1. Workshop days keep `capacity_waitlist` and the claim-link template already seeded; Mindbody treats multi-day courses differently (no auto-enrol, staff enrol and charge when a spot opens), which matches the card-paid, tier-based booking here and wants its own spec. PT sessions keep the columns; a 1-on-1 has no meaningful queue.

### 12a. Mindbody migration

No Mindbody report exports a waitlist: the Schedule at a Glance and Attendance files carry only Reserved / Signed in / Completed / Absent / Late Cancel / No-Show, so the transform writes `capacity_waitlist: 0` everywhere and no queue. The live queues exist only on Mindbody's Class Sign In screens and are scraped at cutover into `waiting` entries, with the studio's chosen `capacity_waitlist` and the `waitlist_enabled` flag carried in the archive. Past promotions are already ordinary bookings and are not re-created as `promoted` entries. Ticket #311 in `spec-waitlist-tickets.md`.

### 13. Sequencing

1. `seats.ts` + `bookings.seat` migration + the three read paths (§2). Ships alone and fixes the capacity display with no behaviour change for members.
2. `waitlist_entries`, join/leave/list routes, catalogue fields, member UI (§3, §4, §6, §9).
3. Promotion in `cancelBooking` + email (§5, §11).
4. Staff booking, overbook, waitlist panel, promote/remove (§7, §10).
5. Feature flag wiring and docs (§8, §14).
6. Mindbody migration of live queues and capacities (§12a), after step 3.

Each step lands with its scenarios. Step 3 is the one the #140 journey was written for.

### 14. Documents to update

`admin-restructure.md` §7d (attendance capacity), `fe-client-features.md` §Booking Rules and §Notifications, `backend-architecture.md` §8 and the `waitlist_entries` sketch at :1190, `class-booking-lifecycle.md` G7, `be-portal.md` and `be-client.md` route tables, `be/CONTEXT.md` (§1 terms), `test-scenarios.md` (WTL section and SCH-04 — human approval).

## Testing Decisions

**What a good test is here.** One that books a real class over HTTP, cancels, and reads the roster back; and one that calls the pure seat and queue functions with rows. Nothing that inspects `waitlist_entries` directly to prove a route worked when the catalogue's `my_entry` would say the same.

**The seams.** `seatFor(counts, capacities, role, overbook)` and `nextToPromote(entries, packageOutcomes)` are pure. `promoteFromWaitlist(tx, classId, now)` takes the clock. Everything else is integration.

**Scenarios** (IDs for `test-scenarios.md`; WTL-01 is rewritten to match §4):

- WTL-01 member joins when online seats are full → entry waiting, position 1, no credit debited
- WTL-02 join refused when waitlist full (`waitlist_full`)
- WTL-03 join refused inside the window (`waitlist_closed`)
- WTL-04 join refused when a seat is free (`class_not_full`)
- WTL-05 join refused when already booked / already waiting
- WTL-06 join refused when no package can pay, with the selection reason
- WTL-07 member cancel outside the window promotes #1: booking confirmed, credit debited, entry promoted, email enqueued
- WTL-08 #1 cannot pay → #2 promoted, #1 stays waiting
- WTL-09 cancel inside the window promotes nobody; staff Add to class then books #1
- WTL-10 two cancels at once with one waiting member → exactly one promotion, one debit
- WTL-11 leave waitlist → withdrawn, no `cancellations` row, cap untouched
- WTL-12 class starts → remaining entries expired
- WTL-13 whole-class cancel → entries removed
- WTL-14 refund-driven cancel promotes like a member cancel
- WTL-15 studio flag off → join refused, existing entry still promotes
- WTL-16 promoted member cancels inside their window → credit returned as any booking
- SEAT-01 staff booking takes a buffer seat and does not change `spots_left`
- SEAT-02 staff booking when buffer full → `class_full` with `waitlist_open`; admin `overbook: true` succeeds; instructor cannot
- SEAT-03 cancelled buffer booking does not promote
- SEAT-04 roster shows `attending / attendance_capacity`; timetable and detail agree with the catalogue
- SEAT-05 isolation: another studio's waiting entries never count toward, or get promoted into, this studio's class

**Not tested.** Email copy wording; the SMS modes we don't build.

## Out of Scope

- Workshop and PT waitlists (§12).
- Mindbody's "First to Claim" and "Continue auto-add" inside the window, and the separate waitlist lock window.
- Priority waitlisting for members over non-members.
- Overlap rules ("can't waitlist a class that clashes with a booking"): there is no time-clash check for bookings at all today; that is its own issue.
- Unpaid staff reservations.
- WhatsApp / SMS on promotion.

## Further Notes

- **Why not one `bookings.state = 'waitlisted'`?** A waitlist entry is not a booking: it holds no seat, debits nothing, does not count toward the cap, and can coexist with the same member's later confirmed booking on the same class (after promotion). A separate table keeps `bookings` meaning "a seat".
- **Why re-select the package at promotion instead of holding it?** Mindbody pins the pricing option at join and shows "Invalid" later if it no longer pays. Ours has cross-location pricing and dormant activation that depend on the booking moment; re-selecting is the same rule the member would hit if they booked by hand at that instant.
- **Mindbody sources:** [How to use waitlists for classes](https://support.mindbodyonline.com/s/article/203253503-Waitlists) · [Waitlists FAQ](https://support.mindbodyonline.com/s/article/203896136-Why-are-my-clients-not-added-automatically-to-class-from-the-waitlist) · [Late Cancellation Window Automation](https://support.mindbodyonline.com/s/article/How-to-enable-the-Late-Cancellation-Window-Automation) · [How to change class capacity](https://support.mindbodyonline.com/s/article/How-do-I-change-capacity-levels-for-a-class-on-a-specific-date-forward) · [Restrict staff from adding clients beyond capacity](https://support.mindbodyonline.com/s/article/203268513-How-can-I-restrict-staff-from-adding-clients-past-class-capacity) · [Class Sign In screen](https://support.mindbodyonline.com/s/article/203259423-Classes-Class-Sign-in-screen) · [Waitlists for courses](https://support.mindbodyonline.com/s/article/Enrollments-Waitlists) · [Client payment requirements for waitlists](https://support.mindbodyonline.com/s/article/When-someone-reserves-a-spot-on-a-class-enrollment-waitlist-does-it-require-them-to-pay) · [How clients see their waitlist position](https://support.mindbodyonline.com/s/article/How-can-my-clients-see-what-position-they-are-on-the-waitlist).
