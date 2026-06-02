# Admin Restructure — Design Decisions

## Overview — Roles, Workspaces, Sidebar Nav

### Role model (two staff roles)

Staff identity is `superadmin` or `admin`. The `instructor` role is reserved in the schema but deferred — there is no instructor sidebar or instructor session in v1.

| Role | Authority |
|---|---|
| **Superadmin** | Global catalog + policy owner. Creates locations, edits class types, configures all packages (Classes + Private Sessions) and their promotions, edits Global Policy, manages Staff/Notifications/Waiver. Full read/write across every workspace. |
| **Admin** | Operations staff scoped to one or more granted workspaces via `staff_users.granted_location_ids: string[]`. Sees only their granted locations' Schedule / Workshops / Check-in / Inbox. **Read-only** on Clients. Cannot reach Class Types, Packages (Classes + Private Sessions), Global Policy, Notifications, Waiver, Staff, or Locations. |

- Superadmin grants are **implicit** — an empty `granted_location_ids` means "all active locations".
- See §14 for invitation + archive rules.

### Workspace boundary (global vs workspace-scoped)

Locations are workspaces. Surfaces are partitioned as follows:

| Tier | Surfaces |
|---|---|
| **Global (superadmin-only)** | Locations CRUD, Class Types, Rooms, Packages → Classes, Packages → Workshops, Packages → Private Sessions, Promotions (nested in packages), Global Policy, Notifications, Waiver, Staff |
| **Workspace-scoped** | Schedule, Check-in, Inbox, PT Requests (clients pick a `location_id` at request time — see §9) |
| **Cross-workspace (global, read-only for admin)** | Clients — cross-location credits mean a client record spans workspaces; admin sees all clients but cannot mutate (no kebab actions, no expiry edits, no set-balance, no manual adjustments, no suspend/reactivate) |

> **Workshops are a global package surface.** Like Classes and Private Sessions, Packages → Workshops is **not** filtered by the topbar workspace switcher — it lists every workshop across all locations. Each workshop still carries a `location_id` chosen in the editor (its days' rooms come from that location); the surface is simply not workspace-scoped.

### Workspace switcher (topbar)

- The admin shell topbar carries a `<WorkspaceSwitcher />` dropdown listing the user's accessible locations. The sidebar **no longer has a "Locations" entry** — moved into this dropdown's "Manage locations" modal (superadmin only).
- The active location is global state, persisted in localStorage under `ys.activeLocationId`. All workspace-scoped pages (Schedule, Rooms, Check-in, Inbox) read it directly — there are **no per-page LocationFilterChips** and **no CheckinLocationPill**. (Workshops is **not** workspace-scoped — see the Workshops note above.)
- Dropdown contents:
  - List of accessible locations (current marked).
  - Superadmin extras: "+ Add location" and "Manage locations" (modal CRUD reusing `LocationFormDialog`).
  - Admin footer hint: "Contact your superadmin to request more workspace access."
- `LocationGate` (cold start guard) is role-aware:
  - Superadmin with zero active locations → "Add your first location" CTA card.
  - Admin with zero accessible locations → "No workspace access — contact your superadmin" empty state.
  - Otherwise pass-through.

### Sidebar structure

**Visual layout** (top to bottom):

- **Settings**: Class Types, Global Policy, Notifications, Waiver (location-independent building blocks + config).
- **Packages**: Classes, Workshops, Private Sessions (global, shared across locations).
- **People**: Clients, Staff (members + staff accounts). **Instructors are merged into Staff** — the Staff page has **Admin** and **Instructors** tabs. "+ Invite staff" (Admin tab) invites admin/superadmin; "+ Add instructor" (Instructors tab) routes to the instructor creation flow (which still captures bio, photo, and eligible class types). Instructor rows link to their detail page. There is no separate "Instructors" sidebar item.
- **Workspace zone** (bottom, separated by a divider, under a header showing the active location's name): **Schedule, Rooms, Check-in, Inbox, PT Requests**. All are filtered by `activeLocationId`; flipping the switcher reloads them. **PT Requests is workspace-scoped** — clients pick a `location_id` at request time, so the triage queue shows only the active location's requests.

`NavItem.workspaceScoped` marks the workspace-zone items; it is distinct from `NavItem.scope`, which only governs role visibility (admin vs superadmin). The build-order below is the recommended *setup* sequence, not the visual order.

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
   - **Create Schedule** — two creation flows:
     - Class instance (class type, instructor, date/time, duration, capacity, credit cost, difficulty)
     - PT session (via PT Request triage — see §9)
   - **"+ Workshop"** is a dropdown of existing workshops (one tile per `WorkshopDay`); workshop *creation* is no longer in the scheduler.

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
- 16. Notifications (email template management)
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

**Surface:** Topbar `<WorkspaceSwitcher />` dropdown → "Manage locations" modal. **Superadmin-only.** There is no sidebar entry for Locations.

Locations are the workspace boundary — every scoped surface (Schedule, Workshops, Check-in, Inbox) reads `ys.activeLocationId` from localStorage and renders only data tied to it.

**Fields per location:**
- Name
- Address
- Google Maps link
- Phone number

**Modal behaviour:**
- List active locations as cards; archived locations at the bottom with an "Archived" badge + Restore button.
- "+ Add location" opens the shared `LocationFormDialog`.
- Cold start (zero active locations): superadmin sees the "Add your first location" CTA card via `LocationGate`; admin sees "No workspace access — contact your superadmin".

**Deletion rules:**
- **Hard delete** — only if zero linked data exists across all tables (location has never been used).
- **Soft delete (archive)** — if past data exists but no upcoming or ongoing sessions. Archived locations appear at bottom of list with Restore option.
- **Blocked** — if the location has any upcoming or ongoing classes, workshops, or private sessions.

---

## 2. Class Types

**Sidebar position:** Top-level building block item. **Superadmin-only** (global catalog).

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
- Admin sets two values: maximum number of cancellations + cycle duration (e.g. 3 cancellations per month).
- Applies universally to all clients — no per-client customisation.
- Cap covers **class + PT bookings together** (one shared bucket).
- Cap counts **cancellations only** — no-shows do not count toward the cap (no-shows already self-punish via full forfeit).

**Time Window:**
- Admin sets two values:
  - **Class cancellation window** (e.g. 12 hours before class start)
  - **PT cancellation window** (e.g. 24 hours before session start)
- Cancelling outside the window forfeits the credit/session regardless of cap state.

**Refund rule (combined cap + window):**

| Within cap | Outside window | Result |
|---|---|---|
| Yes | No (i.e. early cancel) | **Full credit/session refund** |
| Yes | Yes (i.e. late cancel) | Forfeit |
| No | No | Forfeit (cap blocks the refund, not the cancellation) |
| No | Yes | Forfeit |

- Cancellation itself is **always allowed** — the cap and window only gate whether credits/sessions are refunded.
- All-or-nothing: full refund or zero. No partial refunds.
- Cycle resets per the configured duration; both cap counter and refund eligibility reset together.
- No admin override per booking.

**No-show:**
- Hardcoded full forfeit. Not configurable. Does not count toward the cap.

---

## 5. Classes (Config Page — Packages Only)

**Purpose:** Pre-requisite config. Admin sets up class packages here before any class sessions can be created on the Schedule. No scheduling happens here. **Superadmin-only.**

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
- `duration_days` (e.g. 30, 90, 180)
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

**Purpose:** Pre-requisite config. Admin sets up PT packages here before any private sessions can be created. No scheduling happens here. **Superadmin-only.**

**Cancellation policy lives in §4 Global Policy — not configured here.**

**PT Package fields:**
- `name` (e.g. "5-session 1-on-1 pack")
- `session_type` — `1on1` or `2on1` (dropdown)
- `sessions` — number of sessions
- `price_sgd`
- Active / Archived toggle
- `promotions: Promotion[]` — same shape and best-price-wins resolution as §5d.

No validity period on PT packages.

**Booking config:**
- `book_in_advance_days` — how many days ahead a client can submit a PT request.

---

## 7. Schedule

### 7a. Timetable

- Google Calendar-style unified view of all classes, workshops, and confirmed private sessions **scoped to the active workspace** (`ys.activeLocationId`). Switching workspace via the topbar re-renders the calendar.
- Admin navigates by day / week / month.

**Filters (no Location filter — workspace is global now):**
- Instructor — dropdown of all instructors
- Type — All / Class / Workshop / Private Session
- Date — date picker to jump to a specific date

**What influences the timetable:**
- Admin creates a class instance → immediately appears on the Schedule timetable AND occupies that slot on the assigned instructor's calendar.
- Admin creates a workshop in `/admin/packages/workshops` → each `WorkshopDay` auto-renders on the Schedule timetable as one tile with a `Day N/M` chip. Workshops are no longer created from the scheduler.
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

### 7c. Workshops on the Schedule

Workshop creation is no longer in the scheduler — see §7e.

- The scheduler's **"+ Workshop"** button opens a dropdown of existing workshops scoped to the active workspace.
- Selecting a workshop **does not create anything** — its `WorkshopDay` tiles already render on the timetable automatically (one tile per day, `Day N/M` chip).
- Cancelling a workshop still happens from the Schedule detail page (cancellation rules unchanged — full automatic Stripe refund to all attendees per §7a).

**"+ Corporate" picker (replaces the old direct-create).** The scheduler's **"+ Corporate"** button opens a picker of **pending corporate requests** — selecting one opens the schedule dialog (instructor, location, room, date/time). The old "+ corporate" package dropdown and the `/admin/schedule/new/corporate` direct-create page (which took a freeform client name) are **removed**: a `corporate_session` is now created **only** by scheduling a corporate request, and its client name is derived from the member record. See §9b.

### 7d. Structured capacity (`<CapacityFields />`)

`Capacity` is no longer a scalar. Applied to `ClassInstance.capacity`, `WorkshopDay.capacity`, and `PtSession.capacity`:

| Field | Meaning |
|---|---|
| `waitlist` | Overflow queue size once `online_booking + buffer` is full |
| `online_booking` | Bookable seats via the client app |
| `buffer` | Reserved for staff / walk-ins; not exposed to clients |
| `max_capacity` (derived) | `waitlist + online_booking + buffer` |

A shared `<CapacityFields />` block appears on every scheduling form. Detail pages render a **Capacity breakdown** strip showing the three slices side-by-side.

### 7e. Workshops are configured under Packages (not Schedule)

Workshops live at `/admin/packages/workshops` — workspace-scoped (each workshop is tied to a `location_id`, so admins see only their workspace's workshops). See §18 for the full spec.

---

## 8. Instructor Availability — REMOVED

This surface has been **removed entirely.** There is no `/admin/availability` page and instructors do not publish availability slots.

It is replaced by the **PT Request** flow (§9): clients submit a request with their preferred slots, and admin schedules a session from the request via `ScheduleFromRequestDialog`. The instructor's calendar is implicit — the system simply checks for instructor conflicts at the moment of scheduling.

---

## 9. PT Requests (Private Session Booking Flow)

The Availability system is gone (§8). PT sessions now exist only as the resolution of a client-submitted **PT Request**.

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

PT Requests carry a `location_id` chosen by the client at request time. The `/admin/pt-requests` queue is therefore **filtered by the active workspace location** (superadmin sees all); flipping the workspace switcher re-scopes the list, and the page shows a banner naming the active location. At scheduling time the resulting `PtSession.location_id` defaults to the requested location (admin can still change it in `ScheduleFromRequestDialog`).

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

Both paths share `ScheduleFromRequestDialog`:

1. **From PT Requests** → row drawer → "Schedule" button.
2. **From Schedule** → "+ PT Session" button → picker dialog listing pending requests → same dialog.

The scheduler can no longer create a PT session ad-hoc — it must always originate from a request, preserving the invariant.

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
- Check-in column on the roster (QR scan / code entry / manual tick — see §11)
- Check-in state chip: `pending` / `completed` (manual flip — see §11)
- Cancel-this-instance action (admin) → triggers full credit refund + Inbox notification

**Workshop detail page additions:**
- Per-tier breakdown (which tier each attendee bought)
- No check-in (workshops are not check-in tracked)
- Cancel workshop action (admin) → triggers automatic Stripe refund + Inbox notification

**PT detail page additions:**
- Single client (1-on-1) or two clients (2-on-1)
- Check-in row (QR / code / manual — see §11)
- Check-in state chip: `pending` / `completed`
- Cancel-this-session action (admin or assigned instructor) → full session return + Inbox notification

---

## 11. Check-in

**Eligibility:** Classes and PT sessions only. Workshops are not check-in tracked.

**Methods (3 total):**
1. **QR scan** — admin scans a QR code displayed in the client's app. Each booking has a unique QR.
2. **Code entry** — admin types a per-booking alphanumeric code (same value encoded in the QR; format e.g. `YS-A4F2K9`, case-insensitive). Used as fallback when QR scan fails.
3. **Manual tick** — admin or instructor flips a roster row directly to `attended` or `no-show` without scanning.

Per-booking codes are **unique** — the system resolves both client identity and target session from the code alone. No "wrong session" error possible.

**Surfaces (where check-in happens):**

| Surface | Methods available | Use case |
|---|---|---|
| Session detail page (Class/PT) | QR + Code + Manual | Reviewing a roster, marking no-shows, post-class cleanup |
| Generic Check-in page (`/admin/check-in`) | QR + Code | Front-desk daily driver; auto-selects currently active session; persistent scan area |

Both admin and instructor can perform check-in (instructor scoped to own sessions).

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

**Refund inbox: does not exist as a separate actionable queue.** All refunds (credit, session, money) are automated. The Inbox surfaces them informationally only.

---

## 13. Inbox

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

Two staff role types in the system. (The `instructor` role is reserved in the schema for a later phase and is not invitable in v1.)

| Role | How created | Authority |
|---|---|---|
| **Superadmin** | Seeded into fresh deployment — not invitable via UI | Global catalog + policy owner across all workspaces. Can manage Locations, Class Types, all Packages + Promotions, Global Policy, Notifications, Waiver, Staff. Implicit access to every active location. Can archive other staff accounts. |
| **Admin** | Invited by superadmin (or another admin) | Operations staff scoped to one or more workspaces via `staff_users.granted_location_ids: string[]`. Sees only granted-location Schedule / Workshops / Check-in / Inbox. **Read-only on Clients.** Cannot reach Class Types, Packages, Global Policy, Notifications, Waiver, Staff, or Locations. |

- Roles are **mutually exclusive** — one email = one staff account = one role.
- Superadmin grants are implicit: an empty `granted_location_ids` array means "all active locations".
- Admin's accessible-locations list is reflected in the topbar `<WorkspaceSwitcher />` (see Overview).
- The superadmin label is a deployment artifact — there is no ongoing visual distinction in chrome beyond the surfaces a superadmin can reach.

### 14b. Invitation rules

**Who can invite whom:**
- Superadmin can invite admins (and other superadmins).
- Admins can invite other admins, but only scoped to a subset of their own granted locations.
- Instructor profiles (§3) are catalog records — they are not invited into the staff app in v1.

**Admin invitation flow:**
- Inviter enters the invitee's email, role (Admin), and `granted_location_ids` (must be a subset of the inviter's own grants unless inviter is superadmin).
- System sends a magic-link invite email. Invitee clicks link → sets password → lands on `/admin` (dashboard, with their first accessible location selected in the topbar switcher).

**Invite token:**
- Expires after **7 days** (hardcoded).
- On expiry: token invalid; invitee record stays `pending` until admin resends or revokes.
- Resend generates a fresh 7-day token.
- Admin can revoke a pending invite at any time.

**Post-acceptance default:** Admin (and superadmin) → lands on `/admin` (dashboard).

**Email uniqueness:**
- Emails are unique within the **staff space.** One email = one staff account.
- Staff and client spaces are **independent** — the same email can exist as a client in the client app and as a staff member in the admin app. They are treated as separate identities with separate sessions. No cross-login.

### 14c. Archive & removal rules

**Staff accounts (admin + superadmin):**
- **Hard delete: never.** Staff records are never permanently deleted — audit log integrity depends on actor identity surviving.
- **Archive (soft delete):** the only removal path. On archive: active sessions force-logged-out immediately; pending invites the staff member sent remain valid.
- **Only superadmin can archive another staff account.** Admins cannot archive each other.
- **No self-archive** — a staff member cannot archive their own account.
- **No minimum-staff guardrail** — all staff (including superadmin) can be archived, potentially leaving the system staff-less. Recovery requires deployment-level re-seeding.

**Granted-location revocation** is a softer alternative: superadmin may shrink an admin's `granted_location_ids` without archiving them. Effective on next page load.

---

## 15. Clients

### 15a. Client List (`/admin/clients`)

- Searchable by name or email.
- Filterable by status (Active / Suspended).
- Each row shows: name, email, join date, active package count, upcoming booking count, status chip.
- "Add client" is not present — clients self-register via the client app. This list is read-only at the list level.

### 15b. Client Profile (`/admin/clients/[id]`)

**Personal details (read-only):**
- Name, email, phone — sourced from registration; not editable by admin in v1.
- Join date, referral source (who referred them, if any).
- Waiver signed date (read-only — see §17).

**Active packages:**
- Credit bundles: package name, credits remaining, total credits, expiry date.
- Unlimited passes: package name, valid from / valid to.
- PT packs: package name, sessions remaining, total sessions.
- Multiple active packages of the same type are listed separately (e.g. two overlapping credit bundles).

**Booking history:**
- Unified list of all bookings (classes, workshops, PT) — upcoming first, then past.
- Each row: session name, type, date/time, booking state (`confirmed` / `cancelled` / `no-show`), refund outcome (credit returned / forfeited / n/a).

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

Two states: **Active** and **Suspended**.

- **Active** — default. Client can browse, book, and cancel normally.
- **Suspended** — client cannot make new bookings. Existing upcoming bookings are unaffected (not auto-cancelled). Client can still log in and view their history.

Admin can toggle status from the client profile. No reason note required (internal action).

No hard delete — client records are never permanently removed (preserves booking history, check-in records, refund audit trail).

### 15d. Manual Package Adjustments

**Superadmin-only.** Admin sees the read-only banner on every client profile and cannot trigger any of the kebab actions below.

Three actions on a client's active-package kebab, all written into the same immutable `manual_adjustments` audit ledger:

| Action | Available on | Ledger row |
|---|---|---|
| **Adjust balance** (`+N` / `−N`) | `credit_bundle`, PT pack | `delta: signed integer`, `reason: "+N: <reason>"` or `"−N: <reason>"` |
| **Set credit balance** | `credit_bundle`, `trial` | `delta: target − current` (computed), `reason: "Set <N>: <reason>"` |
| **Edit expiry** | `credit_bundle`, `unlimited`, `trial` | `delta: 0`, `reason: "Expiry changed from <X> to <Y>: <reason>"` |

**Fields:**
- Package — dropdown of the client's active packages.
- Adjustment / target / new expiry — depends on action.
- Reason — free-text, required.

**Rules:**
- Balance cannot go below zero — adjustment / set-balance is blocked if it would result in a negative balance.
- Every action is recorded with timestamp, acting superadmin, package, delta, reason — immutable.
- The audit list (renamed **"Package adjustments"**) discriminates row type by `reason.startsWith(...)` and renders tone-coded badges: `Expiry` / `Set N` / `+N` / `−N`.
- Adjustments do not affect cancellation cap counter (§4) — they are a superadmin override, not a client action.

---

## 16. Notifications (Email Templates)

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

In the scheduler, each `WorkshopDay` auto-renders as one tile with a `Day N/M` chip — there is no separate "workshop instance" record. The scheduler's "+ Workshop" button is a *picker* of existing workshops, not a creation flow.

### 18e. Cancellation

Unchanged from prior spec: workshops are non-refundable and non-cancellable by clients. Only admin can cancel a workshop (full automatic Stripe refund to all attendees per §7a).

---

## 19. Next Phase — Deferred Items

The following sections are out of scope for this phase and will be defined in the next design cycle.

| Section | Description |
|---|---|
| **Dashboard** | Admin landing page — key metrics (bookings, revenue, attendance), unread inbox count, pending check-in alerts, upcoming sessions snapshot. |
| **Reports** | Aggregate analytics across instructors, class types, and locations — revenue, attendance rates, package sales, cancellation rates. |
| **Audit log** | Immutable system-wide log of all admin actions — credit adjustments, cancellations, invites, status changes, role changes. Referenced throughout this doc as the record-keeping layer. |
| **Referrals** | Referral program mechanics — reward type, trigger (registration vs. first purchase), admin-configurable reward amount, referral link or code generation. |
| **Instructor portal** | Instructor-scoped admin view — own upcoming schedule, teaching log, self-service profile edit. |

---
