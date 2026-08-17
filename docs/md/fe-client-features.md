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
- 1 session is deducted **only after a PT request is scheduled by the studio**, never on submission.
- PT bookings are **request-driven** — clients submit preferred slots, the studio triages and schedules. There is no public instructor-availability calendar in v1.

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
- Workshops are one or multi-day events with finite capacity. Each workshop has:
  - A list of **days** (`WorkshopDay[]`) — each day has its own date, time window, capacity, and base price.
  - A list of **tiers** (`WorkshopTier[]`) — each tier names a name (e.g. "Full Event", "Day 1 only"), an explicit set of `day_ids` it grants access to, a regular price, and optional early-bird price + cutoff.
- **Tier capacity is derived** as the *minimum capacity across the days it covers* — a tier can never sell more than the smallest constituent day's room. The server is the authority; the card surfaces the resulting "X of N spots left" per tier.
- Workshops are **paid directly** — credits cannot be used. The card carries a clarification note: *"Direct payment only — credits cannot be used."*
- Status: upcoming / fully enrolled / ended.
- Free workshops (price 0) use **"Register"** copy and skip checkout entirely — go directly to a confirmation success page.
- Optional **waitlist** per `WorkshopDay` (capacity now decomposed into `waitlist + online_booking + buffer` — see admin spec).
- Promotions on workshops follow the same best-price-wins resolution as packages (§6.1).

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
- Acts as the pre-purchase confirmation page. Shows workshop details, the day schedule (one row per `WorkshopDay`), all available tiers (each with the `day_ids` it covers rendered as date chips), and the terms note ("Direct payment only — credits cannot be used").
- Honors `?tier=...` from the list page to preselect a tier.
- The selected tier renders its effective price (regular or early-bird, plus any active promotion via best-price-wins) and the derived seats-left count (`min` of constituent days' availability).
- Submit → `/checkout` with workshop + tier in cart.

**User journey**
- Review preselected tier → optionally change to a different tier (e.g. drop from "Full event" to "Day 1 only") → "Purchase" → `/checkout`.
- Free workshops skip checkout: tap "Register" → success page with QR + add-to-calendar.

**Where admin comes in**
- Admin (superadmin) creates / edits workshops at `/admin/packages/workshops` via the three-stage editor (Basics → Days → Tiers). Workspace-scoped — each workshop is pinned to one `location_id`.
- Admin sets per-day capacity (`waitlist + online_booking + buffer`), base price, and time window. Tier capacity is derived, never edited directly.
- Admin sees rosters per day and can manually add / remove attendees.

---

## 5. Private sessions (1-on-1 / 2-on-1)

### 5.1 Landing `/private-sessions`

**Business logic**
- Lists instructors who offer private sessions for browse / context only — there is no per-instructor "available slot" calendar in v1. Booking is **request-driven**: the client submits a request, the studio negotiates over WhatsApp, then schedules.
- Each instructor card shows: photo, name, specialties, bio, locations they serve. Cards are **informational only** — instructor is NOT carried into the request form. The client doesn't pick an instructor; the studio assigns one when scheduling.
- Page exposes the user's **PT credit balance cards** (1-on-1 sessions remaining, 2-on-1 sessions remaining) so they know what they can spend before requesting.
- The primary CTA on this page is **"Request a Private Session"** — opens the PT request form (§5.2).

**Layout**
- Top of page: PT balance cards (one per format, with expiry dates) and a "Buy more" CTA → `/packages`.
- Primary CTA: "Request a Private Session".
- 2-column grid (1 col mobile) of instructor cards (informational only — clicking opens a profile preview, not the form).

### 5.2 Submit PT request `/private-sessions/request`

**Business logic — minimal form, no back-and-forth in app**

The form deliberately collects **only what the studio needs to start the WhatsApp conversation**. Everything beyond that — instructor, room, final time — is settled out-of-app and recorded by the admin at scheduling time.

Fields, in order:
1. **Location** — dropdown of the studio's active locations (from `/public/locations`), required. Routes the request to the right workspace queue in the portal; the studio defaults the scheduled session to this location (and can still change it at scheduling time).
2. **Session type** — 1-on-1 or 2-on-1. Gated by which PT package(s) the client owns; if they hold only one type, that option is auto-selected and the radio is hidden.
3. **Class type** — dropdown of all active class types (yoga style focus, e.g. Hatha, Vinyasa). Drives which instructor the admin assigns.
4. **Proposed slots** — 1..N rows of `{ date, start_time, end_time }`. Date picked via calendar; time as a HH:mm window per row. "Add another slot" button below the last row. Multiple slots maximise the chance the studio can schedule one of them.
5. **Note** — optional free-form message to the studio.
6. **Partner (2-on-1 only)** — email field with exact-match autocomplete against existing members:
   - If the typed email matches a member → row collapses to "Partner: {name}" with the resolved `co_client_id`.
   - If no match → a name field reveals and the client types the partner's full name; the request stores `co_client_email + co_client_name`, the admin creates the partner's account before scheduling.

**On submit**
- Creates a `PtRequest` with `status = "pending"`.
- **Debits the client's PT package immediately**: 1 session for 1-on-1, 2 sessions for 2-on-1 (one per attendee). Cancellation before the studio schedules refunds those sessions; cancellation after schedules forfeits them (v1).
- If the client has no PT-session entitlement for the selected format, the submit button is disabled with a "Buy a PT package first" link to `/packages` — the form does **not** allow optimistic submission without credits.
- No payment is taken at this step (credits already paid for).
- `location_id` is set from the client's selection — it routes the request to that location's workspace queue in the portal and pre-fills the scheduling dialog (admin can still change it).

**User journey**
1. From `/private-sessions`, tap "Request a Private Session".
2. Fill the form: location, session type, class type, one or more proposed slots, optional note, partner (if 2-on-1).
3. Submit → confirmation toast: *"Your request is in. We'll reach you on WhatsApp shortly to confirm the time."* Page redirects to `/account/private-sessions` with the new request highlighted in the **Pending** group.
4. Studio takes over on WhatsApp, then schedules in `/admin/pt-requests` → the client receives an email confirming the final time + venue, and the row moves to **Confirmed** on `/account/private-sessions`.
5. If the studio can't accommodate any proposed slot and the WhatsApp negotiation fails, either side can **cancel** the request from their UI. While `pending`, cancel refunds credits.

**Where admin comes in**
- **`/admin/pt-requests`** triage page is the single surface — see admin-restructure.md §9.
- The system enforces the invariant: **no `PtSession` exists without a backing `PtRequest`** in v1.
- Instructor profile pages on the staff side manage bio, photo, and eligible class types (no `available` flag, no availability slots — the surface was removed).

---

## 6. Packages

### 6.1 Packages `/packages`

**Business logic**
- Four-section catalogue:
  1. **Trial Pass** — quota-based intro pack (e.g. 3 trial classes / 30 days / S$30). **One purchase per client, ever** — enforced server-side at purchase time. A previously-purchased trial (active or expired) blocks further trial purchases and the section renders a "You've already used your Trial Pass" disabled state.
  2. **Credit Bundles** — N credits, validity in days, fixed SGD price. Examples: Bundle of 10 (S$300 / 90d), Bundle of 20 (S$550 / 180d), Bundle of 30/50/100.
  3. **Unlimited** — duration-based (1 / 3 / 6 months) at a fixed price; lets the holder book unlimited group classes **at one Home Location, chosen at checkout** (§7) — never both, unless the plan also carries a paid Cross-Location Add-On. The card reads "Covers one studio — you choose at checkout," not "Valid across both locations."
  4. **VIP Private Sessions** — 1-on-1 or 2-on-1 packs with a session count.
- A user holding a Bundle cannot purchase Unlimited (and vice versa) until the existing one expires or is exhausted. UI flags this and blocks purchase with copy. Trial Pass and VIP are independent and can co-exist with any other holding.
- Trial sits at the top of the page above the Credits / Unlimited toggle. VIP sits as an independent fourth section.

**Promotions (best-price-wins)**
- Any package may carry one or more **promotions** configured in admin (percent off or explicit special price, with start/end windows).
- At purchase time the system evaluates every promotion whose window contains `now` and applies the one yielding the lowest effective price (deterministic tie-break on lowest promotion id).
- The card surface shows: original price (struck through if a promo is active) + effective price + promo pill (label, e.g. "May Day -25%"). Tooltip lists all active promos for transparency.

**Promo Codes are a separate mechanism, typed at checkout, not shown on the catalogue.** A Promotion applies itself and needs no input; a **Promo Code** must be typed and is entered on the review step (§7), which is why the catalogue cards never show a code field. The two stack — a code takes its cut of the price a Promotion has already reduced. See `be/CONTEXT.md` § Discounts for the exact vocabulary; never call a code a "promo", "coupon" or "discount code" in copy.

**User journey**
1. User reviews tiers. **Highlight badge** marks the recommended bundle (e.g., "Best value" on Bundle of 20). Each card shows credit count / session count, validity in days, price (with best-promo applied if any), and any "pending purchase" indicator.
2. Click **Buy Now** on a card → routed to a confirmation step (`/checkout/confirmation` or inline review) showing package name, credits/sessions, validity, original + effective price + applied promo label, and any conflict warning (e.g. "Trial Pass already used" or "You already have an active Unlimited").
3. Click **Confirm Purchase** → `/checkout`.
4. On success → `/booking/confirmation` (success variant) and entitlement appears in `/account` (My Packages section, grouped per studio).

**Where admin comes in**
- Admin manages the **Products catalogue** — trial pass, bundle definitions, unlimited durations, VIP packs, pricing, validity, highlight flags, archive/un-archive.
- Admin (superadmin) configures **promotions** nested inside each package (percent or special-price, with windows).
- The server enforces the **one-trial-per-client** rule at the purchase endpoint.
- Admin needs reporting on package sales (revenue mix, conversion).
- Admin (superadmin) can grant/issue a package manually (e.g., promo, refund replacement) and can edit expiry / set balance on a client's active packages via the kebab menu.

### 6.2 Corporate `/corporate`

**Business logic**
- Corporate packages (company / group sessions) are surfaced to clients as their own catalogue — a dedicated **"Corporate"** nav item and `/corporate` catalog page (previously these were admin-only). There is also a public read for unauthenticated browse.
- Each card shows name, description, and price. Corporate is **paid directly via Stripe** — no credits, no promotions.
- Buying a corporate package is **request-driven**, mirroring private sessions: there is **no client form**. On purchase, the system auto-creates a single **pending corporate request**; all negotiation (date, time, venue, headcount) happens over **WhatsApp** with the studio.

**User journey**
1. User browses `/corporate`, taps **Buy** on a package → normal Stripe checkout (`/checkout`).
2. On success → a pending corporate request is created; the user lands on `/account/corporate` (§8.8) with a WhatsApp contact button (number **6582067247**).
3. Studio negotiates on WhatsApp, then schedules → the request flips to **Scheduled** (date/time, location, instructor shown). After the session, it moves to **done** (attended). Either side can end up at **Cancelled**.

**Where admin comes in**
- Admin (superadmin) manages corporate packages under Packages.
- Admin handles requests on the **Corporate Requests** portal page and schedules them from the Schedule's "+ Corporate" picker — see `admin-restructure.md` §9b.

---

## 7. Checkout `/checkout`

**Business logic — the review step is live, and every paid purchase routes through it.**

The dead `/checkout` page from the earlier spec is gone. `/checkout` is now a real review step, and it is the **only** surface in the member app with a code input anywhere — a Promo Code can be scoped to any product, so the picker's page and the code's page have to be the same page. A package or workshop tier priced above zero keeps its existing auth gate (login modal, return-to-page) and then pushes here; at zero it keeps the old post-and-grant, so a Promotion that drives a package to $0 falls into the free branch for free — the branch is decided by price, not by kind. The Trial card never used the buy button and is untouched.

**What the page carries, top to bottom** — rows marked *(unlimited)* render only when the item being bought is an Unlimited Plan:

1. **Order summary** — item, validity / event date, price.
2. **Home studio** *(unlimited)* — two radios, one per Location, address shown on each, **no pre-selected default**. Pay stays disabled and reads "Choose your home studio to continue" until one is picked. **A renewal** — bought while the member already holds a live Unlimited Plan — replaces the radios with a locked row: "Your renewal continues at Breadtalk IHQ. Ask us if you need to move it." A member may only renew at their existing plan's Home Location; changing it is a portal-only, admin-audited action.
3. **Cross-Location Add-On** *(unlimited)* — a checkbox block, **disabled until a studio is picked**, showing the rate even while disabled so it advertises rather than reads as broken. Live, it names the other studio and shows the arithmetic — months (rounded up) × rate = total — and closes with "Expires with the plan it's attached to." Greyed copy is always a precondition, never "Unavailable": the three disabled reasons are *no studio picked yet*, *this plan already carries one*, and *nothing to attach to* (no Unlimited Plan held at all, worded away from "nothing chosen yet" and routed to the plans). A Dormant plan's Add-On prices at its full stored Duration with no remainder wording; an Activated plan's remainder sentence comes **before** the arithmetic — "Your plan runs to 26 Nov 2026 — 3 months, 10 days left. Part months are charged as whole months, so that's 4." — so the surprising part is answered before the number that provokes it.
4. **Promo code** — a text input, case- and whitespace-insensitive. A code is checked against the specific item being bought, so a green tick is never contradicted by a refusal seconds later. Five distinct outcomes, four of them specific:

   | Case | Member sees |
   |---|---|
   | Expired | "This code has expired" |
   | Cap reached | "This code has been fully claimed" |
   | Already redeemed by this member | "You've already used this code" |
   | Out of scope | "This code doesn't apply to *{product name}*" |
   | Unknown or archived | "We don't recognise that code" |

   Unknown and archived deliberately share one message so the field can't be used to fish for valid codes. **Checkout refuses a bad code outright** — a mistyped or expired code can never silently fall through to a full-price charge while the screen still shows it as accepted, which is the live defect this closes.
5. **Breakdown** — the Add-On is its own line, never folded into the plan; a Promo Code discounts the plan line only and can never touch the Add-On, which is a rate on Global Policy rather than a discountable product.
6. **Home studio, restated** *(unlimited)* — "Your home studio is Breadtalk IHQ for the next 6 months." directly above Pay, so the member passes the irreversible choice twice before money moves.
7. **Pay.** A discount that takes the total to $0 skips the payment step entirely and grants immediately, the same free path packages and free workshop tiers already use.

**Two entry points for a standalone Add-On purchase** against a plan the member already holds — no new Unlimited purchase involved: the nudge on a blocked class (below), and the plan card on the account page. Same review page, entered with the target plan's id instead of a catalogue item.

**The blocked class is a nudge, not an ad.** On `/classes`, a class outside a member's plan coverage is shown, not hidden — the row dims, takes a "Not in your plan" lock chip where the Book button was, and carries one line under a hairline: "Your plan covers **Breadtalk IHQ** only. [Add Outram Park for $30/month] · or [use 1 credit]" if the member also holds credits. Both are links, weighted below the class itself — a louder treatment was tried and rejected because this state repeats on every wrong-Location class in the week's schedule, and at that density an accent border and a filled button read as an ad break. A blocked class never silently spends a credit; a member choosing to pay with credits does so explicitly through the "use 1 credit" link.

**Four confirmation emails**, one per completed purchase, none for an admin's complimentary grant:

| Purchase | Slug |
|---|---|
| Paid class / PT package | `package_purchase_confirmed` |
| Paid workshop | `workshop_purchase_confirmed` |
| Free trial pass | `trial_pass_purchase_confirmed` |
| Free workshop tier | `workshop_purchase_confirmed` |

Every purchase succeeds even if the email fails to send — the send is a fire-and-forget step after the entitlement is already granted. An Unlimited Plan's confirmation reads "Valid 6 months from your first class — your plan activates when you make your first booking" only when the purchase is actually Dormant; a plan bought with no live plan in front is **not** Dormant, gets a real end date immediately, and its email carries that date like any other kind's does — see `be-client.md` §4e for the exact branch. The receipt link never points nowhere: a paid purchase links to the Stripe receipt, a free one falls back to the account page.

- Two-column layout on the payment step: **order summary** (left) — item, qty, subtotal, GST line, promo line, total; **payment form** (right) — card number, expiry, CVC, name on card, "Pay S$XX".
- Failure → inline error, retry without losing form state.
- Phase 1: card only. PayNow / GrabPay are slated for a later phase but the layout reserves space for alternative payment buttons.

**User journey**
1. User arrives from a Buy Now (packages) or Purchase (workshops) flow, or from an Add-On nudge on a blocked class / a plan card.
2. **Review step** (this page, above) → Pay.
3. **Payment step**: enters card details (mocked) → "Pay S$XX". Skipped entirely when a Promo Code takes the total to $0.
4. Loading state → success → confirmation page with QR (bookings) or receipt link, and a confirmation email lands separately.

**Where admin comes in**
- Admin sees every transaction — package purchases and workshop purchases both have their own row on the client detail page — and issues a Refund from either, always the full amount, always the same operation whether triggered from the portal button or from the payment provider's own dashboard (`backend-architecture.md` § Purchase Refunds). Refunding cancels every future booking the purchase paid for and hands any Promo Code back to the member and the code's pool; classes already attended stand as history.
- Admin manages payment provider settings (PayNow/GrabPay/Card per Phase 1 differentiator), tax (GST), receipt branding.
- Admin must handle disputes and edge cases (chargebacks). There is no partial refund anywhere in the system, so there is nothing to calculate.

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
- Past row: status badge (Attended / Late / Cancelled / No-Show).

**User journey**
- Default tab is Upcoming; user reviews, taps QR for the session, or cancels.
- Past tab is an audit.

**Where admin comes in**
- Admin sees this same data per user, plus can override attendance status (mark attended retroactively, void no-show fee).

### 8.4 My Workshops `/account/workshops`

**Business logic**
- Same upcoming/past split, scoped to workshops.
- Includes refund status if a past workshop was cancelled.

**Where admin comes in**
- Admin manages refunds and roster. Can move attendees between dates.

### 8.5 My Private Sessions `/account/private-sessions`

**Business logic**
- Four groupings visible to the user: **Pending** (awaiting studio), **Confirmed** (scheduled upcoming), **Past** (attended), **Cancelled** (rolls up both `cancelled_before_scheduled` and `cancelled_after_scheduled`).
- **Pending row** — shows class type, session type, all proposed slots, partner (if 2on1, with "pending invite" badge if the partner isn't yet a member), and a **"Cancel request"** button. Cancelling while pending refunds credits.
- **Confirmed row** — final date/time, location, instructor (assigned by studio), partner, QR + per-booking code, and a **"Cancel"** button. Cancelling here does **not** refund credits (v1 policy); UI shows that warning in the confirm dialog.
- **Past row** — same fields plus check-in outcome (attended / no-show).
- **Cancelled row** — read-only, dim. Notes whether credits were refunded.

**Where admin comes in**
- Admin's `/admin/pt-requests` is the counterpart — see admin-restructure.md §9.

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

### 8.8 My Corporate `/account/corporate`

**Business logic**
- Lists the user's corporate requests, one card per request, with a status that the FE reflects back from the backend:
  - **Pending** — request created on purchase; shows a **WhatsApp contact** button (deep link to **6582067247**) so the user can start the conversation. No in-app form.
  - **Scheduled** — shows final date/time, location, and assigned instructor.
  - **Attended** — rendered as "done".
  - **Cancelled** — read-only, dim.
- No client-side cancel/reschedule in v1 — corporate is handled out-of-app over WhatsApp.

**Where admin comes in**
- Admin's **Corporate Requests** page (`admin-restructure.md` §9b) is the counterpart — schedule / cancel / mark attended.

---

## 9. Layout & navigation (cross-cutting)

### 9.1 Top nav

- **Unauthenticated**: Logo | Classes | Workshops | Private Sessions | Packages | Corporate | Login button.
- **Authenticated**: Logo | Classes | Workshops | Private Sessions | Packages | Corporate | My Bookings | Avatar dropdown (Account, My QR, Logout).
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
| Private sessions request | PT request triage (`/admin/pt-requests`); `ScheduleFromRequestDialog` for converting to a `PtSession` (no public availability calendar) |
| Packages | Products catalogue — Trial Pass, bundles, unlimited, VIP — with nested promotions (best-price-wins); manual grants + expiry edits + set-balance via client kebab |
| Checkout | Transactions, refunds, payment provider settings, tax/GST |
| Account dashboard | Membership ops on user profile (extend / pause / cancel / contact) |
| Account profile | User detail editor (incl. waiver re-request) |
| My Classes / Workshops / Private Sessions | Per-user booking history; attendance overrides |
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
- **Trial Pass is one-per-client, ever** — server-enforced at purchase. A previous trial (active or expired) blocks new purchases.
- **PT bookings are request-driven** — clients submit preferred slots, the studio schedules. No public instructor availability calendar in v1. Session deduction happens when the studio schedules, not on submit. Invariant: no `PtSession` exists without a backing `PtRequest`.
- **Workshop tier capacity is derived** — `min(day capacity for day in tier.day_ids)`. Never store or trust a tier-level capacity number on the client; ask the server.
- **Promotions use best-price-wins** — when multiple promotions are active on a package or workshop, the lowest effective price wins (deterministic tie-break on lowest id).
- **Workshops never use credits** — admin should not even render a credit-source selector in their tooling.
- **Per-booking QR, not per-user QR** — front-desk app and any admin scan tooling must read the booking-level token.
- **"Contact Sales Team" replaces "Cancel Membership"** — cancellation is a high-touch flow handled out-of-app via WhatsApp; the admin side needs a queue for these inbound conversations.
- **Cancellation windows live in admin settings** — there is one source of truth; client surfaces just render whatever admin sets.
- **Multi-location is real** — every entity that has a location must store it; per-page filters should not silently include other locations.
