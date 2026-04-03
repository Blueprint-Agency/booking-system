# Frontend Design Document — Yoga Sadhana Client Booking Portal (Phase 1 Prototype)

**Product:** Yoga Sadhana Client Booking Portal
**Version:** 1.1
**Date:** April 3, 2026
**Status:** Draft
**Audience:** Design / Engineering / Client Stakeholder
**Author:** TBD

---

## 1. Overview

### 1.1 Purpose

This document defines the complete frontend specification for the Phase 1 clickable prototype. It covers every page, component, user flow, and design token needed to build a testable client-facing interface — without any backend dependency.

The prototype lets stakeholders navigate real pages with mock data, testing all client flows (browsing, booking, purchasing, account management) before backend development begins.

### 1.2 Scope

- **Platform landing & explore** — studio directory, studio profile pages
- **Client booking portal** — packages, classes (weekly calendar), workshops, private sessions
- **Auth flows** — register, login, verify phone/email, forgot/reset password
- **Client account area** — bookings, history, packages, membership, invoices, QR, referral
- **Total**: 27 unique routes

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

### 2.2 Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Display headings | DM Serif Display | 400 | Page titles, hero text, section headers |
| Body / UI | Outfit | 300–700 | All interface text, buttons, labels, navigation |
| Mono / Data | JetBrains Mono | 400–500 | IDs, timestamps, invoice numbers, QR labels |

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

### 3.1 Platform & Booking — 27 Routes

#### Platform-Level

| Route | Page | Auth Required |
|-------|------|:---:|
| `/` | Landing page (studio + student-facing) | No |
| `/explore` | Studio directory — browse by category/location | No |
| `/explore/[slug]` | Studio profile — entry point to booking | No |
| `/explore/[slug]/packages` | Packages — bundles, unlimited plans, private session packs | No |
| `/explore/[slug]/classes` | Classes — weekly calendar, credit-based booking | No* |
| `/explore/[slug]/classes/[id]` | Class detail + booking confirmation step | No* |
| `/explore/[slug]/workshops` | Workshops — card/list view, direct purchase | No |
| `/explore/[slug]/private-sessions` | Private Sessions — instructor listing, request-based | No* |

#### Auth

| Route | Page | Auth Required |
|-------|------|:---:|
| `/login` | Sign in | No |
| `/register` | Create account | No |
| `/verify-email` | Email verification status | No |
| `/verify-phone` | Phone OTP verification (registration + password reset) | No |
| `/forgot-password` | Password reset — phone number entry | No |
| `/reset-password` | New password entry (post-OTP) | No |
| `/checkout` | Stripe Checkout simulation | Yes |
| `/checkout/confirmation` | Package / workshop purchase confirmation step (before Stripe) | Yes |
| `/booking/confirmation` | Booking confirmation (post-payment or post-credit-deduction) | Yes |

#### Client Account

| Route | Page | Auth Required |
|-------|------|:---:|
| `/account` | Overview — upcoming bookings | Yes |
| `/account/history` | Booking history + class ratings | Yes |
| `/account/packages` | Active packages | Yes |
| `/account/membership` | Membership status + contact sales | Yes |
| `/account/invoices` | Invoice list | Yes |
| `/account/profile` | Profile settings | Yes |
| `/account/qr` | My QR code | Yes |
| `/account/referral` | Referral code + tracking | Yes |

*Enhanced UI when authenticated (package status, booking actions)

> **Note:** `/for-business` remains accessible via direct URL and is linked from the landing page footer only — it is not shown in the primary consumer navigation.

---

## 4. Navigation & Information Architecture

### 4.1 Top Navigation Bar

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [Logo: Yoga Sadhana]    Explore    [Login / Avatar]                    │
└─────────────────────────────────────────────────────────────────────────┘
```

**States:**
- **Unauthenticated**: Logo | Explore | Login button
- **Authenticated**: Logo | Explore | My Bookings | Avatar dropdown → Account, My QR, Logout
- **On studio profile page** (`/explore/[slug]`): Logo shows breadcrumb back to Explore; studio name; sub-nav tabs (Packages / Classes / Workshops / Private Sessions)
- **Mobile (< 768px)**: Logo | Hamburger → slide-out drawer with all links

> **Note**: "For Business" is intentionally excluded from the consumer nav bar. It remains accessible at `/for-business` via footer link only.

**Behavior**: Sticky top, transparent on landing hero → solid on scroll. Always solid on interior pages.

---

## 5. Page Specifications

### 5.1 Landing Page (`/`)

**Purpose**: Studio discovery page for clients looking to book classes.

**Layout:**

- **Hero**: Headline (DM Serif Display, 48px) — e.g., "Discover yoga classes, workshops & private sessions." Subtitle (Outfit, 18px, muted). Single CTA:
  - "Explore Classes" (accent, filled) → `/explore`

- **Featured studios**: Horizontal scroll row of studio cards (logo, name, tag, short tagline). Clicking → `/explore/[slug]`. Section heading: "Featured Studios"

- **How it works — Clients**: 3-step horizontal strip with icons:
  1. "Browse" — Discover classes, workshops, and experiences
  2. "Book" — Pick a session and reserve your spot
  3. "Show up" — Check in with your QR code

- **Category grid**: Cards (Yoga, Fitness, Wellness, etc.) linking to `/explore?category={cat}`

- **Footer**: Navigation links (Explore, Login, Register), subtle "For Business" text link (muted, low visual hierarchy), copyright

**Responsive**: Single column on mobile, stacked hero, horizontal scroll for featured studios and category cards.

### 5.1a Explore Page (`/explore`)

**Purpose**: Studio directory — clients browse and discover businesses.

**Layout:**
- **Search bar** (top, prominent): Search by studio name, keyword, or category
- **Filter bar**: Category dropdown, Location dropdown, Sort by (Popular, Newest, Name A–Z)
- **Result count**: "Showing 24 studios"
- **Studio card grid**: 3 columns desktop, 2 tablet, 1 mobile

**Studio Card:**
```
┌──────────────────────────────────────────┐
│  [Cover Image]                           │
│  [Logo]  Studio Name                     │
│  [Category Tag]                          │
│  Short description (2 lines max)         │
│  12 upcoming sessions             →      │
└──────────────────────────────────────────┘
```

- Cover image: 16:9 aspect ratio, fallback gradient
- Industry tag: pill badge in `--accent-glow`
- Click anywhere → `/explore/[slug]`

**Empty state**: "No studios found matching your search. Try different filters."

**Responsive**: Cards stack single-column on mobile. Filters collapse to bottom sheet.

### 5.1b Studio Profile Page (`/explore/[slug]`)

**Purpose**: Public-facing studio profile — entry point into the booking flow.

**Layout:**
- **Cover image**: Full-width banner (16:9), fallback gradient
- **Profile header**: Logo (overlapping cover), studio name (DM Serif Display, 32px), category tag, location, short description
- **Sub-nav tabs**: Packages | Classes | Workshops | Private Sessions | About
  - Default tab: Classes (if active), otherwise first active tab

**About tab:**
- Full studio description, location/address, contact info

**Responsive**: Cover image scales to viewport. Profile header stacks vertically on mobile. Tabs scroll horizontally on mobile.

### 5.2 Auth Pages

All auth pages share the same layout: centered card (max-width 400px) on `--warm` background.

#### Login (`/login`)
- Email + password fields
- "Remember me" checkbox
- "Forgot password?" link
- "Don't have an account? Create one" link
- Form validation: inline error messages, loading state on submit

#### Register (`/register`)
- First name
- Phone number + inline "Send OTP" button — OTP verification required
- Email (verification email sent on submit)
- Password (minimum 8 characters)
- Confirm password
- Gender (dropdown: Male / Female / Prefer not to say) — optional
- Date of birth (date picker) — optional
- Referral code (optional; auto-prefilled from referral link if present)
- Terms & conditions checkbox
- "Create Account" button
- "Already have an account? Log in" link

After submit: phone OTP must be verified (`/verify-phone`) and email must be verified (`/verify-email`) before first booking.

#### Verify Email (`/verify-email`)
- Illustration (envelope icon)
- "Check your inbox" heading + instruction text
- "Resend verification email" link with cooldown timer

#### Verify Phone (`/verify-phone`)
- 6-digit OTP input
- "Verify" button
- "Resend code" link with cooldown timer
- Used for both registration and password reset

#### Forgot Password (`/forgot-password`)
- Phone number field + "Send OTP" button
- On submit: OTP sent → redirects to `/verify-phone`
- On successful OTP: redirects to `/reset-password`

#### Reset Password (`/reset-password`)
- New password + confirm password fields
- Password strength indicator
- "Reset Password" button → on success, redirect to `/login`

### 5.3 Classes Page (`/explore/[slug]/classes`)

**Purpose**: Browse bookable group classes. Consumes credits only — no dollar price shown.

**Layout:**

**Weekly Calendar View:**
- Full-week header row (MON 1, TUE 2, …, SUN 7), selected day highlighted
- Subheading: "Classes on [Day], [Date]" — updates on day click
- Left/Right week navigation + "Today" button
- Each row = one class on the selected day, sorted by start time:

```
┌──────────────────────────────────────────────────────────────────┐
│  [Thumbnail]  [YOGA]  Infra Stretch         Book Now             │
│               Master Sumit · 8:30am +08 · 60 min                │
│               1 credit required · You have 9 credits left        │
└──────────────────────────────────────────────────────────────────┘
```

**Credit info display (dynamic per client state):**
- Bundle package: "1 credit required · You have X credits left"
- Unlimited package: "1 credit required · You have unlimited credits"
- No package / exhausted: "1 credit required · No credits available"
- Not logged in: "Log in to see your credit balance"

**Book Now button states:**
- Has credits + spots open: "Book Now" (sage, filled)
- Spots open + no credits (new user or exhausted): "Book Now" (grey, visually disabled but clickable) → pop-up dialog: "You need a package to book this class." with "Buy a Package" CTA → `/explore/[slug]/packages`
- Full + waitlist enabled: "Join Waitlist" (warning, outlined)
- Full + no waitlist: "Full" (muted, disabled)
- Already booked: "Booked ✓" (sage, disabled)
- Not logged in: "Log In to Book" (accent, filled)

**Mobile**: Horizontal day-selector strip at top; class rows full-width below.

### 5.3a Class Detail / Booking (`/explore/[slug]/classes/[id]`)

**Purpose**: Confirmation step before credit deduction.

**Layout:**
- Class image, name (DM Serif Display, 28px), category tag, level badge
- Schedule block: date, time, duration, recurrence note ("Every Monday")
- Instructor card: avatar, name, short bio
- Capacity bar: booked/total, "X spots remaining"
- Credit summary: "1 credit will be deducted from your [Package Name]"
- **"Reserve Now"** button (sage) → deducts 1 credit → success dialog
- Success dialog: "Your booking is confirmed! Please arrive 15 minutes before class." CTA: "I will attend on time"

### 5.3b Workshops Page (`/explore/[slug]/workshops`)

**Purpose**: Browse and purchase one-off or limited-run events. Direct purchase, no credits.

**Layout:**
- List sorted by date, upcoming first
- Each workshop entry:

```
┌──────────────────────────────────────────────────────────┐
│  Phu Quoc Retreat                                        │
│  Single session, Class Pack, or Unlimited options        │
│                               [View packages ▼]         │
└──────────────────────────────────────────────────────────┘
```

- Accordion expander reveals **workshop packages**:

```
  ┌───────────────────────────────────────────────────────────┐
  │  Twin Sharing Room  ·  1 Class  ·  $1,900.00  [Purchase]  │
  │  Single Room        ·  1 Class  ·  $2,200.00  [Purchase]  │
  └───────────────────────────────────────────────────────────┘
```

**Purchase button states:**
- Available: "Purchase" (accent, filled) → 3-step checkout
- Sold out / max enrolment: "Sold Out" (muted, disabled) + **"Join Waitlist"** below
- Workshop ended (past date): "Ended" (muted, disabled)
- Already purchased: "Purchased ✓" (sage, disabled)

**Purchase flow (Purchase → Confirmation → Checkout):**
1. Client clicks **Purchase** on a workshop package
2. **Confirmation page** (`/checkout/confirmation`): shows workshop name, package name/description, price, and a **Confirm Purchase** button
3. Client clicks **Confirm Purchase** → Stripe Checkout (3-step simulated):
   - **Step 1: Personal Information** — pre-filled name/email, phone input
   - **Step 2: Pay With** — payment method selection
   - **Step 3: Review Your Order** — order summary sidebar (workshop image, name, expiry, total)
4. On success: confirmation screen + confirmation email

**Mobile**: Full-width entries; accordion expands below; sticky order summary moves to bottom sheet on checkout.

### 5.3c Private Sessions Page (`/explore/[slug]/private-sessions`)

**Purpose**: Request personal training sessions. Not instant booking — request-based.

**Layout:**
- Page intro: "Book a private session with one of our instructors"
- Instructor grid (2 columns desktop, 1 mobile):

```
┌─────────────────────────────────┐
│  [Photo]                        │
│  Instructor Name                │
│  Bio / specialties (2 lines)    │
│  [Schedule Private Class]       │
└─────────────────────────────────┘
```

**Button states:**
- Available: "Schedule Private Class" (accent, filled)
- Unavailable: "Not Available" (muted, disabled)

**Request flow:**
1. Confirmation page: instructor details + **"Request Appointment"** button
2. On submit: pending notification — "Your request is pending. We will update you within 12 hours."

### 5.3d Packages Page (`/explore/[slug]/packages`)

**Purpose**: Browse and purchase credit bundles, unlimited plans, and private session packages.

**Layout — Three sections:**

**Bundle Packages (Credits):**
- Cards: package name, credit count, price, "Buy Now" CTA → checkout

**Unlimited Packages:**
- Cards: package name, duration (e.g., "3 months"), price, "unlimited" badge, "Buy Now" CTA

**Private Session Packages:**
- Cards: package name, format (1-on-1 / 2-on-1), session count, price, "Buy Now" CTA

**Package card example (Bundle):**
```
┌──────────────────────────────────────┐
│  10-Class Pack                       │
│  10 credits · Valid 6 months         │
│  SGD $300.00                         │
│  [Buy Now]                           │
└──────────────────────────────────────┘
```

**Purchase flow (Buy Now → Confirmation → Checkout):**
1. Client clicks **Buy Now** on a package card
2. **Confirmation page** (`/checkout/confirmation`): shows package name, credit/session count, validity period, price, and a **Confirm Purchase** button
3. Client clicks **Confirm Purchase** → Stripe Checkout (simulated)
4. On success → `/booking/confirmation`

**Mobile**: Single-column card stack per section.

### 5.4 Checkout (`/checkout`)

**Purpose**: Simulated Stripe Checkout for package purchases.

**Layout** (two-column, stacked on mobile):
- **Left**: Order summary — item name, quantity, price, subtotal, total
- **Right**: Mock payment form — card number, expiry, CVC, name on card, "Pay $XX" button
- Success → redirects to `/booking/confirmation`

### 5.5 Booking Confirmation (`/booking/confirmation`)

**Layout**: Centered success card:
- Large checkmark icon (sage)
- "Booking Confirmed" heading
- Session details: name, date, time, instructor
- Package balance update: "9 credits remaining"
- "Add to Calendar" link (mock)
- "View My Bookings" button → `/account`

### 5.6 Account Pages (`/account/*`)

**Layout**: Sidebar sub-navigation (desktop) or horizontal tab bar (mobile).

#### Account Overview (`/account`)
- **Quick stats row**: Next session (date/time + studio name), Active packages (count), Credits remaining
- **Upcoming bookings list**: Session cards with studio name + logo, cancel/reschedule actions, and per-session QR code (collapsible)
- Empty state: "No upcoming bookings — Explore Classes" → `/explore`

#### Booking History (`/account/history`)
- **Table/list**: Studio name, Session name, Date, Time, Attendance status badge, Rating
- Attendance badges: `Attended` (sage), `Late` (warning), `No-Show` (error), `Cancelled` (muted)
- **Rating column**: Dropdown menu (options: 1 star → 5 stars):
  - **Unrated**: Dropdown placeholder "Rate class", `--muted` color
  - **Rated**: Dropdown shows selected value (e.g., "4 stars"); `--accent` color
  - **Unavailable** (non-attended): Dropdown disabled, greyed out, cursor default
  - On submit: brief "Rated ✓" toast (no page reload)
- Filters: Date range, Studio dropdown
- Empty state: "No past bookings yet"

#### My Packages (`/account/packages`)
- **Package cards grouped by studio**: Studio name + logo header, then cards underneath:
  - **Bundle credits**: credit count remaining (circular progress ring) + expiry date
  - **Unlimited packages**: "Unlimited" badge + expiry date
  - **Private sessions**: session count remaining per format (1-on-1 / 2-on-1) + expiry date
- Each card: package name, purchase date
- Expired packages shown greyed with "Expired" badge
- "Explore Classes" CTA if none active → `/explore`

#### Membership (`/account/membership`)
- **Membership cards grouped by studio**: Studio name + logo, then membership card
- Each card: Plan name, package expiry date, status badge (Active / Expired)
- **No "Cancel Membership" button** — replaced with **"Contact Sales Team"** CTA that opens a WhatsApp link
- If no memberships: "Explore Classes" CTA → `/explore`

#### Invoices (`/account/invoices`)
- **Table**: Invoice number (mono font), studio name, date, description, amount, status (Paid/Pending)
- Each row: "Download PDF" action
- Filter: Studio dropdown
- Empty state: "No invoices yet"

#### Profile (`/account/profile`)
- **Form sections**:
  - Personal info: First name, email (read-only with lock icon), phone, gender (select), date of birth
  - Password change: Current password, new password, confirm new password
- "Save Changes" button with loading state

#### My QR Code (`/account/qr`)
- **Large QR code** centered on page (generated from mock client ID)
- "Show this QR code at the front desk for check-in"
- "Tip: increase your screen brightness for faster scanning"

#### Referral (`/account/referral`)
- **Referral code display**: Large 6-digit alphanumeric code (JetBrains Mono, prominent), "Copy Code" button
- **Shareable link**: `booked4u.com/r/[CODE]` with "Copy Link" button
- **Referral stats**: Total referrals (count), Converted (count with first booking completed)
- **Referral table**: Referee first name, date registered, status badge (`Registered` / `Converted`)

### 5.7 Cancellation / Reschedule Flow

**Trigger**: "Cancel" button on any upcoming booking card.

**Cancellation dialog:**
1. Session details summary (name, date, time)
2. Policy outcome — one of:
   - **Within window**: "You're cancelling more than 12 hours in advance. Your session credit will be returned."
   - **Outside window (forfeit)**: "You're cancelling within 12 hours. Your session credit will be forfeited."
   - **Outside window (fee)**: "Late cancellation fee of $X will be charged."
3. "Confirm Cancellation" (error color) and "Keep Booking" buttons

**Reschedule**: Dialog includes "Reschedule Instead?" link → redirects to `/explore/[slug]/classes` with filters pre-applied.

---

## 6. Key User Flows

### Flow 1: Client Discovers & Books a Class

```
/ → Landing page → "Explore Classes" CTA
  → /explore → Browse studios by category/location
  → Click studio card → /explore/[slug] → Studio profile
  → Classes tab → /explore/[slug]/classes
  → Browse weekly calendar → click "Book Now" on a class row
    → /explore/[slug]/classes/[id] → View details
      → "Reserve Now" (1 credit deducted)
    → Success dialog: "Your booking is confirmed!"
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
/explore/[slug]/classes → Class is full
  → "Join Waitlist" button
  → Confirmation: "You've been added to the waitlist"
  → Booking appears in /account with "Waitlisted" badge
  → [Mock: another client cancels]
  → Notification: "You've been promoted from the waitlist!"
  → Booking status changes to "Confirmed"
```

### Flow 4: Client Purchases a Package

```
/explore/[slug]/packages → Browse package sections
  → Click "Buy Now" on a Bundle/Unlimited/Private Session package
  → /checkout/confirmation → Review package details
  → "Confirm Purchase"
  → /checkout → Enter mock payment details → "Pay $XXX"
  → /booking/confirmation → Package activated
  → Credits/sessions visible in /account/packages
```

### Flow 5: Client Requests a Private Session

```
/explore/[slug]/private-sessions → Browse instructor cards
  → Click "Schedule Private Class" on an instructor
  → Confirmation page with instructor details
  → Click "Request Appointment"
  → Pending notification: "Your request is pending. We will update you within 12 hours."
  → Request confirmed → 1 session deducted, client notified
```

---

## 7. Component Library

### 7.1 Shared Components

| Component | Description |
|-----------|-------------|
| `TenantCard` | Studio card for explore page — cover image, logo, name, category tag, description |
| `SessionRow` | Class row in weekly calendar — thumbnail, tag, title, instructor, time, duration, credit info, Book Now |
| `StatusBadge` | Colored pill badge for statuses: Attended, Late, No-Show, Cancelled, Waitlisted, Active, Expired, etc. |
| `CapacityBar` | Visual progress bar showing booked/total spots |
| `DateRangePicker` | Date range selection with calendar popover |
| `FilterBar` | Horizontal row of filter dropdowns with clear/reset |
| `EmptyState` | Illustration + message + optional CTA for empty lists |
| `PageHeader` | Page title (DM Serif Display) + breadcrumbs |
| `StatCard` | Metric card: large number, label |
| `DataTable` | Sortable, filterable table with pagination and row actions |
| `ConfirmDialog` | Modal dialog for destructive action confirmation |
| `Toast` | Success/error/info notification (bottom-right, auto-dismiss) |
| `LoadingSkeleton` | Shimmer placeholder matching component shapes |

### 7.2 Client-Specific Components

| Component | Description |
|-----------|-------------|
| `WeeklyCalendar` | Full-week calendar grid view with day selector and class rows |
| `ClassRow` | Individual class entry in calendar — all button states |
| `WorkshopCard` | Workshop entry with accordion for package tiers |
| `InstructorCard` | Instructor card with Schedule/Not Available button state |
| `PackageCard` | Package display with credit count, price, validity, Buy Now CTA |
| `BookingCard` | Upcoming/past booking display with actions (cancel, reschedule) and QR code |
| `CreditRing` | Circular progress ring showing credits remaining |
| `MembershipCard` | Active/expired membership with Contact Sales Team CTA |
| `InvoiceRow` | Invoice table row with Download PDF action |
| `RatingDropdown` | Dropdown menu (1–5 stars) for booking history rating column |
| `QRDisplay` | Large QR code renderer with instruction text |
| `CheckoutForm` | Mock Stripe payment form (card fields + pay button) |
| `AccountNav` | Sidebar (desktop) / tab bar (mobile) for account section navigation |
| `ReferralCard` | Referral code display with copy button + shareable link |

### 7.3 shadcn/ui Components to Install

Button, Card, Dialog, DropdownMenu, Input, Label, Select, Textarea, Table, Tabs, Badge, Avatar, Separator, Sheet, Tooltip, Switch, Checkbox, RadioGroup, Calendar, Popover, Command, Skeleton, Sonner (toasts), ScrollArea, Progress, Form, Collapsible, Accordion

---

## 8. Responsive Strategy

### 8.1 Breakpoints

| Width | Name | Target |
|-------|------|--------|
| 375px | `xs` | Small phones (iPhone SE) |
| 640px | `sm` | Large phones |
| 768px | `md` | Tablets (iPad portrait) |
| 1024px | `lg` | Small laptops / iPad landscape |
| 1280px | `xl` | Desktop |
| 1536px | `2xl` | Large screens |

### 8.2 Client Portal (mobile-first)

| Breakpoint | Behavior |
|------------|----------|
| < 768px | Single column layout. Top nav collapses to hamburger drawer. Filters open as bottom sheet. Session rows full-width. Account nav becomes horizontal tab bar. |
| 768px–1024px | Two-column grids where appropriate. Expanded top nav. Filter bar inline. |
| > 1024px | Full desktop layout. Account sidebar navigation visible. Three-column grids for package cards. |

---

## 9. Mock Data Schema

### 9.1 Fixture Files

All fixtures stored in `/src/data/` as JSON files with corresponding TypeScript types in `/src/types/`.

| File | Records | Purpose |
|------|:-------:|---------|
| `sessions.json` | 20 | Classes and workshops with categories, instructors, schedules |
| `bookings.json` | 30 | Booking records for mock client — varied statuses |
| `instructors.json` | 4 | Instructor profiles with bios and private session availability |
| `packages.json` | 14 | All package tiers: bundles, unlimited, private session packs |
| `client-packages.json` | 5 | Active/expired package entitlements for mock client |
| `invoices.json` | 10 | Invoice records with line items |
| `referrals.json` | 4 | Referral records: registered and converted |
| `tenant.json` | 1 | Studio name, branding, timezone, currency (Yoga Sadhana) |
| `workshops.json` | 3 | Workshop entries with package tiers |

### 9.2 Key Type Definitions

```typescript
// Core entity types (defined in /src/types/)

interface Session {
  id: string
  name: string
  category: string
  level: 'beginner' | 'intermediate' | 'advanced' | 'all'
  type: 'regular' | 'workshop' | 'private'
  instructorId: string
  capacity: number
  bookedCount: number
  waitlistCount: number
  date: string        // ISO date
  time: string        // HH:mm
  duration: number    // minutes
  status: 'scheduled' | 'cancelled' | 'completed'
  recurrence: string | null  // RRULE or null
  waitlistEnabled: boolean
  description: string
}

interface Instructor {
  id: string
  name: string
  bio: string
  photo: string
  specialties: string[]
  privateSessionAvailable: boolean
  privateFormats: ('1on1' | '2on1')[]
}

interface Package {
  id: string
  name: string
  type: 'bundle' | 'unlimited' | 'private-session'
  format: '1on1' | '2on1' | null  // for private-session only
  creditCount: number | null       // bundle only
  sessionCount: number | null      // private-session only
  durationMonths: number | null    // unlimited only
  price: number
  currency: string
  active: boolean
}

interface ClientPackage {
  id: string
  packageId: string
  type: 'bundle' | 'unlimited' | 'private-session'
  creditsRemaining: number | null
  sessionsRemaining: number | null
  purchasedAt: string
  expiresAt: string | null
  status: 'active' | 'expired'
}

interface Booking {
  id: string
  sessionId: string
  status: 'confirmed' | 'cancelled' | 'waitlisted'
  checkInStatus: 'pending' | 'attended' | 'late' | 'no-show'
  packageId: string | null
  rating: number | null  // 1–5
  createdAt: string
}

interface Invoice {
  id: string
  invoiceNumber: string
  date: string
  amount: number
  currency: string
  status: 'paid' | 'pending'
  paymentMethod: string
  items: { description: string; quantity: number; unitPrice: number; amount: number }[]
}
```

### 9.3 Data Relationships

```
sessions.instructorId         → instructors.id
bookings.sessionId            → sessions.id
bookings.packageId            → client-packages.id
client-packages.packageId     → packages.id
referrals.refereeId           → (mock client)
invoices                      → (mock client)
```

---

## 10. Implementation Order

### Phase A — Foundation
1. Initialize Next.js App Router with TypeScript + Tailwind
2. Install and configure shadcn/ui (warm minimal theme)
3. Set up CSS variables matching the design system palette
4. Import Google Fonts (DM Serif Display, Outfit, JetBrains Mono)
5. Create client portal layout (top nav + page shell)
6. Create all mock data JSON fixtures + TypeScript types
7. Build shared components: StatusBadge, PageHeader, EmptyState, LoadingSkeleton, Toast

### Phase B — Booking Core
1. Landing page (hero, featured studios, how it works, category grid)
2. Auth pages (login, register, verify-email, verify-phone, forgot/reset password)
3. Explore — studio directory (search, filters, studio cards)
4. Studio profile page (cover, header, sub-nav tabs)
5. Packages page (three sections: bundle, unlimited, private sessions)
6. Classes page — weekly calendar view (all button states, credit info)
7. Class detail / booking confirmation page
8. Workshops page (accordion, purchase button states)
9. Private Sessions page (instructor grid, request flow)
10. Checkout simulation
11. Booking confirmation page

### Phase C — Client Account
1. Account layout with sub-navigation (sidebar desktop / tab bar mobile)
2. Overview page (upcoming bookings, per-session QR codes)
3. Booking history (attendance badges, inline star rating)
4. My Packages page (credit rings, unlimited badge, private session counts)
5. Membership page (Contact Sales Team CTA)
6. Invoices page
7. Profile settings
8. My QR Code page
9. Referral page

### Phase D — Final Polish
1. Responsive pass on all pages (375px–1536px)
2. Loading skeleton states
3. Page enter animations (fadeUp with stagger)
4. Empty states for all lists
5. Edge case displays (error states, no data, expired packages)
6. Full navigation walkthrough test

---

## 11. Open Decisions

| # | Question | Impact |
|---|----------|--------|
| 1 | Should the prototype include dark mode toggle? | Design system needs dark token variants |
| 2 | Should email notification templates be visually mocked? | Additional pages for email preview |
| 3 | Include a "Pricing" public page separate from landing? | Additional route |
| 4 | How realistic should the weekly calendar be? (drag interactions, etc.) | Implementation complexity |
