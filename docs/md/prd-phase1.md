# Phase 1 — Product Requirements Document

**Product:** Booking & Management SaaS Platform
**Version:** 1.0
**Date:** March 28, 2026
**Status:** Draft
**Audience:** Product Manager / Engineering Team
**Author:** TBD

---

## 1. Product Overview

### 1.1 Problem Statement

**For businesses (tenants):** Class-based businesses — fitness studios, art workshops, cooking schools, music academies, and more — currently rely on generic booking tools (e.g., Reserv) that lack the flexibility to enforce business-specific policies, track instructor compensation, or provide meaningful analytics. Admin overhead is high due to manual attendance tracking, waitlist management, and payment reconciliation. Beyond operations, these businesses also lack a unified channel to reach new customers and increase their visibility.

**For customers (students):** Consumers looking for classes, workshops, and experiences have no single destination to discover and compare offerings across different providers and industries. They must visit each business's individual website, making discovery fragmented and inconvenient.

### 1.2 Product Goal

Build a **marketplace and multi-tenant SaaS platform** for class-based businesses. Booked4U serves two audiences:

1. **Businesses (tenants)** subscribe to a Booked4U plan to be listed on the marketplace and gain access to a full operations backend — booking management, payments, attendance, CRM, staff management, and reporting.
2. **Customers (students)** use the Booked4U marketplace to discover, browse, and book sessions across multiple tenants and industries from a single platform.

Each tenant also gets a dedicated profile page on the marketplace and a full admin backend. Students are not locked to a single tenant — they register once on Booked4U and can browse and book across any listed business.

Phase 1 delivers the marketplace, tenant onboarding, and the complete operational core.

### 1.3 Core Features — Phase 1 Scope

| Module | What It Delivers |
|---|---|
| **Platform Marketplace** | Public-facing directory at `booked4u.com`; browse tenants by industry/category/location; tenant profile pages with sessions; dual landing page for students and business owners |
| **Tenant Subscription** | Tiered subscription plans for businesses to join the marketplace; Stripe-powered billing; tenant onboarding flow |
| **Booking Portal** | Tenant-scoped booking experience; session discovery, calendar/list view, filters, 1–2 step booking flow (accessed after selecting a tenant from the marketplace) |
| **Authentication** | Client self-registration + email verification; Admin-created accounts for staff/instructors; JWT sessions |
| **Payments** | Stripe-only; drop-in (single session), packages (N-session bundles), and monthly memberships |
| **Session Management** | Create/edit sessions with recurrence (RRULE), capacity limits, waitlist config, late-entry rules; supports Regular, Workshop, and Event types |
| **Booking Management** | Session rosters, manual add/remove (admin), automated waitlist promotion, attendance status tracking |
| **Client CRM** | Full client profiles with package/membership status, attendance history, admin notes, and waiver records |
| **QR Check-In** | Per-client QR code; camera-based scanner in web app; auto late/no-show enforcement based on configurable cutoff |
| **Digital Waiver** | Admin-defined waiver; e-signature required on first booking; stored per client |
| **Policy Engine** | Configurable per tenant: cancellation windows, no-show penalties, waitlist rules, late-entry cutoff |
| **Instructor Management** | Assign to sessions, compensation tracking (base pay, per-client commission, revenue %, workshop rates); read-only reports |
| **Staff Management** | Staff accounts with scoped permissions, leave request/approval workflow, staff calendar |
| **Invoices** | Auto-generated PDF per payment; emailed to client; stored on profile; accessible by admin |
| **Analytics Dashboard** | Occupancy, revenue, client activity, package sales, no-show rate; date-range filterable |

### 1.4 Out of Scope — Phase 1

The following are explicitly deferred to Phase 2:

- Online / hybrid sessions (Zoom, recorded content)
- Referral program
- WhatsApp / SMS notifications
- Automated marketing campaigns
- Loyalty and points system
- PayNow and GrabPay payment methods

---

## 2. User Roles & Permissions

Clients (students) operate at the **platform level** — they register once on Booked4U and can browse/book across any tenant. All other roles (Instructor, Staff, Admin) are **tenant-scoped** — they belong to a specific business.

| Permission | Client | Instructor | Staff | Admin |
|---|---|---|---|---|
| Browse marketplace & discover tenants | ✓ | — | — | — |
| Browse & book sessions (any tenant) | ✓ | — | — | — |
| Cancel / reschedule own booking | ✓ | — | — | — |
| View own account & history (cross-tenant) | ✓ | — | — | — |
| View assigned schedule | — | ✓ | — | — |
| View own compensation report | — | ✓ | — | — |
| Scan QR / check in clients | — | — | ✓ | ✓ |
| Manual booking add/remove | — | — | ✓ | ✓ |
| View session rosters | — | — | ✓ | ✓ |
| Submit leave requests | — | ✓ | ✓ | — |
| Manage sessions & schedules | — | — | — | ✓ |
| Manage clients & CRM | — | — | — | ✓ |
| Manage staff & instructors | — | — | — | ✓ |
| Configure business policies | — | — | — | ✓ |
| View full analytics | — | — | — | ✓ |
| Approve / reject leave | — | — | — | ✓ |

---

## 3. Platform & Multi-Tenancy

### 3.1 Platform Level (Marketplace)

- The Booked4U marketplace lives at the platform domain (e.g., `booked4u.com`)
- Students register once on the platform and can browse and book across all listed tenants
- Student accounts, booking history, and payment methods are platform-level — not locked to a single tenant
- The marketplace provides tenant discovery by industry, category, and location

### 3.2 Tenant Level (Business Operations)

- Each tenant (business) subscribes to a Booked4U plan to be listed on the marketplace
- Tenant operational data is fully isolated (no cross-tenant data leakage for business data)
- Admin, staff, and instructor accounts are scoped to a single tenant
- Tenant-level configuration covers: policies, pricing, branding (logo, cover image, description), and notification settings
- Each tenant gets a public profile page on the marketplace showing their business info and available sessions

---

## 4. Functional Requirements

---

### 4.1 Platform Marketplace

The public-facing marketplace at `booked4u.com` serves as the primary entry point for both students and business owners.

#### Landing Page

The landing page addresses two audiences with a split value proposition:

- **For students**: "Discover and book classes, workshops, and experiences across providers — all in one place." CTA: "Explore Classes"
- **For businesses**: "List your studio on Booked4U and reach more customers." CTA: "List Your Business"

#### Tenant Discovery (Explore)

- Students can browse all listed tenants from the `/explore` page
- **Filters:**
  - Industry / category (e.g., Fitness, Arts & Crafts, Cooking, Music, Wellness, Education)
  - Location / area
  - Search by business name or keyword
- Each tenant is displayed as a card showing: business name, logo, cover image, industry tag, short description, rating (Phase 2), and number of upcoming sessions
- Clicking a tenant card navigates to the tenant's profile page

#### Tenant Profile Page (`/explore/[slug]`)

- Public page showing the tenant's business information: name, logo, cover image, description, location, industry
- Lists all upcoming sessions from this tenant (same session card format as the booking portal)
- Students can filter/browse sessions and proceed to book — this is the entry point into the tenant-scoped booking flow
- Only sessions from the selected tenant are shown

#### Cross-Tenant Student Experience

- Students register once on Booked4U and maintain a single account
- From their account, students can view bookings and history across all tenants
- Package and membership purchases remain tenant-scoped (a package bought from Studio A cannot be used at Studio B)
- Payment methods are stored at the platform level via Stripe

---

### 4.2 Tenant Subscription & Onboarding

#### Subscription Plans

Businesses subscribe to a Booked4U plan to be listed on the marketplace and access the admin backend. Plans are billed monthly via Stripe.

| Plan | What's Included |
|---|---|
| **Starter** | Marketplace listing, up to 5 active sessions, 1 admin account, basic analytics |
| **Growth** | Everything in Starter + unlimited sessions, up to 3 staff/instructor accounts, full analytics, priority support |
| **Professional** | Everything in Growth + unlimited staff accounts, custom branding, API access (Phase 2), dedicated support |

Plan limits and pricing are configured by the Booked4U platform team (not by tenants).

#### Tenant Onboarding Flow

1. Business owner clicks "List Your Business" on the landing page
2. Registration: business name, owner name, email, password
3. Business profile setup: industry, description, logo, cover image, location
4. Plan selection and payment via Stripe Checkout
5. On success: tenant is provisioned, admin account created, redirect to admin dashboard
6. Tenant listing goes live on the marketplace once profile is complete

#### Tenant Listing Status

- **Active**: subscription current, listing visible on marketplace
- **Incomplete**: profile not yet complete, listing hidden
- **Suspended**: subscription lapsed or payment failed, listing hidden, existing bookings honoured but no new bookings accepted

---

### 4.3 Authentication & Accounts

#### Client (Student) Registration — Platform Level
- Self-registration via email + password on `booked4u.com`
- OAuth login (Google) — optional at launch
- Email verification required before first booking
- Single account used across all tenants
- First booking with any tenant triggers that tenant's digital waiver flow (see §4.12)

#### Tenant (Business Owner) Registration — Platform Level
- Self-registration via "List Your Business" flow (see §4.2)
- Creates both a tenant and the first admin account
- Email verification required

#### Staff / Instructor / Admin Accounts — Tenant Level
- Created by tenant Admin only (no self-registration)
- Role assigned at creation: `admin`, `staff`, `instructor`
- Scoped to a single tenant
- Password reset via email link

---

### 4.4 Client Booking Portal

The tenant-scoped booking interface. Students reach this via the marketplace — either by browsing `/explore` and selecting a tenant, or by navigating directly to `/explore/[slug]`.

#### Session Discovery
- Default view: **list view** sorted by date/time ascending
- Toggle to **calendar view** (weekly layout)
- Filters:
  - Session category (multi-select)
  - Instructor (multi-select)
  - Level / tier (multi-select, if configured)
  - Date range picker
- Each session card displays:
  - Name, category, level
  - Date, time, duration
  - Instructor name
  - Spots remaining (real-time)
  - Price OR "Included in your package" if client has an active package
  - Status badge: `Open` | `Waitlist` | `Full` | `Cancelled`

#### Booking Flow
1. Client selects a session → detail modal/page shown
2. If spots available: "Book Now" CTA
3. If package balance > 0: deduct from package (no payment step)
4. If paying per session: proceed to Stripe Checkout
5. On success: confirmation screen + confirmation email sent
6. If session is full: "Join Waitlist" CTA — adds client to ordered waitlist queue

#### Waitlist
- Clients can join waitlist when session is at capacity
- When a booking is cancelled, the system automatically promotes the first waitlisted client:
  - Booking created for that client
  - Session deducted from their package (if applicable) or payment link sent
  - Notification email dispatched
- Clients can remove themselves from waitlist at any time

#### Cancellation / Reschedule (Client-side)
- Available from "My Bookings" in account area
- System checks cancellation policy (see §4.13) before allowing
- If within allowed window: booking cancelled, session credit returned to package or refund initiated
- If outside allowed window: policy penalty applied (session forfeited or fee charged)
- Reschedule = cancel + rebook (treated as a new booking for policy purposes)

---

### 4.5 Client Account

Platform-level account accessible post-login at `/account`. Shows data across all tenants the student has interacted with.

| Section | Contents |
|---|---|
| Upcoming Bookings | List of future bookings across all tenants, grouped by tenant, with cancel/reschedule action |
| Booking History | Past sessions across all tenants with attendance status |
| My Packages | Active packages per tenant: sessions remaining, expiry date, tenant name |
| Membership | Current membership plans per tenant, next billing date, cancel option |
| Invoices | List of all invoices across tenants; downloadable PDF |
| Profile | Name, email, phone, password change |
| My QR Code | Unique QR for check-in (see §4.11) |

---

### 4.6 Payments & Packages

#### Payment Methods (Phase 1)
- Credit / debit card via **Stripe Checkout**
- No other payment methods in Phase 1

#### Pricing Products (Admin-configurable)
| Type | Description |
|---|---|
| Drop-in | Single session purchase at fixed price |
| Package | Bundle of N sessions at fixed price; optional expiry date |
| Membership | Recurring subscription (monthly); grants N sessions/month or unlimited |

#### Purchase Flow
- Client selects a product → Stripe Checkout session created
- On `payment_intent.succeeded` webhook: entitlement granted, invoice generated
- Failed payments: retry handled by Stripe; client notified by email

#### Package / Membership Logic
- Package balance is decremented on each successful booking
- Expired packages cannot be used; sessions remaining are forfeited (unless admin manually extends)
- Memberships auto-renew monthly via Stripe Subscriptions
- Admin can manually add / deduct sessions from a client's package
- If client's package is exhausted during booking, system falls back to drop-in price

---

### 4.7 Invoice System

- Invoice auto-generated on every successful payment
- Invoice contains: invoice number, date, line items, amount, payment method, business name/logo
- Delivered to client's email immediately after payment
- Stored against client profile; downloadable as PDF
- Accessible to Admin from client profile or invoice list view
- No tax/GST calculation in Phase 1 (line items show pre-tax amounts)

---

### 4.8 Session & Schedule Management (Admin)

#### Session Object
| Field | Type | Notes |
|---|---|---|
| Name | string | Required |
| Category | string | Admin-defined taxonomy |
| Level | enum | Beginner / Intermediate / Advanced / N/A |
| Type | enum | Regular / Workshop / Event |
| Instructor | relation | Links to Instructor profile |
| Capacity | integer | Max bookable spots |
| Waitlist enabled | boolean | |
| Waitlist max size | integer | Nullable (unlimited if null) |
| Date / Time | datetime | |
| Duration | integer | Minutes |
| Recurrence rule | RRULE string | Nullable for one-off sessions |
| Late cutoff | integer | Minutes after start; inherited from global setting if null |
| Price (drop-in) | decimal | |
| Status | enum | Scheduled / Cancelled / Completed |

#### Recurrence
- Admin defines recurring sessions via RRULE (weekly, bi-weekly, custom)
- Editing a recurring session: prompt to apply change to "This session only" or "All future sessions"
- Cancelling a session: all bookings on that session are cancelled; clients notified by email

#### Session Types
- **Regular**: standard class with recurring support
- **Workshop / Event**: one-off; can have different pricing; not package-eligible by default (configurable)

---

### 4.9 Booking Management (Admin)

- View roster for any session: client name, booking status, check-in status, package used
- Manually add a client to a session (bypasses capacity limit — admin override)
- Manually remove a client from a session (no cancellation policy applied)
- Bulk attendance marking: mark all as Attended, or mark individually
- Attendance statuses: `Pending` → `Attended` | `Late` | `No-Show`
- Filter sessions by date, instructor, category, status

---

### 4.10 Client CRM (Admin)

#### Client Profile
| Field | Notes |
|---|---|
| Full name, email, phone | Core contact info |
| Registration date | Auto-set |
| Active package(s) | Sessions remaining, expiry |
| Active membership | Plan, renewal date |
| Total sessions attended | Lifetime count |
| No-show count | Lifetime count |
| Waiver | Signed status, date, file |
| Notes | Private admin notes (multi-entry with timestamps) |

#### Client List View
- Search by name / email / phone
- Filter by: membership status, package status, activity (active/inactive)

#### Activity Status Definition
- **Active**: at least 1 booking in the last 30 days
- **Inactive**: no bookings in the last 30 days

---

### 4.11 QR Code Check-In

#### Check-In Flow
1. Each client has a persistent unique QR code (encoded with their `client_id`)
2. Staff/Admin opens the check-in scanner (camera-based, web app)
3. Staff scans client's QR code
4. System validates:
   - Client has a booking for an active session (started ≤ X minutes ago)
   - Late cutoff not exceeded
5. On success: attendance status set to `Attended` (or `Late` if within late window); confirmation shown on screen
6. On failure states:
   - No booking found → error message
   - Late cutoff exceeded → block check-in; status set to `No-Show`; error message shown
   - Already checked in → warning message

#### Late Window Logic
- `late_window_minutes` is configurable per session (default: global setting, default global: 10 min)
- If `current_time > session_start + late_window_minutes`: check-in blocked, status = `No-Show`
- If `current_time > session_start` but within late window: check-in allowed, status = `Late`

---

### 4.12 Digital Waiver

- Waiver is a text document defined by Admin (HTML/rich text)
- Trigger: first time a client completes a booking (before payment confirmation) or on first login
- Client must scroll to bottom and click "I Agree" with typed full name (e-signature)
- Waiver signature record stores: client ID, timestamp, IP address
- Waiver PDF stored and accessible from client profile

---

### 4.13 Business Policy Engine

All policies are configured per tenant by Admin. System enforces them automatically.

#### Cancellation Policy
| Setting | Type | Default |
|---|---|---|
| Cancellation window | integer (hours) | 12 |
| Late cancel penalty | enum: `none` \| `forfeit_session` \| `charge_fee` | `forfeit_session` |
| Late cancel fee amount | decimal | — |
| Count late cancel as no-show | boolean | false |

#### No-Show Policy
| Setting | Type | Default |
|---|---|---|
| Auto-mark no-show after late cutoff | boolean | true |
| No-show threshold (per rolling 30 days) | integer | 3 |
| Threshold action | enum: `none` \| `warning_email` \| `booking_block` | `warning_email` |

#### Waitlist Policy
| Setting | Type | Default |
|---|---|---|
| Auto-promote on cancellation | boolean | true |
| Waitlist enabled by default for new sessions | boolean | true |
| Default max waitlist size | integer | null (unlimited) |

#### Late-Entry Policy
| Setting | Type | Default |
|---|---|---|
| Late cutoff (minutes after session start) | integer | 10 |
| Block check-in after cutoff | boolean | true |

---

### 4.14 Instructor Management (Admin)

#### Instructor Profile
- Name, contact details, bio (optional)
- Assigned sessions (view only from this screen)
- Compensation configuration:
  - Base pay per session (fixed amount)
  - Per-client commission (amount per attending client)
  - Revenue commission (% of session revenue)
  - Extra hour rate (for sessions over standard duration)
  - Workshop / event rate (override for non-regular sessions)

#### Compensation Report
- Per instructor: sessions taught in period, clients attended, calculated earnings broken down by rate type
- Date range filter
- Export to CSV
- **Read-only** — no payout processing in Phase 1

---

### 4.15 Staff Management (Admin)

#### Staff Accounts
- Role: `staff` (front-desk operations only)
- Admin creates/deactivates accounts
- Permissions: check-in, view rosters, manual booking add/remove

#### Leave Management
- Staff / Instructors can submit leave requests: type (annual/sick/other), date range, notes
- Admin sees pending requests in a queue
- Admin approves or rejects with optional comment
- Approved leave reflected in staff availability calendar
- No auto-blocking of sessions when leave approved (manual responsibility)

#### Staff Calendar
- View showing all staff/instructor working schedules and approved leave
- Date range navigation

---

### 4.16 Sales & Commission Tracking

- Each booking and package purchase records the `staff_id` of the staff member who processed it (if manually added by staff) — auto-bookings record null
- Sales report: groupable by staff member, date range
- Commission calculation: configurable rate per staff member (% of sales or flat per sale)
- Report is read-only; export to CSV

---

### 4.17 Analytics Dashboard (Admin)

| Widget | Data |
|---|---|
| Session occupancy rate | Avg % full per session; trend over time |
| Revenue | Total revenue by day/week/month; MRR for memberships |
| Top sessions | Sessions by attendance count |
| Client activity | Active vs. inactive count; new signups over time |
| Package sales | Revenue and volume by package type |
| No-show rate | No-shows / bookings ratio over time |

- Date range filter across all widgets
- All widgets are read-only in Phase 1 (no drill-down detail pages)

---

## 5. Non-Functional Requirements

| Requirement | Specification |
|---|---|
| Platform | Responsive web app (PWA) — no native app in Phase 1 |
| Browser support | Last 2 versions: Chrome, Safari, Firefox, Edge |
| Mobile | Mobile-first; all client-facing flows must work on 375px+ viewport |
| Performance | Core booking flow < 2s load time on 4G |
| Availability | 99.5% uptime target |
| Data isolation | Strict tenant-level row-level isolation for business data; student accounts are platform-level |
| Payments | PCI compliance delegated to Stripe; no card data stored on platform |
| Auth security | Passwords hashed (bcrypt); JWT expiry 15 min access / 7 day refresh |
| Email | Transactional email via provider TBD (SendGrid / Resend); triggers: booking confirmation, cancellation, waitlist promotion, invoice, waiver |

---

## 6. Email Notification Triggers

| Trigger | Recipient | Template |
|---|---|---|
| Booking confirmed | Client | Booking details, session info, cancellation policy |
| Booking cancelled (by client) | Client | Cancellation confirmation, policy outcome |
| Booking cancelled (by admin) | Client | Cancellation notice |
| Promoted from waitlist | Client | New booking confirmation |
| Payment successful | Client | Invoice attached |
| Waiver reminder | Client | Link to sign waiver |
| No-show warning threshold reached | Client | Warning / restriction notice |
| Leave request submitted | Admin | New request notification |
| Leave approved / rejected | Staff / Instructor | Decision notification |
| Tenant subscription confirmed | Business owner | Plan details, getting started guide |
| Tenant subscription payment failed | Business owner | Retry payment link |
| Tenant listing goes live | Business owner | Confirmation + marketplace link |

---

## 7. Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | What is the platform domain name? | Product | Open |
| 2 | Which email provider? SendGrid vs Resend | Engineering | Open |
| 3 | Should clients be able to transfer package credits to another client? | Product | Open |
| 4 | Membership pause feature needed in Phase 1? | Product | Open |
| 5 | Do workshop sessions consume package credits by default, or is it always drop-in? | Product | Open |
| 6 | Should the no-show booking block auto-lift, or require admin to manually clear? | Product | Open |
| 7 | Multi-location support needed within Phase 1? | Product | Open |
| 8 | What are the exact pricing tiers for tenant subscription plans (Starter/Growth/Professional)? | Product | Open |
| 9 | Should the marketplace show tenant ratings/reviews in Phase 1, or defer to Phase 2? | Product | Open |
| 10 | What industries/categories should be available at launch? | Product | Open |
| 11 | Should tenants have a free trial period before requiring a paid plan? | Product | Open |
| 12 | Do tenants get their own subdomain in addition to the marketplace listing, or marketplace-only in Phase 1? | Product | Open |
