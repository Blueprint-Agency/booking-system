# Admin Portal — Product Requirements Document

**Product:** Yoga Sadhana Admin Portal
**Version:** 2.0 (pillar realignment)
**Date:** April 20, 2026
**Status:** Draft
**Audience:** Product Manager / Engineering Team
**Author:** TBD

> **v2.0 change:** Admin IA is realigned to the three client-facing pillars — **Classes**, **Workshops**, **Private Sessions** — to mirror `fe-client/`. Generic surfaces (`/schedule`, `/bookings`, `/catalog/*`, `/requests`) are dissolved into pillar-scoped sub-pages. Cross-cutting pages (Clients, Instructors, Locations, Invoices, Reports, Check-in, Settings) are unchanged in role but regrouped in the sidebar.

---

## 1. Product Overview

### 1.1 Purpose

Build a dedicated admin portal for Yoga Sadhana staff to operate the studio — manage the class schedule, handle private-session requests, check clients in, adjust credits, issue refunds, and maintain the product catalog. The portal complements the client booking portal defined in `prd-phase1.md`.

### 1.2 Goal

Replace the manual back-office work currently done through Reserv + spreadsheets with a single-screen operations tool. Staff should be able to run a typical studio day — check people in, respond to a private-session inquiry, cancel a class and auto-refund credits, or edit a workshop — without leaving the portal.

### 1.3 Phase & Status

This is a **clickable frontend mockup** with no backend. Mock data lives inside the admin app. Demo targets: Yoga Sadhana owner walkthrough, internal UX review.

### 1.4 Out of Scope

- Real authentication (seeded admin session, no password enforcement).
- Real Stripe integration (invoices and refunds are mocked).
- Real QR scanning (camera view is simulated; manual booking-ID entry works).
- Cross-app state sync with `fe/` (client portal). Each app demos in isolation.
- Content/CMS editing of marketing pages.
- Platform-level super-admin (managing tenants across the SaaS).
- Role tiers. All admin users are equal ("flat" role model).

---

## 2. User Role

Single role: **Admin**. Any authenticated admin user can perform every action in the portal. Seeded admin accounts in `admin-users.json`.

| Permission | Admin |
|---|:---:|
| View and edit schedule (classes, workshops) | ✓ |
| Create / edit / archive packages and workshops | ✓ |
| View roster and check clients in | ✓ |
| Approve / decline private-session requests | ✓ |
| View and edit client profiles | ✓ |
| Manually adjust client credits (with audit reason) | ✓ |
| View invoices and issue refunds | ✓ |
| Manage instructors and locations | ✓ |
| Edit email notification templates | ✓ |
| View reports (attendance, revenue) | ✓ |
| Manage other admin users | ✓ |

---

## 3. Architecture

### 3.1 App Placement

New Next.js App Router project at `fe-admin/`, sibling to `fe/`. Own `package.json`, own `node_modules`, own Vercel deploy. Repository root remains non-workspace.

### 3.2 Design System

Mirrors `fe/` exactly. Tailwind v4 (`@import "tailwindcss"` + `@theme` tokens in `globals.css` — no `tailwind.config.js`). Palette: paper `#f5f6fa`, ink `#0d1a3e`, accent indigo `#1a2a7a`, cyan `#5fbfd9`, sage `#5b7a68`, warning `#c99a3a`, error `#b55151`. Fonts: Manrope (400/500/600/700/800) + JetBrains Mono. `globals.css` is **copied verbatim** from `fe/src/app/globals.css` at scaffold time. Admin may diverge locally where density requires (denser tables, tighter padding) but never changes the token values — any new token is added to both apps.

### 3.3 Mock Data & State

- `fe-admin/src/data/*.json` — seeded JSON for every entity the admin touches.
- `fe-admin/src/lib/mock-state.ts` — in-memory mutable store that wraps JSON for client-side mutation during a session. Resets on page reload.
- `fe-admin/src/lib/mock-auth.ts` — seeded admin session. Login screen accepts any seeded email + any password.

### 3.4 Deployment

- `fe/` → existing Vercel project (client portal).
- `fe-admin/` → new Vercel project.
- `docs/html/` → unchanged static docs deploy via root `vercel.json`.

---

## 4. Information Architecture

Sidebar layout, persistent on desktop, collapsible drawer on mobile. Top of the sidebar shows the three client-facing pillars (Classes / Workshops / Private Sessions); each pillar page uses a tab row for its sub-views. Everything else is cross-cutting.

### 4.1 Pillar map (mirror of `fe-client`)

| fe-client surface | Admin pillar | Admin entry route |
|---|---|---|
| `/classes`, `/account/classes` | **Classes** | `/classes` |
| `/workshops`, `/account/workshops` | **Workshops** | `/workshops` |
| `/private-sessions`, `/account/private-sessions` | **Private Sessions** | `/private-sessions` |

Session-type filter is the canonical join: `Session.type === "regular"` → Classes; `"workshop" \| "event"` → Workshops; `"private"` → Private Sessions. Product-type filter for catalog sub-pages: `creditType === "class"` → Classes packages; `type === "workshop"` → Workshops catalog; `type === "private-pack"` → Private Sessions packs.

### 4.2 Routes

| Route | Page | Notes |
|---|---|---|
| `/login` | Admin sign-in | Pre-auth |
| `/` | Dashboard | Today's view across all pillars |
| **Core pillars** | | |
| `/classes` | Classes home | Redirects to `/classes/schedule` |
| `/classes/schedule` | Class schedule | Week/month calendar, regular sessions only |
| `/classes/schedule/[id]` | Class session detail | Roster + actions |
| `/classes/templates` | Class templates | Vinyasa, Yin, Hatha, etc. (recurring seed) |
| `/classes/packages` | Class packages | Drop-in, packs, memberships (creditType=class) |
| `/workshops` | Workshops list | Upcoming + past, status filter |
| `/workshops/[id]` | Workshop detail | Roster, ticket-tier sales, cancel |
| `/workshops/catalog` | Workshop catalog | Template workshop products (tiered pricing) |
| `/private-sessions` | Private Sessions home | Redirects to `/private-sessions/requests` |
| `/private-sessions/requests` | Requests inbox | SLA-sorted, grouped by status |
| `/private-sessions/requests/[id]` | Request detail | Approve/decline |
| `/private-sessions/upcoming` | Approved sessions | Calendar/list of approved PT sessions |
| `/private-sessions/packs` | PT packs catalog | type=private-pack products |
| **Operate** | | |
| `/check-in` | Check-in | QR scan + manual, cross-pillar |
| **Manage** | | |
| `/clients` · `/clients/[id]` | Clients | List + profile |
| `/instructors` · `/instructors/[id]` | Instructors | List + profile |
| `/locations` | Locations | CRUD |
| **Finance** | | |
| `/invoices` · `/invoices/[id]` | Invoices | Stripe mirror, refunds |
| `/reports` | Reports | Attendance, revenue, sell-through, no-show — with a pillar filter |
| **Settings** | | |
| `/settings` | Studio settings | Tabbed: Studio · Admin Users · Notifications · Waivers · Referrals |

### 4.3 Deprecated routes (dissolved in v2.0)

| Old route | Replacement |
|---|---|
| `/schedule` | `/classes/schedule` |
| `/schedule/[id]` | `/classes/schedule/[id]` (or `/workshops/[id]`, `/private-sessions/requests/[id]` depending on `session.type`) |
| `/bookings` | Deleted — bookings are only viewed inside a pillar's session roster; cross-pillar reporting moves to `/reports` |
| `/catalog/classes` | `/classes/templates` |
| `/catalog/packages` | Split: `/classes/packages` (class credit) and `/private-sessions/packs` (pt credit) |
| `/catalog/workshops` | `/workshops/catalog` |
| `/requests` · `/requests/[id]` | `/private-sessions/requests` · `/private-sessions/requests/[id]` |
| `/notifications` | `/settings` → Notifications tab |
| `/waivers` | `/settings` → Waivers tab |
| `/referrals` | `/settings` → Referrals tab |

---

## 5. Data Model

### 5.1 Reused from `fe/` (seeded fresh in `fe-admin/src/data/`)

`clients.json`, `instructors.json`, `locations.json`, `sessions.json`, `bookings.json`, `products.json`, `client-packages.json`, `memberships.json`, `invoices.json`, `tenants.json`, `users.json`.

### 5.2 Admin-specific additions

| File | Purpose |
|---|---|
| `admin-users.json` | Admin accounts (id, name, email, seeded password hash placeholder) |
| `session-templates.json` | Recurring class definition (type, instructor, location, day-of-week, time, capacity) — source of truth; generates `sessions.json` instances |
| `private-requests.json` | Private-session inbox (client, instructor preference, proposed times, status, SLA deadline, resolution notes) |
| `credit-adjustments.json` | Audit log of manual credit changes (client, delta, reason, admin id, timestamp) |
| `refunds.json` | Refund audit (invoice ref, amount, reason, admin id, timestamp) |
| `waiver-signatures.json` | Client, waiver version, signed-at |
| `email-templates.json` | Event key, subject, body with placeholders |
| `session-cancellations.json` | Audit of cancelled sessions and auto-refunded credits |

---

## 6. Functional Requirements

### 6.1 Authentication

- Seeded admin accounts. Sign-in form accepts any seeded email; password is not validated in the mockup.
- Session stored in `localStorage` with a single `admin-session` key.
- No role tiers; any signed-in admin sees the full portal.

### 6.2 Dashboard

- Today's classes with live attendance count (booked / capacity).
- Pending private-session requests count, with count of those under 2h SLA.
- Revenue snapshot for today, this week, this month.
- Quick links to Check-in and Requests.

### 6.3 Classes pillar (`/classes/*`)

Operates the recurring group-class life cycle.

**`/classes/schedule` — schedule calendar**
- Views: week (default), month. Shows only `Session.type === "regular"`.
- Create recurring class from a template; generates instances forward 12 weeks.
- One-off override: cancel a single instance or swap instructor for that date.
- Cancel session: writes `session-cancellations.json`, auto-refunds credits.

**`/classes/schedule/[id]` — class session detail**
- Roster table: client, package used, credit cost, booking status, check-in status.
- Actions: manual book, cancel booking, mark no-show, add note.

**`/classes/templates` — class templates**
- CRUD for class types (Vinyasa, Yin, Hatha, etc.) with default duration, capacity, credit cost.

**`/classes/packages` — class packages catalog**
- CRUD for `creditType === "class"` products: drop-in, packs, memberships. Active/archived toggle.

### 6.4 Workshops pillar (`/workshops/*`)

Operates discrete paid events. Each workshop is both a session and a sellable product (tiered ticketing lives on the session).

**`/workshops` — list**
- Filters: upcoming/past, date range, location, status.
- Columns: date, title, instructor, location, sold/capacity, revenue.

**`/workshops/[id]` — detail**
- Roster + check-in status.
- Ticket-tier panel: show each `workshopPackage` tier, sold-per-tier.
- Cancel workshop with refund flow.

**`/workshops/catalog` — workshop templates**
- CRUD for reusable workshop blueprints (title, default tiers, default capacity).

### 6.5 Private Sessions pillar (`/private-sessions/*`)

Operates the request-approval-session cycle for 1-on-1 / 2-on-1 PT.

**`/private-sessions/requests` — inbox**
- Sorted by SLA deadline, grouped by status (pending / approved / declined).
- SLA chip: green >6h, amber 2–6h, red <2h or overdue.

**`/private-sessions/requests/[id]` — request detail**
- **Accept:** admin picks final time from client's proposed slots; writes `Session` row with `type="private"`; notification log row added.
- **Decline:** reason required.

**`/private-sessions/upcoming` — approved sessions**
- List/calendar of `Session.type === "private"` with status=scheduled. Row click opens session detail (reuses roster component).

**`/private-sessions/packs` — PT packs catalog**
- CRUD for `type === "private-pack"` products (1-on-1, 2-on-1, VIP family-shareable). `creditType === "pt"`.

### 6.6 Check-in

- Cross-pillar. Mocked camera view with a "Simulate scan" button cycling through today's valid booking codes.
- Manual booking-ID input as fallback.
- On successful match: green confirmation, client name, session, updates booking `checkInStatus`.
- Recent check-ins list (last 20).

### 6.7 Clients

- List: searchable by name/email/phone; filters by package status, last-visit, referrer.
- Profile: upcoming + past bookings, active packages with credit balances and expiry, membership status, waiver status + version, referral stats, free-form notes.
- **Adjust credits:** modal with delta (+/-), reason (required), confirm. Writes `credit-adjustments.json` row. Visible on profile timeline.

### 6.8 Catalog (distributed across pillars)

Catalog surfaces live inside each pillar, not as a separate top-level section:
- Class templates → see §6.3 `/classes/templates`
- Class-credit packages, memberships, drop-in → see §6.3 `/classes/packages`
- Workshop templates → see §6.4 `/workshops/catalog`
- PT packs → see §6.5 `/private-sessions/packs`

### 6.9 Instructors

- CRUD profile: name, photo, bio, specialties, weekly availability window.
- Assignments view: upcoming classes, private-session requests routed to them.

### 6.10 Locations

- CRUD: name, address, room count, amenities, photo.
- Seeded with Breadtalk IHQ and Outram Park.

### 6.11 Invoices

- List mirrors `invoices.json`, filterable by date range, client, status.
- Detail shows Stripe-mock payload and line items.
- **Refund:** full or partial, reason required. Writes `refunds.json` row and visually marks the invoice.

### 6.12 Reports

- **Attendance heatmap:** class-type × weekday grid, color-intensity by fill rate.
- **Revenue:** by product type (packages / workshops / private / membership) over selectable period.
- **Package sell-through:** units sold vs available, per package, per period.
- **No-show rate:** overall and per instructor.
- All charts render from seeded data; export buttons are placeholders.

### 6.13 Settings (`/settings`)

Single page with tabbed sections. No separate top-level routes.

- **Studio:** profile (name, contact, hours), policy text (cancellation window, no-show rules).
- **Admin Users:** CRUD.
- **Notifications:** per-event email templates. One row per key (booking-confirmed, booking-cancelled, package-purchased, package-expiring-30d/15d/7d/1d/12h/2h, request-received, request-approved, request-declined, waiver-resign, workshop-reminder). Editor with subject + mustache body + live preview.
- **Waivers:** client waiver status (signed/outdated/unsigned), version bump triggers force-resign on next client login.
- **Referrals:** referrers view (code, sent, converted, reward) + referees view (referrer, first purchase, reward credited).

---

## 7. Cross-Cutting Requirements

### 7.1 Audit Trail

Every credit adjustment, refund, session cancellation, and waiver reset writes a row to the corresponding audit file. These rows surface on the relevant client / invoice / session detail page as a timeline.

### 7.2 SLA Timers

Private-session requests compute remaining time against a 12-hour deadline from submission. UI shows a live countdown chip (re-computed on render, no background timer).

### 7.3 Mock Persistence

All mutations go through `mock-state.ts` in-memory store. State resets on page reload. Seed data is rich enough that a reload still shows a realistic studio snapshot.

### 7.4 Design Density

Admin is denser than the client portal. Prefer tables to cards. Tighter vertical spacing. Reuse `fe/` primitives (badges, buttons, inputs) where they map 1:1.

### 7.5 Empty & Error States

Every list has empty-state copy and an illustration placeholder. Forms surface inline validation.

---

## 8. Success Criteria

- Owner walkthrough runs end-to-end: sign in → see today's dashboard → check a client in → approve a private request → cancel a class → confirm refunded credits appear on a client's profile.
- All 16 modules have a reachable, non-placeholder page.
- No runtime errors in a 10-minute click-through session.
- Visual consistency with `fe/` (same palette, typography, spacing scale).

---

## 9. Out of Scope (Future)

- Real auth, role tiers, per-instructor scope.
- Platform super-admin (multi-tenant Teeko operator console).
- Real Stripe, real QR scanning, real email sending.
- Mobile-optimized check-in app.
- Push notifications, SMS, WhatsApp integrations.
- Content/CMS editing.
- Analytics beyond the four reports above.
