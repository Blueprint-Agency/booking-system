# Research: Blocking overlapping bookings, and syncing bookings to the member's calendar

**Date checked:** 2026-09-28 · **Research only — no code changed.** External claims cite a primary source (postgresql.org, developers.google.com, support.google.com, support.apple.com, support.microsoft.com, rfc-editor.org, the vendors' own help centres). Codebase claims cite `file:line` as of `bd693d94` on `staging`. Anything not confirmed from a primary source is marked **UNVERIFIED**. Recommendations are kept to the "Recommendation" subsections and the closing **Proposal**.

Two questions:

1. **Overlapping bookings.** A member can today hold two bookings whose times overlap (4:00–5:00 pm at one Location and 4:15–5:15 pm at another). One body, one place. Back-to-back (4:00–5:00 then 5:00–6:00) must stay allowed.
2. **Calendar auto-sync.** A member-level toggle: OFF is today's "Add to Google Calendar" button on the celebration; ON puts bookings — and their cancellations, reschedules and instructor changes — into the member's calendar automatically.

---

## Part 1 — Block overlapping bookings

### 1.1 What the code does today

- **The only double-book rule is "one confirmed booking per member per class".** `holdsSeat` (`be/src/services/bookings/book.ts:227-242`) checks `bookings.client_id = me AND class_id = X AND state = 'confirmed'`; `bookIntoClass` refuses with `409 already_booked` (`book.ts:129-130`). Nothing compares the *time* of one booking with another. `class-booking-lifecycle.md:56` documents the same rule ("Rejects double-book (one `confirmed` booking per client per class)").
- **Times live on the event, not on the booking.** `bookings` has no time column (`be/src/db/schema/bookings.ts:22-76`); it points at `class_id`, `workshop_id` + `workshop_tier_id`, or `pt_session_id` by `kind` (check constraints `bookings.ts:111-122`). The windows are `classes.starts_at/ends_at` (`be/src/db/schema/schedule.ts:54-55`, `CHECK ends_at > starts_at` at `:103`), `workshop_days.starts_at/ends_at` (`schedule.ts:363-364`; a workshop is multi-day and a tier covers a subset of days via `workshop_tier_days`, `be/src/services/workshops/book.ts:94`), and `pt_sessions.starts_at/ends_at` (`schedule.ts:658-659`). Each event has `lifecycle` `active | cancelled` (`be/src/db/enums.ts:86`); a booking has `state` `confirmed | cancelled | no_show` (`enums.ts:141`).
- **Admins can move a class after people have booked it.** `updateClass` accepts new `startsAt` / `endsAt` (`be/src/services/schedule/classes.ts:165`, `:201-202`, `:260-261`) and re-checks only the room and the instructors (`:204-215`, `:245-252`), never the booked members.
- **One booking path for classes.** `payAndBook` (`book.ts:299-399`) is "The one booking path — a member, staff and a waitlist promotion all come through here". Callers: `bookClass` (member, `book.ts:64`), `staffBookClass` (admin/instructor, `book.ts:93`, routes `routes/portal/admin/schedule.ts:302`, `routes/portal/instructor/schedule.ts:237`), `promoteFromWaitlist` (`be/src/services/waitlist/promote.ts:71`) and staff "Add to class" from the waitlist (`be/src/services/waitlist/staff.ts:155`). Member route: `POST /me/bookings/class` → `routes/client/bookings.ts:91`.
- **PT and workshop bookings are separate paths.** PT bookings are inserted when staff schedule a request (`be/src/services/pt-sessions/schedule.ts:105` `schedulePtRequest`, `:438` `updatePtSession`) or create a manual session (`be/src/services/pt-sessions/manual.ts:299`, `:387`). Workshop bookings are inserted on payment (`be/src/services/workshops/book.ts:257` `bookWorkshopPaid`, `:264` `bookWorkshopFree`), after `beginWorkshopCheckout` (`be/src/services/workshops/checkout.ts:24`).
- **Corporate sessions are not member bookings.** `corporate_sessions` carry a `clientName` (the company) and no `bookings` rows (`be/src/services/corporate/sessions.ts:14`, `:113`); there is no member to clash.
- **The overlap rule already exists — for staff and rooms.** `services/schedule/occupancy.ts` answers "is this room or instructor busy in this window" across classes, workshop days, PT sessions, corporate sessions and leave. Its rule is exactly the half-open one we want: `overlaps(a, b) = a.startsAt < b.endsAt && a.endsAt > b.startsAt` — "Two half-open windows [start, end) overlap. Touching endpoints do not." (`occupancy.ts:98-101`). The DB query only narrows candidates; the rule is pure and unit-tested (`occupancy.ts:46-49`, `occupancy.test.ts`). The refusal is `409 schedule_conflict` with the conflicting event in the body (`occupancy.ts:412-443`).
- **There is a race-safe precedent for "check, then write" across rows.** `holdSlot` in `pt-sessions/manual.ts:279-297` takes `pg_advisory_xact_lock(hashtext('pt-slot:{tenant}:{kind}:{id}'))` for each subject, in sorted key order "so two creates cannot deadlock", then re-runs the clash check inside the transaction.
- **Locks already held by a class booking.** The class row `FOR UPDATE` first (`book.ts:118-119`, `lockClass` `:205-225`), then the member's own active `client_packages` rows `FOR UPDATE` (`book.ts:328`). The package lock happens to serialise two class bookings by the same member, but it is not a sound basis for the overlap rule: it locks nothing when the member has no active package rows, and PT and workshop paths do not take it.
- **Error shape.** `AppError` renders `{ error: <code>, ...details }` with the HTTP status (`be/src/middleware/error.ts:37`); `ConflictError` is 409 (`be/src/shared/errors.ts:26-30`). Codes are declared in `be/src/shared/error-codes.ts` (e.g. `schedule_conflict` `:282`, `leave_clash` `:159`) and mirrored in `fe-client/src/lib/error-codes.ts`.
- **fe-client schedule row.** `components/booking/class-row.tsx` maps booking errors to row copy (`:178-215`; `class_full` reads the `waitlist_open` detail from the body, `:186-196`). `is_booked` is computed per card by `myBookedClassIds` (`be/src/services/schedule/client-catalog.ts:323-343`) and merged in `routes/client/catalog.ts:85-96`.

### 1.2 What should count toward "overlap"

| Held by the member | Counts? | Why |
|---|---|---|
| Confirmed **class** booking on an `active` class | **Yes** | The case in the question. |
| Confirmed **PT** booking on an `active` PT session | **Yes** | Also a body in a room. Member-initiated PT is request-driven; staff pick the time (`fe-client-features.md:30`), so the check is for the staff scheduling path. |
| Confirmed **workshop** booking | **Yes, per day of the tier** | Each `workshop_days` row in the booked tier's `workshop_tier_days` is its own window — a workshop is not one continuous range. |
| `cancelled` / `no_show` bookings, cancelled events | No | Not held. Re-booking after a cancel is already allowed (`class-booking-lifecycle.md:169`). |
| **Waitlist** entry (`waiting`) | No (as a *holder*) | A waiting entry is not a seat. See §1.5 for the join and promotion rules. |
| Corporate session | No | No member booking exists. |
| The same class | n/a | Still `already_booked`, checked first. |

Boundaries: half-open `[starts_at, ends_at)`, i.e. reuse `overlaps` from `occupancy.ts:99`. 4:00–5:00 then 5:00–6:00 is allowed; 4:00–5:00 and 4:15–5:15 clash. No travel buffer between Locations in v1 (an open question — see end).

### 1.3 Where to enforce it, race-safely

Two concurrent requests for the same member (double-tap on two tabs, or a member booking while staff add them elsewhere, or a promotion firing while the member books) must not both pass the check. Options:

#### Option A — Check inside the booking transaction under a per-member lock (recommended)

- Take a transaction-scoped advisory lock on the member **after** the event lock the path already takes: `pg_advisory_xact_lock(hashtext('member-time:' || tenant_id || ':' || client_id))`. Then read the member's confirmed bookings overlapping `[start, end)` across the three kinds and refuse on any hit. Released at commit/rollback.
  - Postgres: advisory locks "have application-defined meanings … the system does not enforce their use"; transaction-level ones "are automatically released at the end of the transaction, and there is no explicit unlock operation" — https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
  - Under the default `READ COMMITTED`, each statement sees rows committed before it began, so the overlap `SELECT` run *after* the lock is granted sees the booking the previous lock-holder committed — https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED
- **Why an advisory lock rather than `SELECT … FROM clients … FOR UPDATE`:** a `FOR UPDATE` row lock blocks every other `SELECT FOR KEY SHARE` of that row until commit (https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS). Postgres' foreign-key checks take a key-share lock on the referenced row when a child row is inserted (**UNVERIFIED in the docs** — it is how `ri_triggers` behave; the docs only say `FOR UPDATE` is taken on "columns … that can be used in a foreign key"), and many tables reference `clients`. `FOR NO KEY UPDATE` would avoid that, but the advisory lock matches the existing `holdSlot` precedent (`manual.ts:279-297`) and touches no real row.
- **Lock order** (no deadlocks): event row / slot locks first, then `member-time`, then the member's `client_packages`. A class booking already takes the class lock first (`book.ts:118`); a promotion already holds the class lock when it tries each member (`promote.ts:49`, `:71`). Nobody takes `member-time` and then a class lock, so there is no cycle. PT's `holdSlot` should add the member keys to its sorted key list (`manual.ts:290`).
- **Where the call goes:**
  - Class: inside `payAndBook`, before selection (`book.ts:321-327`), so every class path — member, staff, promotion, staff "Add to class" — gets it once. Return it as a refusal (like `SelectionRefusal`, `book.ts:297`) rather than throw, so `promoteFromWaitlist` can skip to the next person in the same transaction (`promote.ts:71-75`).
  - PT: `schedulePtRequest` / `updatePtSession` / `createManualPtSession` / `addManualPtSessionMember`, for each member on the session.
  - Workshop: at `beginWorkshopCheckout` (`checkout.ts:24`) — **before** taking money. At `bookWorkshopPaid` (Stripe webhook) the money is already taken, so a clash there should be logged and let through, not refused.
- **One pure rule, one query.** Add a `member` subject to occupancy's vocabulary (or a sibling `memberClash(tenantId, clientId, window, exclude?)` next to `findClash`) so the member rule is the same pure `overlaps` and is unit-testable without a database, the way `occupancy.test.ts` is. The query narrows: the member's `confirmed` bookings joined to `classes` / `pt_sessions` (`lifecycle = 'active'`) and, for workshops, `workshop_tier_days` → `workshop_days`, filtered `starts_at < :end AND ends_at > :start`. A member holds few bookings; the existing `bookings_client_booked_idx (tenant_id, client_id, booked_at)` (`bookings.ts:89`) narrows to the member already. Everything runs inside `withTenant`, so RLS scopes it as every other read.
- **Cost:** small; a few services, no schema change.
- **Weakness:** it is an application rule. A new booking path that forgets to call it can double-book. Mitigation: it lives in `payAndBook` (the one class path) and each PT/workshop insert, and each gets a Scenario Inventory row (§1.7).

#### Option B — A database exclusion constraint

Postgres can enforce "no two rows overlap" declaratively:

- "Exclusion constraints ensure that if any two rows are compared on the specified columns or expressions using the specified operators, at least one of these operator comparisons will return false or null." — https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-EXCLUSION
- `EXCLUDE [ USING index_method ] ( exclude_element WITH operator [, ... ] ) index_parameters [ WHERE ( predicate ) ]` — the `WHERE` makes it partial: "a partial exclusion constraint … only a subset of the table" — https://www.postgresql.org/docs/current/sql-createtable.html
- Range types: "The two-argument form of the range constructor constructs a range in standard form (lower bound inclusive, upper bound exclusive)", so `tstzrange(starts_at, ends_at)` is `[)` and back-to-back ranges do not overlap; `&&` is "overlaps". § Constraints on Ranges: "`UNIQUE` … is usually unsuitable for range types. Instead, an exclusion constraint is often more appropriate", with `EXCLUDE USING GIST (during WITH &&)` and, using `btree_gist`, the room-booking example `EXCLUDE USING GIST (room WITH =, during WITH &&)` — https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT
- Combining plain equality (`tenant_id`, `client_id`) with a range needs the `btree_gist` extension (its own page's example: `EXCLUDE USING GIST (cage WITH =, animal WITH <>)`) — https://www.postgresql.org/docs/current/btree-gist.html

Shape it would take here:

```sql
-- One row per occupied window: a class or PT booking has one, a workshop booking one per tier day.
CREATE TABLE member_time_holds (
  tenant_id  uuid NOT NULL,
  client_id  uuid NOT NULL,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  during     tstzrange NOT NULL,          -- tstzrange(starts_at, ends_at, '[)')
  held       boolean NOT NULL,            -- booking confirmed AND event active
  EXCLUDE USING gist (tenant_id WITH =, client_id WITH =, during WITH &&) WHERE (held)
);
```

Why it is a poor fit **now**:

1. **Times are not on the booking.** The constraint needs a denormalised range, so triggers on `bookings` (state), `classes` / `pt_sessions` / `workshop_days` (time, lifecycle) and `workshop_tier_days` must keep `member_time_holds` in step. Four trigger sets, in a codebase whose rules otherwise live in `services/*` (root `CLAUDE.md` § Conventions).
2. **An admin reschedule would fail.** Moving a class (`classes.ts:260-261`) would fire the trigger and raise an exclusion violation if any booked member now clashes — the admin's edit refused because of a member's other booking. That must be a warning, not a hard failure (§1.6).
3. **Override needs a hole.** Staff override (§1.6) means an extra `held = false`/`override` flag in the predicate — at which point the constraint is only as strong as the app code setting the flag.
4. **Errors arrive as SQLSTATE `23P01` (`exclusion_violation`)** (https://www.postgresql.org/docs/current/errcodes-appendix.html), carrying no business detail; the service would still have to find the clashing booking to tell the member *which* class. So Option A's query is needed anyway.
5. **Extension.** "This module is considered 'trusted', that is, it can be installed by non-superusers who have `CREATE` privilege on the current database" (https://www.postgresql.org/docs/current/btree-gist.html), so the migration owner can add it. Not a blocker, but no migration in `be/src/db/migrations/` creates an extension today.

#### Recommendation (1.3)

Option A: an advisory-locked check inside each booking transaction, sharing occupancy's pure `overlaps`. Keep Option B as later hardening only if a second booking path ever double-books in production; do not build it for launch.

### 1.4 Error code and shape

New code `time_clash` (409), in `be/src/shared/error-codes.ts` and `fe-client/src/lib/error-codes.ts`, following `class_full`'s pattern of carrying what the client needs to explain itself (`book.ts:138-142`):

```json
{
  "error": "time_clash",
  "clash": {
    "booking_id": "…",
    "kind": "class",
    "title": "Vinyasa Flow",
    "starts_at": "2026-10-02T08:00:00.000Z",
    "ends_at": "2026-10-02T09:00:00.000Z",
    "location_name": "…"
  }
}
```

Distinct from `schedule_conflict` (that one is about a room or instructor, and staff-facing) and from `already_booked` (same class). `booking_id` lets fe-client link to the booking to cancel it. For staff routes the same body, plus the member's name in the portal's copy.

### 1.5 Waitlist

- **Join.** A member may reasonably hold a backup class and wait on a preferred one at the same time. Recommend: **allow the join**, and warn in the join toast: "You're #N on the waitlist. You're booked into {title} at {time} then — cancel it if a seat opens here, or we'll have to skip you." (Alternative, stricter: refuse the join with `time_clash`. Product decision — see open questions.) `joinRefusal` (`be/src/services/waitlist/entries.ts:64-76`) would gain nothing if we allow; if we refuse, the clash goes after `already_waitlisted` in the §4 order of `spec-waitlist.md:115-126`.
- **Auto-promotion.** `promoteFromWaitlist` tries each entry in order and records a `PromotionOutcome`; a refused entry "stays `waiting` … only skipped for the rest of this pass" (`be/src/services/waitlist/rules.ts:32-37`, `promote.ts:57-83`). Add `'time_clash'` to `PromotionOutcome` and skip exactly as a package that cannot pay is skipped. Never cancel the member's other booking automatically: that would forfeit or refund credit on their behalf and bypass the cancellation policy.
- **Notify on skip?** `spec-waitlist.md` §11 sends nothing on skip (`spec-waitlist.md:204`: "No email on join, withdraw, removal, expiry, or skip"). For a clash the member can fix it themselves (cancel the other booking), so a one-off "A seat opened on X, but you're booked into Y at the same time" email is more useful than silence. Recommend deferring: v1 skips silently like the other refusals, and the staff Waitlist panel shows "Can't book: clashes with {title} {time}" beside "Can't pay: …" (`spec-waitlist.md` §10).
- **Staff "Add to class" from the line** (`waitlist/staff.ts:155-161`) behaves as a staff booking (§1.6).

### 1.6 Admin/staff override and admin edits

- **Staff booking a member** (`staffBookClass`): refuse with `409 time_clash` by default, and let an **admin** retry with `allow_clash: true` — the same shape as `overbook` (`book.ts:77-78`, `spec-waitlist.md` §7). Portal prompt: "{Member} is booked into {title} at {time}. Book anyway?" Instructors: no override (they reach only their own class; the clash is often in someone else's). Record the override in the audit trail as other admin overrides are.
- **Staff scheduling a PT session** for a member: same `time_clash` + admin `allow_clash`. A PT session is usually agreed with the member over WhatsApp, so a clash is usually a mistake.
- **Admin moves or extends a class / PT session / workshop day** so that a booked member now clashes: do **not** block. Return the list of affected members in the success response (or a pre-save preview, like `previewClassRuleChange`, `classes.ts:155`) so the admin can contact them. The member's calendar (Part 2) is updated either way.

### 1.7 UX in fe-client

Two layers, both needed:

1. **Show it before the tap.** `GET /me/classes` (signed in) adds per card `clash: { booking_id, kind, title, starts_at, ends_at } | null`, computed next to `myBookedClassIds` (`client-catalog.ts:323`) with one query over the member's confirmed bookings in the listed date range, then the pure `overlaps` per card. In `class-row.tsx`, precedence (extending `spec-waitlist.md` §9's table): `is_booked` → `my_entry` → **`clash`** → Book Now / Join waitlist / Full. The clash state replaces Book Now with a muted, non-primary button reading **"Clashes with Vinyasa Flow · 4:00 pm"**; tapping it opens the class detail overlay, which says "You're booked into Vinyasa Flow at 4:00 pm (Location), which overlaps this class. Cancel that booking to book this one." with a link to it in My Classes. Don't hide the class. On a full class with an open line, show "Join waitlist" plus the clash note (§1.5).
2. **Handle the race.** `handleBook` maps `time_clash` to the same copy (`class-row.tsx:178-215`) and sets the row's clash state from the body, as `class_full` does with `waitlist_open`.

Also: workshop detail's Buy button (`/workshops/[id]`) gets the same check at checkout start; PT has no member-facing booking step.

### 1.8 Tests — proposed Scenario Inventory rows

Convention (`docs/md/testing.md:102-127`, `docs/md/test-scenarios.md:14-16`): stable IDs, next number in the area, test names start with the ID; `node scripts/check-scenarios.mjs` checks them. Current highest IDs: `BKG-36`, `WTL-30`, `PT-123`, `WSP-16`, `SCH-28`, `TEN-29`.

| ID | role | scenario (short) | risk | level |
|---|---|---|---|---|
| BKG-37 | member | **Given** a confirmed booking 4:00–5:00 pm at Location A **When** the member books a class 4:15–5:15 pm at Location B **Then** `409 time_clash` naming the first class; nothing debited | money | integration |
| BKG-38 | member | **Given** a confirmed booking 4:00–5:00 pm **When** the member books 5:00–6:00 pm **Then** it is confirmed (back-to-back allowed, `[)`) | UX | unit + integration |
| BKG-39 | member | **Given** a cancelled booking, or a booking on a cancelled class, at an overlapping time **When** the member books **Then** it is confirmed | UX | integration |
| BKG-40 | member | **Given** two overlapping classes with seats **When** the same member books both concurrently **Then** exactly one is confirmed and the other is `time_clash`; one debit | money | integration |
| BKG-41 | member | **Given** a confirmed PT session, or a booked workshop tier whose day overlaps **When** the member books the class **Then** `time_clash` naming it; a workshop day outside the class time does not clash | UX | integration |
| BKG-42 | member | **Given** a member with a booking at 4:00 pm **When** they read `/classes` **Then** an overlapping class carries `clash` and its row reads "Clashes with {title} · 4:00 pm" instead of Book Now | UX | integration + e2e |
| BKG-43 | admin | **Given** a member with an overlapping booking **When** an admin books them without, then with, `allow_clash` **Then** refused `time_clash`, then confirmed and audited; an instructor's `allow_clash` is ignored | UX | integration |
| BKG-44 | member | **Given** members of two studios **When** a member of studio A holds a booking at 4:00 pm **Then** a studio B booking at 4:00 pm by a different client row is not a clash (per-studio logins, ADR 0006) | tenancy | integration |
| WTL-31 | system | **Given** a full class whose first waiting member now holds an overlapping booking **When** a seat frees **Then** the second is booked and the first stays `waiting` | UX | unit + integration |
| WTL-32 | member | **Given** a member booked 4:00–5:00 pm **When** they join the waitlist of a full overlapping class **Then** the join succeeds and the toast warns of the clash (or `time_clash`, per the product decision) | UX | integration |
| PT-124 | admin | **Given** a member with a class booked 4:00–5:00 pm **When** staff schedule their PT request at 4:30 pm **Then** `time_clash`; an admin may override | UX | integration |
| WSP-17 | member | **Given** a class booked on one of a workshop tier's days at an overlapping time **When** the member starts checkout for that tier **Then** it is refused `time_clash` before any payment | money | integration |
| SCH-29 | admin | **Given** a class with booked members **When** an admin moves it onto a time one member already has booked elsewhere **Then** the move is saved and the response lists that member | UX | integration |

(Part 2's rows are in §2.9.)

---

## Part 2 — Calendar auto-sync, as a member toggle

### 2.1 What the code does today

- **One manual button, Google only.** `fe-client/src/lib/add-to-calendar.ts:1-12` builds Google's prefilled "new event" URL (`calendar.google.com/calendar/render?action=TEMPLATE…`, `:43-53`), with UTC times, the Location's name + street address as the place (`calendarLocation`, `:34-36`) and a "Directions:" line (`:39-41`). Its header states the design choice: silent writes "would need OAuth with a calendar-write scope — a consent screen and a stored token for one event, which is more than the click is worth". No `.ics` file is offered, so Apple / Outlook users get nothing.
- **Where it shows.** `CelebrationSheet` renders **Add to Google Calendar** then **Done** whenever there is an event (`fe-client/src/components/celebration/celebration-sheet.tsx:98-118`); used by the booked-class celebration (`components/booking/booked-celebration.tsx:40-47`, whose nudge lines all end on the calendar, `:16-21`) and the PT / corporate "Approved!" celebration (`lib/approvals.ts:36-48`). `calendarUid` already builds a stable per-booking UID, `booking-{id}@{host}` (`celebration-sheet.tsx:170-173`). Spec: `fe-client-features.md:257` and `:804`.
- **No booking-confirmation email is actually sent.** `class_booking_confirmed` is seeded (`be/src/db/seed/email-copy.ts:565`) and typed (`be/src/services/notifications/send.ts:13`), but nothing calls it; only promotions (`waitlist/promote.ts:126-139`), cancellations and purchases send mail. Relevant to Option C.
- **General settings** is a member account page (`fe-client/src/app/(client)/account/settings/page.tsx`, nav item `components/account/account-nav-items.ts:30` "Theme and text size"), backed by `clients.theme` / `font_size` and `PATCH /me/display-prefs` (`be/src/db/schema/identity.ts:41-42`, `be/src/routes/client/me.ts:115`; spec `fe-client-features.md:637`). It is the natural home for the toggle.
- **Sealing secrets.** `be/src/lib/secret-box.ts` is AES-256-GCM with a key from the environment (`PAYMENT_CREDENTIALS_KEY`, `be/src/env.ts:116`), written for studios' payment keys (`secret-box.ts:4-21`). A refresh token is the same kind of thing: a credential held on somebody else's behalf.
- **Background jobs** are `node-cron` in `be/src/jobs/index.ts`, with per-tenant fan-out helpers (`perTenant` / `tenantJob`, `jobs/index.ts:55`, `:85`) and 5-minute ticks already (`:160-162`). There is no outbox table today.
- **Hosts.** Members use `https://{slug}.reservetoday.app`; the API is one host, `https://api.reservetoday.app` (staging `api.dev.…`) (`docs/md/deployment.md:16-20`). Tenant middleware resolves every `/api/v1/*` request from `X-Tenant-Slug` / `Origin`, and paths that carry no tenant (the Stripe webhook) are exempted and resolve their own (`docs/md/spec-tenant-resolution.md:24-26`, `:166-168`). A calendar feed fetched by Google's servers and an OAuth callback from Google are both new "carry no tenant headers" paths.
- **Logins are per studio** (ADR 0006, `spec-tenant-resolution.md` § One person, two studios): the same person at two studios is two `clients` rows. A calendar connection is therefore per `(tenant_id, client_id)`.

### 2.2 What Mindbody and ClassPass actually do

- **Mindbody (member side)** — the help article "Calendar syncing": "With the Mindbody app, you can automatically or manually sync your classes and appointments with the default calendar on your mobile device." — https://support.mindbodyonline.com/s/article/Calendar-syncing?language=en_US (meta description, fetched). The article body needs JavaScript; from search-result snippets only (**UNVERIFIED**): each booking "is added to your phone's default calendar"; there is a manual "Add to Calendar"; "ICS and universal calendars are not supported"; "classes cancelled by the business need to be manually removed from your calendar". So Mindbody's member sync is a **native-app write to the device calendar**, not Google OAuth and not a feed — and apparently it does not follow cancellations.
- **Mindbody (staff side)**: "Your Mindbody site integrates with Google Calendar, so your staff members' schedules can be automatically updated to their Google Calendars." — support.mindbodyonline.com (article 203257513). Staff feature, not the member one.
- **ClassPass**: a help article titled "How can I prevent my Google Calendar from automatically syncing with my ClassPass reservations?" exists on classpass.my.site.com, implying reservations reach Google Calendar automatically; body not readable (**UNVERIFIED** mechanism). ClassPass "CalendarSync" on classpass.com/partners is a studio-side feature.

**Implication:** fe-client is a web app. It cannot write to the phone's calendar the way Mindbody's native app does (no web API grants that). The web-reachable equivalents are the four options below.

### 2.3 Option A — Google Calendar API with OAuth

**Scopes (https://developers.google.com/workspace/calendar/api/auth):**

| Scope | Google's description | Class |
|---|---|---|
| `calendar.events` | "View and edit events on all your calendars" | Sensitive |
| `calendar.events.owned` | "See, create, change, and delete events on Google calendars you own" | Sensitive |
| `calendar.app.created` | "Make secondary Google calendars, and see, create, change, and delete events on them" | Sensitive |
| `calendar` | "See, edit, share, and permanently delete all the calendars you can access" | Sensitive |

No core Calendar scope is **restricted** (only the add-on scopes are), so the annual third-party CASA security assessment required for restricted scopes (https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) does not apply. `calendar.app.created` works with `calendars.insert` ("Creates a secondary calendar. The authenticated user for the request is made the data owner of the new calendar") and `events.insert/patch/delete` (https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert, …/events/insert).

**Pick `calendar.app.created`.** It is the narrowest scope that does the job: the app can touch only the calendar it created ("{Studio} classes"), never the member's primary calendar or anyone's other events. The consent line reads as exactly what we do. A dedicated calendar also makes "turn off" clean (delete the calendar) and lets the member hide or recolour all studio bookings at once. Cost: events live in a secondary calendar, not "My calendar" — normal for this kind of sync.

**Verification (sensitive scope)** — https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification:
- Verify the authorised domain in Google Search Console; accurate consent-screen branding with "home page URI, privacy policy URI"; a demo video "that fully demonstrates how a user initiates and grants access… Upload the video to YouTube Studio and set its Visibility as Unlisted"; review "typically takes 3-5 business days".
- Before verification: "the unverified app screen will be displayed before the consent screen, and your app will be limited to 100 new users until it is verified" (https://support.google.com/cloud/answer/7454865). In Testing mode: up to 100 test users and "Authorizations by a test user will expire seven days from the time of consent… that token will also expire" (https://support.google.com/cloud/answer/15549945).
- **Branding is the platform's, not the studio's.** One OAuth client serves every studio, so the Google consent screen shows the platform's app name and domain, not the studio the member knows. The member-facing copy before the redirect must bridge that ("You'll be asked to allow *reservetoday.app* — the booking system {Studio} uses — to create a calendar for your classes."). Per-studio OAuth clients would each need their own verification; not viable.

**Tokens** — https://developers.google.com/identity/protocols/oauth2:
- Refresh tokens stop working when "The user has revoked your app's access", after "not been used for six months", when the account exceeds its live-token maximum, and in Testing mode after 7 days. "There is currently a limit of 100 refresh tokens per Google Account per OAuth 2.0 client ID… creating a new refresh token automatically invalidates the oldest refresh token without warning." — a person connecting at 100+ studios is not a real concern.
- Granular consent: "users may not grant your app access to all of them… your app must verify which scopes were actually granted" — read the token response's `scope` (https://developers.google.com/identity/protocols/oauth2/web-server).
- Revocation on disconnect: POST `https://oauth2.googleapis.com/revoke` with `token` (same page).
- Storage: seal the refresh token with `secret-box` (AES-256-GCM), under its **own** key rather than `PAYMENT_CREDENTIALS_KEY`, so rotating one never orphans the other (`env.ts:111` notes rotation orphans every sealed value). Access tokens are short-lived: keep in memory only.

**Redirect URI vs per-studio subdomains** — "the value must exactly match one of the authorized redirect URIs"; wildcards are not allowed (https://developers.google.com/identity/protocols/oauth2/web-server). So register one callback on the API host per environment — `https://api.reservetoday.app/api/v1/oauth/google/callback` (and the `api.dev.` one) — and carry the tenant in `state`: an opaque random value keyed to a short-lived server row `(tenant_id, client_id, return_to, pkce_verifier, expires_at)`. The callback is exempt from tenant middleware (like the Stripe webhook) and resolves the tenant from that row, then redirects to `https://{slug}.reservetoday.app/account/settings?calendar=connected`. (This design is inference from Google's rules, not a Google statement.)

**Events:**
- **Idempotent IDs.** Client-supplied `id`: "Characters allowed in the ID are those used in base32hex encoding, i.e. lowercase letters a-v and digits 0-9… between 5 and 1024 characters", unique per calendar (https://developers.google.com/workspace/calendar/api/v3/reference/events/insert). The booking UUID with dashes removed is 32 hex characters — all within `0-9a-f` ⊂ base32hex — so `event.id = bookingId.replace(/-/g, '')`. A retried insert then fails as a duplicate instead of creating a second event; the worker treats that as "exists, update it". No mapping table is strictly needed; keep `extendedProperties.private` ("Properties that are private to the copy of the event that appears on this calendar") with `booking_id` / `tenant_id` for debugging.
- **Cancellations.** Delete the event, or set `status: "cancelled"` — "All other cancelled events represent deleted events" (https://developers.google.com/workspace/calendar/api/v3/reference/events). Recommend delete: a cancelled class should vanish, as the member's own cancellation does.
- **`sendUpdates`**: we have no attendees, so leave the default; Google warns `none` can cause "events not syncing to external calendars" only for events with guests (events/insert).
- **Quota**: 10,000 requests/min per project, 600/min per user per project, 1,000,000/day (https://developers.google.com/workspace/calendar/api/guides/quota); errors are `403`/`429 usageLimits`, handled with exponential backoff. A patch "consumes three quota units; prefer using a `get` followed by an `update`" (events/patch) — the worker should `update` the full event it renders. A class cancel for 30 members is 30 calls: far inside quota.

**Latency:** seconds after the worker runs (≤ 1 minute tick). Cancellations and reschedules follow. **Covers Google users only.**

### 2.4 Option B — Per-member secret ICS subscription feed

A URL like `webcal://api.reservetoday.app/api/v1/calendar/{slug}/{token}.ics`, rendering the member's upcoming (and recent past) confirmed bookings as `VEVENT`s. Works with any client that subscribes by URL.

- **Standards.** UID is "the persistent, globally unique identifier for the calendar component" (RFC 5545 §3.8.4.7, https://www.rfc-editor.org/rfc/rfc5545) — reuse `booking-{id}@…`. `SEQUENCE` increments on each significant revision (§3.8.7.4). `STATUS:CANCELLED` "Indicates event was cancelled". Without a `METHOD` property "a scheduling transaction MUST NOT be assumed" — a feed is a snapshot (§3.7.2). RFC 7986 adds `NAME`, `COLOR` and `REFRESH-INTERVAL;VALUE=DURATION:PT1H`, "a suggested minimum interval for polling… SHOULD be used by calendar user agents" (https://www.rfc-editor.org/rfc/rfc7986).
- **Cancellation:** drop the event from the feed (clients remove what disappears) or keep it with `STATUS:CANCELLED` until it has passed. Recommend omit; **UNVERIFIED** how each client treats `STATUS:CANCELLED` in a subscription (some show it struck through, some hide it).
- **`webcal`** is a Provisional registration in IANA's URI scheme registry with no RFC (https://www.iana.org/assignments/uri-schemes/uri-schemes.xhtml); in practice it hands the URL to the OS calendar app. Offer the `https://` URL too, for Google's "From URL" box.
- **Refresh latency — the weak point.**
  - **Google Calendar**: Google publishes **no figure**. The "Add by URL" help page (https://support.google.com/calendar/answer/37100) gives only the steps. A widely-cited "up to 12 hours" is evidenced only by a Community thread titled "Google Calendar does not sync URL-linked calendars within 12 hours as stated" (support.google.com/calendar/thread/12658899 — not primary). Whether Google honours `REFRESH-INTERVAL` / `X-PUBLISHED-TTL`: **UNVERIFIED**, Google documents neither. Treat Google as "hours, sometimes a day", and uncontrollable.
  - **Outlook.com**: "This update can take more than 24 hours, although updates should happen approximately every 3 hours"; Outlook on the web "approximately every 6 hours" (https://support.microsoft.com/en-us/office/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web-cff1429c-5af6-41ec-a5b4-74f2c278e98c).
  - **Apple Calendar**: the member picks the auto-refresh interval — "Control-click the calendar's name, then choose Get Info. Click the 'Auto-refresh' pop-up menu" (https://support.apple.com/guide/calendar/refresh-calendars-icl1024/mac); iPhone: "Add Subscription Calendar" (https://support.apple.com/en-us/102301). The exact interval list (every 5 minutes … every week) is **UNVERIFIED** from the page text.
- **Security/tenancy.** Token = 32 random bytes, base64url; store only its SHA-256, compare in constant time. The slug in the path selects the tenant (`withTenant`), then the token hash finds the client inside it — RLS holds. Revocable (regenerate = new token, old URL 404s). The feed exposes class names, times and Locations — no QR code, no booking code, nothing that checks you in. `Cache-Control: private, max-age=300`; rate-limit per token.
- **Cost:** low — one read-only route, a token table, the renderer (reusable by Option A and C). No OAuth, no Google review, no outbox.

### 2.5 Option C — Email invites with an `.ics` (METHOD:REQUEST / CANCEL)

- iTIP: REQUEST is used to "Make a request for an event… also used to update or change an existing event"; CANCEL "Cancel one or more instances"; a whole-event cancel "MUST" carry `STATUS:CANCELLED` (RFC 5546, https://www.rfc-editor.org/rfc/rfc5546). `METHOD` must match the MIME `method` parameter (RFC 5545 §3.7.2).
- **Gmail auto-adds only if the recipient's setting allows.** Google Calendar's "Add invitations to my calendar": "From everyone"; "Only if the sender is known: Events are automatically added to your calendar if the sender is in your contacts, part of your organization, or someone you previously interacted with. If an event isn't added to your calendar, you get an invitation email"; "When I respond to the invitation in email" (https://support.google.com/calendar/answer/13159188). A Workspace admin control defaults to "From everyone" (https://workspaceupdates.googleblog.com/2026/08/new-admin-controls-for-adding-invitations-to-Google-Calendar.html). Reports that consumer accounts now default to "Only if the sender is known" are secondary-source only (**UNVERIFIED**). Our mail comes from one platform `noreply@` address (`be/src/lib/mailer.ts:215-232`, `docs/md/research-resend-sending-limits.md`), which is unlikely to be a "known sender".
- **Resend** documents attachments (`content`, `filename`, `path`, `content_type`) but nothing about calendar invites or a `text/calendar; method=REQUEST` alternative body part (https://resend.com/docs/api-reference/emails/send-email). Whether an invite sent as a plain attachment is recognised as an invite by Gmail / Outlook is **UNVERIFIED**.
- An invite makes the member an ATTENDEE and the platform the ORGANIZER; clients show Yes/No/Maybe buttons whose replies come back to `noreply@`. Wrong model for a class booking.
- Outlook's auto-add behaviour: no primary source found (**UNVERIFIED**).
- Also: the booking-confirmation email this would ride on is not sent today (§2.1).

**Verdict:** not reliable enough to be "sync". Worth doing later as an `.ics` **download** / attachment with no METHOD (a snapshot) on the celebration and a future confirmation email, so Apple / Outlook users get a one-tap equivalent of today's Google button.

### 2.6 Option D — Hybrid

ICS feed for everyone + Google Calendar API for members who connect Google. Both render from one "booking → calendar event" function, so the event text is identical. Choose one per member (never both into the same Google account, or events duplicate).

### 2.7 Comparison and recommendation

| | A. Google API | B. ICS feed | C. Email invite | D. Hybrid (A + B) |
|---|---|---|---|---|
| Latency of a new booking | ≤ ~1 min | Google: hours, unpublished; Outlook ~3–6 h, can exceed 24 h; Apple: member's setting | Minutes, *if* auto-added | Google ≤ 1 min, others as B |
| Cancellations / reschedules | Yes | Yes, at next refresh | Needs CANCEL mails; best-effort | Yes |
| Platforms | Google only | Google, Apple, Outlook, others | Mostly Gmail/Outlook | All |
| Member setup | Connect + consent (≈3 taps) | Copy/open a link; on desktop Google, paste into "From URL" | None | Member picks one |
| Compliance | Sensitive-scope verification (3–5 business days, demo video, privacy policy, Search Console), refresh-token custody, revoke on disconnect | Secret URL only | Mail reputation; invite RSVP noise | A's |
| Engineering | Outbox, worker, retries, token sealing, OAuth routes, reconnect states | One route + token table + renderer | Mail template + ICS + reliability unknown | Both |
| Multi-tenant fit | One OAuth client, one callback on the API host, tenant in `state`; one secondary calendar per studio per member | Slug in the URL path, token scoped by RLS | Per-tenant mail identity exists | Both fit |

**Recommendation:** **D, phased.**

1. **Phase 1 — ICS feed + `.ics` download.** Ships the toggle for every platform, no Google review on the critical path, and builds the event renderer everything else reuses. Honest copy about Google's delay.
2. **Phase 2 — "Connect Google Calendar"** with `calendar.app.created` into a dedicated "{Studio} classes" calendar. Start Google verification in Phase 1 (it needs the privacy policy, domain and demo video, and runs in parallel); until verified, only the 100-user cap applies.

If only one thing can be built and most members are on Gmail/Android, build A alone — it is what "like Mindbody" feels like to a Google user, and better than Mindbody at cancellations. Skip C as a sync mechanism.

### 2.8 Design sketch

#### Data model (all `tenant_id NOT NULL` via `tenantIdColumn()`; RLS arrives by construction — `ensureTenantIsolation` polices every table with a `tenant_id` column on each deploy, `be/src/db/roles.ts:128-183`)

```
clients.calendar_sync            enum calendar_sync_mode ('off','feed','google'), NOT NULL DEFAULT 'off'

calendar_feeds                   -- Option B
  tenant_id, id, client_id (unique per tenant while active),
  token_hash bytea UNIQUE, created_at, revoked_at,
  last_fetched_at, last_user_agent        -- lets settings say "Last checked by your calendar 2 h ago"

calendar_connections             -- Option A
  tenant_id, id, client_id, provider ('google'),
  google_sub, google_email,
  refresh_token_sealed text,              -- secret-box, CALENDAR_TOKEN_KEY
  granted_scopes text[], calendar_id text, -- the secondary calendar we created
  status ('active','needs_reconnect','disconnected'),
  last_error text, connected_at, disconnected_at
  UNIQUE (tenant_id, client_id) WHERE status <> 'disconnected'

calendar_oauth_states            -- short-lived, deleted on use / expiry
  tenant_id, state_hash, client_id, return_to, pkce_verifier_sealed, expires_at

calendar_outbox                  -- Option A only; the feed renders live
  tenant_id, id, client_id, booking_id, reason,
  created_at, attempts, next_attempt_at, done_at, last_error
  INDEX (next_attempt_at) WHERE done_at IS NULL
```

The outbox row is written **in the same transaction** as the change that caused it (only for members whose `calendar_sync = 'google'`), so a rolled-back booking never syncs and a committed one always will.

#### Worker

- `node-cron` every minute (new tick beside the 5-minute ones, `jobs/index.ts:160-162`), per tenant via the existing fan-out, each tenant inside `withTenant`.
- Claim a batch: `SELECT … FROM calendar_outbox WHERE done_at IS NULL AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 50 FOR UPDATE SKIP LOCKED`. Coalesce by `booking_id`.
- For each booking, **render from current state, not from the event that queued it**: confirmed booking on an active event → `events.update` (on 404 → `events.insert` with the fixed id; on 409 duplicate → `update`); otherwise → `events.delete` (404/410 = done). Idempotent by construction, so retries and out-of-order rows are safe.
- Retries: exponential backoff (1 min, 5 min, 30 min, 2 h, 12 h), then park with `last_error`. `429/403 usageLimits` → backoff (per the quota page). `invalid_grant` → connection `needs_reconnect`, stop its rows, show the state in settings. Missing secondary calendar (member deleted it) → recreate once, then re-push future bookings.
- On connect: create the calendar (`calendars.insert`, name "{Studio} classes", studio timezone) and backfill future confirmed bookings.

#### What enqueues (Option A)

| Change | Where today |
|---|---|
| Class booked — member, staff, waitlist promotion, staff "Add to class" | `payAndBook` (`book.ts:309`) — one place |
| PT session scheduled / member added | `pt-sessions/schedule.ts:105`, `manual.ts:299`, `:387` |
| Workshop booked | `workshops/book.ts:257`, `:264` |
| Booking cancelled — member, staff, refund / complimentary unwind | `cancelBookingInTx` (`bookings/cancel.ts:108`) |
| Class cancelled (whole class) | `cancel-class.ts:49` |
| PT / workshop cancelled | `pt-sessions/cancel.ts:71`, `manual.ts:609`, `workshops/cancel.ts:22` |
| Class moved / re-timed / new instructor / new class type / new Location | `updateClass` (`classes.ts:165`) → one row per confirmed booking on it |
| PT session edited | `pt-sessions/schedule.ts:438` |
| Location address or map link edited | enqueue future bookings there (low priority; could be skipped in v1) |

#### Event content

Title "{Class} at {Studio}" (as today's button, `fe-client-features.md:257`); location = name + street address (`calendarLocation`); description = instructor, Directions line, link to My Bookings; UTC start/end; no QR token or booking code. Move the renderer to `be/` (the backend now needs it); fe-client keeps its own copy for the manual button (the apps share no code, root `CLAUDE.md` § Conventions).

#### Env vars (each goes in `.github/workflows/deploy-be.yml`, `be/.env.example` and `be/src/env.ts` together)

| Var | Purpose | Secret? |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Calendar OAuth client (Phase 2) | no |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Calendar OAuth client secret | yes |
| `CALENDAR_TOKEN_KEY` | secret-box key for refresh tokens (`openssl rand -base64 32`) | yes |

The callback and feed URLs derive from `BETTER_AUTH_URL` (already "the backend origin", `env.ts:67`), so no new URL var. Optional per-tenant switch: a `feature_flags` row `calendar_sync_enabled`, like `waitlist_enabled` (`spec-waitlist.md` §8). Phase 1 needs no new env var.

#### Tenant resolution

The feed route and the OAuth callback join the tenant-middleware exemptions (`spec-tenant-resolution.md:24-26`) and resolve their own tenant — from the path slug (feed, corroborated by the token existing in that tenant) or the `state` row (callback). `spec-tenant-resolution.md` gets a section for each.

### 2.9 UX

**Where the toggle lives.** A new **Calendar** card on `/account/settings` (General settings), under Display; the nav hint becomes "Theme, text size and calendar".

- OFF (default): "**Add my bookings to my calendar automatically** — New bookings, cancellations and time changes show up in your calendar without tapping anything." [toggle]
- Turning ON asks which calendar:
  - **Google Calendar** → "Connect Google Calendar" → pre-redirect line: "Google will ask you to let reservetoday.app create a '{Studio} classes' calendar. We can only see and change that one calendar." → consent → back to settings: "Connected to {google_email}. Your upcoming bookings are in the '{Studio} classes' calendar." [Disconnect]
  - **Apple Calendar, Outlook or another** → "Subscribe" (opens `webcal://…`) and "Copy link"; under it: "Your calendar app checks this link for changes. Apple Calendar lets you choose how often; Google and Outlook check every few hours, so a class booked at the last minute may not appear straight away." [Reset link] [Turn off]
- **Error:** `needs_reconnect` → amber: "Google Calendar stopped accepting updates from us. Reconnect to keep your bookings in sync." [Reconnect]. Feed never fetched after 24 h → "Your calendar hasn't picked up this link yet."
- **Turning off.** Google: "Turn off calendar sync? We'll remove the '{Studio} classes' calendar from your Google account." [Turn off and remove] / [Keep the calendar, stop updating] — then revoke the token. Recommend default **remove**: stale future events that never update (e.g. a later cancellation) are worse than none. Feed: revoke the token; tell them "Also remove the subscription from your calendar app", since we cannot.

**Celebration sheet** (`celebration-sheet.tsx:98-118`):

- Sync OFF: keep **Add to Google Calendar** (plus an **Add to Apple / Outlook** `.ics` download), and under it, once until dismissed or for the first few bookings: "Tired of adding every class? **Turn on calendar sync**" → `/account/settings#calendar`. Keep it one small link — the celebration is the moment of delight, not a settings form.
- Sync ON, Google, healthy: replace the button with a static line "(check icon) Added to your Google Calendar" — strictly "On its way to your Google Calendar" until the worker confirms; the booking response can carry `calendar: { mode: 'google', status: 'queued' | 'synced' }`. **Done** becomes the primary action.
- Sync ON, feed: "(check icon) This class will appear in your calendar" with the smaller "Google Calendar can take a few hours to update." Don't also show the manual button (duplicates).
- Sync ON but broken: show the manual button again plus "Reconnect Google Calendar".
- The nudge lines ("…let your calendar hold that one", `booked-celebration.tsx:16-21`) need a sync-ON variant ("Your calendar has it. Now your mat does too.").

**Proposed Scenario Inventory rows (Part 2)** — current highest `ACC-20`, `TEN-29`, `CXL-53`:

| ID | role | scenario (short) | risk | level |
|---|---|---|---|---|
| ACC-21 | member | **Given** sync off **When** the member turns on the feed **Then** a feed URL is issued and fetching it returns their confirmed upcoming bookings as `VEVENT`s with stable UIDs, and no QR token or booking code | UX | integration |
| ACC-22 | member | **Given** a feed **When** a booking is cancelled or its class moved **Then** the next fetch omits it or shows the new time with a higher `SEQUENCE` | UX | integration |
| ACC-23 | member | **Given** a feed **When** the member resets or turns it off **Then** the old URL is 404 | data-loss | integration |
| ACC-24 | member | **Given** a connected Google calendar **When** the member books, staff book them, or a waitlist promotion books them **Then** one outbox row is written in the same transaction and the worker creates exactly one event with the booking's fixed id, even when retried | UX | integration (Google stubbed) |
| ACC-25 | system | **Given** a synced booking **When** it is cancelled, its class cancelled, or the class re-timed / re-staffed **Then** the Google event is deleted or updated | UX | integration |
| ACC-26 | system | **Given** Google answers `invalid_grant` **When** the worker runs **Then** the connection is `needs_reconnect`, its rows stop retrying, and settings shows Reconnect | UX | integration |
| ACC-27 | member | **Given** a connected calendar **When** the member disconnects choosing remove **Then** the token is revoked, the secondary calendar deleted, and the mode is `off` | data-loss | integration |
| ACC-28 | member | **Given** sync on (Google) / on (feed) / off **When** the booked celebration shows **Then** it reads "Added to your Google Calendar" / "will appear in your calendar" / the Add button with the "Turn on calendar sync" link | UX | e2e |
| TEN-30 | member | **Given** a feed token issued at studio A **When** it is requested under studio B's slug **Then** 404, and no studio B booking is ever rendered into a studio A feed or calendar | tenancy | integration |
| TEN-31 | system | **Given** an OAuth `state` issued for studio A **When** the callback completes **Then** the connection is written in studio A only, and a replayed or expired state is refused | tenancy | integration |

---

## Proposal

**Question 1 — overlapping bookings**

- Refuse a booking whose `[starts_at, ends_at)` overlaps any of the member's `confirmed` bookings on an `active` class, PT session or workshop tier day. Back-to-back is allowed. Reuse `occupancy.ts`'s pure `overlaps`.
- Enforce it in the booking transaction under `pg_advisory_xact_lock('member-time:{tenant}:{client}')`, taken after the event lock. Put the class check in `payAndBook` so member, staff, promotion and "Add to class" all get it. Add it to PT scheduling and to workshop checkout start (before money). No exclusion constraint for now.
- `409 time_clash { clash: { booking_id, kind, title, starts_at, ends_at, location_name } }`.
- Waitlist: allow the join with a warning, and skip a clashing member at auto-promotion (they stay `waiting`), like a member who can't pay.
- Staff: refused by default; admin may pass `allow_clash: true` (audited). Admin re-timing an event is never blocked; the response lists members who now clash.
- fe-client: `clash` on each `/me/classes` card → row reads "Clashes with {title} · {time}" instead of Book Now; `time_clash` handled on the race.
- New rows BKG-37…44, WTL-31…32, PT-124, WSP-17, SCH-29.

**Question 2 — calendar sync**

- Member toggle on `/account/settings` (new Calendar card), `clients.calendar_sync` = `off | feed | google`.
- Phase 1: per-member secret ICS feed (every platform, no OAuth) + `.ics` download beside today's Google button. Phase 2: Google Calendar API with `calendar.app.created` into a dedicated "{Studio} classes" calendar, fixed event ids from booking UUIDs, transactional outbox + 1-minute `node-cron` worker. Start Google's sensitive-scope verification (3–5 business days, no CASA) during Phase 1.
- Not email invites: auto-add depends on each recipient's Google setting and our sender is not "known"; Resend's invite support is undocumented.
- New env (Phase 2): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `CALENDAR_TOKEN_KEY`.
- New rows ACC-21…28, TEN-30…31.

### Open questions for the product owner

1. **Travel buffer.** Is back-to-back at *different* Locations fine (5:00 pm end at A, 5:00 pm start at B)? Or should cross-Location bookings need a gap (e.g. 30 min)?
2. **Waitlist join while clashing:** allow with a warning (recommended), or refuse? And should a member skipped for a clash get an email ("A seat opened, but you're booked into X")?
3. **Staff override:** admin-only (recommended), or instructors too?
4. **Does a PT session or workshop count** as a clash for a class (recommended yes), and should staff scheduling PT be refused or only warned?
5. **Existing overlaps** already in the data (and Mindbody-imported bookings): leave them alone (recommended) or report them to studios?
6. **Calendar: which first?** Is the member base mostly Google (build A first) or mixed with iPhone users (feed first, as proposed)?
7. **Google consent branding:** is it acceptable that Google's consent screen names the platform (reservetoday.app), not the studio? Who owns the Google Cloud project, privacy policy and verification video?
8. **Turning sync off:** remove the studio calendar from Google by default (recommended), or leave past/future events?
9. **Scope of synced items:** classes only, or PT sessions and workshops too (recommended all three — they are all bookings)? Waitlist entries (as tentative events)? Past bookings kept in the calendar?
10. **Per-studio switch:** should each studio be able to disable calendar sync (feature flag), or is it platform-wide?
11. **Default for new members:** off (recommended; consent-driven), or prompt during sign-up?

