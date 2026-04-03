# Phase 1 — Product Requirements Document

**Product:** Yoga Sadhana Client Booking Portal
**Version:** 1.1
**Date:** April 3, 2026
**Status:** Draft
**Audience:** Product Manager / Engineering Team
**Author:** TBD

---

## 1. Product Overview

### 1.1 Problem Statement

Yoga Sadhana currently relies on a generic booking tool (Reserv) that lacks the flexibility for their specific business model — credit-based class packages, private session management, and workshop sales. Clients need a seamless self-service portal to discover classes, purchase packages, and manage their bookings independently.

### 1.2 Product Goal

Build a **client-facing booking portal** for Yoga Sadhana. Clients can:

1. Browse and book group classes (credit-based, no checkout)
2. Discover and purchase workshops (direct payment via Stripe)
3. Request private sessions (instructor-based, request-only, no checkout)
4. Purchase and manage credit packages and private session packages
5. Track their bookings, history, and account

### 1.3 Core Features — Phase 1 Scope

| Module | What It Delivers |
|---|---|
| **Packages** | Credit bundles, fixed-term unlimited plans, private session packages — one-time Stripe purchases |
| **Classes** | Weekly calendar view of bookable group classes; credit-based; Book Now flow with confirmation dialog |
| **Workshops** | Card/list view of upcoming workshops; direct purchase via Stripe Checkout |
| **Private Sessions** | Instructor listing; request-based scheduling; 12-hour response SLA |
| **Authentication** | Client self-registration (phone OTP + email verification); sign-in; password reset via phone OTP |
| **Client Account** | Upcoming bookings, booking history, package status, membership, invoices, profile, QR code, referral |
| **QR Check-In** | Unique per-booking QR code displayed to client for check-in at front desk |
| **Referral Program** | Unique 6-digit referral code per client; shareable link; referral tracking in account |
| **Class Ratings** | Post-attendance star ratings (1–5) inline in booking history |
| **Package Expiry Reminders** | Smart email reminders at 30d / 15d / 7d / 1d / 12h / 2h before package expiry |

### 1.4 Out of Scope — Phase 1

- Admin dashboard, staff management, instructor management
- Business analytics and reporting
- QR scanner / staff check-in interface
- Digital waiver flow
- Online / hybrid sessions
- WhatsApp / SMS notifications (WhatsApp used as a contact link only)
- Automated marketing campaigns
- PayNow and GrabPay payment methods
- Instructor-level ratings and written reviews (class-level star ratings only)

---

## 2. User Role

This document covers the **Client (student)** role exclusively.

| Permission | Client |
|---|---|
| Browse & book group classes (credit-based) | ✓ |
| Browse & purchase workshops | ✓ |
| Request private sessions | ✓ |
| Purchase packages | ✓ |
| Cancel / reschedule own bookings | ✓ |
| View own account & booking history | ✓ |
| Rate attended classes (1–5 stars) | ✓ |
| Generate & share referral code | ✓ |

---

## 3. Pages

### 3.1 Public Pages

| Route | Page | Auth Required |
|-------|------|:---:|
| `/` | Landing page | No |
| `/explore` | Studio directory — browse by category/location | No |
| `/explore/[slug]` | Studio profile — entry point to booking | No |
| `/explore/[slug]/packages` | Packages — bundles, unlimited plans, private session packs | No |
| `/explore/[slug]/classes` | Classes — weekly calendar, credit-based booking | No* |
| `/explore/[slug]/classes/[id]` | Class detail + booking confirmation step | No* |
| `/explore/[slug]/workshops` | Workshops — card/list view, direct purchase | No |
| `/explore/[slug]/private-sessions` | Private Sessions — instructor listing, request-based | No* |

### 3.2 Auth Pages

| Route | Page | Auth Required |
|-------|------|:---:|
| `/login` | Sign in | No |
| `/register` | Create account | No |
| `/verify-email` | Email verification status | No |
| `/verify-phone` | Phone OTP verification | No |
| `/forgot-password` | Password reset — phone number entry | No |
| `/reset-password` | New password entry (post-OTP) | No |
| `/checkout` | Stripe Checkout simulation | Yes |
| `/checkout/confirmation` | Package / workshop purchase confirmation step (before Stripe) | Yes |
| `/booking/confirmation` | Booking confirmation (post-payment or post-credit-deduction) | Yes |

### 3.3 Client Account

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

---

## 4. Functional Requirements

---

### 4.1 Authentication

#### Client Registration

Self-registration with the following fields:

| Field | Required | Notes |
|---|---|---|
| First name | Yes | |
| Phone number | Yes | OTP verification sent on submit |
| Email | Yes | Verification email sent on submit |
| Password | Yes | Minimum 8 characters |
| Confirm password | Yes | Must match password |
| Gender | Optional | |
| Date of birth | Optional | |
| Referral code | Optional | 6-digit code; manual input or auto-prefilled from referral link |

- Both phone OTP and email verification must be completed before first booking
- Single account used across all tenants

#### Client Sign-In
- Email + password
- "Forgot password?" link leads to password reset flow

#### Password Reset
1. Client enters registered phone number
2. OTP sent via SMS → client enters OTP at `/verify-phone`
3. On successful verification: set new password + confirm new password
4. Redirect to sign-in

---

### 4.2 Packages Page (`/explore/[slug]/packages`)

Dedicated page showing all purchasable package options, organized into three categories.

#### A. Bundle Packages (Credits)

| Package | Price | Credits |
|---|---|---|
| One-time pass | SGD $40 | 1 credit |
| Bundle of 10 | SGD $300 | 10 credits |
| Bundle of 20 | SGD $550 | 20 credits |
| Bundle of 30 | SGD $750 | 30 credits |
| Bundle of 50 | SGD $1,100 | 50 credits |
| Bundle of 100 | SGD $2,000 | 100 credits |

Credits are consumed on the Classes page only (1 credit per class). Not usable for Workshops or Private Sessions.

#### B. Unlimited Packages (Credits, Fixed-Term)

| Package | Price | Duration |
|---|---|---|
| 3-Month Unlimited | SGD $600 | 3 months |
| 6-Month Unlimited | SGD $1,000 | 6 months |
| 12-Month Unlimited | SGD $1,700 | 12 months |

Grants unlimited credits for the term. Not a recurring subscription — expires at end of term with no auto-renewal.

> **Note:** Bundle and Unlimited packages are **mutually exclusive** — a client cannot hold an active Bundle and an active Unlimited simultaneously.

#### C. Private Session Packages (Sessions)

**1-on-1 Personal Training:**

| Package | Price | Sessions |
|---|---|---|
| VIP 10 sessions | SGD $1,600 | 10 |
| VIP 20 sessions | SGD $3,000 | 20 |
| VIP 30 sessions | SGD $4,200 | 30 |
| VIP 40 sessions | SGD $5,200 | 40 |
| VIP 50 sessions | SGD $6,000 | 50 |
| VIP 100 sessions | SGD $11,000 | 100 |

**2-on-1 Personal Training:**

| Package | Price | Sessions |
|---|---|---|
| VIP 10 sessions | SGD $2,000 | 10 |
| VIP 20 sessions | SGD $3,600 | 20 |
| VIP 30 sessions | SGD $4,800 | 30 |
| VIP 50 sessions | SGD $7,500 | 50 |

Sessions are consumed on the Private Sessions page only (1 session per confirmed booking). Completely independent from credit balance.

> **Glossary:**
> - **Credits** = the unit consumed by Bundle and Unlimited packages. Used exclusively on the Classes page.
> - **Sessions** = the unit consumed by Private Session packages. Used exclusively on the Private Sessions page.
> - Credits and Sessions are independent balances and never interchangeable.

#### Package Exclusivity

- Bundle and Unlimited are mutually exclusive — cannot hold both simultaneously
- A client **can** hold: Bundle + Private Session packages, OR Unlimited + Private Session packages
- When purchasing a conflicting package type, system warns the client

#### Purchase Flow

1. Client clicks **Buy Now** on a package card
2. Confirmation page shows package details (name, credits/sessions/duration, price, validity) + **Confirm Purchase** button
3. Client clicks **Confirm Purchase** → Stripe Checkout (one-time payment)
4. On success: entitlement granted, invoice generated, confirmation email sent
- Package balance decremented on each successful booking
- Expired packages cannot be used; remaining credits/sessions forfeited
- No auto-renewal — client must purchase a new package

---

### 4.3 Classes Page (`/explore/[slug]/classes`)

Group classes that consume credits from Bundle or Unlimited packages.

#### Discovery — Weekly Calendar View

- Full-week calendar (similar to ClassPass / Mindbody), scrollable by week with left/right navigation
- Header shows day-of-week columns (MON 1, TUE 2, …, SUN 7); selected day highlighted
- Subheading: "Classes on [Day], [Date]"
- Number of rows = number of classes on the selected day, sorted by time
- Each row displays:
  - Category tag (e.g., "YOGA")
  - Class title (e.g., "Infra Stretch")
  - Instructor name (e.g., "Master Sumit")
  - Start time with timezone (e.g., "8:30am +08")
  - Duration (e.g., "60 min")
  - Credit info (dynamic, see below)
  - **Book Now** button
- **No dollar price shown** — credits only

#### Credit Info Display (dynamic per client state)

| Client State | Display |
|---|---|
| Bundle package | "1 credit required · You have X credits left" |
| Unlimited package | "1 credit required · You have unlimited credits" |
| No package / exhausted | "1 credit required · No credits available" |
| Not logged in | "Log in to see your credit balance" |

#### Book Now Button States

| State | Appearance | Action |
|---|---|---|
| Has credits + spots open | "Book Now" (sage, filled) | → Class detail / confirmation |
| Spots open + no credits (new user or exhausted) | "Book Now" (grey, disabled-look but clickable) | → Pop-up: "You need a package to book this class." CTA: "Buy a Package" → `/explore/[slug]/packages` |
| Full + waitlist enabled | "Join Waitlist" (warning, outlined) | → Join waitlist |
| Full + no waitlist | "Full" (muted, disabled) | — |
| Already booked | "Booked ✓" (sage, disabled) | — |
| Not logged in | "Log In to Book" (accent, filled) | → `/login` |

#### Booking Flow (no checkout)

1. Client clicks **Book Now**
2. Confirmation page shows all class details + **Reserve Now** button
3. Client clicks **Reserve Now** → 1 credit deducted from package
4. Success dialog: **"Your booking is confirmed! Please arrive 15 minutes before class."** CTA: "I will attend on time"
5. Confirmation email sent (includes per-session QR code)

#### Waitlist

- When a class is at full capacity, "Book Now" changes to "Join Waitlist"
- When a booking is cancelled, the system automatically promotes the first waitlisted client
- Clients can remove themselves from the waitlist at any time

---

### 4.4 Workshops Page (`/explore/[slug]/workshops`)

One-off or limited-run events purchased directly — no credits consumed.

#### Discovery — Card / List View

- List sorted by date (upcoming workshops first)
- Each workshop entry displays:
  - Workshop title
  - Single-line description
  - **Accordion expander** to reveal workshop packages
- Each workshop package (inside accordion):
  - Package name, description, price
  - **Purchase** CTA button

#### Purchase Flow (checkout required)

1. Client clicks **Purchase** on a workshop package
2. Confirmation page shows all workshop details + **Purchase Now** button
3. Client clicks **Purchase Now** → Stripe Checkout (3-step):
   - **Step 1: Personal Information** — pre-filled name/email; phone input
   - **Step 2: Pay With** — payment method selection
   - **Step 3: Review Your Order** — final review with order summary sidebar (workshop image, name, expiry, total)
4. On success: confirmation screen + confirmation email

#### Disabled States

| Condition | Button State | Additional |
|---|---|---|
| Workshop has ended (past date) | Greyed — "Ended" | — |
| Maximum enrolment reached | Greyed — "Sold Out" | "Join Waitlist" button appears below |
| Already purchased | "Purchased ✓" (sage, disabled) | — |

---

### 4.5 Private Sessions Page (`/explore/[slug]/private-sessions`)

Personal training sessions (1-on-1 or 2-on-1) booked via request — not instant booking.

#### Discovery — Instructor Listing

- Page showcases all available instructors
- Each instructor card: photo, name, bio, specialties
- CTA: **"Schedule Private Class"**

#### Instructor Availability States

| State | Button |
|---|---|
| Available | "Schedule Private Class" (accent, filled) |
| Unavailable | "Not Available" (muted, disabled) |

#### Request Flow (no checkout, no instant booking)

1. Client clicks **Schedule Private Class**
2. Confirmation page shows instructor details + **"Request Appointment"** button
3. Client clicks **Request Appointment** → request submitted
4. Pending notification: "Your request is pending. We will update you within 12 hours."

---

### 4.6 Client Account (`/account/*`)

Platform-level account accessible post-login. Shows data across all tenants the client has interacted with.

| Section | Contents |
|---|---|
| **Overview** | Upcoming bookings with per-session QR code; cancel/reschedule actions |
| **Booking History** | Past sessions with attendance status (Attended, Late, Cancelled, No-Show); **Rating column** — 1–5 star dropdown for sessions with "Attended" status |
| **My Packages** | Bundle credits (count remaining + expiry), Unlimited package (expiry + "unlimited" badge), Private sessions (count per format + expiry) |
| **Membership** | Active package status; **No "Cancel Membership" button** — replaced with **"Contact Sales Team"** CTA linking to WhatsApp |
| **Invoices** | All invoices; downloadable PDF |
| **Profile** | First name, email, phone, gender, date of birth, password change |
| **My QR Code** | Large QR code for check-in at front desk |
| **Referral** | Unique 6-digit referral code, shareable link, referral count and status |

---

### 4.7 Package Expiry Reminders

Automated email notifications sent before a package expires to encourage renewal.

| Reminder Lead Time | Smart Rule |
|---|---|
| 30 days | Only sent if package duration ≥ 30 days |
| 15 days | Only sent if package duration ≥ 15 days |
| 7 days | Only sent if package duration ≥ 7 days |
| 1 day | Only sent if package duration ≥ 1 day |
| 12 hours | Always sent |
| 2 hours | Always sent |

**Smart sending rule:** Only dispatch a reminder if `reminder_lead_time ≤ total_package_duration`. For example, a 1-day one-time pass only triggers the 12-hour and 2-hour reminders.

Each reminder includes: package name, expiry date, credits/sessions remaining, and a CTA to renew or contact the sales team (WhatsApp link).

---

### 4.8 Invoice System

- Invoice auto-generated on every successful payment
- Invoice contains: invoice number, date, line items, amount, payment method, business name/logo
- Delivered to client's email immediately after payment
- Stored against client's account; downloadable as PDF

---

### 4.9 QR Code Check-In

- Each confirmed booking generates a **unique per-session QR code** (encoded with booking ID)
- QR code displayed:
  - On the booking confirmation screen
  - In the upcoming bookings list (`/account`)
  - In the booking confirmation email
- Client shows QR code at front desk for staff to scan

---

### 4.10 Referral Program

#### Referral Code

- Every registered client is auto-assigned a **unique 6-digit alphanumeric referral code**
- Code displayed in the client's account under the Referral section
- **Shareable link:** `booked4u.com/r/[CODE]` — clicking opens the registration page with the code pre-filled

#### Referral Tracking

When a new client registers using a referral code:
- System records: referrer, referee, code used, date, status
- Status: `Registered` → `Converted` (first booking completed)
- Referrer can view referral count and status in their account

#### Referral Rewards

- Tenant-configurable (e.g., bonus credits, discount on next package)
- Phase 1: reward fulfilment is manual; automated reward fulfilment deferred to Phase 2

---

### 4.11 Class Ratings

- After attending a class (status = `Attended`), clients can rate it **1–5 stars**
- Rating provided via **dropdown menu (1–5 stars)** in the Booking History table (rightmost column)
- One rating per attended session; optional; updatable within 7 days of class
- **Class-level only** in Phase 1 — no instructor ratings, no written reviews
- Not logged in / non-attended rows: stars greyed out and non-interactive

---

### 4.12 Cancellation / Reschedule

Available from the upcoming bookings list in the account area.

| Booking Type | Within Cancellation Window | Outside Window |
|---|---|---|
| Class | Credit returned to package | Credit forfeited or fee charged |
| Workshop | Refund initiated | Policy penalty applied |
| Private Session (unconfirmed) | Freely cancelled | Freely cancelled |
| Private Session (confirmed) | Session returned to package | Session forfeited or fee charged |

- Reschedule = cancel + rebook (treated as a new booking for policy purposes)
- System checks the tenant's cancellation policy before confirming cancellation

---

## 5. Non-Functional Requirements

| Requirement | Specification |
|---|---|
| Platform | Responsive web app (PWA) — no native app in Phase 1 |
| Browser support | Last 2 versions: Chrome, Safari, Firefox, Edge |
| Mobile | Mobile-first; all client-facing flows must work on 375px+ viewport |
| Performance | Core booking flow < 2s load time on 4G |
| Availability | 99.5% uptime target |
| Payments | PCI compliance delegated to Stripe; no card data stored on platform |
| Auth security | Passwords hashed (bcrypt); JWT expiry 15 min access / 7 day refresh; phone OTP for registration and password reset |
| OTP | SMS delivery via provider TBD (Twilio); OTP expiry: 5 minutes; max 3 attempts |
| Email | Transactional email via provider TBD (SendGrid / Resend) |

---

## 6. Email Notification Triggers

| Trigger | Recipient | Content |
|---|---|---|
| Booking confirmed (Class) | Client | Session details, per-session QR code, "arrive 15 min before class", cancellation policy |
| Booking confirmed (Workshop) | Client | Workshop details, order summary, invoice |
| Private session request submitted | Client | Request details, "we will update you within 12 hours" |
| Private session request confirmed | Client | Confirmed session details, per-session QR code, instructor info |
| Private session request declined | Client | Decline reason, link to browse other instructors |
| Booking cancelled (by client) | Client | Cancellation confirmation, credit/session outcome (returned or forfeited) |
| Promoted from waitlist | Client | New booking confirmation, per-session QR code |
| Payment successful | Client | Invoice attached as PDF |
| Package expiry reminder (smart) | Client | Package name, expiry date, credits/sessions remaining, renew / contact sales CTA |
| Referral signup notification | Client (referrer) | "[Name] signed up using your referral code" |
| Class rating request | Client | Sent 24h after attended class; link to rate in booking history |

---

## 7. Open Questions

| # | Question | Status |
|---|---|---|
| 1 | Which email provider? SendGrid vs Resend | Open |
| 2 | Which SMS / OTP provider? Twilio vs equivalent | Open |
| 3 | Should clients be able to transfer package credits to another client? | Open |
| 4 | Should clients be able to pause/freeze an active Unlimited package? | Open |
| 5 | Travel package (SGD $60) — include or remove? Pending client confirmation | Open |
| 6 | OAuth login (Google) — include at launch or defer? | Open |
| 7 | Should the no-show booking block auto-lift, or require manual clearance? | Open |
| 8 | Average class rating shown on Classes page — yes/no? Minimum rating count threshold? | Open |
