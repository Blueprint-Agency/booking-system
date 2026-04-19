# fe-admin — Feature Breakdown

Companion to `fe-client-features.md`. This document defines the **admin-side** clickable mockup for the Yoga Sadhana product: what surfaces exist, what each one does, what UX it presents, and which journeys cut across them.

Source of truth references:
- Product scope, role model, business rules: `docs/md/prd.md`
- Client-side product surfaces this admin app operates on: `docs/md/fe-client-features.md`

The admin app is a **clickable Next.js + Tailwind + shadcn/ui mockup** with no backend. All data is seed JSON. Three role surfaces are demoed in the same app behind a role switcher: **Super-admin**, **Studio admin**, **Instructor**.

---

## 0. Cross-cutting concepts

These appear on every surface. Keep them consistent — never re-implement them per page.

### 0.1 Three-tier role model

| Role | Default home | Authority |
|---|---|---|
| **Super-admin** | `/super/health` | Platform/system ops + impersonation. Never touches business data directly — impersonates a studio admin to act. |
| **Studio admin** | `/admin` | Full business authority within Yoga Sadhana — schedule, packages, member profiles, refund inbox, settings, reports, notification templates. Single tier; no sub-roles. |
| **Instructor** | `/admin/today` | Row-level scope: own classes, own roster (no member profiles), own private-session inbox, own availability, own profile, own teaching log + own ratings. |

Demo prop: a **role switcher** in the top bar (visible only when the mockup is in dev mode) flips between seeded super-admin / studio admin / instructor identities so all three surfaces are walkable in one session.

### 0.2 Two locations

Breadtalk IHQ (Tai Seng) + Outram Park. Every list with a physical-presence dimension carries a **location filter chip — `All / Breadtalk / Outram`**. Per-user "default location" is a UI preference only, not a permission boundary. Cross-location packages are an explicit exception: credits and sessions are usable at either site.

Instructors do not see a location chip — their scope is implicit via assigned classes.

### 0.3 Inbox pattern (refund / cancellation / private-session)

Three out-of-app flows where the system owns the **request inbox** but a human resolves outside the app (typically WhatsApp + PayNow / bank transfer / cash):

1. **Refund requests** — member submits → admin notified → admin acts in WhatsApp → admin marks **Resolved / Declined** with notes. **No "Refund" button** that calls a payment provider.
2. **Membership cancellation / pause** — "Contact Sales Team" CTA on the client side → admin inbox → handled in WhatsApp → admin marks **Resolved**.
3. **Private-session requests** — see §5.

Every inbox surface uses the same shape: queue + state machine + admin notes + audit row. **Never** an in-app financial action.

### 0.4 Audit log

Every credit adjustment, session adjustment, refund-inbox state change, schedule cancellation, waiver reset, and impersonation event writes a row. Audit rows surface as a **timeline** on the relevant client / invoice / session / class detail page. Append-only — no edits, no deletes.

Required fields: `actor_id`, `actor_role`, `impersonated_by` (nullable), `action`, `target_id`, `reason` (free-text where mandatory), `timestamp`.

### 0.5 Cancellation policy (single editable record)

Editable in **Settings → Policy**. Determines per-booking-type behavior:

| Booking type | Inside window | Outside window |
|---|---|---|
| Class | Credit returned | Credit forfeited / fee |
| Workshop | Refund initiated (out-of-app) | Policy penalty |
| Private (unconfirmed) | Free | Free |
| Private (confirmed) | Session returned | Session forfeited / fee |

Reschedule = cancel + rebook, re-evaluated against policy. Default windows: 12h class, 12h private.

### 0.6 Notifications — email-only in v1

The admin **Notifications** surface collapses the per-event channel matrix to a single **Email** column. No WhatsApp / SMS / push columns. Admin inboxes (refund, cancellation, private-session) are dashboard views in fe-admin and are independent of outbound channel scope.

### 0.7 Out-of-app instructor pay

System tracks classes scheduled / completed (Teaching log). Admin computes pay externally → disburses externally. **No** in-app pay rate field on instructor profile beyond a metadata note, **no** statement page, **no** payout report.

### 0.8 Manual-grant mutex resolution

When admin issues a package or raw credit/session count to a client, the action requires a **mandatory reason**. If the client already has an overlapping active package, the resolution rule (extend vs replace vs stack) is presented inline with a default + override.

### 0.9 Impersonation

Super-admin → "Impersonate this studio admin" enters a **session-scoped impersonation** with a persistent banner ("You are acting as Maya — Exit impersonation"). Every state-changing action during impersonation records both the studio admin (acting identity) and the super-admin (originator).

---

## 1. Information architecture

Sidebar layout, persistent on desktop, collapsible drawer on mobile. Top-level nav reflects role.

### 1.1 Studio admin — `/admin/*`

| Route | Surface | Purpose |
|---|---|---|
| `/admin` | **Dashboard** | Today's classes + needs-attention feed |
| `/admin/today` | **Today** | Live "next class up" — roster, check-in, walk-ins |
| `/admin/schedule` | **Schedule** | Weekly/monthly calendar; create / edit / cancel instance |
| `/admin/schedule/[id]` | Session detail | Roster + per-instance actions |
| `/admin/classes` | Class templates | Recurring class types + bulk-generate |
| `/admin/classes/[id]` | Template editor | Recurrence builder |
| `/admin/workshops` | Workshops | List + CRUD + tier pricing + roster |
| `/admin/workshops/[id]` | Workshop detail | Editor + roster + waitlist |
| `/admin/packages` | Packages catalog | Bundles / Unlimited / Private VIP CRUD |
| `/admin/packages/[id]` | Product editor | Validity + price + scope |
| `/admin/clients` | Clients list | Search + filter + waiver state |
| `/admin/clients/[id]` | Client profile | Profile, membership, balance, history, invoices, audit, notes |
| `/admin/clients/[id]/grant` | Manual grant | Modal route — package or raw credits |
| `/admin/instructors` | Instructors list | |
| `/admin/instructors/[id]` | Instructor profile | Bio, availability, teaching log, ratings |
| `/admin/private/inbox` | Private-session inbox | All-instructors view; SLA chips; takeover |
| `/admin/private/[id]` | Request detail | Approve / decline |
| `/admin/refunds` | Refund inbox | Open / resolved / declined |
| `/admin/cancellations` | Cancellation inbox | Membership pause/cancel requests |
| `/admin/check-in` | Check-in | QR scan + manual booking-ID + walk-in |
| `/admin/invoices` | Invoices list | Stripe mirror, refund actions |
| `/admin/invoices/[id]` | Invoice detail | Resend, void, mark refunded |
| `/admin/promos` | Promo / referral codes | Codes + reward config |
| `/admin/referrals` | Referral attribution | Graph + payout audit |
| `/admin/marketing` | Marketing / Site CMS | Hero, locations, features, testimonials, CTA |
| `/admin/notifications` | Email templates | Per-event editor (override factory) |
| `/admin/waivers` | Waivers | Signed list + version |
| `/admin/audit` | Audit log | Filterable activity stream |
| `/admin/reports` | Reports | Attendance, revenue, membership, teaching log, ratings, inbox throughput, referral attribution |
| `/admin/settings` | Settings | Profile, locations, policy, hours, admin users, branding |

### 1.2 Instructor portal — `/admin/*` (scoped views)

Instructors share the URL prefix but every list/detail is row-level scoped to `instructor_id = self`. No location chip.

| Route | Surface |
|---|---|
| `/admin/today` | **Today** — own next-class roster + check-in |
| `/admin/schedule` | Own assigned classes (read-only on instances) |
| `/admin/sessions/[id]/roster` | Roster (name + check-in state only — no membership / invoice / credit info) |
| `/admin/availability` | Editable working-hours blocks + per-day overrides |
| `/admin/private/inbox` | Own pending requests; approve / decline |
| `/admin/profile` | Editable bio, photo, per-session rate (admin override applies) |
| `/admin/teaching-log` | Own classes by state |
| `/admin/ratings` | Aggregate per own class |

### 1.3 Super-admin — `/super/*`

| Route | Surface |
|---|---|
| `/super/health` | System health (service status, error rates, recent deploys, queue depths) |
| `/super/flags` | Feature flags |
| `/super/templates` | Notification factory templates + variable token catalog |
| `/super/admins` | Studio-admin accounts (peer-add, force-logout, password reset, MFA enrollment) |
| `/super/audit` | Read-only mirror of studio audit + super-admin own actions |
| `/super/impersonate` | Pick a studio admin → enter impersonation |
| `/super/waivers/reset` | Bulk waiver reset (legal change) |
| `/super/reports` | Read-only mirror of v1 report set (no PII CSV unless impersonating) |

---

## 2. Studio admin surfaces

### 2.1 Dashboard `/admin`

**Business logic**
- Two cards above the fold:
  - **Today's classes** — next 4 hours of scheduled classes, capacity vs booked, instructor, location.
  - **Needs attention** — counts and chips for: private-session requests within 6h of SLA, refund-inbox open count, cancellation-inbox open count, lapsing memberships (next 7 days), expired waivers awaiting next booking.
- Below: small KPI strip (today bookings, today walk-ins, today no-shows, today revenue) + a "Recent activity" tail (last 10 audit rows).
- Per-location chip filters Today's classes only — needs-attention feed is global.

**User journey (front-desk shift)**
1. Land on `/admin`. Glance at **Today's classes** + **Needs attention**.
2. Click **Refund inbox: 3 open** chip → triage (§2.10).
3. Click **Today** → check in arrivals (§2.2).

**Why it exists**
The single screen a front-desk admin should land on at the start of a shift. Nothing on this page requires drilling — it's the orientation surface.

### 2.2 Today `/admin/today`

**Business logic**
- "Next class up" view: shows the upcoming class in the studio (location-filterable), its roster, capacity, and a **Check-in** column per booking.
- Three add-actions: **Scan QR**, **Enter booking ID**, **Add walk-in**.
- Walk-in flow: searches existing clients by name / phone / email → if found, adds to roster (charges via manual-grant flow if no entitlement); if not found, opens a quick-add new client form.
- Per-row state: `Booked` / `Checked in` / `No-show` (auto-set 10 min after class start). Manual override allowed with audit row.

**User journey**
1. Open `/admin/today` 5 min before class.
2. Confirm instructor on site.
3. Scan QR codes from arriving clients → roster row flips to **Checked in**.
4. Walk-in arrives → tap **Add walk-in** → search → add → if no credits, manual-grant modal (mandatory reason).

**Why it exists**
Mirrors the surface instructors use for their own classes. Studio admin sees *all* classes; instructor sees own only.

### 2.3 Schedule `/admin/schedule`

**Business logic**
- Weekly calendar default; month toggle. Filter chips: **Location**, **Instructor**, **Level**.
- Click a slot → session detail (`/admin/schedule/[id]`): roster, capacity override, waitlist toggle, **Cancel instance** (auto-returns credits + fires `class-cancelled.email` to all booked clients).
- Empty slots show **+ Add class** quick-create (template-backed).
- **Bulk-generate from template** (top-right) lays out the next 4–8 weeks of recurring classes; surfaces instructor-availability conflicts inline; resolve by reassign / reduce capacity / cancel single instance.

**User journey (weekly build)**
1. Open `/admin/schedule` → weekly view → **Bulk-generate**.
2. System lays out instances; conflict drawer shows 3 conflicts.
3. Resolve each → save → schedule write.

**Why it exists**
The scheduling backbone. Every booking, roster, check-in, and report rolls up from here.

### 2.4 Class templates `/admin/classes`

**Business logic**
- List of recurring class types (e.g., "Vinyasa 60min"): title, description, duration, default capacity, default instructor, location.
- Editor: recurrence builder (days of week, start time, weeks valid), default capacity, level, type (Vinyasa / Yin / Hatha / Restorative / Pranayama), description, image.

**User journey**
1. New class type → `/admin/classes/new` → fill template → save.
2. Use **Bulk-generate from template** on Schedule (§2.3) to materialize instances.

### 2.5 Workshops `/admin/workshops`

**Business logic**
- One-off paid events. CRUD: title, description, date/time, location, capacity, **tier prices** (early-bird / standard / member rate), waitlist toggle.
- Roster tab: attendees, payment status, **Move attendees between dates** action (used when admin reschedules a workshop).
- Refund-on-cancel: cancelling a workshop instance triggers `workshop-cancelled.email` and surfaces a refund row in the refund inbox per attendee (admin acts out-of-app).

**Why it exists**
Workshops sit outside the credit system — they need their own pricing model + per-event roster and a refund-eligible commerce flow.

### 2.6 Packages catalog `/admin/packages`

**Business logic**
- Three tabs: **Bundles** (credit packs), **Unlimited** (memberships), **Private VIP** (1-on-1 / 2-on-1 packs, family-shareable).
- Product editor: price, credit/session count, validity days, **location scope** (cross-location-only in v1 — no per-location lock UI), archive toggle.
- "Archived" packages remain valid for clients who already own them; just removed from the public catalog.

**User journey**
1. Quarterly price change → open Bundle editor → bump price → save.
2. New seasonal pack → **+ New product** → fill → publish → appears on `/packages` client side.

### 2.7 Manual grants (modal `/admin/clients/[id]/grant`)

**Business logic**
- Two paths: **Issue a package** (picks from catalog, sets validity from now) or **Issue raw credits/sessions** (count + validity days).
- Mandatory **reason** field (free-text). Audit row written.
- If client has an overlapping active package: mutex resolver inline (extend vs replace vs stack). Default per package type + admin override.
- Used for: walk-ins without entitlement, comp credits for incidents, rebooking after refund.

### 2.8 Clients `/admin/clients`

**Business logic**
- List: search by name / email / phone; filter by location, membership state (active / lapsing / expired / never), waiver state (signed / lapsed / expired), referral graph (referrer / referee).
- Detail (`/admin/clients/[id]`): tabbed.
  - **Profile** — name, contact, location preference, registration date, waiver state.
  - **Membership** — current package(s), credit balance per package, expiry, membership state. Manual-adjust controls. **Pause / cancel / extend / contact** actions (cancel/pause are inbox-driven; extend = manual grant).
  - **Bookings** — full history across classes, workshops, privates with per-row status (booked / attended / no-show / cancelled).
  - **Invoices** — purchase history; resend, void, mark refunded.
  - **Notes** — freeform admin notes.
  - **Audit** — append-only timeline of state-changing actions on this client.
  - **Referral graph** — referrer + referee tree.
  - **Account** — force-logout, password reset, suspend, **Re-request waiver** (bumps version for this user only).

**User journey (refund triage)**
1. Refund inbox row → click client name → opens client profile → Invoices tab → review original purchase.
2. Drop back to refund inbox → mark Resolved with notes ("PayNow ref ABC").

**Why it exists**
The single profile that unifies everything a front-desk admin needs to know about a member when triaging a request.

### 2.9 Instructors `/admin/instructors`

**Business logic**
- List + detail. Detail shows: bio, photo, per-session rate (metadata only — pay is out-of-app), assigned locations.
- Tabs:
  - **Availability** — admin can edit any instructor's working-hours blocks and block-offs (vacation, sick).
  - **Teaching log** — read-only; classes scheduled / completed / cancelled per period. Used for monthly external pay calc (§4.3).
  - **Ratings** — aggregate per class; no peer comparison surfaced anywhere.
  - **Account** — create / archive instructor account; set rate metadata.

### 2.10 Refund inbox `/admin/refunds`

**Business logic**
- Three queues: **Open** / **Resolved** / **Declined**. New rows arrive when a client submits via `/account/invoices` "Request refund".
- Row: client, invoice, amount, reason, submitted-at, age (chip turns warning at 24h).
- Detail drawer: full invoice + booking context + WhatsApp deep-link to client phone (prefilled message). **Mark Resolved** (mandatory notes field — typically PayNow reference) or **Mark Declined** (mandatory reason).
- No payment-provider call. Audit row written per state change.

**User journey**
1. Open inbox → triage **Open** queue oldest-first.
2. Click row → review context → tap WhatsApp deep-link → handle in WhatsApp → return → mark Resolved with PayNow ref in notes.

### 2.11 Cancellation inbox `/admin/cancellations`

**Business logic**
- Same shape as refund inbox. New rows arrive when a client taps **Contact Sales Team** on `/account` membership card.
- States: **Open** / **Resolved**. No "Decline" — everything resolves (admin handles cancel/pause/retain in WhatsApp; resolution notes record outcome).

### 2.12 Private-session inbox `/admin/private/inbox`

**Business logic**
- All-instructors view, **read-only by default**. Studio admin can **take over** any request (records "on behalf of" in audit + notification).
- SLA chips per row: green (< 6h since submit), amber (6–12h), red (> 12h, escalation triggered).
- Detail (`/admin/private/[id]`): client, requested slot, requested location, message, instructor (if assigned). Actions: Approve (optional note) / Decline (mandatory reason) / Take over.
- On approve: booking confirmed, 1 session deducted from client, calendar event created on instructor's schedule, client gets `private-confirmed.email`.

**User journey (escalation)**
1. Dashboard surfaces "Private inbox: 2 escalated".
2. Click → red-chip rows.
3. WhatsApp instructor → confirm availability → return → **Take over** → Approve.

### 2.13 Check-in `/admin/check-in`

**Business logic**
- Standalone surface (also embedded inside Today). Persistent **scan area** (simulated camera in mockup) + **Manual entry** (booking ID) + **Walk-in** quick-add.
- Live session selector at top — defaults to the currently-active class.
- Audit row written per check-in action.

### 2.14 Invoices `/admin/invoices`

**Business logic**
- List: id, client, item, issued, total, GST, status. Filter by date range, client, item type.
- Detail: full line items, **Resend**, **Void**, **Mark refunded** (state-only — actual money out-of-app), **Edit item description** (for support clarity).

### 2.15 Promos & referrals `/admin/promos`, `/admin/referrals`

**Business logic**
- **Promos**: code, discount type (% / flat), validity, applicable products, usage cap, per-user cap. Blacklist abusive codes.
- **Referrals**: referrer / referee graph, attribution status (`Registered` / `Converted`), reward audit (S$20 credit issuance per conversion). Reward amount editable. Manual mark-conversion override.

### 2.16 Marketing / Site CMS `/admin/marketing`

**Business logic**
- Editor for the public marketing surface (home page on the client side):
  - Hero (eyebrow, headline, rotating words, subhead, CTAs).
  - Locations (per-location: address, photo, hours).
  - Feature tiles (6 slots: title, copy, icon).
  - FeatureDeepDive blocks (image + bullets + CTA).
  - Testimonial.
  - CTA banner.
- Versioned with **CMS history** (revert to prior). Saved as the live marketing data the client app reads.

**Why it exists**
Yoga Sadhana staff change copy and imagery seasonally without a code deploy.

### 2.17 Notifications `/admin/notifications`

**Business logic**
- Per-event template editor. Single **Email** column in v1 (no WhatsApp / SMS / push).
- Variable token catalog (e.g., `{{client.firstName}}`, `{{class.startAt}}`).
- Each event: factory template (super-admin owned) + studio override. Studio admin edits override.
- **Resend** action on a sent notification (support recovery).

Event catalog (v1, all email): `register-verify-phone`, `register-verify-email`, `forgot-password`, `waiver-required`, `waiver-expired`, `booking-confirmed`, `booking-cancelled` (in/out of window), `class-cancelled`, `workshop-confirmed`, `private-request-received`, `private-request-approved`, `private-request-declined`, `private-request-expired`, `package-purchased`, `package-lapsing-soon`, `package-expired`, `referral-earned`, `refund-request-received`.

### 2.18 Waivers `/admin/waivers`

**Business logic**
- List: every client + waiver state (signed / lapsed / expired) + signed version.
- Per-client **Reset waiver** (forces re-sign on next booking; mandatory reason).
- Bulk reset is super-admin only (legal-change path).

### 2.19 Audit log `/admin/audit`

**Business logic**
- Read-only stream. Filters: actor, role, target type, action, date range.
- Each row: actor, role, impersonated_by (if any), action, target, reason, timestamp.
- 24-month retention in-app; archived after.

### 2.20 Reports `/admin/reports`

**Business logic**
- Tabbed: **Attendance**, **Revenue**, **Membership**, **Teaching log**, **Class ratings**, **Inbox throughput**, **Referral attribution**.
- Standard filter set across all: date-range presets (7d / 30d / 90d / current month / last month / custom), location (All / Breadtalk / Outram), **Export to CSV**.

| Report | Detail |
|---|---|
| Attendance | Class fill rate, no-show rate, by class type / location / time-of-day / instructor. Trend over period. |
| Revenue | Package sales by type / location / period; payment method mix; outstanding balances; workshop ticket revenue (separate line). |
| Membership | Active / expired / lapsing-soon clients; bundle vs unlimited mix; signed vs lapsed waivers; churn signals (no booking 30/60/90d). |
| Teaching log | Classes scheduled / completed / cancelled per instructor per period. Powers external pay. |
| Class ratings | Avg rating per class, per instructor (post-class survey). |
| Inbox throughput | Refund / cancellation / private-session counts and time-to-resolution by state. |
| Referral attribution | Referrer → referee → first-purchase conversion rate. |

### 2.21 Settings `/admin/settings`

**Business logic**
- Sub-pages:
  - **Studio profile** — name, logo, brand colours, footer copy.
  - **Locations** — per-location: address, photo, hours, contact, room/capacity defaults.
  - **Policy** — single editable record: cancellation windows per booking type (§0.5), no-show fee, late-cancel fee, repeated-cancellation rule copy.
  - **Hours** — studio operating hours per location (informs Schedule slot validation).
  - **Admin users** — list + peer-add other studio admins; force-logout; password reset.
  - **Waiver** — current legal text; version bump.
  - **Branding** — receipt branding, email-template header/footer.

---

## 3. Instructor portal surfaces

Instructor sees a **subset** of the admin app, scoped to `instructor_id = self`. No location chip. No financial surfaces. No settings. No notification editor.

### 3.1 Today `/admin/today`

Live next-class roster + check-in for own classes. Same UI as studio admin's Today; data is row-filtered.

### 3.2 Schedule `/admin/schedule`

Calendar of own assigned classes. Read-only on instances (cannot edit capacity, cancel, reassign — escalates to studio admin).

### 3.3 Roster `/admin/sessions/[id]/roster`

Per-class roster: client first name + check-in state. **No** membership / invoice / credit info — privacy boundary.

### 3.4 Availability `/admin/availability`

**Business logic**
- Editable working-hours blocks per day, per location. Save → constrains slots clients can request a private with this instructor on `/private-sessions`.
- Per-day overrides for vacations / sick days.
- Default to studio operating hours from Settings.

**User journey (weekly availability update)**
1. Open Availability → set / edit blocks for the week ahead.
2. Add per-day overrides for next vacation.
3. Save → client `/private-sessions` slot picker reflects within the next render.

### 3.5 Private-session inbox `/admin/private/inbox`

Own pending requests only. Same shape as §2.12 minus the "take over" action (instructor sees only own; studio admin sees all + can take over).

**Business logic**
- Approve (optional note) → booking confirmed, 1 session deducted from client.
- Decline (mandatory reason) → client gets `private-request-declined.email` with reason.
- If no action within SLA: at SLA – 6h, system pings studio admin (escalation). At SLA expiry → request `expired`, client notified to re-submit.

### 3.6 Profile `/admin/profile`

Editable bio, photo, per-session rate (subject to admin override per §0.7 — rate edits flag for admin review).

### 3.7 Teaching log `/admin/teaching-log`

History of own classes by state (scheduled / completed / cancelled). Read-only. Informs external pay calc on the studio admin side (§4.3).

### 3.8 Class ratings `/admin/ratings`

Aggregate per own class; no peer comparison; no per-client rating drill-through (anonymized).

---

## 4. Super-admin surfaces

Super-admin **never sees** a Refund button, credit-adjust, schedule editor, package editor, or any business action surface in their own context. To act, they impersonate a studio admin.

### 4.1 System health `/super/health`

Service status, error rates, recent deploys, queue depths (notifications pending, audit ingestion).

### 4.2 Feature flags `/super/flags`

Platform-level toggles (e.g., enable WhatsApp-channel preview, enable v2 reports). Audit row per flip.

### 4.3 Notification factory templates `/super/templates`

Edit the **canonical** email template library + variable token catalog. Studio admins inherit + override (§2.17). Super-admin cannot edit a studio override.

### 4.4 Studio-admin accounts `/super/admins`

Create, peer-add, force-logout, password reset, MFA enrollment.

### 4.5 Audit `/super/audit`

Read-only mirror of studio audit log + super-admin own action log + impersonation events. Cannot edit.

### 4.6 Impersonate `/super/impersonate`

Pick a studio admin → enter their session with persistent banner (§0.9). Used to action a refund / credit grant / schedule edit on their behalf when supporting them.

### 4.7 Bulk waiver reset `/super/waivers/reset`

Single-action mass waiver reset with mandatory reason. Used when waiver legal text changes. Single audit row at platform level + per-client trigger row.

### 4.8 Reports (read-only) `/super/reports`

Read-only mirror of v1 report set for diagnostics. CSV export of PII is gated — must impersonate to export rows containing client identifiers.

---

## 5. End-to-end user journeys

### 5.1 Front-desk shift (studio admin)

1. Lands on `/admin`. Glances at Today's classes + Needs attention feed.
2. Opens **Today** → confirms instructor present → scans QR codes as clients arrive → marks any walk-ins (manual-grant if needed).
3. Returns to dashboard → triages **Refund inbox** new rows: opens each, reviews invoice + booking context, replies on WhatsApp, marks **Resolved** with PayNow ref or **Declined** with notes.
4. Same flow for **Cancellation inbox**.
5. Triages **Private-session inbox** escalations (red SLA chip): WhatsApps instructor → confirms availability → takes over → approves on behalf of instructor.

### 5.2 Weekly schedule build (studio admin)

1. Opens **Schedule** → weekly view → **Bulk-generate from template** for next 4–8 weeks.
2. Reviews instructor-availability conflict drawer.
3. Resolves: reassign / reduce capacity / cancel single instance.
4. Saves → bulk schedule write.

### 5.3 Monthly close (studio admin)

1. Opens **Reports** → **Revenue** → last calendar month → CSV export.
2. Same for **Attendance**, **Membership**, **Teaching log**.
3. Computes instructor pay externally from Teaching log → disburses externally.
4. Reviews **Audit log** for the month: sanity-checks credit grants, refund decisions, schedule cancellations.

### 5.4 Instructor day

1. Lands `/admin/today` → sees own next class roster.
2. Checks in arrivals (own classes only).
3. Opens **Private-session inbox** → approves / declines pending requests.
4. Opens **Availability** → updates next week's blocks.

### 5.5 Super-admin routine

1. Lands `/super/health` → checks service status, queue depths.
2. Toggles a feature flag → audit row recorded.
3. Studio admin pings for support on a stuck refund → super-admin **Impersonate** → resolves in studio admin context → exits impersonation.

### 5.6 Bulk waiver reset (super-admin)

1. Legal flags new waiver text.
2. Super-admin **Impersonates** a studio admin → updates waiver text in Settings → bumps version → exits impersonation.
3. Super-admin → **Bulk waiver reset** → mandatory reason → confirms.
4. All clients flagged for re-sign on next booking. Single platform-level audit row + per-client trigger rows.

---

## 6. UX principles

- **Single design language.** Cream / terracotta / sage palette; DM Serif Display headings, Outfit body, JetBrains Mono for codes/IDs. No one-off visual motifs per surface.
- **Inbox-shape consistency.** Refund / cancellation / private-session inboxes share row anatomy, state chips, detail-drawer pattern, action vocabulary. Pick up one, pick up all.
- **Audit timeline anywhere there's history.** Client profile, invoice detail, session detail, instructor profile — same timeline component.
- **Mandatory-reason fields are the discipline.** Every destructive or financial state change forces a free-text reason. The audit row is only as useful as the reason.
- **Location chip on every list with a physical-presence dimension** — never silent inclusion of the other location.
- **No sub-roles, no per-page permission.** Studio admin = flat. Instructor = row-level scope, full stop. The mockup must reflect that — no greyed-out actions for "permission" reasons within a role.
- **Out-of-app flows look like inboxes, not buttons.** No "Refund" button anywhere. No "Cancel membership" button anywhere. No "Pay instructor" button anywhere.

---

## 7. Demo data shape

Seed JSON in the admin app (mockup-only). One file per entity. Cross-referenced by id.

`tenants.json` (single record), `locations.json`, `admin-users.json`, `clients.json`, `instructors.json`, `session-templates.json`, `sessions.json` (instances), `bookings.json`, `walk-ins.json`, `client-packages.json`, `products.json`, `promos.json`, `invoices.json`, `availability-templates.json`, `availability-blockoffs.json`, `private-requests.json`, `referral-codes.json`, `referral-events.json`, `audit-log.json`, `notification-templates.json`, `broadcasts.json`, `announcements.json`, `marketing-cms.json`, `cms-history.json`, `feature-flags.json`, `super-tenants.json` (n=1).

Default seed populates: 2 locations, 4 instructors, 30 clients, 6 class templates, 4 weeks of generated instances (~120 sessions), 3 active workshops, 5 packages, 8 invoices, 3 open refund rows, 2 open cancellation rows, 4 pending private requests (1 escalated), an audit log of ~50 entries.

---

## 8. Out of scope (v2+)

Named explicitly so they are not inferred as v1 commitments:

- WhatsApp / SMS / web push channels for outbound notifications.
- WhatsApp Business API templates and approval flow.
- In-app refund processing. Refunds stay out-of-app **permanently**.
- In-app membership cancellation. Cancellation stays out-of-app **permanently**.
- Auto-renewing memberships.
- Native mobile app; mobile-optimized check-in app.
- Marketing funnel analytics (page views → registration → first purchase).
- Cohort retention analysis.
- Custom date-range builder, saved reports, scheduled report email.
- Heatmap / capacity-planning suggestions.
- Mandarin / Tamil localization. English only in v1.
- Per-location-locked studio admin sub-role.
- Approval ladder / dual-signoff for refunds.
- Tenant entity, slug routing, plan/billing layer, "For Business" surface — none of these exist in this single-studio product.
- Real authentication (seeded admin session in mockup), real Stripe integration, real QR scanning, real email sending, cross-app state sync with the client portal.
