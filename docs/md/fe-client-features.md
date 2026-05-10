# fe-client — Feature Breakdown

A reference for the **business logic** and **user journey** behind every client-facing feature in `fe-client/`. Written for an agent that will plan the admin-side counterpart in `fe-portal/`. Where state on the client is read-only, the admin app is where it's *written* — every "Where admin comes in" callout flags the data the admin must manage.

**Scope.** This is a dedicated 2-app suite for **Yoga Sadhana** only — `fe-client` (member-facing booking app) and `fe-portal` (staff-facing back office). It is **not** a multi-tenant SaaS; there are no other studios on this platform, no tenant switcher, no slug routing, no plan/billing layer for the studio. Studio-specific data (locations, branding, copy, policies, products) is owned and edited in `fe-portal`, but it lives as a single set of values — there is no "per-tenant" surface anywhere.

Yoga Sadhana operates 2 studios in Singapore: **Breadtalk IHQ** (Tai Seng) and **Outram Park**.

---

## 0. Cross-cutting concepts

These show up in many features. Understanding them up front makes the rest read more cleanly.

### 0.1 Credit system (group classes)

- **Credit** = currency for **group classes only**. Earned by purchasing a Bundle, or held implicitly by an Unlimited package.
- A user can hold a Bundle **OR** Unlimited at a time, **never both** at the same time.
- A class booking deducts **1 credit** at the moment of confirmation.
- Cancelling within the policy window returns the credit; outside the window it is forfeited (or fee charged — per Yoga Sadhana's cancellation policy, configured in admin).
- Workshops do **not** consume credits — they're paid directly per workshop.

### 0.2 Session entitlement (private training)

- **Sessions** = a separate currency for **private training only**.
- Held by VIP packages (1-on-1 / 2-on-1).
- 1 session is deducted **only after a private-session request is confirmed by the studio**, never on submission.

### 0.3 Locations

- The studio has **2 locations**. Locations are a separate entity (not a label).
- Sessions, instructors, and class schedules are scoped to a `locationId`.
- Packages and credits are **cross-location** (1 credit works at either studio).
- The `Classes` page filters by location via a pill toggle (per-page, not global nav).

### 0.4 Booking states (covers all booking types)

| State | Meaning |
|---|---|
| `confirmed` | Class/workshop seat held; private session approved by studio |
| `pending` | Private-session request awaiting studio response (≤12h SLA) |
| `cancelled` | User or admin cancelled |
| `attended` | Client checked in (QR scanned) |
| `late` | Checked in after start |
| `no-show` | Did not check in within window |

### 0.5 Per-booking QR

- Every confirmed booking generates a **QR per session** (not a generic per-user QR).
- Format: `YS-BOOKING-{bookingId}-{sessionId}`.
- Front-desk scans → marks attendance → updates `attended`/`late`.

### 0.6 Cancellation policy (set in admin)

| Booking type | Inside window | Outside window |
|---|---|---|
| Class | Credit returned | Credit forfeited / fee |
| Workshop | Refund initiated | Policy penalty |
| Private (unconfirmed) | Free | Free |
| Private (confirmed) | Session returned | Session forfeited / fee |

Reschedule is implemented as cancel + rebook — re-evaluated against policy.

---

## 1. Authentication & onboarding

### 1.1 Register `/register`

**Business logic**
- Required fields: First name, phone, email, password (≥8), confirm password, T&C accepted.
- Optional: gender, DOB, referral code (auto-prefilled from `?ref=` link).
- Account is created in a **half-verified** state — both phone OTP and email link must be verified before the first booking is allowed. Bookings/checkout pages should block unverified users.
- Referral code, if valid, links the new user to the referrer's record so the referrer earns credit upon the referee's first paid booking (see §13.5).

**User journey**
1. User lands on `/register` (often from a referral link with `?ref=YS8472`).
2. Fills form. Inline "Send OTP" on the phone field triggers a phone OTP send.
3. Submit → account created → routed to `/verify-phone`.
4. Enters 6-digit OTP → routed to `/verify-email`.
5. Email OTP entry (6-digit) with 30s resend cooldown.
6. On both verified → home (or back to the page they came from via `?next=`).

**Where admin comes in**
- Admin needs to view accounts in any state (unverified / phone-verified / fully verified).
- Admin should be able to **manually verify** a user (waive OTP) for support cases.
- Admin must be able to inspect the **referral chain** that produced an account.

### 1.2 Verify Phone `/verify-phone` & Verify Email `/verify-email`

**Business logic**
- 6-digit numeric OTP.
- Resend has a cooldown timer (30s).
- Used for both registration and password reset (phone only).

**User journey**
- 6 single-digit inputs auto-advance focus on type and back-focus on backspace.
- "Resend code" disabled until cooldown elapses.

**Where admin comes in**
- Admin can resend or override OTP for stuck users.
- Admin sees verification timestamps on the user record.

### 1.3 Login `/login`

**Business logic**
- Email + password.
- "Remember me" extends session.
- `?next=` query string preserves intended destination after login (e.g., from a CTA on Classes).

**User journey**
1. Email + password → submit.
2. On success → redirect to `next` or home.
3. Errors render inline; form keeps state.
4. Google sign-in button is present (treated as same identity as email when emails match).

**Where admin comes in**
- Admin needs an "impersonate user" path (already done in `fe-portal`).
- Admin needs to disable login (suspend account).

### 1.4 Forgot / Reset Password `/forgot-password`, `/reset-password`

**Business logic**
- Step 1: phone number → send OTP.
- Step 2: enter OTP → enter new password + confirm with strength indicator.
- On success, redirect to `/login`.

**User journey**
- Two-step linear flow with a "Back" affordance from step 2.

**Where admin comes in**
- Admin can trigger a password reset email/SMS on behalf of a user.

### 1.5 Waiver `/waiver`

**Business logic**
- One-time legal acknowledgement: Assumption of Risk, Release of Liability, Medical Disclaimer, Photo/Video Release, etc.
- Required **once before the first paid booking**.
- A `waiverSignedAt` timestamp is stored on the user record. Pages that need a signed waiver gate on this.

**User journey**
- Long-form scrollable text → checkbox "I have read and agree" → "Continue" CTA.
- After signing, user returns via `?next=` to the action they were attempting.

**Where admin comes in**
- Admin sees waiver status per user.
- Admin can re-request waiver (e.g., after a policy revision).

---

## 2. Marketing & landing

### 2.1 Home `/`

**Business logic**
- Public, unauthenticated marketing page. No data dependencies beyond static studio content.
- Sections (in order):
  1. **Hero** — eyebrow, rotating headline word ("Classes / Workshops / Private Sessions / Packages"), subhead, primary CTA → `/classes`, secondary → `/packages`.
  2. **Locations** — both studios with address, photo, hours.
  3. **FeatureGrid** — 6 feature tiles (Easy booking, Class packages, Private sessions, Workshops, QR check-in, Referral rewards).
  4. **FeatureDeepDive** sections — paired blocks for classes and packages (image + bullets + CTA).
  5. **ShowcaseGrid** — workshops/specialties imagery.
  6. **Testimonial**.
  7. **CtaBanner** at bottom.

**User journey**
- Anonymous visitor scrolls; CTAs hand off into `/classes` or `/packages` for browse, or `/login` / `/register` for first-time users.

**Where admin comes in**
- Hero copy, locations content, feature tiles, testimonials, CTA banner are all editable from admin. The admin app should expose a **Marketing / Site Content** surface where Yoga Sadhana staff can update copy and imagery without a code deploy.

### 2.2 Pricing `/pricing`

**Business logic**
- Public-facing summary of bundle / unlimited / private package tiers (read-only browse before signup).
- Mirrors the catalogue but with marketing framing — no Buy CTA without auth.

**User journey**
- Visitor reads tiers → "View packages" CTA → routed to `/packages` (which requires auth to actually purchase).

**Where admin comes in**
- Pricing tiers are published from the same Products catalogue admin manages.

---

## 3. Classes (group)

### 3.1 Browse `/classes`

**Business logic**
- Schedule is generated from **session templates** by location/instructor, materialised as concrete sessions for the selected week.
- Filters: location pill (All / Breadtalk / Outram), level, instructor (optional). Filters are **per-page**, not global nav.
- Each session has: category tag, title, instructor, start time + tz, duration, capacity, seats taken.
- **No dollar price shown** — credits only. (A user without a Bundle/Unlimited can still book a single class via the **One-time Pass** under `/packages`, which acts as the drop-in path.)

**Layout & controls**
- Horizontal **date strip** scroller with `< / >` arrows for week navigation and a **"Today"** button that snaps back to the current day. Selected day is highlighted.
- Subheading: *"Classes on [Day], [Date]"* — updates on day click.
- Filter row beneath the date strip: location pill toggle, instructor select, level select.
- Mobile: classes for the selected day collapse into accordion-style rows.

**Per-row layout (one class)**
- Thumbnail · category tag (e.g., `YOGA`) · title · instructor · start time + tz · duration.
- **Credit info line** (dynamic per user state):
  - On Bundle: *"1 credit required · You have X credits left"*
  - On Unlimited: *"1 credit required · You have unlimited credits"*
  - Logged in but no/exhausted package: *"1 credit required · No credits available"*
  - Logged out: *"Log in to see your credit balance"*
- Right side: action button (states below).

**Button states (per row)**
| User state | Button |
|---|---|
| Logged out | "Book Now" → `/login?next=/booking/confirmation?sessionId=...` |
| Logged in, has credits, seat available | "Book Now" (sage, filled) |
| Logged in, no credits / exhausted | Grey "Book Now" → popup *"You need a package to book this class"* → "Buy a Package" CTA → `/packages` |
| Spots open + waitlist enabled (rare on classes — waitlist is more common on workshops) | "Join Waitlist" |
| Class full + waitlist enabled | "Join Waitlist" (warning, outlined) |
| Class full, no waitlist | "Full" (muted, disabled) |
| Class started/ended | "Ended" (disabled) |
| Already booked by user | "Booked" (link → `/account/classes`) |

**User journey**
1. User opens `/classes`, defaults to current week, all locations.
2. Scrolls/clicks day on the date strip → list of classes for that day.
3. Optionally narrows with location/instructor/level filters.
4. Clicks **Book Now** on a row → routed to `/booking/confirmation?sessionId=...`.
5. If unverified or unsigned-waiver, intercepted → routed through the appropriate gate first (waiver, OTP), then back via `?next=`.

**Where admin comes in**
- Admin builds session templates (recurring patterns), generates instances, manages cancellations/substitutions.
- Admin sets capacity, waitlist toggle, level, category, instructor, location per template.
- Admin can override an individual instance (sub instructor, change room, cancel a single date).

### 3.2 Booking confirmation `/booking/confirmation`

**Business logic**
- This is a **pre-confirmation reserve step** (not a success page) for class bookings — confirms session details, shows credit balance, lets user pick which package the credit is drawn from (if multiple), and exposes the cancellation window.
- For workshop purchases and package buys, this page acts as the success endpoint after `/checkout` completes.
- Requires auth + verified user + signed waiver.

**User journey (class flow)**
1. Lands on page with session summary (title, instructor, time, location).
2. Sees credit balance and package selector if user has more than one active package.
3. Reads the cancellation policy ("Cancel up to Xh before — credit returned").
4. Clicks **Reserve Now** → seat held, credit deducted.
5. Success dialog: *"Your booking is confirmed! Please arrive 15 minutes before class."* → CTA "I will attend on time" → routes to `/account/classes`.

**Where admin comes in**
- Admin sets the cancellation window (overall, or per class category if needed).
- Admin sees who reserved and credit-source per booking (audit trail).

---

## 4. Workshops

### 4.1 Browse `/workshops`

**Business logic**
- Workshops are one-off events with finite capacity and a single date (or a date range).
- Each workshop has one or more **package tiers** (e.g., Early bird / Standard / VIP+1 friend) stored on `workshopPackages[]`.
- Workshops are **paid directly** — credits cannot be used. The card carries a clarification note: *"Direct payment only — credits cannot be used."*
- Status: upcoming / fully enrolled / ended.
- Free workshops (`price === 0`) use **"Register"** copy and skip checkout entirely — go directly to a confirmation success page.
- Optional **waitlist** per workshop (`waitlistEnabled` flag).
- **Level badge** is colour-coded: beginner (sage) / intermediate (warning) / advanced (error) / all-levels (accent).

**User journey**
1. List rendered as **expandable accordion cards**. Card header shows title, instructor, level badge (colour-coded), date, **"X of N spots left"** counter, *"From S$X"* on the collapsed view.
2. Tapping the header expands the card inline → bio, full description, all pricing tiers as individual rows.
3. Each tier row has its own **"Purchase"** button that preselects the tier via `/workshops/[id]?package=N`.

**Button states**
| State | Label |
|---|---|
| Available, paid | "Purchase" |
| Available, free | "Register" |
| Full + waitlist enabled | "Join waitlist" |
| Full, no waitlist | "Fully Enrolled" (disabled) |
| Past | "Workshop Ended" (disabled) |

**Waitlist enrollment UX**
1. User taps "Join waitlist" on a full workshop.
2. Confirmation toast: *"You're on the waitlist. We'll notify you if a seat opens."*
3. Studio cancellation frees a seat → user receives notification (email/in-app) with a time-bound CTA to confirm and pay.
4. If user doesn't claim within window, next person on waitlist is offered.

### 4.2 Workshop detail `/workshops/[id]`

**Business logic**
- Acts as the pre-purchase confirmation page. Shows workshop details, the selected package tier (changeable), terms note ("Direct payment only — credits cannot be used").
- Honors `?package=N` from the list page to preselect a tier.
- Submit → `/checkout` with workshop+tier in cart.

**User journey**
- Review preselected tier → optionally change to a different tier → "Purchase" → `/checkout`.
- Free workshops skip checkout: tap "Register" → success page with QR + add-to-calendar.

**Where admin comes in**
- Admin creates/edits workshops, sets capacity, package tiers, waitlist toggle, level, photo, instructor, location, refund policy override.
- Admin sees rosters and can manually add/remove attendees.

---

## 5. Private sessions (1-on-1 / 2-on-1)

### 5.1 Instructor grid `/private-sessions`

**Business logic**
- Lists instructors who offer private sessions.
- Each instructor has: photo, name, specialties, bio, locations they serve, an `available` flag, and (optionally) declared time slots.
- Booking is **request-based**, not instant.
- Page also exposes the user's **PT credit balance cards** (1-on-1 sessions remaining, 2-on-1 sessions remaining), so they know what they can spend before requesting.

**Layout**
- Top of page: PT balance cards (one per format, with expiry dates) and a "Buy more" CTA → `/packages`.
- **Step-1 form** (above the grid): instructor (any/specific), location, preferred date. Selections pre-fill the detail page via query params (`?instructor=...&location=...&date=...`).
- 2-column grid (1 col mobile) of instructor cards.

**Button states (per card)**
| State | Button |
|---|---|
| `available: true` | "Schedule Private Class" |
| `available: false` | "Not Available" (disabled, grey) |

### 5.2 Instructor detail / request `/private-sessions/[id]`

**Business logic**
- Shows full instructor profile and a request form, pre-filled from the step-1 form on the list page if present.
- User picks: format (1-on-1 / 2-on-1), location (limited to instructor's serving locations), preferred date + **time slot** (chooser shows the instructor's declared availability for that date).
- Submitting creates a `pending` private-session request — **no session deducted yet, no payment taken**.
- Studio responds within 12 hours: confirm → 1 session deducted from the matching format's VIP pack; reject → request closed.
- If user has no VIP-session entitlement for the selected format, the page surfaces a nudge to `/packages` first; user can still submit (entitlement is resolved/charged at confirmation time, per Yoga Sadhana's chosen workflow in admin).

**User journey**
1. Browse instructor grid → click "Schedule Private Class" (or use step-1 form to pre-select).
2. Detail page with bio + request form (format / location / date / time slot).
3. Submit → confirmation page: *"Your request is pending. We will update you within 12 hours."*
4. Studio confirms or rejects (action happens in admin's `/private/inbox`).
   - On **confirm** → user receives notification (email + in-app), booking flips to `confirmed`, 1 session deducted, per-booking QR generated, item appears in `/account/private-sessions` (Confirmed tab).
   - On **reject** (or counter-offer of alt time) → user is notified and routed back to re-pick a slot or cancel.

**Where admin comes in**
- **Inbox** of pending private-session requests (already present in fe-portal under `/private/inbox`).
- Admin confirms/rejects, optionally proposing alt times.
- On confirmation: deducts 1 session from the user's VIP package, generates a per-session QR, schedules instructor block.
- Admin manages instructor `available` flag and per-instructor pricing.

---

## 6. Packages

### 6.1 Packages `/packages`

**Business logic**
- Three-section catalogue:
  1. **Credit Bundles** — N credits, validity in days, fixed SGD price. Examples: One-time Pass (1 credit / 1 day / S$40), Bundle of 10 (S$300 / 90d), Bundle of 20 (S$550 / 180d), Bundle of 30/50/100.
  2. **Unlimited** — duration-based (1 / 3 / 6 months) at a fixed price; lets the holder book unlimited group classes.
  3. **VIP Private Sessions** — 1-on-1 or 2-on-1 packs with a session count.
- A user holding a Bundle cannot purchase Unlimited (and vice versa) until the existing one expires or is exhausted. UI flags this and blocks purchase with copy.
- Sections 1+2 are toggleable (Credits | Unlimited) since they're mutually exclusive; VIP sits as an independent third section.

**User journey**
1. User reviews tiers. **Highlight badge** marks the recommended bundle (e.g., "Best value" on Bundle of 20). Each card shows credit count, validity in days, price, and any "pending purchase" indicator if the user has an in-flight order for that tier.
2. Click **Buy Now** on a card → routed to a confirmation step (`/checkout/confirmation` or inline review) showing package name, credits/sessions, validity, price, and any conflict warning ("You already have an active Unlimited — purchasing a Bundle is not allowed until it expires").
3. Click **Confirm Purchase** → `/checkout`.
4. On success → `/booking/confirmation` (success variant) and entitlement appears in `/account` (My Packages section, grouped per studio).

**Where admin comes in**
- Admin manages the **Products catalogue** — bundle definitions, unlimited durations, VIP packs, pricing, validity, highlight flags, archive/un-archive.
- Admin needs reporting on package sales (revenue mix, conversion).
- Admin can grant/issue a package manually (e.g., promo, refund replacement).

---

## 7. Checkout `/checkout`

**Business logic**
- Simulated Stripe Checkout for package and workshop purchases.
- Always preceded by a **review/confirmation step** (`/checkout/confirmation` or an inline one): shows item, validity / event date, price, applicable promo, and a Confirm button. This is the last stop before the payment form takes over — gives the user a clean cancel point with no card details exposed.
- Two-column layout on the payment step: **order summary** (left) — item, qty, subtotal, GST line, promo line, total; **payment form** (right) — card number, expiry, CVC, name on card, "Pay S$XX".
- On success → `/booking/confirmation` (success variant) + invoice generated + entitlement issued + receipt emailed.
- Failure → inline error, retry without losing form state.
- Phase 1: card only. PayNow / GrabPay are slated for a later phase but the layout reserves space for alternative payment buttons.

**User journey**
1. User arrives from a Buy Now (packages) or Purchase (workshops) flow.
2. **Review step**: confirms item details → Confirm Purchase.
3. **Payment step**: enters card details (mocked) → "Pay S$XX".
4. Loading state → success → confirmation page with QR and receipt link.

**Where admin comes in**
- Admin sees all transactions, can refund/void.
- Admin manages payment provider settings (PayNow/GrabPay/Card per Phase 1 differentiator), tax (GST), receipt branding.
- Admin must handle disputes and edge cases (chargebacks, partial refunds).

---

## 8. Account portal `/account/*`

The account section is a sticky sidebar (desktop) / tab bar (mobile). All sub-pages share an `AccountShell`.

### 8.1 Dashboard `/account`

**Business logic**
- Summary / hub view that consolidates:
  - **My Packages** card group (per studio): bundle credits with a CreditRing visual + expiry; unlimited with an "Unlimited" badge + expiry; PT sessions remaining per format (1-on-1 / 2-on-1) + expiry. Expired packages render greyed with an "Expired" badge.
  - **Membership** card (per studio): plan name, status badge (Active / Expired), package expiry. **No "Cancel Membership" button** — replaced with **"Contact Sales Team"** → WhatsApp deep link (`wa.me/65...`).
  - **Expiry banner** appears at t-30 / 15 / 7 / 1 days / 12h / 2h before package end. Banner only renders if the chosen milestone is shorter than the package's full duration (avoids absurd "expires in 30 days" on a 1-day pass).
  - **Upcoming bookings** (cards): class/workshop/private. Each card has the per-booking QR, cancel, reschedule actions (gated by cancellation window).
  - Quick links to other account sections (My Classes / Workshops / Private Sessions / Invoices / Referral / Profile).
- Cards are grouped by studio (header with studio name + logo) so a member of both locations sees their entitlements split cleanly.
- If user has no active package: empty state with **"Explore Classes"** CTA → `/classes` and **"View packages"** CTA → `/packages`.

**User journey**
- Lands here after login. Glances at credits + upcoming sessions. Taps an upcoming booking → expanded view with QR + cancel/reschedule. Taps "Contact Sales Team" on membership → WhatsApp deep link with a prefilled message.

**Where admin comes in**
- Admin needs to issue / extend / pause / cancel memberships from a user-detail page (already partly built — D.4 commit).
- Admin sees the same expiry milestones to drive comms (auto reminders).

### 8.2 Profile `/account/profile`

**Business logic**
- Editable: first name, phone (with re-verify if changed), gender, DOB.
- Read-only: email (lock icon — change requires support).
- Password change requires current password.
- Save → patches user record, returns success toast.

**User journey**
- Linear form with two sections (Personal info / Password).
- Errors inline, submit disabled until dirty.

**Where admin comes in**
- Admin can edit any of these fields on a user (including email override) for support cases.

### 8.3 My Classes `/account/classes`

**Business logic**
- Tabs: **Upcoming** / **Past**.
- Upcoming row: class title, instructor, date/time, location, QR action, cancel/reschedule actions (gated by cancellation policy).
- Past row: status badge (Attended / Late / Cancelled / No-Show) + 1–5 star **rating dropdown** if status is `Attended`.

**User journey**
- Default tab is Upcoming; user reviews, taps QR for the session, or cancels.
- Past tab is an audit + rating affordance.

**Where admin comes in**
- Admin sees this same data per user, plus can override attendance status (mark attended retroactively, void no-show fee).
- Ratings flow into instructor performance reports.

### 8.4 My Workshops `/account/workshops`

**Business logic**
- Same upcoming/past split, scoped to workshops.
- Includes refund status if a past workshop was cancelled.

**Where admin comes in**
- Admin manages refunds and roster. Can move attendees between dates.

### 8.5 My Private Sessions `/account/private-sessions`

**Business logic**
- Three states visible to the user: **Pending** (awaiting studio), **Confirmed** (upcoming), **Past**.
- For pending: a "Cancel request" affordance.
- For confirmed: QR + cancel/reschedule.

**Where admin comes in**
- Admin's `/private/inbox` is the counterpart — pending requests resolve there.
- Admin sets per-instructor session pricing/availability that drives whether requests are accepted.

### 8.6 Invoices `/account/invoices`

**Business logic**
- List of invoices: id, item name, issued date, total, GST line.
- Empty state when none. Filters by date range.
- Each row has a **Download PDF** action.

**User journey**
- Filter → page through results → tap row → download PDF.

**Where admin comes in**
- Admin sees invoices across all users; can resend, void, mark refunded, edit item description for support.

### 8.7 Referral `/account/referral`

**Business logic**
- Unique 6-digit alphanumeric referral code per user (e.g., `YS8472`), rendered prominently in mono font with a copy button.
- Shareable link: `booked4u.com/r/{CODE}` with a separate copy button (and WhatsApp share intent).
- Stats: total referrals, converted (referee made first paid booking).
- History table: referee first name, registered date, status (`Registered` / `Converted`).
- Reward: **S$20 credit** to referrer when referee converts.

**User journey**
- User copies code or link → shares → referees register with code → on first paid booking, referrer gets S$20 credit applied.

**Where admin comes in**
- Admin sees the global referral graph: who referred whom, attribution status, payout (credit issuance) audit.
- Admin sets the reward amount; can blacklist abusive codes; can manually mark a conversion.

---

## 9. Layout & navigation (cross-cutting)

### 9.1 Top nav

- **Unauthenticated**: Logo | Classes | Workshops | Private Sessions | Packages | Login button.
- **Authenticated**: Logo | Classes | Workshops | Private Sessions | Packages | My Bookings | Avatar dropdown (Account, My QR, Logout).
- Mobile: hamburger drawer with the same items.
- Sticky top, transparent on landing hero, solid on scroll/interior pages.
- A credit balance pill is shown in the avatar area for authenticated users.

### 9.2 Footer

- Studio info, location addresses, social links, legal links (Terms, Privacy), copyright.
- (No "For Business" / SaaS marketing link — this product is dedicated to Yoga Sadhana members.)

**Where admin comes in**
- Footer copy is editable from admin.
- Logo, favicon, and brand colours live under Settings → Branding in fe-portal.

---

## 10. Admin-side surface map (derived)

For every fe-client feature above, admin must own at least the **write side** of the corresponding state. The mapping below should drive the next agent's plan for `fe-portal` gaps:

| Client surface | Admin counterpart (fe-portal) |
|---|---|
| Register / verify | Users list, user detail (verify, suspend, impersonate) |
| Classes browse | Session templates, schedule generator, single-instance overrides, capacity, waitlist toggles |
| Booking confirmation | Cancellation policy editor; booking audit log |
| Workshops browse / detail | Workshop CRUD + tiers + waitlist + roster |
| Private sessions request | Private-session inbox (`/private/inbox`); instructor availability + pricing |
| Packages | Products catalogue (bundles, unlimited, VIP); manual grants |
| Checkout | Transactions, refunds, payment provider settings, tax/GST |
| Account dashboard | Membership ops on user profile (extend / pause / cancel / contact) |
| Account profile | User detail editor (incl. waiver re-request) |
| My Classes / Workshops / Private Sessions | Per-user booking history; attendance overrides; rating data feeds reports |
| Invoices | Invoices list; resend, void, refund, branding |
| Referral | Referral graph, attribution audit, reward config |
| Layout / branding | Studio settings: branding, locations, marketing copy, footer |
| Notifications & messages | Template library, channel routing, per-event toggles, send audit log |
| Cross-cutting | Reports, feature flags |

Anything in the right column without strong representation in `fe-portal` today is a candidate for the next planning pass.

---

## 11. Notifications & messages (client-facing)

These are the in-app and channel touchpoints triggered by booking and payment events. The client renders banners, dialogs, and toasts; admin owns the templates and recipient logic.

### 11.1 In-session UI feedback (immediate, optimistic)

| Trigger | Surface | Copy |
|---|---|---|
| Class reserved | Modal dialog | "Your booking is confirmed! Please arrive 15 minutes before class." + CTA "I will attend on time" |
| Class cancelled by user (in-window) | Toast | "Booking cancelled · 1 credit returned" |
| Class cancelled by user (out-of-window) | Toast | "Booking cancelled · credit forfeited per cancellation policy" |
| Workshop purchased | Confirmation page | "You're registered for [workshop]. We've emailed your receipt." |
| Package purchased | Confirmation page | "[Package name] is now active. Start booking from /classes." |
| Private session requested | Confirmation page | "Your request is pending. We will update you within 12 hours." |
| Waitlist join | Toast | "You're on the waitlist. We'll notify you if a seat opens." |
| Verification successful | Toast | "Email verified ✓" / "Phone verified ✓" |
| Payment failed | Inline error in checkout | "Payment failed. [reason]. Please try again." |

### 11.2 Out-of-session events (push to email / WhatsApp / in-app inbox)

| Event | Channel(s) | Notes |
|---|---|---|
| Booking confirmation (any) | Email | Includes per-booking QR link |
| Workshop purchase receipt | Email | PDF invoice attached or linked |
| Private-session request approved/rejected | Email + in-app | Approval includes QR; rejection may include alt-time suggestion |
| Waitlist seat available | Email + in-app | Time-bound CTA to claim |
| Class cancelled by studio | Email + in-app | Credit auto-returned, banner on dashboard |
| Membership / package expiry milestones | Email + in-app banner | t-30/15/7/1d/12h/2h gated by package length (see §8.1) |
| Referral converted | In-app toast on next visit | "[Referee] just joined — S$20 credit added to your account" |
| Password reset request | SMS (OTP) + email | OTP entry on reset flow |

### 11.3 Where admin comes in

- Admin maintains the **template library** for every event row above (copy, brand voice, language).
- Admin sets which channels are enabled per event (e.g., disable WhatsApp for receipts but keep it on for waitlist alerts).
- Admin can resend any individual notification from a user-detail page (support recovery).
- Admin needs an audit log of "what was sent to whom, when, with what result" — for compliance and ops debugging.

---

## 12. Quick rules-of-thumb for the next planner

- **Credits vs sessions are different currencies** — never let admin tooling accidentally let a private-session pack pay for a group class, or vice versa.
- **Bundle and Unlimited are mutually exclusive at the user level** — admin issuance flow must enforce this.
- **Private-session deduction happens on confirmation, not on request** — admin inbox actions are the trigger.
- **Workshops never use credits** — admin should not even render a credit-source selector in their tooling.
- **Per-booking QR, not per-user QR** — front-desk app and any admin scan tooling must read the booking-level token.
- **"Contact Sales Team" replaces "Cancel Membership"** — cancellation is a high-touch flow handled out-of-app via WhatsApp; the admin side needs a queue for these inbound conversations.
- **Cancellation windows live in admin settings** — there is one source of truth; client surfaces just render whatever admin sets.
- **Multi-location is real** — every entity that has a location must store it; per-page filters should not silently include other locations.
