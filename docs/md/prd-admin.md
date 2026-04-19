# Admin Portal — Product Requirements Document

**Product:** Yoga Sadhana Admin Portal
**Version:** 1.0
**Date:** April 20, 2026
**Status:** Draft
**Audience:** Product Manager / Engineering Team
**Author:** TBD

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

Sidebar layout, persistent on desktop, collapsible drawer on mobile.

| Route | Page | Notes |
|---|---|---|
| `/login` | Admin sign-in | Pre-auth |
| `/` | Dashboard | Today's view |
| `/schedule` | Schedule calendar | Week/month toggle |
| `/schedule/[id]` | Session detail | Roster + actions |
| `/bookings` | Bookings list | Flat, filterable |
| `/check-in` | Check-in | QR scan + manual |
| `/requests` | Private session requests | Inbox with SLA |
| `/requests/[id]` | Request detail | Approve/decline |
| `/clients` | Clients list | Search + filter |
| `/clients/[id]` | Client profile | Bookings, packages, credits, notes, waiver |
| `/catalog/packages` | Packages CRUD | Credit bundles, memberships, private packs |
| `/catalog/workshops` | Workshops CRUD | |
| `/catalog/classes` | Class templates | Types (Vinyasa, Yin, etc.) |
| `/instructors` | Instructors list | |
| `/instructors/[id]` | Instructor profile | Bio, availability |
| `/locations` | Locations CRUD | |
| `/invoices` | Invoices list | Stripe mirror, refund actions |
| `/invoices/[id]` | Invoice detail | |
| `/reports` | Reports dashboard | Attendance, revenue, sell-through |
| `/notifications` | Email templates | Per-event editor |
| `/waivers` | Waiver tracking | Signed list + version |
| `/referrals` | Referral tracking | Referrer + referee lists |
| `/settings` | Studio settings | Profile, policy, admin users |

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

### 6.3 Schedule

- **Views:** week (default), month.
- **Create recurring class:** pick template (class type, instructor, location, day/time, capacity); generates instances forward for 12 weeks.
- **One-off override:** cancel a single instance or swap instructor for that date.
- **Add workshop:** one-off session with price + capacity.
- **Cancel session:** marks session cancelled, writes `session-cancellations.json` row, auto-refunds credits to all booked clients (adjustment logged in `credit-adjustments.json` with reason "session cancelled").

### 6.4 Session Detail

- Roster table: client, package used, credit cost, status (booked / checked-in / no-show / cancelled).
- Actions: manual book (pick from client list), cancel booking, mark no-show, note.

### 6.5 Check-in

- Mocked camera view with a "Simulate scan" button cycling through today's valid booking codes.
- Manual booking-ID input as fallback.
- On successful match: green confirmation, client name, class, updates booking status to `checked-in`.
- Recent check-ins list (last 20).

### 6.6 Private Session Requests

- Inbox sorted by SLA deadline, grouped by status (pending / approved / declined).
- **SLA chip:** green >6h remaining, amber 2–6h, red <2h or overdue.
- **Accept:** admin picks final time from client's proposed slots; status → approved; notification is mocked (row added to a local notification log; no cross-app delivery).
- **Decline:** reason required; status → declined.

### 6.7 Clients

- List: searchable by name/email/phone; filters by package status, last-visit, referrer.
- Profile: upcoming + past bookings, active packages with credit balances and expiry, membership status, waiver status + version, referral stats, free-form notes.
- **Adjust credits:** modal with delta (+/-), reason (required), confirm. Writes `credit-adjustments.json` row. Visible on profile timeline.

### 6.8 Catalog

- **Packages:** CRUD for credit bundles, unlimited memberships, private-session packs. Fields per PRD phase 1 product schema. Active/archived toggle.
- **Workshops:** CRUD for one-off paid events.
- **Class templates:** CRUD for class types (Vinyasa, Yin, Hatha, etc.) with default duration, capacity, credit cost.

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

### 6.13 Notifications

- Template list: one row per event key (booking-confirmed, booking-cancelled, package-purchased, package-expiring-30d/15d/7d/1d/12h/2h, request-received, request-approved, request-declined, waiver-resign, workshop-reminder).
- Editor: subject + body, mustache-style placeholders (`{{client.firstName}}`, `{{session.date}}`, etc.).
- Live preview pane rendering with sample data.

### 6.14 Waivers

- List of clients with waiver status (signed / outdated / unsigned), version, signed-at.
- **Force re-sign on policy change:** admin bumps waiver version; all prior signatures marked outdated. Clients prompted to re-sign on next login (mocked).

### 6.15 Referrals

- **Referrers view:** client, code, referrals sent, converted, reward earned.
- **Referees view:** client, referrer, first purchase, reward credited.

### 6.16 Settings

- Studio profile (name, contact, hours).
- Policy text (cancellation window, no-show rules) — consumed by client portal in future integration.
- Admin users CRUD.

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
