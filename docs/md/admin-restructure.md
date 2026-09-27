# Admin Restructure — Design Decisions

## Overview — Roles, Workspaces, Sidebar Nav

### Role model (two staff roles)

Staff identity is `admin` or `instructor` — a studio's portal has exactly these two roles, ranked admin > instructor.

| Role | Authority |
|---|---|
| **Admin** | Runs the studio. Global catalog + policy owner: creates locations, edits class types, configures all packages and their promotions, promo codes, Global Policy, Waiver, Marketing and feature flags. Manages Staff (including other admins), Clients, Workshops and Rooms with full read/write — nothing is read-only — and can impersonate a member. Sees every active location of the studio. |
| **Instructor** | Teaching staff. Uses the instructor portal (`/instructor/*`; routes in `be-portal.md` §4) scoped to their own sessions. Cannot reach any `/admin/*` surface. |

- There are no location grants: an admin's accessible locations are all of the studio's active locations.
- The **platform administrator** who operates the super portal is not a studio staff role and is out of scope for this doc.
- See §14 for invitation + archive rules.

### Workspace boundary (global vs workspace-scoped)

Locations are workspaces. Surfaces are partitioned as follows:

| Tier | Surfaces |
|---|---|
| **Global (admin-only)** | Locations CRUD, Class Types, Rooms, Packages → Classes, Packages → Workshops, Packages → Private Sessions, Promotions (nested in packages), Global Policy, Waiver, Staff |
| **Workspace-scoped** | Schedule, Check-in, PT Requests (clients pick a `location_id` at request time — see §9) |
| **Cross-workspace (global)** | Clients — cross-location credits mean a client record spans workspaces; admin sees and manages every client (kebab actions, expiry edits, set-balance, manual adjustments, block/unblock) |

> **Workshops are a global package surface.** Like Classes and Private Sessions, Packages → Workshops is **not** filtered by the topbar workspace switcher — it lists every workshop across all locations. Each workshop still carries a `location_id` chosen in the editor (its days' rooms come from that location); the surface is simply not workspace-scoped.

### Workspace switcher (topbar)

- The admin shell topbar carries a `<WorkspaceSwitcher />` dropdown listing the studio's active locations. The sidebar **no longer has a "Locations" entry** — moved into this dropdown's "Manage locations" modal.
- The active location is global state, persisted in localStorage under `rt.activeLocationId`. All workspace-scoped pages (Schedule, Rooms, Check-in, PT Requests) read it directly — there are **no per-page LocationFilterChips** and **no CheckinLocationPill**. (Workshops is **not** workspace-scoped — see the Workshops note above.)
- Dropdown contents:
  - List of the studio's active locations (current marked).
  - "+ Add location" and "Manage locations" (modal CRUD reusing `LocationFormDialog`).
- `LocationGate` (cold start guard):
  - Admin with zero active locations → "Add your first location" CTA card.
  - Anyone else with no location to open → "No workspace access — contact an admin" empty state.
  - Otherwise pass-through.

### Sidebar structure

**Visual layout** (top to bottom):

- **Finance**: Finance (§20) — first, because it is the surface an owner opens most and the one every other page eventually reports into.
- **Config**: Class Types, Promo Codes. **A Promo Code sits in Config, not Packages**: it crosses products, so it belongs with the building blocks rather than inside any one catalogue (contrast a Promotion, which belongs to exactly one product and is edited there).
- **Packages**: Classes, Workshops, Private Sessions, Corporate, Merch (global, shared across locations). Merch is shop-floor stock (mats, props, apparel) rather than catalogue governance, but like the rest of Packages it is managed by admins.
- **People**: Customers, Corporate Requests, Staff, Leave, My leave (members + staff accounts). **Leave** is the queue of every staff member's requests, each labelled with the applicant's role, where any admin decides any request, their own included. **My leave** (`/admin/my-leave`) is the admin's own balances, request form, documents and history, the same page instructors have at `/instructor/leave` (#315). **Corporate Requests sits here, not in the workspace zone** — a request records no `location_id` until it is scheduled, so there is nothing for the switcher to filter it by; it is a person asking, which is what People is.
- **Settings**: Global Policy, Waiver (location-independent policy + config). **Instructors are merged into Staff** — the Staff page has **Admin** and **Instructors** tabs. "+ Invite staff" (Admin tab) invites a staff member, and its role picker offers only Admin and Instructor; "+ Add instructor" (Instructors tab) routes to the instructor creation flow (which still captures bio, photo, and eligible class types). Instructor rows link to their detail page. There is no separate "Instructors" sidebar item.
- **Workspace zone** (bottom, separated by a divider, under a header showing the active location's name): **Schedule, Rooms, Check-in, PT Requests**. All are filtered by `activeLocationId`; flipping the switcher reloads them. **PT Requests is workspace-scoped** — clients pick a `location_id` at request time, so the triage queue shows only the active location's requests.

`NavItem.workspaceScoped` marks the workspace-zone items; it is distinct from `NavItem.scope`, which only governs role visibility (admin vs instructor). The build-order below is the recommended *setup* sequence, not the visual order.

**Building Blocks** (set up first — prereqs for everything else):
1. Class Types  *(locations moved to topbar switcher)*
2. Instructors
3. Rooms — physical spaces per location (name + capacity). Required when scheduling a class, workshop day, or PT session; the scheduler blocks two sessions sharing a room at overlapping times.

**Policy:**
4. Global Policy — cancellation cap (applies to all clients across all session types)

**Packages + Policies** (configure before creating scheduled sessions):
5. Classes — Trial Pass, credit bundles, unlimited memberships (+ promotions)
6. Private Sessions — PT packages (+ promotions)
7. Workshops — multi-day workshop editor (housed under Packages; global/shared, not workspace-scoped — each workshop still picks its own location)

**Schedule:**
8. Schedule
   - **Timetable** — unified calendar view of all sessions (classes + workshops + confirmed PT) scoped to the active workspace
   - **Create Schedule** — every flow starts by arming the grid and clicking a slot (§7f):
     - Class instance (class type, instructor, date/time, duration, capacity, credit cost, difficulty)
     - Workshop — the slot becomes the first day of a new workshop in the Packages editor (§7c)
     - Corporate session (via corporate request picker — see §9b)
     - PT session (via PT Request triage — see §9)

**Operations:**
9. PT Requests (replaces Instructor Availability — see §8/§9)
10. Session Detail Pages (class / workshop / PT)
11. Check-in
12. Cancellation & Refund Mechanics
13. Inbox
14. Roles & Invitations

**Clients & Content:**
15. Clients
16. Notifications (Email Templates)
17. Waivers

**Completed this phase:**
- 14. Roles & Invitations
- 15. Clients (list, profile, credit balance, history, manual adjustments)
- 16. Notifications (email template management) — built against fixture templates, then hidden (#277); see §16
- 17. Waivers

**Next phase (see §19):**
- Dashboard
- Reports
- Audit log
- Referrals
- Instructor portal

**Out of scope:**
- Settings (studio profile, branding, operating hours)

---

## 1. Locations (Workspaces)

**Surface:** Topbar `<WorkspaceSwitcher />` dropdown → "Manage locations" modal. **Admin-only.** There is no sidebar entry for Locations.

Locations are the workspace boundary — every scoped surface (Schedule, Rooms, Check-in, PT Requests) reads `rt.activeLocationId` from localStorage and renders only data tied to it.

**Fields per location:**
- Name
- Address
- Google Maps link
- Phone number

**Modal behaviour:**
- List active locations as cards; archived locations at the bottom with an "Archived" badge + Restore button.
- "+ Add location" opens the shared `LocationFormDialog`.
- Cold start (zero active locations): admin sees the "Add your first location" CTA card via `LocationGate`.

**Deletion rules:**
- **Hard delete** — only if zero linked data exists across all tables (location has never been used).
- **Soft delete (archive)** — if past data exists but no upcoming or ongoing sessions. Archived locations appear at bottom of list with Restore option.
- **Blocked** — if the location has any upcoming or ongoing classes, workshops, or private sessions.
- **Warned, not blocked** — if live Unlimited Plans call the location home, archiving asks for confirmation naming how many members it strands (`GET /locations/:id/live-unlimited-count`). Both archive buttons — the Locations page and this modal — warn identically, because the check sits in `archiveLocation` in the workspace context.

---

## 2. Class Types

**Sidebar position:** Top-level building block item. **Admin-only** (global catalog).

**Purpose:** Shared catalogue of session types (e.g. Chair Yoga, Vinyasa Flow, Aerial Yoga). Used as a dropdown when creating a class/workshop/PT session, and as a multi-select on instructor profiles to indicate teaching eligibility.

**Fields per class type:**
- `name`
- `description` — short blurb shown to clients on `/classes` and workshop cards.
- `parent_id: string | null` — single-level hierarchy. A class type may have a parent, but a child cannot itself become a parent (depth capped at 1). Rendered as a tree on the catalog page.

**Difficulty has moved off class types.** It is now set per-instance on `class_instances.difficulty: "general" | "beginner" | "intermediate" | "advanced"` during scheduling — the same class type can run at different levels depending on the scheduled session.

**Deletion rules:**
- **Hard delete** — only if zero linked data (class type has never been used).
- **Soft delete (archive)** — if past data exists but no upcoming or ongoing sessions reference it.
- **Blocked** — if any upcoming or ongoing session uses this class type. Parents are also blocked while any child still has linked data.
- Archived class types appear at bottom of list with Restore option.

---

## 3. Instructors

**Sidebar position:** Top-level building block item.

**Fields per instructor:**
- Name
- Profile photo
- Bio
- Phone number
- Email
- Eligible class types (multi-select from the shared Class Types catalogue)

**All fields are editable.**
No location assignment in v1. No pay rate in app (handled externally).

**Page behaviour:**
- Instructors list: cards/rows with an "Add instructor" CTA.
- Clicking an instructor opens a dedicated page (`/admin/instructors/[id]`) with full profile and editable fields.
- Archived instructors shown at bottom of list with "Archived" badge + Restore button.

**Deletion rules:**
- **Hard delete** — only if zero linked data exists across all tables (instructor has never been assigned to any session).
- **Soft delete (archive)** — if past data exists but no upcoming or ongoing sessions. Archived instructors appear at bottom of list with Restore option.
- **Blocked** — if the instructor has any upcoming or ongoing classes, workshops, or private sessions.

---

## 3b. Rooms

**Sidebar position:** Top-level building block item (under "Building Blocks", beside Instructors). Location-scoped, so workspace-aware.

**Fields:** name, capacity (whole number ≥ 1). A room belongs to exactly one location and cannot be moved between locations after creation.

**Where it's used:** Every scheduled session — a class, a workshop day, or a PT session — is assigned a room. The room dropdown in each scheduling form is filtered to the chosen location's rooms.

**Clash validation:** The scheduler hard-blocks creating or rescheduling a session into a room that already has another **active** session at an overlapping time, checked across classes, workshop days, and PT sessions together (a physical room hosts one thing at a time). The error names the conflicting session(s).

**Capacity is reference metadata** — it does not cap a session's online/waitlist/buffer booking capacity.

**Deletion rules:**
- **Archive** — allowed when no upcoming active session references the room. Archived rooms appear at the bottom with a Restore option.
- **Blocked** — if any upcoming active class, workshop day, or PT session uses the room.

---

## 4. Global Policy — Cancellation (Class + PT)

Single source of truth for client-initiated class and PT cancellation. Workshops and package purchases are non-refundable and not cancellable by the client (see §7c, §12).

**Cancellation Cap:**
- A switch, **"Limit refunded cancellations"** (#318). On (the default), the two values below apply. Off, every cancellation made in time returns the credit, however many; the count and cycle fields are disabled and the summary reads "No cap — every cancellation made in time returns the credit." Cancellations are still recorded while it is off, so switching it back on counts the ones already inside the cycle — the page says so beside the switch.
- Admin sets two values: maximum number of cancellations + cycle duration. A new studio starts at 10 cancellations per 30 days.
- Applies universally to all clients — no per-client customisation.
- Cap covers **class + PT bookings together** (one shared bucket).
- Cap counts **cancellations only** — no-shows do not count toward the cap (no-shows already self-punish via full forfeit).

**Time Window:**
- Admin sets two values:
  - **Class cancellation window** (e.g. 12 hours before class start)
  - **PT cancellation window** (e.g. 24 hours before session start)
- Cancelling inside the window forfeits the credit/session regardless of cap state. A member can always cancel a class until it starts: inside the window it is a **late cancel** — it goes through, keeps the credit and counts toward the cap. A PT session cannot be cancelled by the member inside its window. A class may carry its own window (#313).

**Refund rule (combined cap + window):**

| Within cap | Outside window | Result |
|---|---|---|
| Yes | No (i.e. early cancel) | **Full credit/session refund** |
| Yes | Yes (i.e. late cancel) | Forfeit |
| No | No | Forfeit (cap blocks the refund, not the cancellation) |
| No | Yes | Forfeit |

- Cancelling a class is **always allowed** until it starts — the cap and window only gate whether the credit is returned. With the cap switched off, "Within cap" is always Yes.
- All-or-nothing: full refund or zero. No partial refunds.
- Cycle resets per the configured duration; both cap counter and refund eligibility reset together.
- A member's own cancel has no per-booking override. A **staff cancel** of one booking (§12, #320) is not judged by this table at all: the staff member chooses Return credit or Keep credit every time, and it never counts toward the member's cap. Its `cancellations` row still records, truthfully, whether it came inside the class's window.

**No-show:**
- Hardcoded full forfeit. Not configurable. Does not count toward the cap.

---

## 5. Classes (Config Page — Packages Only)

**Purpose:** Pre-requisite config. Admin sets up class packages here before any class sessions can be created on the Schedule. No scheduling happens here. **Admin-only.**

**Cancellation policy lives in §4 Global Policy — not configured here.**

`ClassPackageKind = "credit_bundle" | "unlimited" | "trial"`. Page lists Trial Pass first, then credit bundles, then unlimited memberships.

### 5a. Trial Pass (one-per-client, quota-based)

A standalone, quota-based pack that any client may purchase **once only** — enforced at purchase time. A warning header above the section explains the one-per-client rule.

**Trial Pass fields:**
- `name` (e.g. "First-timer Trial")
- `description` — short copy shown on the client packages page
- `price_sgd`
- `credits` — count of trial classes included
- `validity_days: number | null` — optional; `null` means no expiry
- Active / Archived toggle
- `promotions: Promotion[]` (see §5d)

### 5b. Credit Bundle package fields
- `name` (e.g. "5-class pack")
- `credits` — number of credits
- `price_sgd`
- `validity_days` — days from purchase date
- Active / Archived toggle
- `promotions: Promotion[]` (see §5d)

### 5c. Unlimited package fields
- `name` (e.g. "Monthly Unlimited")
- `duration_months` (e.g. 3, 6, 12) — whole calendar months
- `price_sgd`
- Active / Archived toggle
- `promotions: Promotion[]` (see §5d)

### 5d. Promotions (shared shape across Classes + Private Sessions)

`class_packages` and `pt_packages` each carry `promotions: Promotion[]`. Promotions are nested in the package editor — there is no separate Promotions page. Quick-add via "+ Add promotion" in the package dialog.

**Promotion shape:**
- `id`
- `label` — admin-facing name (e.g. "May Day 25% off")
- `starts_at`, `ends_at`
- `mode: "percent" | "price"`
- `percent: number | null` — used when `mode = "percent"`; quick-pick buttons offer 10 / 25 / 50, but any 0–100 value is allowed.
- `price_sgd: number | null` — used when `mode = "price"`; explicit special-price override.

**Resolution: best-price-wins.** At purchase time the system evaluates every promotion whose `[starts_at, ends_at]` window contains `now` and applies the one yielding the lowest effective price. Deterministic tie-break on lowest `id` alphabetically. Multiple promotions may stack as candidates — only one wins per purchase.

**Surfacing:**
- Active and future promotions render as pills on the `/admin/classes` package cards.
- The Trial Pass section may also carry promotions, evaluated identically.

---

## 6. Private Sessions (Config Page — Packages Only)

**Purpose:** Pre-requisite config. Admin sets up PT packages here before any private sessions can be created. No scheduling happens here. **Admin-only.**

**Cancellation policy lives in §4 Global Policy — not configured here.**

**PT Package fields:**
- `name` (e.g. "5-session 1-on-1 pack")
- `session_type` — `1on1` or `2on1` (dropdown)
- `sessions` — number of sessions
- `validity_days` — how long a purchase lasts, in days. **Required**, 1..3650, set beside `sessions` in the editor. A purchased package expires at purchase time plus this figure, through the same helper a Credit Bundle uses. Editing it moves **future sales only** — a package already sold keeps the expiry it was stamped with. There is no "never expires": a null expiry means Dormant and only an Unlimited Plan can be that.
- `price_sgd`
- Active / Archived toggle
- `promotions: Promotion[]` — same shape and best-price-wins resolution as §5d.

The catalogue list shows each package's session count and validity.

**Booking config:**
- `min_book_in_advance_days` — the soonest a client may propose a PT session, in days after today (default 3).
- `book_in_advance_days` — the latest, in days after today; also how long a pending request waits before it expires.
- A minimum above the maximum is refused (`min_book_in_advance_after_max`); the page says so before saving. Both are editable here and in Global Policy.

**Staff notes to the member** (PT Requests queue, the session's page, the instructor's queue and session page):
- **Cancel** opens a dialog saying what happens to the sessions held, with an optional **Reason** (500 characters) the member reads on their booking (`cancel_note`).
- **Schedule** offers an optional **Note to the member** only when the date and start chosen match none of the member's proposed slots (`schedule_note`), to say why.
- The request drawer shows both to staff.

---

## 6b. Merch (Config Page — Packages)

Studio goods surfaced in the member app at `/merch`. **Admins** manage them — see `be-portal.md` §`merch.ts` for the route surface.

- Fields: **Title, Description, Price (SGD), Photo** (JPG/PNG/WebP, max 5MB, stored in R2). Nothing else: no stock count, no location, no promotions, no Promo Code scope.
- **Archive** hides an item from the member app and refuses new checkouts; **Delete** is permanent and stays available because nothing references a merch row — a member's purchase history keeps its own frozen title and amount.
- Members pay online via Stripe and **collect the item in person**; the member app says so above the grid. There is no fulfilment state to tick off — the front desk works off the member's `/account/merch` purchase history.
- Not in this page: who bought what. A staff-side orders view is deliberately out of scope for now.

---

## 7. Schedule

### 7a. Timetable

- Google Calendar-style unified view of all classes, workshops, and confirmed private sessions **scoped to the active workspace** (`rt.activeLocationId`). Switching workspace via the topbar re-renders the calendar.
- Admin navigates by day / week / month.

**Filters (no Location filter — workspace is global now):**
- Instructor — dropdown of all instructors
- Type — All / Class / Workshop / Private Session
- Date — date picker to jump to a specific date

**What influences the timetable:**
- Admin creates a class instance → immediately appears on the Schedule timetable AND occupies that slot on the assigned instructor's calendar.
- Admin creates a workshop in `/admin/packages/workshops` → each `WorkshopDay` auto-renders on the Schedule timetable as one tile with a `Day N/M` chip. The scheduler can *start* that creation (§7c) but the workshop is still configured and saved in the Packages editor.
- Admin (or assigned instructor in a later phase) schedules a PT session from a PT Request (§9) → confirmed session appears on the Schedule timetable AND occupies that slot on the instructor's calendar.

**Admin-initiated cancellation:**
When admin cancels a class, workshop, or PT session from the Schedule, all booked clients automatically receive a full refund — regardless of cap, window, or any other rule. No exceptions.

- **Class cancelled by admin** → full credit returned to each booked client's package. In-app, automatic.
- **PT cancelled by admin** → full session returned to client's PT package. In-app, automatic.
- **Workshop cancelled by admin** → automatic Stripe money refund to each attendee, fired immediately on cancellation. No manual settlement.

In all three cases, an Inbox notification is generated (see §13).

### 7b. Create Schedule — Class Instance

Fields:
- `class_type_id` (from shared Class Types catalogue)
- `instructor_id` (dropdown filtered by eligible class types)
- `location_id` — defaults to active workspace; not user-selectable.
- Date and time
- Duration
- `difficulty: "general" | "beginner" | "intermediate" | "advanced"` — per-instance (moved off class type, see §2).
- **Capacity** — structured, see §7d below.
- Credit cost (set manually per class instance — varies by class type but entered at scheduling time)
- **Packages accepted** — the class's **Package rule** (`PackageRuleField`, be/CONTEXT.md § Package rule): a mode control, *All packages* (the default) / *Only these* / *All except*, and for the last two a checklist of the studio's class packages grouped by kind (Unlimited Plans, Credit Bundles, Trials), searchable, with archived packages under their own heading — they are pickable, because members may still hold one. Exact packages only: no kind-level rule, no Class Type default. "Only these" with nothing ticked is refused (`package_rule_empty`); a PT, corporate or another studio's package is refused (`package_rule_invalid_package`). Sent as `package_rule: { mode, package_ids }`. Admins and Instructors both set it on the new-class screen; Admins also on the class editor (§10).

### 7b-bis. Class Series — "+ Class" with Repeat weekly

There is one `+ Class` on the Schedule; the slot picked seeds the date and times of `/admin/schedule/new/class`. The class screen has a **Repeat weekly** switch, off by default. Off, it makes one class. On, it makes a Class Series:

- **Date** becomes **First date**; the weekday is taken from it and shown read-only ("Every Tuesday"); **Last date** appears, at most a year after the first date.
- **Preview dates** is required before anything is created. It lists every date with its clashes (room, instructor, leave); clashing dates start unticked, and unticking any date skips it (a public holiday). Any change to the form makes the preview stale, and a create refused with `409` previews again, keeping the dates already unticked.
- The submit reads **Create N classes** and is enabled only when no ticked date clashes; it creates all or nothing.
- Pay reads "Main instructor pay per class (S$) · optional". The optional **Cancellation window (hours)** is copied onto every class, and so are the **Packages accepted** (§7b) — onto every class an Extend adds too. The series panel shows the rule and an admin may change it there; the change reaches only the classes the series adds from then on, and the classes it already made keep theirs (each is changed on the class, §10). Editing one class's rule changes that class only.

The retired `/admin/schedule/new/series` redirects to the class screen with Repeat weekly on (`?repeat=weekly`), keeping any slot.

**Instructors** have the same switch on `/instructor/schedule/new/class`. As with their single classes, they are forced as main instructor, name no supporting instructors, see no pay field (every class is Unpriced for an admin to set from Finance), and pick the location and room on the form. Instructors cannot extend or end a series.

Classes made by a series show a repeat mark on the Schedule. Their detail page shows the series ("Mondays 19:00–20:00 · 1 Oct to 31 Dec") with **Extend** (a new last date → preview → add classes; never repeats a date) and **End series** (from a date: unbooked classes are cancelled, booked ones are listed with a link to cancel each, which refunds). Everything else about a class from a series is edited on the class itself.

### 7c. Workshops on the Schedule

Workshops are still *configured* under Packages (§7e) — the scheduler only picks when one starts.

- The scheduler's **"+ Workshop"** button arms the timetable grid (§7f). Clicking a slot opens the Packages workshop editor at `/admin/packages/workshops/new` with that slot as the workshop's **first day** — date, start and end pre-filled, range mode ready to extend across further days. Nothing is saved until the admin completes the editor.
- Existing workshops are never re-picked from the scheduler: their `WorkshopDay` tiles already render on the timetable automatically (one tile per day, `Day N/M` chip).
- Cancelling a workshop still happens from the Schedule detail page (cancellation rules unchanged — full automatic Stripe refund to all attendees per §7a).

**"+ Corporate" picker (replaces the old direct-create).** The scheduler's **"+ Corporate"** button opens a picker of **pending corporate requests** — selecting one opens the schedule dialog (instructor, location, room, date/time). The old "+ corporate" package dropdown and the `/admin/schedule/new/corporate` direct-create page (which took a freeform client name) are **removed**: a `corporate_session` is now created **only** by scheduling a corporate request, and its client name is derived from the member record. See §9b.

### 7d. Structured capacity (`<CapacityFields />`)

`Capacity` is no longer a scalar. Applied to `ClassInstance.capacity`, `WorkshopDay.capacity`, and `PtSession.capacity`:

| Field | Meaning |
|---|---|
| `online_booking` | Online seats: members book these themselves in the client app |
| `buffer` | Buffer seats: only staff fill these, by booking a member from the session page; never shown to members |
| `waitlist` | How many members may queue once the online seats are gone. **Not a seat.** |
| `attendance_capacity` (derived) | `online_booking + buffer` — the most people the roster holds without an overbook |

The waitlist is a line, not part of the room, so it is never added into a capacity (`spec-waitlist.md` §1; this replaces the earlier `max_capacity = waitlist + online_booking + buffer`).

A shared `<CapacityFields />` block appears on every scheduling form, reading "Attendance capacity: N · Waitlist: M" under its three inputs.

**Seats.** Every class booking records the seat it holds — `online`, `buffer` or `overbook` — and `services/bookings/seats.ts` is the only place they are counted. A member takes an online seat; staff take a buffer seat; an admin may **overbook** past a full buffer after confirming "No seats left. Overbook?". An instructor is told "No seats left." and cannot overbook. The member catalogue's `spots_left` is online seats only, so a staff booking never changes it.

**Session page** (admin and instructor): **Booked** `attending / attendance capacity` (e.g. 8 / 16); **Seats** `online used / online · buffer used / buffer`, plus "N overbooked" when any; the roster tags each buffer and overbook row; **Add member** searches the studio's members and books one on; when the member holds more than one package that can pay, a **Pay with** select opens on their row with the Default payer chosen and Ineligible packages greyed with their reason (a Dormant one says "Starts today, runs until {date}"), and with one or none the booking goes straight through (#333). The timetable cell reads `attending / attendance capacity`. An instructor reaches this page for the classes they lead.

### 7e. Workshops are configured under Packages (not Schedule)

Workshops live at `/admin/packages/workshops` — workspace-scoped (each workshop is tied to a `location_id`, so admins see only their workspace's workshops). See §18 for the full spec.

---

## 8. Instructor Availability — REMOVED

This surface has been **removed entirely.** There is no `/admin/availability` page and instructors do not publish availability slots.

It is replaced by the **PT Request** flow (§9): clients submit a request with their preferred slots, and admin schedules a session from the request via `ScheduleFromRequestDialog`. The instructor's calendar is implicit — the system simply checks for instructor conflicts at the moment of scheduling.

---

## 9. PT Requests (Private Session Booking Flow)

The Availability system is gone (§8). PT sessions now exist only as the resolution of a **PT Request** — one a client submitted, or one the portal writes itself for a session staff add manually (§9d).

**Invariant:** in v1, **no `PtSession` can exist without a matching `PtRequest`.**

> **v1 flow rule:** there is **no in-app back-and-forth** between client and admin. All negotiation (date, time, partner availability, instructor swap) happens **out-of-app on WhatsApp**. The portal exposes exactly two terminal actions: **schedule** (the implicit approval) and **cancel**. There is no "approve" button and no "decline with note" path.

### 9a. Data shape — `PtRequest`

| Field | Notes |
|---|---|
| `id` | |
| `client_id` | The requester |
| `class_type_id` | Class type focus picked from the active list (drives instructor expertise hint) |
| `session_type` | `1on1` or `2on1` |
| `co_client_id: string \| null` | 2on1 only: existing partner (matched by email lookup at submit time) |
| `co_client_name: string \| null` | 2on1 only: partner full name when not yet a member |
| `co_client_email: string \| null` | 2on1 only: partner email when not yet a member |
| `message` | Optional free-form note from the client |
| `status` | `pending` / `scheduled` / `cancelled_before_scheduled` / `cancelled_after_scheduled` / `attended` |
| `scheduled_pt_session_id` | Set when scheduled |
| `expires_at` | Auto-cancels the request (refund) if no schedule by this point |
| `resolved_by_staff_id`, `resolved_at` | Audit — set on schedule or cancel |
| `created_at` | |
| `slots: PtRequestSlot[]` (separate `pt_request_slots` table, 1..N) | Each `{ proposed_date, start_time, end_time }` — client supplies multiple options |

**Instructor preference is NOT captured** — admin assigns instructor at scheduling, informed by `class_type_id` and live availability.

### 9b. Workspace-scoped

PT Requests carry a `location_id` chosen by the client at request time. The `/admin/pt-requests` queue is therefore **filtered by the active workspace location**; flipping the workspace switcher re-scopes the list, and the page shows a banner naming the active location. At scheduling time the resulting `PtSession.location_id` defaults to the requested location (admin can still change it in `ScheduleFromRequestDialog`).

### 9c. Triage UI (`/admin/pt-requests`)

- Filter chips: `pending` / `scheduled` / `cancelled` / `attended` / `all`. (`cancelled` rolls up both cancelled variants.) Pending count badge appears on the sidebar item.
- Row click opens a **detail drawer** with: class type, session type, all proposed slots, partner info (with "needs account" badge if `co_client_id` is null), and the client's message.
- **Schedule** opens `ScheduleFromRequestDialog`:
  - Quick-pick chips for each proposed slot — clicking one fills date / start / end.
  - Admin can also free-type a date/time that wasn't proposed (post-WhatsApp negotiation).
  - **Instructor**: admin picks from active instructors, no pre-fill (no `preferred_instructor_id`).
  - **Location + Room**: required; room must belong to the chosen location.
  - **2on1 + partner is not yet a member** → admin is prompted to create the partner's client account first (via a "+ Create partner" inline action) before submit; the scheduler refuses to save until `co_client_id` is populated.
  - `<CapacityFields />` defaults from session type (`1on1` → `online_booking: 1, buffer: 0, waitlist: 0`; `2on1` → `online_booking: 2`).
- **Cancel** (admin) is a single-confirm action — no decline note. Branches on current status (see §9e).

### 9d. Two converging entry points

Scheduling a request goes through `ScheduleFromRequestDialog` from either of two places (Add manually, below, is a third path with its own dialog):

1. **From PT Requests** → row drawer → "Schedule" button.
2. **From Schedule** → "+ PT Session" button → picker dialog listing pending requests → same dialog.

**Add manually (#336).** The "+ PT Session" picker also offers **Add manually**, whether or not requests are pending, for a session agreed outside the app. It opens `ManualPtSessionDialog` seeded with the clicked slot: session type (1-on-1 / 2-on-1), date, start and end, instructor, instructor pay (optional, as on the class form), Location and room. Below the form, a member search and roster like the class roster's seats one member on a 1-on-1 and up to two on a 2-on-1, nobody twice. Each member row reads the member's PT packages for the chosen type and instructor (`GET …/seat-candidates`, re-read when either changes): the one that can pay is shown, or a **Pay with** select when more than one can, each named with its sessions left, type, bound instructor and end date (a Dormant one says when it would run until), Ineligible ones greyed with their reason. A package that bends what the member bought — the other session type, or (Admin only) bound to another instructor — shows a warning band with **Add anyway**; for an Instructor another coach's package is a refusal. Saving is refused with no member, and sends `override` only when staff accepted a warning. The **Instructor** portal reaches the same dialog from **PT session** on My schedule: the instructor is them and not editable, and pay is left for an admin.

The invariant still holds: a manual session is created with a portal-origin request behind it (be-portal.md § `/pt-requests/manual`).

### 9e. Status lifecycle + refund policy

Credit deduction happens **on submit**, not on schedule. 1 session debited for `1on1`, 2 for `2on1` (one per attendee).

| Transition | Trigger | Refund |
|---|---|---|
| `→ pending` | Client submits | n/a (credits debited) |
| `pending → scheduled` | Admin schedules (creates `pt_sessions` + per-client `bookings`) | n/a |
| `pending → cancelled_before_scheduled` | Client or admin cancels while pending **or** request expires | **Refund** — 1 (1on1) or 2 (2on1) sessions returned to the source package |
| `scheduled → cancelled_after_scheduled` | Client or admin cancels after scheduling | **No refund (v1)** — cascade-cancels the `pt_sessions` row + every booking on it; bookings marked `state='cancelled'`, `refund_outcome='forfeited'` |
| `scheduled → attended` | Check-in on the linked PT booking flips the mirrored status | n/a |

Both the cancel-before and cancel-after paths fire the same client email (subject differs only in whether a refund line is included). The matching admin Inbox entry uses `type='admin_cancel_class_pt'`.

### 9b. Corporate Requests (`/admin/corporate-requests`)

Corporate sessions follow the **same request-driven pattern as PT** (§9). The old admin-direct-create — where an admin made a `corporate_session` with a freeform client name straight on the schedule — is **removed**. Corporate packages are now surfaced to clients (a "Corporate" catalogue in the client app); a member **buys** one via Stripe, and the purchase auto-creates a single **pending** corporate request. There is **no client form** — negotiation happens over **WhatsApp**.

> **v1 flow rule:** like PT, there is **no in-app back-and-forth** and no approve/decline. The portal exposes three actions: **schedule** (the implicit approval), **cancel**, and **mark attended**.

**Status lifecycle** — `pending` / `scheduled` / `cancelled` / `attended`. Note the **single `cancelled`** state (no before/after split, unlike PT) and **no `expires_at`** (a corporate request never auto-expires).

| Transition | Trigger |
|---|---|
| `→ pending` | Member buys a corporate package (Stripe webhook auto-creates the request — no credits granted; the request itself is the entitlement) |
| `pending → scheduled` | Admin schedules → creates the `corporate_session` (room + instructor conflict-checked, reusing the existing corporate-session create logic); session's client name is derived from the member record |
| `pending → cancelled` | Admin cancels |
| `scheduled → cancelled` | Admin cancels → also cancels the linked `corporate_session` |
| `scheduled → attended` | Admin marks attended |

**Triage UI:**
- Filter chips: `pending` / `scheduled` / `cancelled` / `attended` / `all`. Pending count badge on the sidebar item.
- Row → detail drawer: client, package, message, and (when scheduled) the linked session's date/time, location, instructor.
- **Schedule** dialog: `main_instructor` (+ optional supporting instructors), `location`, `room` (must belong to the location), date/time. Same conflict checks as any scheduled session.
- Two converging entry points (like PT): the **Corporate Requests** page row drawer, and the Schedule **"+ Corporate"** picker (§7c) — both open the same schedule dialog.

The client reflects status back on `/account/corporate` (`fe-client-features.md` §8.8); pending requests surface a WhatsApp contact button.

---

## 10. Session Detail Pages

Every scheduled item (class, workshop, PT) becomes clickable on the Schedule timetable and opens its own dedicated detail page.

**Common shape (all three types):**
- Header: title, type badge (Class / Workshop / PT), date/time, location, instructor(s)
- Event state chip: `scheduled` / `ongoing` / `completed` (auto-flipped by system based on time)
- Summary: capacity, booked count, full booking details
- Attendees list (roster)
- Per-row booking actions where applicable

**Class detail page additions:**
- Each roster row shows a read-only **Checked in** tag once the member is attended (or **No-show**). Attendance is not marked here — that is the check-in desk's alone (§11)
- Cancel-this-instance action (admin) → triggers full credit refund + Inbox notification
- **Cancel** on each confirmed, not-attended roster row (admin on any class; instructor on a class they lead) → the staff cancel dialog, Return credit or Keep credit (§12)
- **Packages accepted** — the class's Package rule as a sentence ("All packages" / "Only: …" / "All except: …"), on the admin page and the instructor's session page. The admin editor changes it with the same `PackageRuleField` as §7b. A change that would cancel bookings is previewed first (`PATCH …/classes/:id` with `preview: true` → `{ would_cancel: n }`): above zero, a confirm step says **"This will cancel N bookings"** before anything is saved. Saving cancels exactly the bookings paid by a package the class no longer accepts (never one already checked in) — each refunded in full to the package that paid, its seat offered to the waitlist, not counted against the member's cancellations, and the member emailed `class_rule_cancelled`. A change that cancels nobody saves without the confirm.

**Workshop detail page additions:**
- Per-tier breakdown (which tier each attendee bought)
- No check-in (workshops are not check-in tracked)
- Cancel workshop action (admin) → cancels its bookings; nobody is refunded automatically. Each paid booking stays refundable from the member's Workshop purchases card (#272)

**PT detail page additions:**
- Single client (1-on-1) or two clients (2-on-1)
- Check-in row (QR / code / manual — see §11)
- Check-in state chip: `pending` / `completed`
- Cancel-this-session action (admin or assigned instructor) → full session return + Inbox notification
- Members panel: each member with their check-in and the package paying their seat (name, sessions left)
- **Manual sessions (#338).** A session staff added manually (§9d) carries a **Manual** badge here and on the PT Requests list and drawer, which hide the request-only fields (proposed slots, preferred class type, message, bound instructor). While it is to come, the Members panel manages it: **Remove** takes one member off, their session back on their own package, the others staying; **Add member** fills a free seat through the same member search, package pick and Add anyway band as Add manually (an Instructor is refused another coach's package); and, an Admin's alone, **Change to 1-on-1** confirms which partner leaves and refunds them, while **Change to 2-on-1** asks for the partner through that same add-member row, who pays one session from their own package. The edit form's Format select is not shown for a manual session. Refusals are worded from their error code. The **Instructor** portal opens the same page for a private session they run from My schedule (`/instructor/schedule/pt/:id`): the members, Remove and Add member on a manual one, and Cancel — no pay, editing or type change.

---

## 11. Check-in

**Eligibility:** Classes and PT sessions only. Workshops are not check-in tracked.

**Methods (3 total):**
1. **QR scan** — admin scans a QR code displayed in the client's app. Each booking has a unique QR.
2. **Code entry** — admin types a per-booking alphanumeric code (same value encoded in the QR; format e.g. `RT-A4F2K9`, case-insensitive). Used as fallback when QR scan fails.
3. **Manual tick** — admin or instructor flips a roster row directly to `attended` or `no-show` without scanning.

Per-booking codes are **unique** — the system resolves both client identity and target session from the code alone. No "wrong session" error possible.

**Surfaces (where check-in happens):**

| Surface | Methods available | Use case |
|---|---|---|
| Check-in desk (`/admin/check-in`, `/instructor/check-in`) | QR + Code + Manual | The only place attendance is marked. Front-desk daily driver |

The class session page shows each member's check-in but does not change it.

Both admin and instructor can perform check-in (instructor scoped to own sessions).

**The desk has two views**, switched by tabs under the header:

- **Scan** (the default): the result banner across the top (with **Open roster** after a check-in), the camera, the **Type a booking code** box, and an **At the door** card naming the session running now or next with its checked-in count. The camera closes while Rosters is up and re-opens on the way back, so nobody is checked in by a camera no one is watching.
- **Rosters**: today's sessions down the side, one line each (start and end time, name, instructor, checked-in / booked, waitlist count), with a **Now** line between the sessions that have started and those still to come; below `md` they are one swipeable strip. The picked session's roster sits beside it: kind and phase, time, instructor and room, a checked-in progress bar, a name-or-code search once there are more than 8 rows, then the members. On the admin desk each member's name (and each waitlisted name) opens their customer profile in a new tab.

There is no location filter on the desk: it follows the workspace switcher's location like every workspace-scoped page. A session's location is shown on its line only when the day's sessions span more than one.

**Marking and unmarking.** A member not yet in has **Mark as attended** — one tap. Once attended the button reads **Attended**; tapping it turns it into **Undo?**, with the note "Their check-in is removed. The credit stays spent — to return it, cancel the booking afterwards." beside it, and a second tap unmarks them. Tapping elsewhere, pressing Escape or waiting four seconds leaves them attended.

Unmarking only removes the check-in; it never returns the credit the booking spent.

**State machines:**

**Event state** (auto-flipped by system, time-based):
- `scheduled` → `ongoing` → `completed`
- Applies to class, workshop, and PT.

**Check-in state** (manual, applies to class and PT only):
- `pending` — any roster row still undecided (not yet marked `attended` or `no-show`)
- `completed` — every roster row marked `attended` or `no-show`

No automatic no-show flip. Forfeits only fire when admin/instructor manually marks the row `no-show`.

**Pending check-in surfacing:**
- Dashboard alert chip: "N sessions need check-in finalised" → links to filtered list.
- Schedule timetable visual cue: completed event with pending check-in shows an amber dot.
- 24h email nag: if a session's check-in is still `pending` 24h after event end, email assigned instructor (cc admin).

---

## 12. Cancellation & Refund Mechanics

Consolidated reference for all cancellation paths.

**Client-initiated:**

| Item | Cancellable by client? | Refund mechanic | Rules |
|---|---|---|---|
| Class booking | Yes (self-service) | Credit returned to package | Full or zero per §4 (cap + window) |
| PT booking | Yes (self-service) | Session returned to PT package | Full or zero per §4 (cap + window) |
| Workshop purchase | **No** | n/a | Non-refundable, persistent |
| Package purchase | **No** | n/a | Non-refundable, persistent |

- Cancellation is always allowed for class/PT — cap and window only gate whether the refund fires.
- All-or-nothing: full refund or zero. No partials.
- "Reschedule" is not a first-class action — it's just cancel + rebook, subject to the same rules.

**Admin-initiated** (Schedule → Cancel session/workshop):

| Item | Refund mechanic |
|---|---|
| Class | Full credit return to all booked clients (in-app, automatic) |
| PT | Full session return to client (in-app, automatic) |
| Workshop | Full Stripe money refund to all attendees (in-app, automatic, immediate) |

- Always 100%, overrides cap and window.
- Generates an Inbox notification (§13).

**Staff-initiated — one member's class booking** (#320):

An admin cancels any member's class booking — from the class roster (§10) or the member's profile; an instructor cancels a member's booking on a class they lead, from its roster (anyone else's is refused `not_your_session`). Adding members from the roster is unchanged.

Every staff cancel asks, in one shared dialog, with **neither option pre-selected**:

- **"Return 1 credit to {package}"** (plural "Return 2 credits to …") — the credits go back to the package that paid (`credit_returned`).
- **"Keep the credit — recorded as a late cancel"** — nothing moves (`forfeited`), and the member's history counts it as a late cancel.

**Cancel booking** stays disabled until one is picked. Under the title the dialog says "Their place is released." and whether the class is already inside its cancellation window ("The class is already inside its cancellation window." / "…is not yet inside…"). A booking that spent nothing — an Unlimited plan's — offers no choice and says so instead ("Their plan is unlimited, so no credit was spent — nothing to return or keep."); its outcome is `n_a` either way.

- A staff cancel **never counts toward the member's Cancellation Cap** (§4).
- A booking marked attended is refused (`booking_attended`) until it is unticked (§11); a workshop is refunded, not cancelled; a private session is cancelled as a PT request.
- A freed online seat goes to the head of the waitlist under the usual rules and the class's effective window.
- No member email.

**Refund inbox: does not exist as a separate actionable queue.** All refunds (credit, session, money) are automated. The Inbox surfaces them informationally only.

---

## 13. Inbox

> **Hidden (#277).** The Inbox screen read fixture data and described cancellations as refunds they are not (a Workshop cancel refunds nobody; a class cancel returns credits, not money). It has been removed from the portal until it is wired to real data — a separate ticket. The design below is the target for that work, not a description of the shipped portal.

Single workspace-scoped inbox at `/admin/inbox`. Filter tabs by notification type. One sidebar item with total unread count for the active workspace.

PT request triage **does not live here** — it has its own dedicated page (`/admin/pt-requests`, §9). The Inbox is now purely a notification feed.

**Notification types:**

| # | Type | Trigger | Shape | Actionable? |
|---|---|---|---|---|
| 1 | **Client cancellation** | Client cancels a class or PT | Feed-style row: client, session, time-of-cancel, refund result (credit returned / forfeited) | No — read/unread only |
| 2 | **Admin cancellation — class/PT** | Admin cancels a class or PT instance | Feed-style row: actor, session, time-of-cancel, count of clients refunded | No — read/unread only |
| 3 | **Admin cancellation — workshop** | Admin cancels a workshop | Feed-style row: actor, workshop, time-of-cancel, total SGD refunded, count of attendees refunded | No — read/unread only |

**Shape conventions:**
- Informational rows (1–3): mark read individually or bulk; no other actions on the row. To drill into a client pattern, admin navigates to the client profile from the row.
- Filter chips: All / Unread / By type / Date range.

**Unread count** surfaces as a chip on the dashboard and on the sidebar Inbox item, scoped to the active workspace.

---

## 14. Roles & Invitations

### 14a. Role model

Two staff roles in the system: `admin` and `instructor`. The `staff_role` type holds nothing else.

| Role | How created | Authority |
|---|---|---|
| **Admin** | A studio's first admin arrives with the studio (created or restored through the super portal); further admins are invited by an admin | Everything in the portal: Locations, Class Types, all Packages + Promotions, Promo Codes, Global Policy, Waiver, Notifications, Marketing, feature flags, Staff (including other admins), Clients, Workshops, Rooms, and member impersonation. Sees every active location of the studio. |
| **Instructor** | Invited by an admin | The instructor portal only, scoped to their own sessions. What they may do there beyond teaching is set per person by their **Instructor Permissions** (below). |

- Roles are **mutually exclusive** — one email = one staff account = one role.
- **Rank:** admin > instructor. Nobody can edit a staff member who outranks them (instructors cannot edit admins; admins can edit anyone), and changing a role requires admin.
- Every admin sees all of the studio's active locations in the topbar `<WorkspaceSwitcher />` (see Overview). There are no per-admin location grants.
- The Staff list shows only **Admin** and **Instructor** badges. No staff member is "main" or seeded with powers beyond their role.
- A studio archive taken while the portal still had a third, now-retired staff role restores those staff rows and invitations as admins.
- **Changing a sign-in email.** An admin can change any staff member's email, another admin's and their own included, from **Change** beside the email in the staff dialog (view or edit). It is verified by link: **Send link** saves the new address, which the staff dialog and the staff list show beside the current one labelled **Unverified**, and mails a confirmation link to it. Nothing changes on the account — the current address keeps signing in — until the link is clicked; it opens `/confirm-email` on the studio's portal, which shows the address and asks for one **Confirm email** click (no sign-in needed; the click is asked for so a mail scanner opening links cannot confirm it). The link works for 24 hours, after which the address shows **Link expired**. While it is Unverified or expired, an admin can **Resend link** (a new link; the old one stops working; not within 30 seconds of the last) or **Revoke** it (the link stops working and the address disappears). Changing to another address replaces the pending one. On confirming, the same login is re-addressed: password, second factor and sessions stay, a pending invitation moves to the new address, and the old address gets a notice (unless it is a `.invalid` placeholder). Refused: an address another staff member of this studio signs in with, a `.invalid` placeholder, the current address, and a blocked (archived) staff member. Because nobody signs in to confirm, a link also stops working if the admin who sent it is blocked, deleted or made an instructor before it is clicked. Service: `be/src/services/auth/staff-email-change.ts`.

**Instructor Permissions** (`be/CONTEXT.md` § Staff; `be/docs/adr/0012`). Every Instructor has three switches an admin sets from the Staff page, each granting one job's worth of actions:

| Permission | Label | Grants |
|---|---|---|
| `schedule_classes` | Schedule classes | Create a class, preview and create a Class Series, cancel a class they lead |
| `take_pt_bookings` | Take PT bookings | See the pending PT Request queue, schedule a request to themselves, cancel a PT session they lead |
| `manage_rosters` | Manage rosters | Search members, book a member into a buffer seat, join, promote and remove on the Waitlist, cancel a member's booking (Return or Keep credit) |

- **All three are on** for every existing Instructor and every newly invited one, so nothing changes at release. An instructor who "should not do any type of scheduling" is one with the first two switched off.
- **Never a role, never on an Admin.** Admins hold every permission and are never gated by one; the API refuses an attempt to set permissions on an Admin (or to promote someone to Admin and set them in the same request). The Staff list shows the switches on an Instructor's row and none on an Admin's.
- **What an Instructor needs to teach is not a permission:** their own timetable, the roster of a class they lead, check-in by scan, code or manual tick, their own leave, teaching log and profile stay whatever the switches say.
- **Immediate.** A change is felt on the instructor's very next request, with no sign-out. A class or series made while a switch was on stays on the timetable when it is turned off; only an admin can then cancel it.
- **Set at invitation.** The invite dialog offers the three switches when the role picker says Instructor; an invitation with none stated gives all three. A staff member changed from Admin to Instructor starts with all three; one changed from Instructor to Admin keeps their switches for a later demotion.
- **The backend refuses, the portal hides.** A refused action answers `403 forbidden_permission`, which the portal renders as "You do not have permission for this. Ask an admin." Hiding is a convenience; the backend is the truth.
- **Per studio.** A person who teaches at two studios is trusted separately by each.
- Every change goes through the staff audit trail like any other staff edit.
- **On the Staff page.** Each active Instructor's row in the Instructors tab carries the three switches, and flipping one saves at once. The staff dialog lists them by name and its edit form offers them while the person stays an Instructor; a change from Admin to Instructor sets them after that save, since the backend then holds the grant (all three, or what they had before a promotion).
- **In the instructor portal.** The portal learns the switches from `me`, and one helper (`fe-portal/src/lib/instructor-permissions.ts`, Admin always yes) decides every button they govern. With Schedule classes off, New class, Repeat weekly and the per-class Cancel are gone from My schedule, and the New class page says to ask an admin. With Take PT bookings off, PT Requests leaves the instructor's navigation and its pending badge is not fetched; PT sessions an admin schedules for them stay on My schedule and the check-in desk. With Manage rosters off, the session page of a class they lead keeps the roster (names, booking codes, check-in state) and the Waitlist, but Add member (and its offer to put a member in the line), each booking's Cancel and the Waitlist's Add to class and Remove are gone, as is the check-in desk's "Add to class on the class page" link beside a class's waitlist.
- **Rollout (#327).** This section is the target. The backend stores and serves all three and enforces Schedule classes (#328); the portal's switches, refusal message and Schedule classes hiding follow (#329); Take PT bookings is enforced and hidden end to end (#330); Manage rosters is enforced and hidden end to end (#331).

### 14b. Invitation rules

**Who can invite whom:**
- Admins invite admins and instructors.
- Instructors cannot invite.

**Invitation flow:**
- Inviter enters the invitee's email and role (Admin or Instructor), and for an Instructor the three Instructor Permissions (all on unless changed). No locations are captured.
- System sends a magic-link invite email. Invitee clicks link → sets password → lands on `/admin` (dashboard, with the first active location selected in the topbar switcher).

**Invite token:**
- Expires after **7 days** (hardcoded).
- On expiry: token invalid; invitee record stays `pending` until admin resends or revokes.
- Resend generates a fresh 7-day token.
- Admin can revoke or resend a pending invite at any time.

**Post-acceptance default:** Admin → lands on `/admin` (dashboard); Instructor → lands on `/instructor`.

**Email uniqueness:**
- Emails are unique within the **staff space.** One email = one staff account.
- Staff and client spaces are **independent** — the same email can exist as a client in the client app and as a staff member in the admin app. They are treated as separate identities with separate sessions. No cross-login.

### 14c. Archive & removal rules

**Staff accounts (admin + instructor):**
- **Archive:** active sessions are force-logged-out immediately; pending invites the staff member sent remain valid. An archived account can be unarchived.
- **Delete:** a soft delete, allowed only on an already-archived account — audit log integrity depends on actor identity surviving.
- **Admins manage every staff account, including other admins:** archive, unarchive, delete, change role, and sign out everywhere. Instructors can do none of these.
- **No self-archive and no self role-change** — a staff member cannot archive their own account or change their own role.
- **Last-admin guard:** archiving a staff member, or changing their role away from admin, is refused when they are the studio's only active admin (role admin, status active, not soft-deleted); the error tells the caller to promote someone first. The count and the write share a transaction, so two concurrent removals cannot both pass. Delete needs an archived account, so it needs no separate check. Signing out everywhere is not guarded — the admin can sign back in.

---

## 15. Clients

### 15a. Customer List (`/admin/customers`)

The page is **Customers** in the nav and lives at `/admin/customers`; `/admin/clients` and `/admin/clients/:id` redirect there permanently (`fe-portal/next.config.ts`). Only the page moved — the API behind it is still `/portal/admin/clients` (`be-portal.md` § `clients.ts`), and the domain word in the backend is still *client*.

- **Paged on the server** (25 / 50 / 100 per page, default 50) with the total shown — a studio migrated from another system arrives with thousands of members, and the list never loads them all.
- Searchable by name, email or phone — across every member, not the page on screen. The search box is debounced (300 ms) and any change of search, filter, sort or page size goes back to page 1.
- Filterable by status (All / Active / **Trials** / Blocked — the Blocked pill is admin-only). Sortable by newest joined (default) or name A–Z.
- The position (search, filter, sort, page, page size) is kept in the address bar (`?q=&filter=&sort=&page=&size=`), so opening a customer and pressing Back returns to the same page.
- Each row shows: name, email, phone, join date, status chip. Row → the customer's profile.

**Trials filter — the trial funnel.** Selecting **Trials** narrows the list to members who bought a Trial Pass and answers the three questions about them in one screen: how many bought a trial, how many attended it, how many converted. Three tiles sit above the list (each with its share of trials), and the table swaps Joined for **Trial started**, adds **Attended**, and reads the status column as **Converted** / **Follow up**.

- **Attended** is attendance *on the trial package*, never the member's attendance overall — someone who skipped their trial and returned later on a bundle reads zero, and zero is the follow-up signal.
- **Converted** means they paid for a package that is not another trial. A comped grant is not a conversion; a second trial is not one either.
- The tiles count **every member the filter and search match**, across all pages — the backend returns them as `funnel` beside the page — so a search narrows the figures with the list rather than contradicting it, and the page size never changes them.
- The funnel lives here rather than on Finance because it is a question about a client, not about a period (`be/docs/adr/0003-finance-reads-as-a-general-ledger.md`).
- "+ Customer" adds a member (`POST /portal/admin/clients`) with the details sign-up asks for: first and last name, email, phone (country picker, Singapore first) and gender. **Email them an invite** is on by default and sends the `client_invite`; turned off, nothing is mailed and the studio tells the member itself. Either way the account has no password, and the member's first sign-in mails them the set-password link. Most members self-register via the client app or arrive by import.

### 15b. Customer Profile (`/admin/customers/[id]`)

One read, `GET /portal/admin/clients/:id`, fills the page.

**Personal details (read-only):**
- Name, email, phone — sourced from registration or import; the email is changeable (#176), the rest is not editable by admin in v1.
- Join date, gender and date of birth when given, referral source (who referred them, linked to their profile).
- Waiver signed date, or "Waiver not signed" (see §17).
- **Attendance strip** under the name: classes attended, no-shows, late cancels and the last visit, counted over every booking the member has ever had (not just the history listed below).

**Packages & memberships:**
- **Current** — what the member can still use: running (clock started, something left) first, then **Not started** (Dormant, waiting for a first booking), soonest-ending first. Each card: package name, kind, credits or sessions remaining of total (or "Unlimited"), valid-until date, Home Location and Add-On for an Unlimited Plan, Bound Instructor for PT, bought date and money.
- **Past** — expired, used up, or ended (refunded / voided), newest first, folded behind "Past packages (n)". Same card, same actions, so an expired pack can still be extended or refunded.
- Which list a package is in is the backend's `standing` (`running` / `dormant` / `expired` / `used_up` / `ended`); the portal never re-tests dates and balances.
- **Money line.** A package paid online reads "List S$x · paid S$y · S$z off". A package with **no online payment and not given free** — every package a migration brings over from another system arrives like this, with `purchase_id` null — reads "paid S$y · no online payment on record" with **no discount derived**: the figure is what the old system recorded, and a list-minus-paid there would invent a discount nobody gave.
- Multiple packages of the same type are listed separately (e.g. two overlapping credit bundles).

**Bookings:**
- **Upcoming bookings** — everything still booked from now on, soonest first: classes, private sessions and workshops.
- **Booking history** — the most recent 50 past bookings, newest first, 10 shown until "Show all". Cancelled bookings stay in the list.
- Each row: date and time, session name (class type, "Private session", or workshop · tier), instructor, location, the package it was booked on, and one outcome chip — Booked / Attended / No-show / Late cancel (credit forfeited) / Cancelled / Not checked in (in the past, confirmed, never marked).
- Imported history (a migrated studio's past classes, check-ins and late cancels) is ordinary bookings and reads the same.

**Online payments:**
- Every payment through the payment provider, newest first: date, what it was for, amount, status (Paid / Pending / Refunded / Failed), receipt link.
- Empty for a member whose packages were all imported or given free — what was paid for those is on the package card, and the empty state says so.

**Notes:** there is no notes field on a member (`clients` has none). Adding one is a schema change, not built.

**Cancellation history:**
- Running cancellation count vs. the configured cap (§4) for the current cycle.
- Cycle reset date shown.
- Only counts cancellations — no-shows excluded per §4.

**Attendance record:**
- Aggregate: total sessions attended, total no-shows.
- Viewable per session type (class / workshop / PT).

**Referrals:**
- Referred by: name + link to referrer's profile (if applicable).
- Referred: list of clients this person has referred.

### 15c. Account Status

Two states: **Active** and **Blocked**.

- **Active** — default. Client can browse, book, and cancel normally.
- **Blocked** — client is locked out of the booking app entirely (their sessions at the studio ended, refused a new one, and rejected by `requireActiveClient`) and hidden from the default directory listing. Existing upcoming bookings are unaffected (not auto-cancelled).

Admins block from the client profile ("Block") and reverse it from the banner on the same page ("Unblock"). Blocked clients are reachable via the admin-only **Blocked** filter on the clients list. No reason note required (internal action).

No hard delete — client records are never permanently removed (preserves booking history, check-in records, refund audit trail).

### 15d. Manual Package Adjustments

**Admin-only.** There is no read-only mode on client profiles; instructors cannot reach them at all.

The actions on a client's active-package kebab, all written into the same immutable `manual_adjustments` audit ledger:

| Action | Available on | Ledger row |
|---|---|---|
| **Adjust balance** (`+N` / `−N`) | `credit_bundle`, PT pack | `delta: signed integer`, `reason: "+N: <reason>"` or `"−N: <reason>"` |
| **Set credit balance** | `credit_bundle`, `trial` | `delta: target − current` (computed), `reason: "Set <N>: <reason>"` |
| **Edit expiry** | `credit_bundle`, `unlimited`, `trial` | `delta: 0`, `reason: "Expiry changed from <X> to <Y>: <reason>"` |
| **Change home studio** | `unlimited` | `delta: 0`, `reason: "Home Location changed from <X> to <Y>: <reason>"` — one row per plan moved, because the Activated plan and any Dormant renewal move together (spec-pre-launch-batch.md §7). Bookings are untouched. |

**Fields:**
- Package — dropdown of the client's active packages.
- Adjustment / target / new expiry — depends on action.
- Reason — free-text, required.

**Rules:**
- Balance cannot go below zero — adjustment / set-balance is blocked if it would result in a negative balance.
- Every action is recorded with timestamp, acting admin, package, delta, reason — immutable.
- The audit list (renamed **"Package adjustments"**) discriminates row type by `reason.startsWith(...)` and renders tone-coded badges: `Expiry` / `Set N` / `+N` / `−N`.
- Adjustments do not affect cancellation cap counter (§4) — they are an admin override, not a client action.

---

## 16. Notifications (Email Templates)

> **Hidden (#277).** The Notifications screen listed fixture templates, including `admin_cancel_*` emails no backend code sends, and omitted `purchase_refunded`, which it does send. It has been removed from the portal and its nav entry until the list can be read from the emails the backend actually sends — a separate ticket. The design below is the target for that work, not a description of the shipped portal.

### 16a. Overview

- Every trigger event always fires its email — no per-template enable/disable toggle.
- Each template ships with seeded default content (subject + body). Admin can customise; the seed is the fallback for a fresh deployment.
- No rendered preview mode — admin edits and saves directly.
- Body uses a **rich text editor** (headings, bold, italic, bullet points, links).
- Variables use `{{variable_name}}` syntax. The editor **detects variables inline** — known variables are highlighted; unknown variables are flagged in amber. A reference panel alongside the editor lists all valid variables for that specific template.

### 16b. Template List

**Auth**

| # | Template | Trigger | Recipient | Key variables |
|---|---|---|---|---|
| 1 | Welcome | Client completes registration | New client | `{{client_name}}`, `{{studio_name}}` |
| 2 | Password reset | Client requests password reset | Client | `{{client_name}}`, `{{reset_link}}`, `{{expiry_time}}` |

**Bookings**

| # | Template | Trigger | Recipient | Key variables |
|---|---|---|---|---|
| 3 | Class booking confirmed | Client books a class | Client | `{{client_name}}`, `{{class_name}}`, `{{instructor_name}}`, `{{date}}`, `{{time}}`, `{{location}}`, `{{credits_used}}`, `{{credits_remaining}}` |
| 4 | PT request submitted | Client submits PT request (§9) | Client | `{{client_name}}`, `{{instructor_name}}`, `{{requested_date}}`, `{{requested_time}}` |
| 5 | PT session approved | Admin/instructor approves PT request | Client | `{{client_name}}`, `{{instructor_name}}`, `{{date}}`, `{{time}}`, `{{location}}` |
| 6 | PT session declined | Admin/instructor declines PT request | Client | `{{client_name}}`, `{{instructor_name}}`, `{{requested_date}}`, `{{requested_time}}`, `{{decline_note}}` |
| 7 | Workshop purchase confirmed | Client purchases a workshop tier | Client | `{{client_name}}`, `{{workshop_name}}`, `{{tier_name}}`, `{{date}}`, `{{location}}`, `{{amount_paid}}` |

**Client-initiated cancellations**

| # | Template | Trigger | Recipient | Key variables |
|---|---|---|---|---|
| 8 | Class cancelled — credit returned | Client cancels within cap + within window | Client | `{{client_name}}`, `{{class_name}}`, `{{date}}`, `{{credits_returned}}` |
| 9 | Class cancelled — forfeited | Client cancels late or over cap | Client | `{{client_name}}`, `{{class_name}}`, `{{date}}`, `{{forfeit_reason}}` |
| 10 | PT cancelled — session returned | Client cancels within cap + within window | Client | `{{client_name}}`, `{{instructor_name}}`, `{{date}}`, `{{sessions_returned}}` |
| 11 | PT cancelled — forfeited | Client cancels late or over cap | Client | `{{client_name}}`, `{{instructor_name}}`, `{{date}}`, `{{forfeit_reason}}` |

**Admin-initiated cancellations**

| # | Template | Trigger | Recipient | Key variables |
|---|---|---|---|---|
| 12 | Class cancelled by admin | Admin cancels a class instance (§7a) | All booked clients | `{{client_name}}`, `{{class_name}}`, `{{date}}`, `{{credits_returned}}` |
| 13 | PT cancelled by admin | Admin/instructor cancels PT session (§7a) | Client | `{{client_name}}`, `{{instructor_name}}`, `{{date}}`, `{{sessions_returned}}` |
| 14 | Workshop cancelled by admin | Admin cancels a workshop (§7a) | All attendees | `{{client_name}}`, `{{workshop_name}}`, `{{amount_refunded}}` |
| 14b | Booking cancelled by a package rule change (`class_rule_cancelled`) | Admin changes a class's Packages accepted so the package that paid is refused (§10) | Each client whose booking it cancelled | `{{client_name}}`, `{{class_name}}`, `{{date}}`, `{{package_name}}`, `{{credits_returned}}` |

**Packages**

| # | Template | Trigger | Recipient | Key variables |
|---|---|---|---|---|
| 15 | Package purchase confirmed | Client purchases any package | Client | `{{client_name}}`, `{{package_name}}`, `{{amount_paid}}`, `{{credits_or_sessions}}`, `{{expiry_date}}` |
| 16 | Credit expiry reminder | 7 days before credit bundle expiry (hardcoded) | Client | `{{client_name}}`, `{{package_name}}`, `{{credits_remaining}}`, `{{expiry_date}}`, `{{days_until_expiry}}` |

**Staff**

| # | Template | Trigger | Recipient | Key variables |
|---|---|---|---|---|
| 17 | Instructor invite | Admin creates instructor profile (§14b) | New instructor | `{{instructor_name}}`, `{{studio_name}}`, `{{invite_link}}`, `{{expiry_days}}` |
| 18 | Admin invite | Admin sends admin invite (§14b) | Invitee | `{{studio_name}}`, `{{invite_link}}`, `{{expiry_days}}` |
| 19 | Check-in nag | Check-in still `pending` 24h after event end (§11) | Assigned instructor (cc admin) | `{{instructor_name}}`, `{{session_name}}`, `{{date}}`, `{{pending_count}}`, `{{checkin_link}}` |

### 16c. Template Editor

**Fields:**
- **Subject** — plain text input; supports variables.
- **Body** — rich text editor; supports headings, bold, italic, bullet points, links, and variables.

**Variable behaviour:**
- Variables written as `{{variable_name}}`.
- Editor highlights known variables inline as the admin types.
- Unknown or misspelled variables flagged in amber with a tooltip ("Unrecognised variable — will render as blank").
- Reference panel alongside the editor lists all valid variables for the open template with a short description of each.

**Save behaviour:**
- Save button active whenever unsaved changes exist.
- Save replaces the current template body + subject for that trigger.
- No versioning or rollback in v1 — admin can manually restore by re-typing or referencing the seeded defaults (documented externally).

---

## 17. Waivers

Single studio-wide liability waiver. One page at `/admin/waivers`.

### 17a. Waiver Text

- Admin edits the waiver body via a **rich text editor** (headings, bold, italic, bullet points, links).
- Ships with seeded placeholder text for a fresh deployment.
- Save replaces the current waiver body — no versioning, no rollback in v1.
- Updating the text does **not** require existing signed clients to re-sign. Their original acceptance timestamp stands.

### 17b. Client Signing

- Waiver is presented during **registration** — client must tick an acceptance checkbox to complete account creation. Hard block: no account without acceptance.
- Acceptance timestamp is recorded per client at the moment of sign-up.
- No manual "mark as signed" action for admin — signing is self-service only.

### 17c. Admin Visibility

- **Client profile (§15b):** shows "Waiver signed — [date]" as a read-only field.
- **`/admin/waivers` page:** shows total signed count alongside the editor. No per-client list on this page — individual signed dates live on each client profile.

---

## 18. Workshops (multi-day, under Packages)

Workshops are configured at `/admin/packages/workshops` — **workspace-scoped** (each workshop carries a `location_id`, so admins see only their workspace's workshops). They no longer have a creation surface in the scheduler (see §7c).

### 18a. Data shape

**`Workshop`:**
- `id`, `name`, `class_type_id`, `location_id`
- `instructor_ids: string[]`
- `cover_url`, `additional_images: string[]`
- `description_html`
- `days: WorkshopDay[]`
- `tiers: WorkshopTier[]`
- `lifecycle` — draft / published / archived

**`WorkshopDay`:**
- `id`, `date`, `start_time`, `end_time`
- `capacity` — structured (`waitlist + online_booking + buffer`, per §7d)
- `base_price_sgd`

**`WorkshopTier`:**
- `id`, `workshop_id`
- `name`, `description`
- `day_ids: string[]` — which `WorkshopDay`s this tier grants access to (subset or all)
- `price_sgd`
- `early_bird_price_sgd: number | null`
- `early_bird_cutoff_at: string | null`

### 18b. Three-stage editor

1. **Basics** — name, description, class type, location, instructors, cover + additional images.
2. **Days** — date entry (range mode or individual dates) with per-day `start_time`, `end_time`, `base_price_sgd`, and `<CapacityFields />`.
3. **Tiers** — at least one tier required. Each tier picks which `day_ids` it covers, a name, regular price, and optional early-bird price + cutoff.

### 18c. Derived tier capacity

Tier capacity is **derived**, never stored:

```
tier.max_capacity = min(day.max_capacity for day in tier.day_ids)
```

A tier can never sell more than the smallest constituent day's room. This handles "Full event" tiers (limited by the tightest day) and partial-coverage tiers (e.g. Day 1 only) uniformly.

### 18d. Schedule rendering

In the scheduler, each `WorkshopDay` auto-renders as one tile with a `Day N/M` chip — there is no separate "workshop instance" record. The scheduler's "+ Workshop" button starts a *new* workshop (§7c): it hands the picked slot to this editor as the first day. Existing workshops are not re-picked from the scheduler.

### 18e. Cancellation

Unchanged from prior spec: workshops are non-refundable and non-cancellable by clients. Only admin can cancel a workshop (full automatic Stripe refund to all attendees per §7a).

---

## 19. Next Phase — Deferred Items

The following sections are out of scope for this phase and will be defined in the next design cycle.

| Section | Description |
|---|---|
| **Dashboard** | Admin landing page — key metrics (bookings, revenue, attendance), pending check-in alerts, upcoming sessions snapshot. |
| **Reports** | Aggregate analytics across instructors, class types, and locations — attendance rates, cancellation rates. *(Partly shipped: the money half and class popularity now live on Finance §20.)* |
| **Audit log** | Immutable system-wide log of all admin actions — credit adjustments, cancellations, invites, status changes, role changes. Referenced throughout this doc as the record-keeping layer. |
| **Referrals** | Referral program mechanics — reward type, trigger (registration vs. first purchase), admin-configurable reward amount, referral link or code generation. |
| **Instructor portal** | Instructor-scoped admin view — own upcoming schedule, teaching log, self-service profile edit. |

---

---

## 20. Finance (`/admin/finance`)

The studio's money in one place, replacing the admin Payroll surface. Full behaviour, and the reasoning behind the layout, live in `docs/md/spec-finance.md` and `be/docs/adr/0003-finance-reads-as-a-general-ledger.md`; what matters for the nav is:

- **Its own sidebar group, at the top.** Not Packages (it is not a catalogue) and not Settings (it is not config).
- **Admin.** Admins read the records and edit instructor pay.
- **Workspace-agnostic.** Most purchases record no Location at all, so filtering the ledger by the switcher would silently drop them; the Location filter on the page carries an explicit **Unattributed** bucket instead.
- **The overview reads a period and nothing else.** The other filters narrow the table below them and never the figures above — a headline that moved because of a control the reader has scrolled past reads as a fact.
- The trial funnel is **not** here; it is the Customers page's Trials filter (§15a).

---
