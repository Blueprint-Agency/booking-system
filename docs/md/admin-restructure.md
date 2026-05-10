# Admin Restructure — Design Decisions

## Overview — Sidebar Nav Structure

**Building Blocks** (set up first — prereqs for everything else):
1. Locations
2. Class Types
3. Instructors

**Policy:**
4. Global Policy — cancellation cap (applies to all clients across all session types)

**Packages + Policies** (configure before creating scheduled sessions):
5. Classes — credit bundle & unlimited packages + cancellation tiers
6. Private Sessions — PT packages + cancellation tiers
   (Workshops have no config page — creation and policy set per workshop at scheduling time)

**Schedule:**
7. Schedule
   - **Timetable** — unified calendar view of all sessions (classes + workshops + confirmed PT)
   - **Create Schedule** — two creation flows:
     - Class instance (class type, instructor, location, date/time, duration, capacity, credit cost)
     - Workshop (name, class type, images, description, dates, tiers, instructor, location, cancellation policy)
   - Private Sessions excluded from Create Schedule — client-driven via instructor availability system

**Operations:**
8. Instructor Availability
9. Private Session Booking Flow
10. Session Detail Pages (class / workshop / PT)
11. Check-in
12. Cancellation & Refund Mechanics
13. Inbox
14. Rating & Completion
15. Roles & Invitations

**Clients & Content:**
16. Clients
17. Notifications (Email Templates)
18. Waivers

**Completed this phase:**
- 14. Rating & Completion
- 15. Roles & Invitations
- 16. Clients (list, profile, credit balance, history, manual adjustments)
- 17. Notifications (email template management)
- 18. Waivers

**Next phase (see §19):**
- Dashboard
- Reports
- Audit log
- Referrals
- Instructor portal

**Out of scope:**
- Settings (studio profile, branding, operating hours)

---

## 1. Locations

**Sidebar position:** Top-level building block item.

**Fields per location:**
- Name
- Address
- Google Maps link
- Phone number

**Page behaviour:**
- Starts empty on first load — admin keys in their own locations.
- Empty state with "Add location" CTA.
- List view: active locations as cards, archived locations shown at the bottom with an "Archived" badge + Restore button.

**Deletion rules:**
- **Hard delete** — only if zero linked data exists across all tables (location has never been used).
- **Soft delete (archive)** — if past data exists but no upcoming or ongoing sessions. Archived locations appear at bottom of list with Restore option.
- **Blocked** — if the location has any upcoming or ongoing classes, workshops, or private sessions.

---

## 2. Class Types

**Sidebar position:** Top-level building block item.

**Purpose:** Shared catalogue of session types (e.g. Chair Yoga, Vinyasa Flow, Aerial Yoga). Used as a dropdown when creating a class/workshop/PT session, and as a multi-select on instructor profiles to indicate teaching eligibility.

**Fields per class type:**
- Name

**Deletion rules:**
- **Hard delete** — only if zero linked data (class type has never been used).
- **Soft delete (archive)** — if past data exists but no upcoming or ongoing sessions reference it.
- **Blocked** — if any upcoming or ongoing session uses this class type.
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

**Purpose:** Pre-requisite config. Admin sets up class packages here before any class sessions can be created on the Schedule. No scheduling happens here.

**Cancellation policy lives in §4 Global Policy — not configured here.**

**Credit Bundle package fields:**
- Name (e.g. "5-class pack")
- Number of credits
- Price (SGD)
- Validity period (days from purchase date)
- Active / Archived toggle

**Unlimited package fields:**
- Name (e.g. "Monthly Unlimited")
- Duration (e.g. 1 month, 3 months)
- Price (SGD)
- Active / Archived toggle

---

## 6. Private Sessions (Config Page — Packages Only)

**Purpose:** Pre-requisite config. Admin sets up PT packages here before any private sessions can be created. No scheduling happens here.

**Cancellation policy lives in §4 Global Policy — not configured here.**

**PT Package fields:**
- Name (e.g. "5-session 1-on-1 pack")
- Session type (1-on-1 or 2-on-1 — dropdown)
- Number of sessions
- Price (SGD)
- Active / Archived toggle

No validity period on PT packages.

**Booking config:**
- Book in advance (days) — how many days ahead a client can book a private session

---

## 7. Schedule

### 7a. Timetable

- Google Calendar-style unified view of all classes, workshops, and confirmed private sessions.
- Admin navigates by day / week / month.

**Filters:**
- Location — All / Breadtalk IHQ / Outram Park
- Instructor — dropdown of all instructors
- Type — All / Class / Workshop / Private Session
- Date — date picker to jump to a specific date

**What influences the timetable:**
- Admin creates a class instance → immediately appears on the Schedule timetable AND occupies that slot on the assigned instructor's availability timetable.
- Admin creates a workshop → immediately appears on the Schedule timetable AND occupies the assigned instructor(s)' availability timetable for the duration.
- Admin or instructor approves a PT session request → confirmed session appears on the Schedule timetable AND occupies that slot on the instructor's availability timetable.

**Admin-initiated cancellation:**
When admin cancels a class, workshop, or PT session from the Schedule, all booked clients automatically receive a full refund — regardless of cap, window, or any other rule. No exceptions.

- **Class cancelled by admin** → full credit returned to each booked client's package. In-app, automatic.
- **PT cancelled by admin** → full session returned to client's PT package. In-app, automatic.
- **Workshop cancelled by admin** → automatic Stripe money refund to each attendee, fired immediately on cancellation. No manual settlement.

In all three cases, an Inbox notification is generated (see §13).

### 7b. Create Schedule — Class Instance

Fields:
- Class type (from shared Class Types catalogue)
- Instructor (dropdown filtered by eligible class types)
- Location
- Date and time
- Duration
- Capacity (max pax)
- Credit cost (set manually per class instance — varies by class type but entered at scheduling time)

### 7c. Create Schedule — Workshop

Fields:
- Name
- Class type (from shared Class Types catalogue)
- Cover image
- Additional image(s)
- Description (rich text editor — supports headings, bullet points, emphasis)
- Start date and time
- End date and time
- Instructor(s) (multi-select)
- Location

**Pricing — Tiers only** (no flat price). Each tier has:
- Tier name (e.g. "2 Days", "1 Day")
- Description
- Regular price (SGD)
- Early bird price (SGD) — optional
- Early bird ends: quota (first N sign-ups) and/or cutoff date — whichever hits first
- Capacity (seats for this tier)

**Capacity & waitlist:**
- Capacity is per tier.
- Once a tier hits capacity it is marked sold out — no waitlist in v1.

**Cancellation Policy:**
- Workshops are **non-refundable and non-cancellable by clients.** Once purchased, persistent.
- Only admin can cancel a workshop. Admin cancellation = full automatic Stripe money refund to all attendees (see §7a).
- No per-workshop policy config — there are no client-side cancellation rules to set.

---

## 8. Instructor Availability

**Who sets it:** Admin sets availability on behalf of instructors (instructor self-service TBD for later).

**Two types of availability input:**
- **Recurring weekly slots** — e.g. every Tuesday 8–10am
- **Custom one-off slots** — specific dates and times

**Timetable view:**
- Google Calendar-style view (consistent with fe-client pattern).
- Shows availability slots overlaid with assigned classes, workshops, and confirmed private sessions.
- Colour coding (TBD at design stage): available / class / workshop / private session / blocked.
- Admin navigates by week or month.
- When a class or workshop is assigned to an instructor via Schedule → Create Schedule, it automatically occupies that slot — remaining free slots are bookable for private sessions.

---

## 9. Private Session Booking Flow

1. Client picks an instructor.
2. Client sees that instructor's available slots (derived from instructor availability minus already-assigned sessions).
3. Client submits a request for a specific slot.
4. Slot is held as **pending**.
5. Admin or instructor reviews the request in the **Private Sessions inbox** and approves or declines.
6. On approval: session confirmed, slot marked booked, client notified.
7. On decline: slot released, client notified.

**Credit deduction for PT sessions:** Fixed at 1 PT session per booking — no config needed.

**Inbox details:** see §13.

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

Single unified inbox at `/admin/inbox`. Filter tabs by notification type. One sidebar item with total unread count.

**Notification types:**

| # | Type | Trigger | Shape | Actionable? |
|---|---|---|---|---|
| 1 | **Client cancellation** | Client cancels a class or PT | Feed-style row: client, session, time-of-cancel, refund result (credit returned / forfeited) | No — read/unread only |
| 2 | **Admin/instructor cancellation — class/PT** | Admin or instructor cancels a class or PT instance | Feed-style row: actor, session, time-of-cancel, count of clients refunded | No — read/unread only |
| 3 | **Admin/instructor cancellation — workshop** | Admin cancels a workshop | Feed-style row: actor, workshop, time-of-cancel, total SGD refunded, count of attendees refunded | No — read/unread only |
| 4 | **PT request** | Client submits a private session request (per §9) | Actionable row: client, instructor, requested slot, message | **Yes** — Approve / Decline |

**Shape conventions:**
- Informational rows (1, 2, 3): mark read individually or bulk; no other actions on the row. If admin wants to drill into a client pattern, they navigate to the client profile from the row.
- Actionable rows (4): Approve / Decline buttons inline; required note on Decline.
- Filter chips: All / Unread / By type / Date range.

**Unread count** surfaces as a chip on the dashboard and on the sidebar Inbox item.

---

## 14. Rating & Completion

**What is rated:** the **class instance** (or workshop instance). One rating per attended booking, attached to that specific session.

- **Instructor rating** is derived — reports aggregate across all sessions an instructor taught. No standalone "rate the instructor" action.

**Eligibility:**
- Only clients whose roster row is marked `attended` can rate.
- One rating per attended booking. Editable until X (TBD — likely until rating window closes, e.g. 7 days post-class).

**Scope by session type:**
- **Class** — rateable
- **Workshop** — rateable
- **PT** — not rateable in v1 (1-on-1 dynamics make ratings awkward)

**Scale:** 1–5 stars + optional free-text comment.

**Required or optional:** Optional. Client app shows a one-time post-class prompt; if dismissed, no follow-up.

**Surfacing — admin views (full visibility):**
- **Per session detail page** — aggregate rating + every individual rating/comment for that specific instance, with client attribution.
- **Per instructor profile** — rolling average across all that instructor's sessions, with trend over time.
- **Reports** — aggregate dashboard across instructors / class types / locations.

**Surfacing — instructor view (own only):**
- Instructor sees ratings/comments only for sessions they personally taught.
- Aggregate score per session + per their own profile + individual comments.
- Comments are anonymized to the instructor (no client name attached) to avoid interpersonal friction.

**Surfacing — client view (attended sessions only):**
- Client can view full ratings (aggregate + all comments) for sessions they personally attended.
- Other clients' comments are anonymized to the viewing client.
- Their own past rating is visible and editable within the rating window (e.g. 7 days post-class).
- Ratings are **not displayed publicly** on instructor cards, class listings, or any pre-booking surface — only post-attendance.

**Privacy rule of thumb:**
- Admin: sees everything with attribution.
- Instructor: sees own sessions, comments anonymized.
- Client: sees attended sessions, others' comments anonymized.

---

## 15. Roles & Invitations

### 15a. Role model

Three role types in the system:

| Role | How created | Authority |
|---|---|---|
| **Superadmin** | Seeded into fresh deployment — not invitable via UI | Identical to admin + exclusive: can archive/remove other admin accounts |
| **Admin** | Invited by any admin or superadmin | Full daily-ops authority across all surfaces |
| **Instructor** | Invited by any admin; profile created first in §3 | Scoped to own sessions only |

- Roles are **mutually exclusive** — one email = one account = one role. An instructor who also does front-desk work uses two separate email accounts.
- Admins and superadmin are functionally identical except for the admin-archival power.
- The superadmin label is a deployment artifact — there is no ongoing UI distinction between superadmin and admin sessions.

### 15b. Invitation rules

**Who can invite whom:**
- Any admin (including superadmin) can invite admins and instructors.
- Instructors cannot invite anyone.

**Instructor invitation flow:**
- Admin creates an instructor profile (§3 fields: name, photo, bio, phone, email, eligible class types).
- On save, the system **automatically fires an invite email** to the instructor's email address. No separate "send invite" toggle.
- The instructor's profile is immediately usable for scheduling whether or not the invite has been accepted — profile existence and login access are independent.

**Admin invitation flow:**
- Admin enters the invitee's email address and role (Admin).
- System sends a magic-link invite email. Invitee clicks link → sets password → lands on `/admin` (dashboard).

**Invite token:**
- Expires after **7 days** (hardcoded).
- On expiry: token invalid; invitee record stays `pending` until admin resends or revokes.
- Resend generates a fresh 7-day token.
- Admin can revoke a pending invite at any time.

**Post-acceptance defaults:**
- Admin → lands on `/admin` (dashboard)
- Instructor → lands on `/admin/today`

**Email uniqueness:**
- Emails are unique within the **staff space** (admin + instructor). One email cannot hold both an admin and an instructor account.
- Staff and client spaces are **independent** — the same email can exist as a client in the client app and as a staff member in the admin app. They are treated as separate identities with separate sessions. No cross-login.

### 15c. Archive & removal rules

**Admin accounts:**
- **Hard delete: never.** Admin records are never permanently deleted — audit log integrity depends on actor identity surviving.
- **Archive (soft delete):** the only removal path. On archive: active sessions force-logged-out immediately; pending invites the admin sent remain valid.
- **Only superadmin can archive another admin.** Admins cannot archive each other.
- **No self-archive** — an admin cannot archive their own account.
- **No minimum-admin guardrail** — all admins (including superadmin) can be archived, potentially leaving the system admin-less. Recovery requires deployment-level re-seeding.

**Instructor accounts:**
- Same archive/deletion rules as §3 (hard delete only if zero linked data; archive if past sessions exist; blocked if upcoming/ongoing sessions).
- On archive: active sessions force-logged-out.
- Any admin can archive an instructor (subject to §3 blocking rules).

---

## 16. Clients

### 16a. Client List (`/admin/clients`)

- Searchable by name or email.
- Filterable by status (Active / Suspended).
- Each row shows: name, email, join date, active package count, upcoming booking count, status chip.
- "Add client" is not present — clients self-register via the client app. This list is read-only at the list level.

### 16b. Client Profile (`/admin/clients/[id]`)

**Personal details (read-only):**
- Name, email, phone — sourced from registration; not editable by admin in v1.
- Join date, referral source (who referred them, if any).
- Waiver signed date (read-only — see §18).

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

### 16c. Account Status

Two states: **Active** and **Suspended**.

- **Active** — default. Client can browse, book, and cancel normally.
- **Suspended** — client cannot make new bookings. Existing upcoming bookings are unaffected (not auto-cancelled). Client can still log in and view their history.

Admin can toggle status from the client profile. No reason note required (internal action).

No hard delete — client records are never permanently removed (preserves booking history, check-in records, refund audit trail).

### 16d. Manual Credit / Session Adjustments

Admin can directly modify a client's credit or PT session balance from the client profile.

**Fields:**
- Package — dropdown of the client's active packages (credit bundle or PT pack; unlimited passes are not adjustable by count).
- Adjustment — signed integer (e.g. `+3` or `−1`).
- Reason — free-text, required. No structured types.

**Rules:**
- Balance cannot go below zero — adjustment is blocked if it would result in a negative balance.
- Each adjustment is recorded in an immutable audit log entry: timestamp, acting admin, package, delta, reason.
- No cap on how many adjustments can be made. No approval workflow.
- Adjustments do not affect cancellation cap counter (§4) — they are an admin override, not a client action.

---

## 17. Notifications (Email Templates)

### 17a. Overview

- Every trigger event always fires its email — no per-template enable/disable toggle.
- Each template ships with seeded default content (subject + body). Admin can customise; the seed is the fallback for a fresh deployment.
- No rendered preview mode — admin edits and saves directly.
- Body uses a **rich text editor** (headings, bold, italic, bullet points, links).
- Variables use `{{variable_name}}` syntax. The editor **detects variables inline** — known variables are highlighted; unknown variables are flagged in amber. A reference panel alongside the editor lists all valid variables for that specific template.

### 17b. Template List

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

**Post-session**

| # | Template | Trigger | Recipient | Key variables |
|---|---|---|---|---|
| 15 | Rating prompt — class | Check-in state flips to `completed` (§11) | Attended clients only | `{{client_name}}`, `{{class_name}}`, `{{instructor_name}}`, `{{date}}`, `{{rating_link}}` |
| 16 | Rating prompt — workshop | Workshop event state flips to `completed` | All attendees | `{{client_name}}`, `{{workshop_name}}`, `{{instructor_name}}`, `{{date}}`, `{{rating_link}}` |

**Packages**

| # | Template | Trigger | Recipient | Key variables |
|---|---|---|---|---|
| 17 | Package purchase confirmed | Client purchases any package | Client | `{{client_name}}`, `{{package_name}}`, `{{amount_paid}}`, `{{credits_or_sessions}}`, `{{expiry_date}}` |
| 18 | Credit expiry reminder | 7 days before credit bundle expiry (hardcoded) | Client | `{{client_name}}`, `{{package_name}}`, `{{credits_remaining}}`, `{{expiry_date}}`, `{{days_until_expiry}}` |

**Staff**

| # | Template | Trigger | Recipient | Key variables |
|---|---|---|---|---|
| 19 | Instructor invite | Admin creates instructor profile (§15b) | New instructor | `{{instructor_name}}`, `{{studio_name}}`, `{{invite_link}}`, `{{expiry_days}}` |
| 20 | Admin invite | Admin sends admin invite (§15b) | Invitee | `{{studio_name}}`, `{{invite_link}}`, `{{expiry_days}}` |
| 21 | Check-in nag | Check-in still `pending` 24h after event end (§11) | Assigned instructor (cc admin) | `{{instructor_name}}`, `{{session_name}}`, `{{date}}`, `{{pending_count}}`, `{{checkin_link}}` |

### 17c. Template Editor

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

## 18. Waivers

Single studio-wide liability waiver. One page at `/admin/waivers`.

### 18a. Waiver Text

- Admin edits the waiver body via a **rich text editor** (headings, bold, italic, bullet points, links).
- Ships with seeded placeholder text for a fresh deployment.
- Save replaces the current waiver body — no versioning, no rollback in v1.
- Updating the text does **not** require existing signed clients to re-sign. Their original acceptance timestamp stands.

### 18b. Client Signing

- Waiver is presented during **registration** — client must tick an acceptance checkbox to complete account creation. Hard block: no account without acceptance.
- Acceptance timestamp is recorded per client at the moment of sign-up.
- No manual "mark as signed" action for admin — signing is self-service only.

### 18c. Admin Visibility

- **Client profile (§16b):** shows "Waiver signed — [date]" as a read-only field.
- **`/admin/waivers` page:** shows total signed count alongside the editor. No per-client list on this page — individual signed dates live on each client profile.

---

## 19. Next Phase — Deferred Items

The following sections are out of scope for this phase and will be defined in the next design cycle.

| Section | Description |
|---|---|
| **Dashboard** | Admin landing page — key metrics (bookings, revenue, attendance), unread inbox count, pending check-in alerts, upcoming sessions snapshot. |
| **Reports** | Aggregate analytics across instructors, class types, and locations — revenue, attendance rates, package sales, cancellation rates, rating trends. |
| **Audit log** | Immutable system-wide log of all admin actions — credit adjustments, cancellations, invites, status changes, role changes. Referenced throughout this doc as the record-keeping layer. |
| **Referrals** | Referral program mechanics — reward type, trigger (registration vs. first purchase), admin-configurable reward amount, referral link or code generation. |
| **Instructor portal** | Instructor-scoped admin view — own upcoming schedule, teaching log, ratings (own sessions only, comments anonymised), self-service profile edit. |

---
