# Yoga Sadhana — Product Requirements Document (PRD)

**Status:** v1 scope, post-redo (2026-05-01)
**Owner:** Teeko (Christopher Kwek)
**Companion docs:** [`fe-client-features.md`](./fe-client-features.md) (canonical client-surface spec)

---

## 1. Overview

### 1.1 Product scope

A **dedicated 2-app product for Yoga Sadhana**, a yoga studio in Singapore with 2 physical locations (Breadtalk IHQ Tai Seng + Outram Park). It replaces their previous Reserv subscription.

- **fe-client** — member-facing booking app: browse classes/workshops/private sessions, buy packages, manage bookings, QR check-in, referrals.
- **fe-portal** — staff back-office: schedule + roster + member ops + content + reports + system ops.

This is **not a multi-tenant SaaS**. There is no tenant entity, no slug routing, no plan/billing layer, no "For Business" pitch surface. Yoga Sadhana is hardcoded throughout. Any prior tenants/billing/plans surface from the H-series fe-portal commits is legacy and gets removed in this rebuild.

### 1.2 v1 in-scope

- 3-tier admin model (Super-admin / Studio admin / Instructor) with hard permission boundaries
- Full client-side surface set per `fe-client-features.md` §1–§9
- Schedule + roster + check-in + private-session inbox + member ops on admin side
- Refund-request inbox, cancellation/membership-pause inbox (admin acts out-of-app)
- Email-only outbound notifications, with admin-editable templates
- v1 report set: attendance, finance (money in and out, netted), membership, inbox throughput, referral attribution
- Audit trail across credit adjustments, refunds, session cancellations, waiver resets, impersonation
- Two-location data model (cross-location packages, per-page location filter)

### 1.3 v1 out-of-scope (deferred)

| Area | Status |
|---|---|
| WhatsApp / SMS / web push channels | Deferred — email only in v1 |
| In-app refund processing | Out-of-app permanently — admin settles via WhatsApp/PayNow |
| Instructor pay computation, statements, payouts | Out-of-app permanently — admin computes externally from teaching log |
| Membership cancellation in-app | Out-of-app permanently — "Contact Sales Team" via WhatsApp |
| Auto-renewing memberships | Deferred — manual re-buy in v1 |
| Native mobile app | Deferred |
| Marketing funnel analytics, cohort retention, custom report builder | Deferred to v2 |
| Mandarin / Tamil localization | Deferred — English only in v1 |
| Per-location-locked studio admin sub-role | Deferred — all studio admins are multi-location in v1 |

### 1.4 Out-of-app flows (named explicitly so they are not built in)

Three flows where the system owns the **request inbox** but a human handles the actual resolution outside the app — typically via WhatsApp, with money movement on PayNow / bank transfer / cash:

1. **Refund requests.** Member submits → admin notified → admin acts in WhatsApp → admin marks resolved/declined in app (with notes). No "Refund" button that calls a payment provider.
2. **Membership cancellation / pause.** "Contact Sales Team" CTA on the client side → admin inbox → handled in WhatsApp → admin marks resolved.
3. **Instructor pay.** The system records what each instructor is owed per session and totals it per period on the Finance report (§8); the admin hands the money over externally. No pay *rate* field and no payout run — the platform never records when an instructor was actually paid, which is why every figure it reports is accrual, not cash. See `docs/adr/0001-finance-replaces-payroll.md`.

Anywhere the PRD specifies an "inbox" surface, this is the underlying pattern: a queue with state machine + admin notes + audit, **never** an in-app financial action.

---

## 2. Roles & Permissions

### 2.1 Three-tier role model

| Role | Who | Default home | Authority shape |
|---|---|---|---|
| **Super-admin** | Teeko dev team / founder (platform operators) | `/super/health` | Platform/system ops + impersonation. **Does not touch business data directly** — when they need to act on a member or invoice, they impersonate a studio admin. |
| **Studio admin** | Yoga Sadhana staff (founder, manager, front-desk) | `/admin` | Full business authority within Yoga Sadhana — schedule, packages, member profiles, refund inbox, settings, reports, notification templates. Single tier; no sub-roles in v1. |
| **Instructor** | Yoga Sadhana instructors | `/admin/today` | Row-level scope: own classes, own roster (no member profiles), own private-session inbox, own availability, own profile, own teaching log. **Never sees other instructors or aggregates.** |

### 2.2 Permission matrix

| Action | Super-admin | Studio admin | Instructor |
|---|:---:|:---:|:---:|
| Edit schedule (create class, edit instance, override capacity) | ✗ | ✓ | ✗ |
| Cancel an entire class (e.g., instructor sick) — auto-returns credits | ✗ | ✓ | ✗ |
| Mark attendance / scan QR / check in client | ✗ | ✓ | ✓ own classes only |
| Create / edit / archive packages | ✗ | ✓ | ✗ |
| Create / edit / archive workshops | ✗ | ✓ | ✗ |
| Edit cancellation policy + windows | ✗ | ✓ | ✗ |
| Edit pricing (packages, workshops, private rates) | ✗ | ✓ | ✗ own rate only on profile |
| Approve / decline private-session request | ✗ | ✓ | ✓ own inbox only |
| Manually grant / adjust client credits (mandatory reason) | ✗ | ✓ | ✗ |
| Manually grant / adjust private sessions (mandatory reason) | ✗ | ✓ | ✗ |
| Reset / re-request a waiver | ✗ | ✓ (per user) | ✗ |
| Bulk-reset all waivers (legal text changed) | ✓ | ✗ | ✗ |
| View refund-request inbox + mark resolved/declined | ✗ | ✓ | ✗ |
| View membership-cancellation inbox + mark resolved | ✗ | ✓ | ✗ |
| View any client profile (membership, invoices, credits, history) | ✗ | ✓ | ✗ |
| View own roster on a class (name + check-in state only) | ✗ | ✓ | ✓ own classes only |
| Edit own profile (bio, photo) | n/a | ✓ | ✓ |
| Edit own availability + working-hours blocks | n/a | ✓ (any instructor) | ✓ own only |
| Manage instructor accounts (create / archive / set rate metadata) | ✗ | ✓ | ✗ |
| Manage studio admin accounts (peer-add) | ✓ | ✓ | ✗ |
| View finance / attendance / membership reports | ✓ read-only | ✓ | ✗ |
| View own teaching log | ✓ read-only | ✓ all instructors | ✓ own only |
| Edit notification templates (factory / override) | ✓ factory only | ✓ override only | ✗ |
| Resend a notification (support recovery) | via impersonation | ✓ | ✗ |
| Toggle feature flags / view system health | ✓ | ✗ | ✗ |
| Impersonate a studio admin (audit-logged) | ✓ | ✗ | ✗ |
| Force-logout / reset password for any user | ✓ | ✓ | ✗ |

### 2.3 Scoping rules

**Location scope** (single dimension; no tenant scoping since this is single-studio):

| Role | Location scope | UI |
|---|---|---|
| Super-admin | Both locations always | No filter; sees raw data |
| Studio admin | Both locations by default; per-list location filter chip ("All / Breadtalk / Outram"); optional per-user "default location" UX preference (no permission boundary) | Filter chip on every list with a location dimension |
| Instructor | Implicit — wherever their assigned classes are; no filter chip | n/a |

**Row-level scope** applies only to Instructor:

- Sees only rows where `instructor_id = self`
- This applies to: class instances, rosters, private-session requests, teaching log, availability, profile.
- Never sees: other instructors' rosters, member profiles, invoices, credits, revenue.

**Hard rule:** every entity that has a physical-presence dimension carries `location_id`. Per-page filters must not silently include other locations. Cross-location packages are an explicit exception — credits and sessions are usable at either site.

### 2.4 Impersonation + audit

- Super-admin can impersonate a studio admin via a session-scoped action (banner persists across the impersonated session; "Exit impersonation" returns to super-admin context).
- During impersonation, every state-changing action records both the studio admin (acting identity) and the super-admin (originator). E.g., audit row reads: `Studio admin Maya granted 5 credits to client X — impersonated by Teeko (Christopher) at 2026-05-01 14:22`.
- Audit log is studio-admin-readable for transparency. Super-admin cannot edit audit rows.
- Any attempt to use raw super-admin credentials to write to business tables (refunds, credit adjustments, schedule edits) is blocked by the permission matrix — impersonation is the only path.

---

## 3. Cross-cutting business logic

### 3.1 Credit system (group classes)

- **Credit** = currency for **group classes only**. Earned by purchasing a Bundle, or held implicitly by an Unlimited package.
- A user holds a Bundle **OR** an Unlimited at any moment — never both. See §3.6 for mutex resolution.
- A class booking deducts **1 credit at confirmation**.
- Cancelling within the policy window returns the credit; outside the window it is forfeited (see §3.5).
- **Workshops never use credits** — paid directly per workshop.
- **No-show = forfeit** (same treatment as outside-window cancel). Admin can manually return the credit on the booking detail page with a mandatory reason. No automatic "first no-show forgiveness" in v1.

### 3.2 Session entitlement (private training)

- **Sessions** = a separate currency for **private training only**.
- Held by VIP packages (1-on-1 / 2-on-1).
- 1 session is deducted **only after a private-session request is confirmed** by either the requested instructor or studio admin — never on submission. See §6.2 (instructor journey) + §5.1 (private inbox surface).
- Session forfeit on outside-window cancel mirrors credit forfeit (§3.5).

### 3.3 Locations

- 2 locations: **Breadtalk IHQ (Tai Seng)** + **Outram Park**.
- Locations are a **separate entity**, not a label.
- Class instances, instructors (when teaching), workshops, and physical-presence sessions are scoped to a `location_id`.
- **Packages and credits/sessions are cross-location** — 1 credit works at either site. Member balance is studio-wide.
- Client-side `Classes` page filters by location via a pill toggle (per-page, not global nav). Admin equivalents follow the same pattern (§5).

### 3.4 Booking states + per-booking QR

| State | Meaning |
|---|---|
| `pending` | Private-session request awaiting response (≤12h SLA) |
| `confirmed` | Class/workshop seat held; private session approved |
| `expired` | Private-session request hit 12h SLA without response |
| `cancelled` | User or admin cancelled |
| `attended` | Client checked in (QR scanned) |
| `late` | Checked in after start |
| `no-show` | Did not check in within window |

**Per-booking QR** — every confirmed booking generates a QR scoped to that single booking, format `YS-BOOKING-{bookingId}-{sessionId}`. Front-desk scans the per-booking QR (never a per-user QR) to mark attendance and update state to `attended` or `late`.

### 3.5 Cancellation policy

Yoga Sadhana defaults seeded at v1 launch (admin-editable):

| Booking | Window (free) | Outside window |
|---|---|---|
| Class | 4h before start | Credit forfeited (no fee) |
| Workshop | 7 days before | Refund request (out-of-app); 50% policy retention |
| Private (unconfirmed) | Always free | n/a |
| Private (confirmed) | 24h before | Session forfeited |

Reschedule = cancel + rebook, re-evaluated against policy.

**Admin-cancelled class** (e.g., instructor sick): system auto-returns credits to every booked client; system-issued audit row ("class cancelled by studio — credit returned"). Cancellation email goes out via the `class-cancelled.email` template. No admin override on the credit return; this is the only correct behavior.

### 3.6 Bundle / Unlimited mutex resolution

When admin attempts to issue a new package while user has an active one of the **other type** (Bundle when Unlimited is active, or vice versa):

- Issuance is **blocked with a warning modal**.
- Admin chooses one of two paths:
  - **Cancel current package and replace** — terminates current entitlement, optionally creates a refund-request inbox row for proportional refund.
  - **Queue this package** — purchase recorded, entitlement starts when current expires.
- No silent overwrite. No parallel run. No third-tier "merge."

Same-type stacking (e.g., a second Bundle while one is active) **is** allowed — credits aggregate, expiries track per purchase (FIFO consumption).

### 3.7 Package validity windows (defaults seeded; per-product editable)

| Package type | Default validity from purchase |
|---|---|
| 5-class bundle | 60 days |
| 10-class bundle | 90 days |
| 20-class bundle | 180 days |
| Unlimited (monthly) | 30 days |
| Private VIP (5 sessions) | 90 days |
| Private VIP (10 sessions) | 180 days |

**Auto-renew is off in v1.** Member buys again manually. Lapsing-soon clients are surfaced in the Membership report (§8) for admin to follow up via WhatsApp.

### 3.8 Waiver re-request triggers

Three triggers, all funnel into the same client-side waiver flow on next class booking:

1. **Manual** — studio admin resets waiver from user detail page; mandatory reason recorded. Used for one-off cases (e.g., legal team requested a re-sign on a specific client).
2. **Annual** — system flags waiver as expired 12 months after last sign; client is prompted on next booking.
3. **Bulk** — super-admin can mass-reset all waivers (e.g., legal text rewrite). Single platform-level action, audit-logged with a reason field.

A user with an expired waiver can browse but not confirm a class booking. Existing confirmed bookings stay valid; the next booking attempt triggers the re-sign.

### 3.9 Audit trail principles

- Every credit adjustment, session adjustment, refund-inbox state change, schedule cancellation, waiver reset, and impersonation event writes a row to its respective audit log.
- Audit rows surface on the relevant client / invoice / session / class detail page as a timeline.
- Required fields on every audit row: `actor_id`, `actor_role`, `impersonated_by` (nullable), `action`, `target_id`, `reason` (free-text where mandatory per matrix), `timestamp`.
- Audit rows are append-only — no row edits, no row deletes, even by super-admin.
- Retention: 24 months in-app; archived after.

---

## 4. Entities (high-level data model)

Not a schema — disambiguates terms used throughout the PRD.

### 4.1 People

- **Client** — registered member. Has email, phone (verified separately), name, waiver state + signed timestamp, current package + balance, booking history, referral graph, location preference (UX only).
- **Instructor** — staff who teaches classes / workshops / privates. Has name, bio, photo, own user account (login as Instructor role), per-session private rate (own profile, admin override possible), assigned class instances, availability blocks, archived flag.
- **Studio admin** — staff with admin authority. Has name, email, default-location preference, peer-creatable.
- **Super-admin** — Teeko team account. Has name, email, MFA required at v1 launch.

### 4.2 Catalog (admin-owned templates)

- **Class template** — recurring class type (e.g., "Vinyasa 60min"). Has title, description, duration, default capacity, default instructor, location.
- **Class instance** — concrete class on the schedule (template + datetime + location + instructor + capacity override). Has booking list, attendance state per booking.
- **Workshop** — one-off paid event. Has title, description, capacity, tier prices (early-bird / standard / member rate), date, location, roster.
- **Package** — purchasable product. Type ∈ {Bundle, Unlimited, Private VIP}. Has price, credit/session count, validity days, location scope (cross-location only in v1).
- **Cancellation policy** — single editable record, holds the windows in §3.5.

### 4.3 Booking + financial

- **Booking** — one client × one (class instance | workshop | private session). Has state per §3.4, credit/session source reference, per-booking QR, audit timeline.
- **Private-session request** — `pending`/`confirmed`/`expired` precursor to a booking. See §5.1.
- **Invoice** — payment record for a package or workshop purchase. Has amount, currency (SGD), method, paid timestamp, outstanding-balance flag.
- **Refund request** — out-of-app inbox row. State ∈ {open, resolved, declined}; admin notes; original invoice reference.
- **Membership-cancellation request** — out-of-app inbox row. Same shape as refund request, different category.

### 4.4 Operational

- **Audit row** — per §3.9.
- **Notification send** — one row per outbound email; recipient, event, template version, channel (email in v1), status, triggered-by.
- **Notification template** — factory version (super-admin) + optional studio override (studio admin). Per event type.
- **Feature flag** — super-admin-owned platform toggle.
- **Location** — `id`, name, address, hours; non-deletable in v1 (just two seeded rows).

---

## 5. Admin surface inventory

Listed as **surface name → 1-line purpose → role visibility**. UX detail in §6 journeys.

### 5.1 Studio admin surfaces (default home `/admin`)

| Surface | Purpose | Visibility |
|---|---|---|
| **Dashboard** | Today's classes + needs-attention feed (private-SLA escalations, pending refund/cancellation rows, lapsing memberships, expired waivers). | Studio admin |
| **Schedule** | Calendar view of class instances; create / edit / cancel instance; capacity + waitlist toggle; bulk-generate from template. Per-location filter chip. | Studio admin |
| **Today** | Live "next class up" view: roster, check-in, manual attendance overrides. Mirrors the surface instructors see for their own classes. | Studio admin (all classes) + Instructor (own only) |
| **Workshops** | CRUD + tier pricing + roster. | Studio admin |
| **Packages catalog** | CRUD on Bundles / Unlimited / Private VIP; validity window editor; price editor; archive. | Studio admin |
| **Manual grants** | Issue a package (or raw credit/session count) to a client; mandatory reason; mutex resolution per §3.6. | Studio admin |
| **Clients** | List + detail. Detail shows: profile, membership state, balance, booking history, invoices, audit timeline, waiver state, manual-adjust controls, force-logout, password reset, referral graph view. | Studio admin |
| **Instructors** | List + detail. Create / archive / set per-session rate (override). View teaching log for any instructor. | Studio admin |
| **Private-session inbox** | All-instructors view, read-only by default; SLA chips; can take over any request (records "on behalf of"). | Studio admin |
| **Refund-request inbox** | Open / resolved / declined queue; admin notes; out-of-app pattern (§1.4). | Studio admin |
| **Membership-cancellation inbox** | Same shape as refund inbox; out-of-app. | Studio admin |
| **Notification templates** | Per-event email template editor; factory vs override; resend audit + manual resend per booking/user. | Studio admin (override only) |
| **Reports** | v1 set per §8. Filter conventions: date range, location, CSV export. | Studio admin |
| **Marketing copy** | Landing page hero, pricing page, footer, branding (single editable record set). | Studio admin |
| **Settings** | Cancellation windows, validity window defaults, waiver text + version, locations metadata, working-hours defaults. | Studio admin |
| **Audit log** | Searchable global view across all audit categories. | Studio admin |

### 5.2 Instructor portal surfaces (default home `/admin/today`)

| Surface | Purpose | Visibility |
|---|---|---|
| **Today** | Live next-class roster + check-in for own classes. | Instructor (own) |
| **Schedule** | Calendar of own assigned classes; read-only on instances. | Instructor (own) |
| **Roster** | Per-class roster: client name + check-in state. **No** membership / invoice / credit info. | Instructor (own classes) |
| **Availability** | Editable working-hours blocks + per-day overrides; constrains private-session request slots. | Instructor (own) |
| **Private-session inbox** | Own pending requests; approve (optional note) / decline (mandatory reason). | Instructor (own) |
| **Profile** | Editable bio, photo, per-session rate (subject to admin override). | Instructor (own) |
| **Teaching log** | History of own classes by state (scheduled / completed / cancelled); informs external pay. | Instructor (own) |

Instructors do not see: any client profile beyond roster row, any other instructor, any aggregate report, any financial surface, any settings page, any notification editor.

### 5.3 Super-admin surfaces (default home `/super/health`)

| Surface | Purpose | Visibility |
|---|---|---|
| **System health** | Service status, error rates, recent deploys, queue depths (notifications pending, audit ingestion). | Super-admin |
| **Feature flags** | Platform-level toggles (e.g., enable WhatsApp-channel preview, enable v2 reports). | Super-admin |
| **Notification factory templates** | Edit the canonical email template library; variable token catalog. | Super-admin |
| **Studio-admin accounts** | Create, peer-add, force-logout, password reset, MFA enrollment. | Super-admin |
| **Audit (read-only, including impersonation events)** | Read-only mirror of studio-admin audit log + super-admin own action log. | Super-admin |
| **Impersonate** | Pick a studio admin account → enter their session with persistent banner. | Super-admin |
| **Bulk waiver reset** | Single-action mass waiver reset with reason. | Super-admin |
| **Reports** | Mirror of the v1 report set (§8) for diagnostics — read-only except Finance, where pay editing carries over from the Payroll page it replaced (§8.4 principle 2). No CSV export of PII unless impersonating. | Super-admin |

Super-admin does not see (without impersonating): a "Refund" button, a credit-adjust control, schedule editing, package editing, or any other business action surface.

---

## 6. User journeys

### 6.1 Studio admin

#### 6.1.1 Daily ops (front-desk shift)

1. Lands on `/admin` dashboard. Scans:
   - **Today's classes** card — sees next 4 hours of scheduled classes, capacity vs booked, instructor, location.
   - **Needs attention** feed — private-session requests within 6h of SLA, refund inbox open count, cancellation inbox open count, lapsing memberships in the next 7 days, expired waivers awaiting next booking.
2. Walks to **Today** for the next class starting → confirms instructor is on site, scans incoming clients' QR codes, marks any walk-ins (added to roster on the spot, charged via the manual grant flow if needed).
3. Triages **Refund inbox** new rows: opens each, reviews the booking + invoice context, replies to client on WhatsApp (out-of-app), then marks **Resolved** with notes citing the WhatsApp action and PayNow reference, or **Declined** with notes.
4. Same flow for **Membership-cancellation inbox**.
5. Triages **Private-session inbox** rows that have escalated (instructor unresponsive < 6h to SLA): takes over → confirms availability with instructor on WhatsApp → approves on behalf of instructor (audit records "on behalf of").

#### 6.1.2 Weekly schedule build

1. Opens **Schedule** → switches to weekly view → uses **Bulk-generate from template** to lay out the next 4–8 weeks of recurring classes.
2. Reviews instructor assignments against availability — system surfaces conflicts (instructor unavailable on a generated slot).
3. Resolves conflicts: reassign instructor, or reduce capacity, or cancel that single instance (which triggers the credit-return flow if any client had pre-booked — though for a future-week cancellation no client has booked yet, so this is rare).
4. Saves → bulk schedule write → notification template `schedule-published.email` fires to members who have favorited the studio (deferred to v2 if not built yet).

#### 6.1.3 Member ops (one-off)

1. Searches `Clients` → opens detail page.
2. Adjusts credit balance manually if needed → modal forces a free-text reason → audit row appended → balance updated.
3. Issues a new package → mutex-resolution modal if conflict (§3.6) → resolution choice → balance updated → audit row + invoice generated (or marked manual-issuance, no payment captured in v1 outside the package catalog price).
4. Resets waiver if requested by legal/operations → reason recorded.
5. Reviews booking history + audit timeline.

#### 6.1.4 Monthly close

1. Opens **Finance** → filters to last calendar month → reads Gross, discounts, Refunds, Instructor Pay and Net → exports CSV for the bookkeeper.
2. Same for Attendance and Membership.
3. Reads the per-instructor pay breakdown on Finance → disburses via PayNow / bank transfer. The platform does not record that the money went out.
4. Reviews **Audit log** for the month: sanity-checks credit grants, refund decisions, schedule cancellations.

### 6.2 Instructor

#### 6.2.1 Pre-class

1. Lands on `/admin/today`. Sees next class card with: title, time, location, capacity vs booked, roster (name only).
2. Reviews roster — names only, no membership/credit/invoice info. Notes any names with "Late check-in last time" markers (system-surfaced).

#### 6.2.2 In-class

1. Opens **Today** view → starts roster QR scanner.
2. Scans each arriving client's per-booking QR (`YS-BOOKING-…`) → state flips to `attended` (or `late` if past start). Manual override available with a reason for tech failures.
3. After class window closes (e.g., 30 min after start), unmarked rows auto-flip to `no-show`.

#### 6.2.3 Post-class

1. Class instance state flips to `completed` automatically after end time.
2. Teaching log row created.

#### 6.2.4 Weekly availability update

1. Opens **Availability** → sets / edits working-hours blocks per day, per location.
2. Adds per-day overrides for vacations / sick days.
3. Save → constrains the slots clients can request a private with this instructor.

#### 6.2.5 Private-session inbox

1. Notification fires → instructor opens their **Private-session inbox**.
2. Reviews pending request: client name, requested slot, requested location, message.
3. **Approve** with optional note OR **Decline** with mandatory reason.
4. On approve: booking confirmed, 1 session deducted from client, calendar event created on instructor's schedule, client receives `private-confirmed.email`.
5. If unresponsive: at SLA – 6h, system pings studio admin (§5.1). At SLA expiry, request → `expired` and client is notified to re-submit.

### 6.3 Super-admin

#### 6.3.1 Routine system ops

1. Lands on `/super/health` → checks service status, error rates, queue depths.
2. If abnormal, drills into logs (out of app — observability stack TBD).

#### 6.3.2 Support escalation (e.g., client reports broken booking)

1. Receives escalation from studio admin.
2. Goes to **Impersonate** → picks the studio admin account → enters the session.
3. Persistent banner reads: `Impersonating Studio Admin Maya — exit to return`.
4. Reproduces the issue with full studio-admin authority. Any state-changing action is audit-logged with `impersonated_by = super-admin Christopher`.
5. Exits impersonation → returns to super-admin context.

#### 6.3.3 Release rollout (feature flag toggle)

1. Goes to **Feature flags** → toggles new flag for studio.
2. Studio admins see the new behavior on next page load.
3. Audit row recorded.

#### 6.3.4 Bulk waiver reset (legal change)

1. Receives signal from legal that waiver text changed.
2. Goes to **Settings → Waiver** (via impersonation) → updates waiver text, increments version.
3. Returns to super-admin context → **Bulk waiver reset** → enters reason → confirms → all clients flagged for re-sign on next booking.
4. Single audit row at platform level + per-client trigger row.

---

## 7. Notifications

### 7.1 Channel — email only in v1

WhatsApp, SMS, web push are deferred. The per-event channel matrix in admin collapses to a single column ("Email"). Don't ship the WhatsApp/SMS/push columns.

Admin-side **inbox surfaces** (refund / cancellation / private-session) are dashboard views in fe-portal and not "channels" — these remain regardless of outbound channel scope.

### 7.2 Event catalog (v1)

| Event | Trigger | Recipient | Mandatory in v1 |
|---|---|---|---|
| `register-verify-phone` | Registration submitted | Client | ✓ |
| `register-verify-email` | Registration submitted | Client | ✓ |
| `forgot-password` | Forgot-password requested | Client | ✓ |
| `waiver-required` | First class booking attempt without signed waiver | Client | ✓ |
| `waiver-expired` | Annual / bulk reset triggered | Client | ✓ |
| `booking-confirmed` (class) | Class booking → `confirmed` | Client | ✓ |
| `booking-cancelled` (client-initiated, in window) | Client cancel within window | Client | ✓ |
| `booking-cancelled` (client-initiated, out of window) | Client cancel outside window | Client | ✓ |
| `class-cancelled` (admin-initiated) | Admin cancels class instance | All booked clients | ✓ |
| `workshop-confirmed` | Workshop purchased | Client | ✓ |
| `private-request-received` | Client submits request | Client (acknowledgment) | ✓ |
| `private-request-approved` | Instructor or admin approves | Client | ✓ |
| `private-request-declined` | Instructor or admin declines | Client (includes reason) | ✓ |
| `private-request-expired` | 12h SLA elapses | Client | ✓ |
| `package-purchased` | Package purchase confirmed | Client | ✓ |
| `package-lapsing-soon` | Package validity ≤ 7 days remaining | Client | ✓ |
| `package-expired` | Package validity reached zero | Client | ✓ |
| `referral-earned` | Referral attribution confirmed | Referrer | ✓ |
| `refund-request-received` | Client submits refund request | Studio admin | ✓ |
| `cancellation-request-received` | Client submits membership cancellation/pause | Studio admin | ✓ |
| `private-sla-escalation` | Private request 6h to SLA, instructor unresponsive | Studio admin | ✓ |

### 7.3 Template ownership (factory + override)

- **Super-admin** owns the **factory** library — one entry per event per channel. Defines the variable tokens (`{{client.firstName}}`, `{{class.startTime}}`, `{{cancellation.window}}`, etc.). Variable schema is fixed; factory copy is editable by super-admin only.
- **Studio admin** can author a **local override** for any event template. Override scope: copy + tone + branding. Cannot change variable schema, cannot change trigger logic.
- **Reset to factory** action available on every override.
- **Instructor** never edits templates.

### 7.4 Manual resend + audit

- Studio admin can resend any past notification from a user-detail page or booking-detail page. Reason recorded.
- Super-admin can resend only via impersonation.
- Every send (system-triggered or manual resend) writes a **notification send** row: recipient, event, template version, channel, status (queued / sent / delivered / bounced / failed), triggered-by, timestamp.
- Searchable in admin by recipient + event type. Retention 12 months in-app.

---

## 8. Reports (v1)

### 8.1 v1 report set

| Report | Detail |
|---|---|
| **Attendance** | Class fill rate (booked / capacity), no-show rate, by class type / location / time-of-day / instructor. Trend over period. |
| **Finance** | Every **Money Event** in the period, money in and money out, in one table: package sales, Cross-Location Add-Ons, workshop tickets, corporate packages, Merch Orders, Refunds (negative, on their own date), Instructor Pay and Manual Entries. Five figures over the whole filtered range: Gross, discounts given, Refunds, Instructor Pay, and **Net**. Replaces the separate Revenue and Teaching log reports — Net cannot be computed on either alone. See `docs/md/spec-finance.md`. |
| **Membership** | Active / expired / lapsing-soon clients; bundle vs unlimited mix; signed-waiver vs lapsed-waiver counts; churn signals (no booking in 30/60/90d). |
| **Inbox throughput** | Refund / cancellation / private-session request counts and time-to-resolution by state. |
| **Referral attribution** | Who referred whom, referral → first-purchase conversion rate. |

### 8.2 Standard filter set

- Date range (presets: 7d / 30d / 90d / current month / last month / custom).
- Location (All / Breadtalk / Outram / **Unattributed**). The Unattributed bucket is not an error state: only an Unlimited Plan records a Location at purchase, so most revenue genuinely has none. Naming it keeps the gap visible instead of dropping that money out of both studios' figures.
- Export to CSV — exactly the filtered rows, from the same read the screen used.

### 8.3 Visibility

| Report | Studio admin | Instructor | Super-admin |
|---|:---:|:---:|:---:|
| Attendance | ✓ full | ✗ | ✓ read-only |
| Finance | ✓ full | ✗ | ✓ **full** (see principle 2) |
| Membership | ✓ full | ✗ | ✓ read-only |
| Inbox throughput | ✓ full | ✗ | ✓ read-only |
| Referral attribution | ✓ full | ✗ | ✓ read-only |

An instructor's own **Teaching log** (`/instructor/payroll`) is not a report and is not on this table: it shows that instructor their own sessions and their own pay, never a studio total. It is the surface principle 1 exists to protect.

### 8.4 Principles

1. **Instructors never see aggregates.** Even own teaching log shows their rows, not "performance vs. studio average." Studio admin can share insights manually if useful.
2. **Super-admin reports are diagnostic, not actionable — except Finance.** No edit affordances on a report surface, and no PII export unless impersonating. Finance is the deliberate exception: it absorbed the Payroll page's inline pay editing, and a super-admin correcting a figure should not have to impersonate to do it. Within Finance, only Instructor Pay and Manual Entries are editable by anyone — purchases and Refunds carry no edit affordance for either role, because they are the payment provider's record. Reversed in `docs/adr/0001-finance-replaces-payroll.md`.

---

## 9. Out of scope (v2+)

Named explicitly so a reader does not infer them as v1 commitments:

- WhatsApp / SMS / web push channels for outbound notifications. The channel matrix in admin collapses to a single Email column for v1.
- WhatsApp Business API templates and approval flow. WhatsApp remains a manual ops channel.
- In-app refund processing. Refunds stay out-of-app permanently.
- In-app membership cancellation. Cancellation stays out-of-app permanently.
- Auto-renewing memberships.
- Native mobile app.
- Marketing funnel analytics (page views → registration → first purchase).
- Cohort retention analysis.
- Custom date-range builder, saved reports, scheduled report email.
- Heatmap / capacity-planning suggestions.
- Mandarin / Tamil localization. English only in v1.
- Per-location-locked studio admin sub-role.
- Approval ladder / dual-signoff for refunds. Refunds are out-of-app entirely.
- Tenant entity, slug routing, plan/billing layer, "For Business" surface — none of these exist in this single-studio product.

---

## Appendix A — Glossary

- **Bundle** — package type granting N group-class credits, expires after validity window.
- **Unlimited** — package type granting unlimited group classes within a time window (no credit count).
- **Credit** — currency for group classes only. 1 booking = 1 credit at confirmation.
- **Session** — currency for private training only. Held by VIP packages. 1 session deducted at private-request confirmation, never on submission.
- **Per-booking QR** — QR scoped to a single booking, format `YS-BOOKING-{bookingId}-{sessionId}`. Not a per-user QR.
- **Inbox surface** — admin-side queue for an out-of-app flow (refund / cancellation / private-session). State machine + admin notes + audit, never an in-app financial action.
- **Mutex resolution** — the modal that fires when admin tries to issue a Bundle while user has Unlimited active (or vice versa). Choices: replace, queue.
- **Factory template** — super-admin-owned canonical email template per event.
- **Override** — studio admin's local edit of a factory template; copy + tone only, not variable schema.
- **Impersonation** — super-admin enters a studio admin's session to act on business data; persistent banner; every action audit-logged with `impersonated_by`.
- **Teaching log** — per-instructor, per-period record of classes scheduled / completed / cancelled. Powers external pay calc.

---

## Appendix B — Reference

- [`fe-client-features.md`](./fe-client-features.md) — canonical client-surface spec (sections §0–§12). The PRD inherits §0 cross-cutting concepts wholesale; §3 of this PRD locks the values that fe-client says are "set in admin."
- Memory: `project_overview.md` — single-studio scope, NOT SaaS.
- Memory: `project_multi_location.md` — 2 locations, cross-location packages.
- Memory: `project_refunds_out_of_app.md` — refund pattern.
- Memory: `project_instructor_pay_out_of_app.md` — pay pattern.
- Memory: `project_email_only_v1.md` — channel scope.
- Memory: `project_yoga_sadhana.md` — Mar 29 product decisions.
