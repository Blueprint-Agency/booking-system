# Frontend Design Document — Teeko Booking Platform (Phase 1 Prototype)

**Product:** Booking & Management SaaS Platform
**Version:** 1.0
**Date:** March 29, 2026
**Status:** Draft
**Audience:** Design / Engineering / Client Stakeholder
**Author:** TBD

---

## 1. Overview

### 1.1 Purpose

This document defines the complete frontend specification for the Phase 1 clickable prototype. It covers every page, component, user flow, and design token needed to build a testable interface — without any backend dependency.

The prototype lets stakeholders navigate real pages with mock data, testing all user flows (booking, cancellation, check-in, admin operations) before backend development begins.

### 1.2 Scope

- **Client booking portal** — public-facing session browser + authenticated account area
- **Admin dashboard** — full operations backend covering all PRD features
- **Instructor portal** — schedule, compensation, leave (3 pages)
- **Staff portal** — check-in scanner, leave (2 pages)
- **Total**: 48 unique routes across 4 portals

### 1.3 Technical Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Components | shadcn/ui |
| Charts | Recharts |
| Forms | React Hook Form + Zod |
| QR Code | qrcode.react |
| Dates | date-fns |
| Animations | Motion (framer-motion) |
| Data | Hardcoded JSON fixtures |

### 1.4 Design Direction

**Warm Minimal** — clean and modern with warm tones (cream, terracotta, sage). Premium and calm. The aesthetic is aligned with the existing documentation portal and evokes trust without being sterile.

**Content**: Generic SaaS placeholder content (not themed to a specific business type). Session names, instructor names, and categories are neutral to show the platform's flexibility across business types.

---

## 2. Design System

### 2.1 Color Palette

Derived from the existing `docs/html/index.html` design tokens.

#### Core

| Token | Value | Usage |
|-------|-------|-------|
| `--ink` | `#1a1a2e` | Primary text, dark backgrounds |
| `--paper` | `#faf9f6` | Page background |
| `--warm` | `#f5f0e8` | Subtle backgrounds, input fields |
| `--card` | `#ffffff` | Card surfaces |
| `--border` | `#e2ddd5` | Dividers, card borders |
| `--muted` | `#8b8b8b` | Secondary text, captions, placeholders |

#### Accent

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#c4956a` | Primary CTA, links, active states |
| `--accent-deep` | `#a67548` | Hover states, emphasis text |
| `--accent-glow` | `#e8c9a8` | Light accent backgrounds, highlights |

#### Nature

| Token | Value | Usage |
|-------|-------|-------|
| `--sage` | `#7a8f72` | Success, confirmation, available status |
| `--sage-light` | `#e8ede6` | Success backgrounds |

#### Status

| Token | Value | Usage |
|-------|-------|-------|
| `--status-warning` | `#d4a843` | Waitlist, late, pending |
| `--status-warning-bg` | `#faf3e0` | Warning backgrounds |
| `--status-error` | `#c45a5a` | Cancelled, no-show, error |
| `--status-error-bg` | `#fdf0f0` | Error backgrounds |
| `--status-info` | `#5a8ac4` | Informational badges |
| `--status-info-bg` | `#eef4fb` | Info backgrounds |

#### Admin Sidebar

| Token | Value | Usage |
|-------|-------|-------|
| `--sidebar-bg` | `#1a1a2e` | Dark sidebar background |
| `--sidebar-text` | `#b8b8cc` | Inactive menu items |
| `--sidebar-active` | `#ffffff` | Active menu item text |
| `--sidebar-hover` | `#2a2a4e` | Hover background |
| `--sidebar-accent` | `#c4956a` | Active indicator bar |

### 2.2 Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Display headings | DM Serif Display | 400 | Page titles, hero text, section headers |
| Body / UI | Outfit | 300–700 | All interface text, buttons, labels, navigation |
| Mono / Data | JetBrains Mono | 400–500 | IDs, timestamps, invoice numbers, metrics, code |

**Type Scale**: 11 · 12 · 13 · 14 · **16 (base)** · 18 · 20 · 24 · 28 · 32 · 40 · 48 px

**Line Heights**: Headings 1.2, Body 1.6, UI 1.4

### 2.3 Spacing

**Base unit**: 4px

**Scale**: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 px

### 2.4 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `sm` | 8px | Badges, small elements |
| `md` | 12px | Inputs, buttons |
| `lg` | 16px | Cards, modals |
| `xl` | 24px | Large containers |
| `full` | 9999px | Pills, avatars |

### 2.5 Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `soft` | `0 2px 20px rgba(26,26,46,0.06)` | Cards at rest |
| `hover` | `0 8px 40px rgba(26,26,46,0.10)` | Cards on hover |
| `modal` | `0 16px 64px rgba(26,26,46,0.16)` | Modals, sheets |

### 2.6 Motion

| Context | Duration | Easing |
|---------|----------|--------|
| Interactions (buttons, toggles) | 200ms | ease |
| Hover transitions | 300ms | ease |
| Page enter animations | 600ms | ease-out |
| Stagger delay per item | 80ms | — |

---

## 3. Page Inventory

### 3.1 Client Portal — 18 Routes

| Route | Page | Auth Required |
|-------|------|:---:|
| `/` | Landing / marketing page | No |
| `/login` | Login form | No |
| `/register` | Registration form | No |
| `/verify-email` | Email verification status | No |
| `/forgot-password` | Password reset request | No |
| `/reset-password` | Password reset form | No |
| `/sessions` | Session discovery (list + calendar toggle) | No* |
| `/sessions/[id]` | Session detail + booking CTA | No* |
| `/checkout` | Stripe Checkout simulation | Yes |
| `/booking/confirmation` | Booking confirmation | Yes |
| `/waiver` | Digital waiver signing | Yes |
| `/account` | Account overview / upcoming bookings | Yes |
| `/account/history` | Booking history | Yes |
| `/account/packages` | Active packages | Yes |
| `/account/membership` | Membership details | Yes |
| `/account/invoices` | Invoice list | Yes |
| `/account/profile` | Profile settings | Yes |
| `/account/qr` | My QR code | Yes |

*Enhanced UI when logged in (package pricing, booking actions)

### 3.2 Admin Dashboard — 25 Routes

| Route | Page |
|-------|------|
| `/admin` | Analytics dashboard home |
| `/admin/sessions` | Session list / management |
| `/admin/sessions/new` | Create session form |
| `/admin/sessions/[id]` | Edit session |
| `/admin/sessions/[id]/roster` | Session roster + attendance |
| `/admin/schedule` | Calendar schedule view |
| `/admin/bookings` | All bookings list |
| `/admin/clients` | Client CRM list |
| `/admin/clients/[id]` | Client profile detail (tabbed) |
| `/admin/check-in` | QR code scanner |
| `/admin/products` | Packages / memberships / drop-in config |
| `/admin/products/new` | Create product form |
| `/admin/products/[id]` | Edit product |
| `/admin/invoices` | Invoice list |
| `/admin/invoices/[id]` | Invoice detail |
| `/admin/instructors` | Instructor list |
| `/admin/instructors/[id]` | Instructor profile + compensation config |
| `/admin/instructors/compensation` | Compensation report |
| `/admin/staff` | Staff list |
| `/admin/leave` | Leave requests queue |
| `/admin/staff-calendar` | Staff/instructor availability calendar |
| `/admin/policies` | Business policy configuration |
| `/admin/sales` | Sales & commission reports |
| `/admin/settings` | Tenant settings (branding, notifications) |

### 3.3 Instructor Portal — 3 Routes

| Route | Page |
|-------|------|
| `/instructor` | My schedule |
| `/instructor/compensation` | My compensation report |
| `/instructor/leave` | My leave requests |

### 3.4 Staff Portal — 2 Routes

| Route | Page |
|-------|------|
| `/staff/check-in` | QR scanner |
| `/staff/leave` | My leave requests |

---

## 4. Navigation & Information Architecture

### 4.1 Client Portal — Top Navigation Bar

```
┌───────────────────────────────────────────────────────────┐
│  [Logo: Teeko]      Sessions    Pricing    [Login/Avatar]  │
└───────────────────────────────────────────────────────────┘
```

**States:**
- **Unauthenticated**: Logo | Sessions | Pricing | Login button
- **Authenticated**: Logo | Sessions | My Bookings | Avatar dropdown → Account, My QR, Logout
- **Mobile (< 768px)**: Logo | Hamburger → slide-out drawer with all links

**Behavior**: Sticky top, transparent on landing hero → solid on scroll. Always solid on interior pages.

### 4.2 Admin Dashboard — Sidebar + Top Bar

```
┌──────────┬────────────────────────────────────────────────┐
│          │  [Breadcrumbs]                [Search] [Avatar] │
│  SIDEBAR ├────────────────────────────────────────────────┤
│          │                                                │
│ Dashboard│               PAGE CONTENT                     │
│ Sessions │                                                │
│ Clients  │                                                │
│ Team     │                                                │
│ Finance  │                                                │
│ Settings │                                                │
│          │                                                │
└──────────┴────────────────────────────────────────────────┘
```

**Sidebar sections** (collapsible groups):

| Section | Items |
|---------|-------|
| Dashboard | Analytics home |
| Sessions | Session list, Schedule, Check-in |
| Clients | Client list, Bookings |
| Team | Instructors, Staff, Leave requests, Staff calendar |
| Finance | Products, Invoices, Compensation, Sales |
| Settings | Policies, Tenant settings |

**Sidebar behavior:**
- Full width: 240px with labels
- Collapsed (tablet): 56px icon-only mode
- Hidden (mobile): hamburger toggle, slides over content
- Dark background (`--sidebar-bg: #1a1a2e`)
- Active item: white text + left accent bar (`--sidebar-accent`)

### 4.3 Role Switcher (Development Aid)

A floating pill anchored to the bottom-right corner. Allows the reviewer to switch between Client / Admin / Instructor / Staff views instantly without logging in/out. Only visible in prototype mode.

---

## 5. Client Portal — Page Specifications

### 5.1 Landing Page (`/`)

**Purpose**: Marketing page that communicates the platform value proposition.

**Layout:**
- **Hero**: Headline (DM Serif Display, 48px) + subtitle (Outfit, 18px, muted) + two CTAs: "Browse Sessions" (accent, filled) and "Get Started" (accent, outlined)
- **Features grid**: 3–4 benefit cards (easy booking, real-time availability, flexible packages, mobile check-in) with icons
- **Pricing preview**: 3 tier cards — Drop-in, Package, Membership — showing summary pricing with "Learn More" links
- **Footer**: Navigation links, copyright, business info

**Responsive**: Single column on mobile, stacked hero, swipeable pricing cards.

### 5.2 Auth Pages

All auth pages share the same layout: centered card (max-width 400px) on `--warm` background.

#### Login (`/login`)
- Email + password fields
- "Remember me" checkbox
- "Forgot password?" link
- Divider: "or continue with"
- Google OAuth button
- "Don't have an account? Create one" link
- Form validation: inline error messages, loading state on submit

#### Register (`/register`)
- Full name, email, phone, password, confirm password
- Terms & conditions checkbox with link
- "Create Account" button
- "Already have an account? Log in" link

#### Verify Email (`/verify-email`)
- Illustration (envelope icon)
- "Check your inbox" heading + instruction text
- "Resend verification email" link with cooldown timer

#### Forgot Password (`/forgot-password`)
- Email field + "Send Reset Link" button
- Success state: "If an account exists, we've sent a reset link"

#### Reset Password (`/reset-password`)
- New password + confirm password fields
- Password strength indicator
- "Reset Password" button

### 5.3 Session Discovery (`/sessions`)

**Purpose**: Browse and filter available sessions.

**Layout:**
- **Filter bar** (top): Category dropdown, Instructor dropdown, Level dropdown, Date range picker
- **View toggle**: List (default) | Calendar — icon buttons
- **Result count**: "Showing 12 sessions"

**List View** — vertical stack of session cards, sorted by date ascending:

```
┌──────────────────────────────────────────┐
│  [Category Tag]  [Level Badge]           │
│  Session Name                  status •  │
│  Mon, Apr 7 · 10:00 AM · 60 min         │
│  Instructor Name                         │
│  4 spots left              [$25 / Pkg ✓] │
└──────────────────────────────────────────┘
```

**Session Card details:**
- Category tag: pill badge in `--accent-glow`
- Level badge: Beginner (sage) / Intermediate (info) / Advanced (accent-deep)
- Status indicator: `Open` (sage dot) | `Waitlist` (warning dot) | `Full` (muted dot) | `Cancelled` (error dot, strikethrough)
- Price: dollar amount, OR "Included in Package" if client has active package
- Spots remaining: count with visual urgency (< 3 spots: warning color)

**Calendar View** — weekly grid:
- Columns: Mon–Sun
- Rows: hourly time slots (7 AM – 9 PM)
- Sessions as colored blocks (category-based coloring)
- Click block → navigates to session detail

**Mobile:**
- Filters collapse to a "Filters" button → opens bottom sheet
- List view: full-width cards
- Calendar view: horizontal scroll with day selector

### 5.4 Session Detail (`/sessions/[id]`)

**Purpose**: Full session information + booking action.

**Layout:**
- **Header**: Session name (DM Serif Display, 28px), category tag, level badge, type badge (Regular/Workshop/Event)
- **Schedule block**: Date, time, duration, recurrence note (e.g., "Every Monday")
- **Instructor card**: Avatar, name, short bio
- **Capacity bar**: Visual progress bar (booked/total), "X spots remaining" text
- **Description**: Session description text (if any)
- **CTA area**: Context-dependent button

**CTA States:**

| Client State | Button |
|-------------|--------|
| Spots available + has package | "Book Now — Use Package" (sage, filled) |
| Spots available + no package | "Book Now — $25" (accent, filled) |
| Full + waitlist enabled | "Join Waitlist (Position #N)" (warning, outlined) |
| Full + no waitlist | "Session Full" (muted, disabled) |
| Already booked | "You're Booked ✓" (sage, disabled) + "Cancel Booking" text link |
| On waitlist | "On Waitlist (Position #N)" (warning, disabled) + "Leave Waitlist" text link |
| Not logged in | "Log In to Book" (accent, filled) |

### 5.5 Checkout (`/checkout`)

**Purpose**: Simulated Stripe Checkout for drop-in / package / membership purchases.

**Layout** (two-column, stacked on mobile):
- **Left**: Order summary — item name, quantity, price, subtotal, total
- **Right**: Mock payment form — card number, expiry, CVC, name on card, "Pay $XX" button
- Success → redirects to `/booking/confirmation`

### 5.6 Digital Waiver (`/waiver`)

**Purpose**: Collect digital signature before first booking.

**Layout:**
- **Waiver document**: Scrollable container with rich text content (terms, liability, policies)
- **Signature area** (below document):
  - "Type your full name as your electronic signature" label
  - Full name input field
  - "I Agree" button — **disabled** until: (a) scrolled to bottom of document, AND (b) name field is not empty
- **Success state**: "Waiver Signed" confirmation card with checkmark, date/time, "Continue to Booking" button

### 5.7 Booking Confirmation (`/booking/confirmation`)

**Layout**: Centered success card:
- Large checkmark icon (sage)
- "Booking Confirmed" heading
- Session details: name, date, time, instructor
- Package balance update (if applicable): "9 sessions remaining"
- "Add to Calendar" link (mock)
- "View My Bookings" button → `/account`

### 5.8 Account Pages (`/account/*`)

**Layout**: Sidebar sub-navigation (desktop) or horizontal tab bar (mobile) linking to all account sections.

#### Account Overview (`/account`)
- **Quick stats row**: Next session (date/time), Active package (sessions left), Membership status
- **Upcoming bookings list**: Session cards with "Cancel" and "Reschedule" action buttons
- Empty state: "No upcoming bookings — Browse Sessions" link

#### Booking History (`/account/history`)
- **Table/list**: Session name, Date, Time, Attendance status badge
- Attendance badges: `Attended` (sage), `Late` (warning), `No-Show` (error)
- Date range filter
- Empty state: "No past bookings yet"

#### My Packages (`/account/packages`)
- **Package cards**: Name, sessions remaining (circular progress ring), expiry date, purchase date
- Expired packages shown greyed out with "Expired" badge
- "Browse Packages" CTA if none active

#### Membership (`/account/membership`)
- **Current plan card**: Plan name, price/month, next billing date, sessions used this month (if limited)
- "Cancel Membership" button → confirmation dialog with consequences text
- If no membership: "View Plans" CTA

#### Invoices (`/account/invoices`)
- **Table**: Invoice number (mono font), date, description, amount, status badge (Paid/Pending)
- Each row: "Download PDF" action
- Empty state: "No invoices yet"

#### Profile (`/account/profile`)
- **Form sections**:
  - Personal info: Full name, email (read-only with lock icon), phone
  - Password change: Current password, new password, confirm new password
- "Save Changes" button with loading state

#### My QR Code (`/account/qr`)
- **Large QR code** centered on page (generated from mock client_id)
- "Show this QR code at the front desk for check-in" instruction text
- Brightness boost hint: "Tip: increase your screen brightness for faster scanning"

### 5.9 Cancellation / Reschedule Flow

**Trigger**: "Cancel" button on any upcoming booking card.

**Cancellation dialog:**
1. Session details summary (name, date, time)
2. Policy outcome — one of:
   - **Within window**: "You're cancelling more than 12 hours in advance. Your session credit will be returned to your package."
   - **Outside window (forfeit)**: "You're cancelling within 12 hours of the session. Per the studio's cancellation policy, your session credit will be forfeited."
   - **Outside window (fee)**: "Late cancellation fee of $X will be charged."
3. "Confirm Cancellation" (error color) and "Keep Booking" buttons

**Reschedule**: Cancel dialog includes "Reschedule Instead?" link → redirects to `/sessions` with relevant filters pre-applied. Reschedule is treated as cancel + new booking per PRD.

---

## 6. Admin Dashboard — Page Specifications

### 6.1 Analytics Dashboard (`/admin`)

**Purpose**: At-a-glance business health overview.

**Layout:**

**Stat Cards** (top, 3-column grid on desktop / 2-column on tablet / 1-column on mobile):

| Card | Data | Detail |
|------|------|--------|
| Total Revenue | $12,450 | +8.2% vs last month |
| Active Clients | 142 | Trend arrow |
| Session Occupancy | 78% | Mini sparkline |
| No-Show Rate | 4.2% | Trend arrow |
| Package Sales | 23 | This month count |
| New Signups | 18 | This month count |

**Chart Widgets** (2x2 grid below stats):

1. **Revenue over time** — Line chart with day/week/month toggle
2. **Top Sessions** — Horizontal bar chart, top 5 by attendance
3. **Client Activity** — Donut chart: active vs inactive
4. **Occupancy Trend** — Area chart over 30 days

**Global date range filter** at top-right applies to all widgets.

### 6.2 Session Management

#### Session List (`/admin/sessions`)

**Data table columns**: Name, Category, Level, Type, Instructor, Date/Time, Capacity (progress bar: booked/total), Status badge

**Actions**: Filter by category, instructor, type, status, date range. "+ New Session" primary button.

**Row actions**: Edit, View Roster, Cancel Session (with confirmation)

#### Create / Edit Session (`/admin/sessions/new`, `/admin/sessions/[id]`)

**Multi-section form:**

| Section | Fields |
|---------|--------|
| Basic Info | Name (text), Category (select + create new), Level (select: Beginner/Intermediate/Advanced/N/A), Type (select: Regular/Workshop/Event) |
| Schedule | Date (date picker), Start time (time picker), Duration in minutes (number), Recurrence (select: None/Weekly/Bi-weekly/Custom) |
| Capacity | Max spots (number), Waitlist enabled (toggle), Max waitlist size (number, shown when waitlist enabled) |
| Pricing | Drop-in price (currency input), Package-eligible (toggle) |
| Instructor | Select from instructor list (searchable select) |
| Late Cutoff | Minutes after start (number), or "Use global default" checkbox |

**Recurrence editing**: When editing a recurring session, dialog prompt: "Apply to this session only" or "All future sessions"

### 6.3 Session Roster (`/admin/sessions/[id]/roster`)

**Purpose**: View and manage bookings + attendance for a specific session.

**Layout:**
- **Session summary header**: Name, date, time, instructor, capacity bar (e.g., "12 / 15 spots filled")
- **Roster table**:

| Column | Content |
|--------|---------|
| Client Name | Linked to client profile |
| Booking Status | Confirmed / Waitlisted |
| Check-in Status | Pending (muted) / Attended (sage) / Late (warning) / No-Show (error) |
| Package Used | Package name or "Drop-in" |
| Actions | Mark Attended / Late / No-Show (dropdown) |

- **Bulk action**: "Mark All Attended" button (top of table)
- **"+ Add Client"** button: Opens client search modal. Admin override — bypasses capacity limit.
- **"Remove"** action per row: Confirmation dialog, no cancellation policy applied (admin override)

### 6.4 Schedule Calendar (`/admin/schedule`)

**Layout**: Full calendar view with week/month toggle.
- Sessions displayed as colored blocks (category-based coloring)
- Click any session block → navigates to its roster page
- **Filters**: Instructor, Category (applied as calendar overlays)
- **Navigation**: Previous/Next week/month arrows, "Today" button

### 6.5 Booking Management (`/admin/bookings`)

**Data table**: Client Name, Session Name, Date, Booking Status, Check-in Status, Package Used, Booked At.
- Search by client or session name
- Filter by status, check-in status, date range
- Row action: View session roster

### 6.6 Client CRM

#### Client List (`/admin/clients`)

**Data table columns**: Name, Email, Phone, Membership Status, Active Package, Last Booking Date, Activity Status, Tags

**Search**: By name, email, or phone
**Filters**: Membership status (active/inactive/none), Package status (has active/expired/none), Activity (active/inactive), Tags (multi-select)
**Bulk actions**: "Export CSV", "Send Email" (mock)
**Row action**: Click → client profile

#### Client Profile (`/admin/clients/[id]`)

**Tabbed layout** with 6 tabs:

**Overview tab:**
- Contact info: name, email, phone
- Key stats: Registration date, Total sessions attended, No-show count, Activity status badge
- Tags: Editable inline tag chips (click to add/remove). Example tags: VIP, New, Injured
- Quick actions: "Add to Session", "Add Package"

**Bookings tab:**
- Upcoming bookings list with cancel action
- Past bookings list with attendance status

**Packages & Membership tab:**
- Active packages: name, sessions remaining (progress bar), expiry date
- Manual actions: "+ Add Sessions", "- Deduct Sessions" with quantity input
- Membership: plan name, billing date, status
- Manual action: "Extend Package" (change expiry date)

**Invoices tab:**
- Invoice table for this client only
- Same columns as main invoice list

**Waiver tab:**
- Signed status: Yes/No badge
- If signed: date, time, waiver version, "View Waiver PDF" link
- If not signed: "Waiver not yet signed" warning

**Notes tab:**
- Timestamped admin notes list (newest first)
- Each note: author, date/time, text content
- "Add Note" textarea + submit button at top

### 6.7 QR Check-In Scanner (`/admin/check-in`)

**Purpose**: Staff/Admin scans client QR codes to mark attendance.

**Layout:**
- Camera viewfinder area (mock — shows placeholder graphic)
- "Scan QR Code" instruction text
- **Mock scan buttons** (since camera won't work in prototype):
  - "Simulate: Attended" → green result
  - "Simulate: Late" → yellow result
  - "Simulate: No Booking" → red result
  - "Simulate: Cutoff Exceeded" → red result
  - "Simulate: Already Checked In" → orange result

**Result Cards:**

| State | Card Color | Content |
|-------|-----------|---------|
| Attended | Green (`--sage`) | Client name, session name, "Checked In" + timestamp |
| Late | Yellow (`--status-warning`) | Client name, session name, "Checked In (Late)" + timestamp |
| No Booking | Red (`--status-error`) | "No booking found for this client" |
| Cutoff Exceeded | Red (`--status-error`) | "Check-in blocked — late cutoff exceeded. Marked as No-Show." |
| Already Checked In | Orange (`--status-warning`) | Client name, "Already checked in at [time]" |

Each result card has a "Scan Next" button to reset.

### 6.8 Products Management (`/admin/products`)

**Layout**: Three tabs — **Drop-in** | **Packages** | **Memberships**

**Each tab**: Card grid of configured products.

**Product Card:**
- Product name
- Price (formatted)
- Details: session count + expiry for packages; monthly price + session limit for memberships
- Active/Inactive badge
- Edit / Deactivate actions

**Create / Edit form** (`/admin/products/new`, `/admin/products/[id]`):

| Field | Type |
|-------|------|
| Name | text |
| Type | select: Drop-in / Package / Membership |
| Price | currency |
| Session count | number (packages/memberships) |
| Expiry days | number (packages only) |
| Sessions per month | number (memberships, or "Unlimited" toggle) |
| Description | textarea |
| Active | toggle |

### 6.9 Invoice Management

#### Invoice List (`/admin/invoices`)

**Data table**: Invoice # (mono font), Client Name, Date, Amount, Status (Paid/Pending badge), Actions (View, Download PDF)

**Filters**: Date range, Status, Client search

#### Invoice Detail (`/admin/invoices/[id]`)

**Invoice preview layout** (printable):
- Business logo + name (from tenant settings)
- Invoice number, issue date
- Client name + contact info
- Line items table: description, quantity, unit price, amount
- Subtotal, total
- Payment method, payment date
- Status badge

### 6.10 Instructor Management

#### Instructor List (`/admin/instructors`)

**Display**: Cards or table — Name, contact, sessions this month, total earnings this month
**Action**: "+ Add Instructor" button

#### Instructor Profile (`/admin/instructors/[id]`)

- **Bio section**: Name, email, phone, bio text
- **Assigned sessions**: List of upcoming sessions for this instructor
- **Compensation config form**:

| Field | Type | Description |
|-------|------|-------------|
| Base pay per session | currency | Fixed amount per session taught |
| Per-client commission | currency | Amount per attending client |
| Revenue commission | percentage | % of session revenue |
| Extra hour rate | currency | For sessions exceeding standard duration |
| Workshop/event rate | currency | Override rate for non-regular sessions |

### 6.11 Compensation Report (`/admin/instructors/compensation`)

**Layout:**
- **Date range picker** at top
- **Table per instructor**: Sessions taught, Total clients attended, Earnings breakdown (base, per-client, revenue %, extra hours, workshops), Total earnings
- **Summary row**: Totals across all instructors
- **"Export CSV"** button

### 6.12 Staff Management (`/admin/staff`)

**Data table**: Name, Role, Email, Status (Active/Deactivated badge)
**"+ Add Staff"** button → modal form: Name, Email, Role (select: Staff / Instructor)
**Row actions**: Deactivate / Reactivate

### 6.13 Leave Management (`/admin/leave`)

**Layout**: Three tabs — **Pending** | **Approved** | **Rejected**

**Leave Request Card:**
- Staff/instructor name + avatar
- Leave type badge: Annual (info) / Sick (warning) / Other (muted)
- Date range: start – end date
- Notes from requester
- Submitted date

**Pending tab actions:**
- "Approve" button (sage) + optional comment field
- "Reject" button (error) + optional comment field

**Status badges**: Pending (warning), Approved (sage), Rejected (error)

### 6.14 Staff Calendar (`/admin/staff-calendar`)

**Layout**: Calendar showing all staff/instructor schedules + approved leave blocks.
- Color-coded by person
- Leave blocks shown as hatched/striped overlays
- Date range navigation (week/month)
- Filter by specific staff member

### 6.15 Business Policies (`/admin/policies`)

**Layout**: Four collapsible accordion sections. Each section has its own "Save" button.

#### Cancellation Policy

| Field | Type | Default |
|-------|------|---------|
| Cancellation window | number (hours) | 12 |
| Late cancel penalty | select: None / Forfeit Session / Charge Fee | Forfeit Session |
| Late cancel fee amount | currency (shown when "Charge Fee" selected) | — |
| Count late cancel as no-show | toggle | Off |

#### No-Show Policy

| Field | Type | Default |
|-------|------|---------|
| Auto-mark no-show after cutoff | toggle | On |
| No-show threshold (per 30 days) | number | 3 |
| Threshold action | select: None / Warning Email / Booking Block | Warning Email |

#### Waitlist Policy

| Field | Type | Default |
|-------|------|---------|
| Auto-promote on cancellation | toggle | On |
| Waitlist enabled by default | toggle | On |
| Default max waitlist size | number (blank = unlimited) | — |

#### Late-Entry Policy

| Field | Type | Default |
|-------|------|---------|
| Late cutoff (minutes after session start) | number | 10 |
| Block check-in after cutoff | toggle | On |

### 6.16 Sales & Commission (`/admin/sales`)

**Layout:**
- **Date range filter**
- **Summary stat cards**: Total revenue, Total commissions
- **Sales table**: Staff name, Bookings processed, Package sales count, Total sales value, Commission rate (% or flat), Commission earned
- **"Export CSV"** button

### 6.17 Tenant Settings (`/admin/settings`)

**Layout**: Three sections.

**Branding:**
- Logo upload area (drag & drop)
- Business name (text input)
- Primary color picker (with preview)
- Subdomain display (read-only, e.g., "yourbusiness.platform.com")

**Notifications:**
- Toggle switches for each email notification trigger (per PRD §6):
  - Booking confirmed, Booking cancelled (client), Booking cancelled (admin), Waitlist promotion, Payment successful, Waiver reminder, No-show warning, Leave request submitted, Leave approved/rejected

**General:**
- Timezone (select)
- Currency (select)
- Default session duration (number, minutes)

---

## 7. Key User Flows

### Flow 1: Client Books a Session

```
/sessions → Browse/Filter → Click session card
  → /sessions/[id] → View details
    → "Book Now" CTA
      → [If first booking] → /waiver → Sign → Return
      → [If paying] → /checkout → Mock payment → Success
      → [If using package] → Direct booking
    → /booking/confirmation → Success
    → Session appears in /account → Upcoming bookings
```

### Flow 2: Client Cancels a Booking

```
/account → Upcoming bookings list
  → Click "Cancel" on a booking
  → Confirmation dialog appears
    → Shows policy outcome (credit returned / forfeited / fee)
  → "Confirm Cancellation"
  → Booking removed from upcoming list
  → Toast: "Booking cancelled"
```

### Flow 3: Client Joins Waitlist

```
/sessions/[id] → Session is full
  → "Join Waitlist (Position #3)" CTA
  → Confirmation: "You've been added to the waitlist"
  → Booking appears in /account with "Waitlisted" badge
  → [Mock: another client cancels]
  → Notification: "You've been promoted from the waitlist!"
  → Booking status changes to "Confirmed"
```

### Flow 4: Admin Creates a Recurring Session

```
/admin/sessions → Click "+ New Session"
  → /admin/sessions/new → Fill form
    → Name, Category, Instructor, etc.
    → Recurrence: "Weekly on Monday, Wednesday, Friday"
    → Set capacity, pricing
  → Save
  → Sessions appear in /admin/sessions list
  → Sessions appear on /admin/schedule calendar
  → Can edit one occurrence or all future
```

### Flow 5: QR Check-In

```
/admin/check-in → Scanner ready state
  → "Simulate Scan" → Select scenario
    → [Attended] → Green card: "Checked In"
    → [Late] → Yellow card: "Checked In (Late)"
    → [No Booking] → Red card: "No booking found"
    → [Cutoff] → Red card: "Marked as No-Show"
    → [Already In] → Orange card: "Already checked in"
  → "Scan Next" → Reset to ready state
```

### Flow 6: Admin Manages a Client

```
/admin/clients → Search by name
  → Click client row → /admin/clients/[id]
  → Overview tab: View stats, edit tags
  → Packages tab: Add sessions to package
  → Notes tab: Add a private admin note
  → Waiver tab: Check waiver status
  → Bookings tab: Review attendance history
```

### Flow 7: Leave Request Cycle

```
/instructor/leave → "Request Leave" button
  → Form: Type, Start date, End date, Notes
  → Submit → Shows in pending list

/admin/leave → Pending tab
  → Review request details
  → "Approve" with comment → Status changes to Approved
  → Leave block appears on /admin/staff-calendar
```

---

## 8. Component Library

### 8.1 Shared Components (used across portals)

| Component | Description |
|-----------|-------------|
| `SessionCard` | Compact session display for list views — name, time, instructor, capacity, status |
| `StatusBadge` | Colored pill badge for statuses: Open, Waitlist, Full, Cancelled, Attended, Late, No-Show, Pending, Active, Inactive, etc. |
| `CapacityBar` | Visual progress bar showing booked/total spots |
| `DateRangePicker` | Date range selection with calendar popover |
| `FilterBar` | Horizontal row of filter dropdowns with clear/reset |
| `EmptyState` | Illustration + message + optional CTA for empty lists |
| `PageHeader` | Page title (DM Serif Display) + breadcrumbs + action buttons |
| `StatCard` | Metric card: large number, label, trend indicator (arrow + percentage) |
| `DataTable` | Sortable, filterable table with pagination and row actions |
| `ConfirmDialog` | Modal dialog for destructive action confirmation |
| `Toast` | Success/error/info notification (bottom-right, auto-dismiss) |
| `RoleSwitcher` | Floating bottom-right pill for switching user roles |
| `LoadingSkeleton` | Shimmer placeholder matching component shapes |

### 8.2 Client-Specific Components

| Component | Description |
|-----------|-------------|
| `SessionCalendar` | Weekly calendar grid view with time slots and session blocks |
| `BookingCard` | Upcoming/past booking display with actions (cancel, reschedule) |
| `PackageCard` | Package display with circular progress ring and expiry info |
| `MembershipCard` | Membership plan display with billing info and cancel option |
| `InvoiceRow` | Invoice table row with download PDF action |
| `WaiverForm` | Scrollable document + typed-name signature + agree button |
| `QRDisplay` | Large QR code renderer with instruction text |
| `CheckoutForm` | Mock Stripe payment form (card fields + pay button) |
| `AccountNav` | Sidebar (desktop) / tab bar (mobile) for account section navigation |

### 8.3 Admin-Specific Components

| Component | Description |
|-----------|-------------|
| `AdminSidebar` | Collapsible dark sidebar with grouped navigation |
| `AdminTopBar` | Breadcrumbs + search bar + profile avatar |
| `ChartWidget` | Wrapper for Recharts with title, date toggle, responsive sizing |
| `RosterTable` | Session attendance table with bulk mark + individual status dropdowns |
| `ClientProfileTabs` | Tabbed layout for client detail (6 tabs) |
| `ScannerView` | QR scanner mock with viewfinder graphic + result state cards |
| `PolicyForm` | Collapsible policy section with labeled form fields and save button |
| `CompensationTable` | Instructor earnings breakdown table with totals |
| `LeaveRequestCard` | Leave request display with approve/reject action buttons |
| `ProductCard` | Package/membership/drop-in product card for admin view |
| `SessionForm` | Multi-section form for creating/editing sessions |
| `CalendarView` | Full-page calendar for schedules/availability (week + month modes) |

### 8.4 shadcn/ui Components to Install

Button, Card, Dialog, DropdownMenu, Input, Label, Select, Textarea, Table, Tabs, Badge, Avatar, Separator, Sheet, Tooltip, Switch, Checkbox, RadioGroup, Calendar, Popover, Command, Skeleton, Sonner (toasts), ScrollArea, Progress, Form, Collapsible, Accordion

---

## 9. Responsive Strategy

### 9.1 Breakpoints

| Width | Name | Target |
|-------|------|--------|
| 375px | `xs` | Small phones (iPhone SE) |
| 640px | `sm` | Large phones |
| 768px | `md` | Tablets (iPad portrait) |
| 1024px | `lg` | Small laptops / iPad landscape |
| 1280px | `xl` | Desktop |
| 1536px | `2xl` | Large screens |

### 9.2 Client Portal (mobile-first)

| Breakpoint | Behavior |
|------------|----------|
| < 768px | Single column layout. Top nav collapses to hamburger drawer. Filters open as bottom sheet. Session cards full-width. Account nav becomes horizontal tab bar. |
| 768px–1024px | Two-column grids where appropriate. Expanded top nav. Filter bar inline. |
| > 1024px | Full desktop layout. Account sidebar navigation visible. Three-column grids for pricing/packages. |

### 9.3 Admin Dashboard (sidebar layout)

| Breakpoint | Behavior |
|------------|----------|
| < 768px | Sidebar hidden behind hamburger toggle (slides over content). All content single column. Stat cards stack vertically. Charts full-width. |
| 768px–1024px | Collapsed icon-only sidebar (56px). Content area with 2-column grids for stat cards and charts. |
| > 1024px | Full sidebar (240px) with labels. Content area with 3-column stat cards, 2-column charts. |

---

## 10. Mock Data Schema

### 10.1 Fixture Files

All fixtures stored in `/src/data/` as JSON files with corresponding TypeScript types in `/src/types/`.

| File | Records | Purpose |
|------|:-------:|---------|
| `sessions.json` | 20 | Session catalog with varied categories, levels, instructors, statuses |
| `clients.json` | 20 | Client profiles with varied activity levels, packages, tags |
| `bookings.json` | 50 | Booking records linking clients to sessions, varied statuses |
| `instructors.json` | 4 | Instructor profiles with different compensation structures |
| `staff.json` | 3 | Staff accounts (1 admin, 2 staff) |
| `products.json` | 7 | 2 drop-in, 3 packages, 2 memberships |
| `client-packages.json` | 8 | Active/expired packages for various clients |
| `invoices.json` | 15 | Invoice records with line items |
| `leave-requests.json` | 6 | Mix of pending, approved, rejected requests |
| `analytics.json` | 1 | Monthly data arrays for dashboard charts |
| `policies.json` | 1 | Current business policy configuration |
| `tenant.json` | 1 | Business name, branding, timezone, currency |
| `users.json` | 4 | One mock user per role for role switcher |

### 10.2 Key Type Definitions

```typescript
// Core entity types (defined in /src/types/)

interface Session {
  id: string
  name: string
  category: string
  level: 'beginner' | 'intermediate' | 'advanced' | 'all'
  type: 'regular' | 'workshop' | 'event'
  instructorId: string
  capacity: number
  bookedCount: number
  waitlistCount: number
  date: string        // ISO date
  time: string        // HH:mm
  duration: number    // minutes
  price: number
  status: 'scheduled' | 'cancelled' | 'completed'
  recurrence: string | null  // RRULE or null
  waitlistEnabled: boolean
  waitlistMaxSize: number | null
  lateCutoffMinutes: number | null
  packageEligible: boolean
  description: string
}

interface Client {
  id: string
  name: string
  email: string
  phone: string
  registeredAt: string
  activityStatus: 'active' | 'inactive'
  noShowCount: number
  totalSessions: number
  tags: string[]
  waiverSigned: boolean
  waiverSignedAt: string | null
  waiverVersion: string | null
}

interface Booking {
  id: string
  clientId: string
  sessionId: string
  status: 'confirmed' | 'cancelled' | 'waitlisted'
  checkInStatus: 'pending' | 'attended' | 'late' | 'no-show'
  packageId: string | null
  createdAt: string
}

interface Product {
  id: string
  name: string
  type: 'drop-in' | 'package' | 'membership'
  price: number
  sessionCount: number | null
  expiryDays: number | null
  sessionsPerMonth: number | null  // null = unlimited
  description: string
  active: boolean
}

interface Invoice {
  id: string
  clientId: string
  invoiceNumber: string
  date: string
  amount: number
  status: 'paid' | 'pending'
  paymentMethod: string
  items: { description: string; quantity: number; unitPrice: number; amount: number }[]
}

interface Instructor {
  id: string
  name: string
  email: string
  phone: string
  bio: string
  compensation: {
    basePerSession: number
    perClientCommission: number
    revenueCommissionPercent: number
    extraHourRate: number
    workshopRate: number
  }
}
```

### 10.3 Data Relationships

```
sessions.instructorId     → instructors.id
bookings.clientId         → clients.id
bookings.sessionId        → sessions.id
bookings.packageId        → client-packages.id
client-packages.clientId  → clients.id
client-packages.productId → products.id
invoices.clientId         → clients.id
leave-requests.staffId    → staff.id | instructors.id
```

---

## 11. Implementation Order

### Phase A — Foundation
1. Initialize Next.js App Router with TypeScript + Tailwind
2. Install and configure shadcn/ui (warm minimal theme)
3. Set up CSS variables matching the design system palette
4. Import Google Fonts (DM Serif Display, Outfit, JetBrains Mono)
5. Create client portal layout (top nav + page shell)
6. Create admin dashboard layout (sidebar + top bar + content area)
7. Create all mock data JSON fixtures + TypeScript types
8. Build shared components: StatusBadge, StatCard, PageHeader, EmptyState, RoleSwitcher

### Phase B — Client Core
1. Landing page (hero, features, pricing preview)
2. Auth pages (login, register, verify, forgot/reset password)
3. Session discovery (list view + calendar view + filters)
4. Session detail (all CTA states)
5. Checkout simulation
6. Digital waiver
7. Booking confirmation

### Phase C — Client Account
1. Account layout with sub-navigation
2. Upcoming bookings with cancel/reschedule
3. Booking history
4. Packages + Membership pages
5. Invoices
6. Profile settings
7. QR code page

### Phase D — Admin Core
1. Analytics dashboard (stat cards + charts)
2. Session management (list + CRUD forms)
3. Session roster + attendance
4. Schedule calendar
5. QR check-in scanner (mock states)

### Phase E — Admin CRM
1. Client list (search, filter, bulk actions)
2. Client profile (all 6 tabs)
3. Bookings management

### Phase F — Admin Team & Finance
1. Instructor management + compensation config
2. Compensation report
3. Staff management
4. Leave management (approve/reject flow)
5. Staff calendar
6. Products management
7. Invoice management
8. Sales & commission reports

### Phase G — Admin Settings + Sub-portals
1. Business policies configuration
2. Tenant settings
3. Instructor portal (3 pages)
4. Staff portal (2 pages)

### Phase H — Final Polish
1. Responsive pass on all pages (375px–1536px)
2. Loading skeleton states
3. Page enter animations (fadeUp with stagger)
4. Empty states for all lists
5. Edge case displays (error states, no data, expired)
6. Full navigation walkthrough test

---

## 12. Open Decisions

| # | Question | Impact |
|---|----------|--------|
| 1 | Should the prototype include dark mode toggle? | Design system would need dark variants for all tokens |
| 2 | How realistic should calendar interactions be? (Drag to reschedule, etc.) | Implementation complexity for admin schedule view |
| 3 | Should email notification templates be visually mocked? | Additional pages for email preview |
| 4 | Include a "Pricing" public page separate from landing? | Additional client portal route |
