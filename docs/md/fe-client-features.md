# fe-client — Feature Breakdown

A reference for the **business logic** and **user journey** behind every client-facing feature in `fe-client/`. Written for an agent that will plan the admin-side counterpart in `fe-portal/`. Where state on the client is read-only, the admin app is where it's *written* — every "Where admin comes in" callout flags the data the admin must manage.

**Scope.** A 2-app suite — `fe-client` (member-facing booking app) and `fe-portal` (staff-facing back office) — serving **every** studio on the platform from one deployment of each. Everything below describes what one studio's members see; which studio a request is about is resolved from the hostname (`spec-tenant-resolution.md`).

> **Superseded on tenancy.** This paragraph used to read "a dedicated suite for one studio… not a multi-tenant SaaS… studio data lives as a single set of values". All of that is now false: studio-specific data (locations, branding, copy, policies, products) is per-Tenant, owned and edited by that studio's own admins, and fenced by Row-Level Security. The feature descriptions themselves still hold.

A studio has as many Locations as it has — one, several, or none yet. No rule anywhere may assume a particular number.

---

## 0. Cross-cutting concepts

These show up in many features. Understanding them up front makes the rest read more cleanly.

### 0.1 Credit system (group classes)

- **Credit** = currency for **group classes only**. Earned by purchasing a Bundle, or held implicitly by an Unlimited package.
- ~~A user can hold a Bundle **OR** Unlimited at a time, **never both** at the same time.~~ Superseded: a member may hold, and have running, any number of Credit Bundles, Unlimited Plans and a Trial at once, and picks which one pays when they book (§3.1; `be/docs/adr/0010-several-packages-run-per-family.md`).
- A class booking deducts **1 credit** at the moment of confirmation.
- Cancelling before the class's window returns the credit while the member is under the cancellation cap (or always, with the cap switched off), and loses it once they are over; inside the window the cancel is a **late cancellation** and the credit is kept; once the class starts it cannot be cancelled (§0.6).
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
- Format: `RT-BOOKING-{bookingId}-{sessionId}`.
- Front-desk scans → marks attendance → updates `attended`/`late`.

### 0.6 Cancellation policy (set in admin)

The studio sets a class window, a PT window, and a **cap**: how many cancellations a member may make per cycle and still get the credit back (class and PT share one count). The cap can be switched off on the Policy page; then every cancel made in time returns, and nothing a member sees mentions a cap. A class may carry its own window (#313).

A member can cancel a **class** until it starts (`422 class_started` after). The class's **window** decides whether the credit comes back: inside it the cancel is a **late cancellation** — it goes through, the credit is kept, and it counts toward the cap (#318). A scheduled **PT session** is different: its window is a deadline, and inside it the server refuses (`422 cancellation_window_passed`) and the member has to contact the studio.

| Booking type | Cancelled in time, under the cap (or cap off) | Cancelled in time, over the cap | Inside the window | After the start |
|---|---|---|---|---|
| Class (credit-paid) | Credit returned | Cancelled, credit lost | Late cancellation, credit lost | Refused |
| Class (Unlimited) | Place freed, nothing to return | Place freed, nothing to return | Late cancellation, place freed | Refused |
| Private (pending) | Sessions returned | Sessions returned | Sessions returned | — |
| Private (scheduled) | Session returned | Cancelled, session lost | Refused | Refused |

Workshops are not cancelled by members (non-refundable). Every member cancel is recorded and counts toward the cap — Unlimited ones and late ones included — and they are recorded with the cap off too, so switching it back on counts the ones already in the cycle.

fe-client reads the numbers from `GET /public/cancellation-policy` — none are compiled in — and states them on the schedule before a member books, in the cancel dialogs, and in the PT footnote. Each upcoming class booking carries `cancel_deadline` and says "Cancel by {time} to avoid a late cancellation." (or "Cancelling now is a late cancellation."); Cancel is offered on every confirmed booking until the class starts. The class cancel dialog reads the booking's `cancel_preview` from `GET /me/bookings/:id` when it opens — the server's own answer, cap included — and warns "This is a late cancellation — your credit won't be returned." when it applies. Member-facing copy never says "refund" for a credit or session coming back; a refund is money. Copy lives in `fe-client/src/lib/cancellation-copy.ts`.

Reschedule is implemented as cancel + rebook — re-evaluated against policy.

---

## 1. Authentication & onboarding

### 1.1 Register `/register`

> **As built (#117, #173):** Register takes first name, last name, email, phone, gender (Female / Male / Prefer not to say) and a password (8 characters or more, typed twice and matched on the page), emails a 6-digit code, and the code proves the email before the account and the studio's member record are created together (`POST /public/members/register`, `be-client.md` §4f). Login is email first, then the password, or "check your email" when the address has no password yet and a set-password link goes out (§1.4). The fuller journey below (phone OTP, T&C, referral, Google) is not built yet.

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
- Email → a 6-digit code emailed to it (#117). An address with no member record at this studio is sent to register; a member the studio has blocked is refused.
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

> **As built (#173):** "Forgot password?" on the password step mails a set-password link, and so does the email step when the address has no password yet. An address with no account at this studio is not sent to "check your email": the email step says there is no account here and links to registration (`account_not_found`). The link is single use and lasts 30 minutes. It lands on `/set-password`, and setting the password signs the member in. The profile page (`/account/profile`) has a "change password" card: current password plus the new one. See `be-client.md` §4f.

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
- Hero copy, locations content, feature tiles, testimonials, CTA banner are all editable from admin. The admin app should expose a **Marketing / Site Content** surface where a studio's own staff can update copy and imagery without a code deploy.

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
- Filters: location (one at a time — no "All"), level, instructor (optional). Filters are **per-page**, not global nav.
- Each session has: category tag, title, instructor, start time + tz, duration, and whether a seat is free (`has_seats`).
- **Seat counts are the studio's, never the member's.** No page of the member app says how many seats a class has, how many are taken or left, or how many members wait for one — no "N spots left", no "3 left" nudge, no "N waiting". The member catalogue does not send them (`be-client.md` § Waitlist shape); a member sees only Book / Full / the waitlist's state, and their own place in line. Staff see every count in the portal. Hiding them keeps members from comparing classes and Locations by how full they are.
- **No dollar price shown** — credits only. (A user without a Bundle/Unlimited can still book a single class via the **One-time Pass** under `/packages`, which acts as the drop-in path.)

**Layout & controls**
- _As built:_ a signed-in member's next booking leads the schedule as the same ticket "Your bookings" opens with (§8.1, `ComingUp`), Cancel included; a cancel there re-reads the feed.
- _As built:_ the cancellation rules sit under the filters in a **yellow-framed "Cancellation policy" notice**, collapsed to its title with a chevron — a tap opens it — one short line each (`classPolicyPoints`): the window ("Cancel at least 2 hours before class and you get your credit back."), the late rule ("Cancel within 2 hours of class and you lose the credit."), and the cap and what going over it costs ("You get 3 cancellations every 30 days. After that, you lose the credit even if you cancel early."). The Book sheet keeps the full sentence (`classBookingPolicy`). The cancel dialog frames its notice amber whenever the credit will stay spent — late, or over the cap — and names the cap.
- _As built:_ each row is time · class and instructor · location · cost · action; from `md` up the location and the cost are columns of their own, so they line up down the day whatever the instructor's name. Every **Book Now** (row, class detail, Book sheet's "Book class", workshop "Book now") wears the studio accent (`BTN_BOOK`).
- The schedule shows the next **10 days** (today and the nine after it), grouped by day. Past classes and days with no classes are left out.
- The days are an **accordion, at most one open**. The soonest day with classes opens by default; each collapsed day shows its label ("Today", "Tomorrow", or the weekday, with the date) and its class count. Tapping a collapsed day opens it and closes the one that was open; tapping the open day closes it, leaving none open. Days slide open and shut (no slide with reduced motion). The open day's header stays pinned under the top bar while its classes scroll.
- After a day opens, the page scrolls so its first class sits a quarter of the way down the screen (or as near as the foot of the page allows). After the open day is closed, if its header is above the screen, the page scrolls it back to just under the top bar.
- Filter row above the schedule: location select and instructor select. _As built:_ the schedule is **one Location's at a time**: the location select has no "All locations" option and opens on the first Location, because two studios' classes side by side read as repeats and were booked at the wrong one. If a filter leaves the open day empty, the soonest remaining day opens. The instructor select lists everyone teaching in the window whichever instructor is picked, so the member can switch straight to another: the schedule is read for the picked location only and narrowed to the picked instructor on the page, and the select lists every main instructor in that read.

**Per-row layout (one class)**
- Thumbnail · category tag (e.g., `YOGA`) · title · instructor · start time + tz · duration.
- **Credit info line** (dynamic per user state):
  - On Bundle: *"1 credit required · You have X credits left"*
  - On Unlimited: *"1 credit required · You have unlimited credits"*
  - Logged in but no/exhausted package: *"1 credit required · No credits available"*
  - Logged out: *"Log in to see your credit balance"*
- Right side: action button (states below).

**Button states (per row)** — first match wins; the waitlist rows are `spec-waitlist.md` §9, read from each class's `has_seats` and `waitlist { enabled, open, my_entry }`.
| User state | Button |
|---|---|
| Already booked by user | "Booked" (link → `/account/classes`). A booked class never shows a waitlist control. |
| In this class's line (`waitlist.my_entry`) | "On waitlist · #N" with a secondary "Leave" → confirm dialog → toast *"Left the waitlist."*; the row then reads "Join waitlist" if the line is still open, else "Full" |
| Booked into another class, private session or workshop day that overlaps this one (`clash`), and the class would otherwise offer Book or Join waitlist | "Clashes · {its start time}" (muted; the row dims) — a tap opens the class detail. Under the row: *"You're booked into {title} at {time} ({Location}), which overlaps this class. Cancel that booking to book this one."* and a **My bookings** link. One body, one class at a time: no travel time is added, and back-to-back is allowed (`class-booking-lifecycle.md` §3.6). A booking or join refused `time_clash` since the schedule was read shows the same, titled "Time clash"; a booking made from the row re-reads the schedule so the classes it now overlaps show it |
| Logged out, seat available | "Book Now" → `/login?next=/booking/confirmation?sessionId=...` |
| Logged in, has credits, seat available | "Book Now" (sage, filled) → the **Book sheet** *"Book {class}?"* (date, time, location, instructor, the package picker below, and the cancellation policy) → "Book class" books it with the picked package, "Not now" closes it; nothing is spent until "Book class" |
| Logged in, no credits / exhausted | Grey "Book Now" → popup *"You need a package to book this class"* → "Buy a Package" CTA → `/packages` |
| Online seats full + `waitlist.open` (studio switch on, before the Cancellation Window, room in the line) | "Join waitlist" (warning, outlined). Joining debits nothing; the row becomes "On waitlist · #N" without a reload |
| Online seats full, waitlist off / closed / full | "Full" (muted, disabled) |
| Class started/ended | "Ended" (disabled) |

**The Book sheet is the package picker** (`be/docs/adr/0010-several-packages-run-per-family.md`). A member may have several class packages running at once — Credit Bundles, Unlimited Plans, the Trial — and chooses which one pays. The sheet reads `GET /me/classes/:id` for the class it opened (the class list stays cheap and anonymous) and lists the member's class packages as a radio list, in the server's default order:

- **Pre-selected: the Default payer** (`default_client_package_id`) — a running package before a Dormant one, the soonest-ending running one first; with nothing running, an Unlimited Plan before credits. Booking stays one tap.
- Each row: the package's name, what it has left (credits, or "Unlimited"), and its end date if running.
- **Ineligible packages are shown greyed and cannot be picked**, each with its reason:

  | `reason` | Row says |
  |---|---|
  | `not_accepted` | "Not accepted for this class" — the class's **Package rule** does not take it (be/CONTEXT.md § Package rule) |
  | `location_not_covered` | "Covers {Location} only", with the Cross-Location Add-On link beside it (§7) |
  | `plan_expires_before_class` | "Ends before this class" |
  | `insufficient_credits` | "Not enough credits" |

- **Picking a Dormant package** adds "Starts today, runs until {date}" (`activation_end_if_picked`) — picking it starts its clock at this booking, beside whatever else is running.
- The cost line reads from the picked package ("Uses 1 credit" / "Covered by your plan").
- "Book class" sends `{ class_id, client_package_id }`; the response's `paid_with` names the package that paid. A refusal for the picked package (a stale sheet) shows that reason's copy. With nothing Eligible the sheet has nothing to pick and the row's own blocked state applies (the "You need a package" popup, or the Location nudge in §7).
- **A booked class is celebrated.** On success the sheet gives way to a small celebration (`components/booking/booked-celebration.tsx`): a confetti burst (none under reduced motion), **"You're booked!"**, one light-hearted nudge to remember the class (picked at random from a few, each ending on the calendar), the class, date, time, location and instructor, and "Paid with {package}" when the member had packages to choose between (this replaced the "Booked with {package}." toast). Its actions: **Add to Google Calendar** — Google's prefilled new-event page (`calendar.google.com/calendar/render?action=TEMPLATE…`, times in UTC) in a new tab, where the member presses Save; no Google sign-in or calendar permission is asked of the app; then **Done**. The event is titled "{class} at {studio}", its place is the Location's name and street address (the text Google searches, so the address is what pins the studio), and its description carries a "Directions:" line with the Location's map link (`gmaps_url`, when set) and links back to My Bookings. The "Approved!" celebration's event (§11.2) does the same; an off-site corporate session's place is its venue text, with no directions line. Helpers: `lib/add-to-calendar.ts`.

There is no other way to choose: the old "use N credits" shortcut on a blocked row is gone (§7), and `use_credits` is no longer accepted by the server.

**Package rules.** A class may accept only some packages, or all but some (be/CONTEXT.md § Package rule). The class list carries only a boolean `restricted`, and a restricted row shows a small **"Some packages"** hint; which ones is on the class detail. A package the class does not take is greyed on the Book sheet with "Not accepted for this class", and a booking refused `409 not_accepted` (a stale sheet, or nothing the member holds is accepted) says the same in the member's words.

**Class detail overlay.** Tapping anywhere on a class row opens the class's detail — the row's own Book / Join waitlist button still acts directly and does not open it. A wide panel from `sm`, a full-height sheet on phones; rendered on `document.body`, focus-trapped, closing on Escape and on the backdrop, and fitting 360px with its own scroll. It reads `GET /public/classes/:id` signed out and `GET /me/classes/:id` signed in, for the class opened only, and shows:

- the class type and its description; the date, start, end and length;
- the instructor and every supporting instructor;
- the Location with its address and a map link, and the room;
- the credit cost, and **Availability**: "Available", or, full, "Full · waitlist open", "Full · waitlist closed" or "Full" (`lib/class-detail.ts` `seatsLine`) — never a count;
- the effective Cancellation Window;
- the packages accepted: **"All packages"**, **"Only: …"** or **"All except: …"**, naming each;
- signed in, the member's own class packages, each ticked or with the reason it cannot pay (the Book sheet's reasons above); signed out, a prompt to sign in to see which of theirs can pay.

Its **Book** button opens the same Book sheet as the row's. A class the member is already booked into, or waiting for, opens with that state.

A waitlist is never offered while a seat is free — the member books it. Refused joins, in the member's words:

| Code | Member sees |
|---|---|
| `waitlist_closed` | "This class starts within N hours, so the waitlist has closed." (N from the refusal's `window_hours`) |
| `waitlist_full` | "The waitlist for this class is full." |
| `waitlist_disabled` | "This studio isn't taking waitlist sign-ups right now." |
| `class_not_full` | "A spot just opened in this class — you can book it now." (the row is re-read and offers Book Now) |
| `already_waitlisted` / `already_booked` | Nothing to explain: the row is re-read and shows the member's place or "Booked" |
| `insufficient_credits` | The "You need a package" popup, as for booking |
| `location_not_covered` / `plan_expires_before_class` / `not_accepted` | The booking's own copy for the same refusal |
| anything else | The generic "Something went wrong. Please try again." dialog |

**My Bookings** (`/account/classes`) lists the member's places in line in a **Waitlisted** group above Upcoming — class, instructor, location, time, "#N in line" and "Leave waitlist" (confirm dialog, then the banner *"Left the waitlist."*). Read from `GET /me/waitlist` in the same load as the bookings. When a seat opens the member is booked automatically and the class moves to Upcoming (`spec-waitlist.md` §5).

**User journey**
1. User opens `/classes`, defaults to the next 10 days at the first location.
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
- This is a **pre-confirmation reserve step** (not a success page) for class bookings — confirms session details, shows credit balance, lets user pick which package the credit is drawn from (if multiple), and exposes the cancellation window. *(Not built as a page: the class's details are the class detail overlay and the package choice the Book sheet's picker, both in §3.1 — BKG-06.)*
- For workshop purchases and package buys, this page acts as the success endpoint after `/checkout` completes.
- Requires auth + verified user + signed waiver.

**User journey (class flow)**
1. Lands on page with session summary (title, instructor, time, location).
2. Sees credit balance and package selector if user has more than one active package.
3. Reads the cancellation policy ("Cancel up to Xh before — credit returned").
4. Clicks **Reserve Now** → seat held, credit deducted.
5. Success dialog: *"Your booking is confirmed! Please arrive 15 minutes before class."* → CTA "I will attend on time" → routes to `/account/classes`.

**Where admin comes in**
- Admin sets the studio's cancellation window, and staff may give any class (or weekly series) its own. The confirm sheet uses that class's `effective_cancel_window_hours`, and the booking cards its `cancel_deadline` (#313, #318).
- Admin sees who reserved and credit-source per booking (audit trail).

---

## 4. Workshops

**Members only.** Signed out, `/workshops` and `/workshops/[id]` show nothing about any workshop — no name, date, price or instructor — only a "Sign up to see workshops" panel with **Sign up** and **Log in**, each returning to the page after (`?next=`). The API has no signed-out workshop read (`be-client.md` §2), so the page makes no request until there is a session: the point is that a studio's programme can't be lifted without an account.

### 4.1 Browse `/workshops`

**Business logic**
- Workshops are one or multi-day events with finite capacity. Each workshop has:
  - A list of **days** (`WorkshopDay[]`) — each day has its own date, time window, capacity, and base price.
  - A list of **tiers** (`WorkshopTier[]`) — each tier names a name (e.g. "Full Event", "Day 1 only"), an explicit set of `day_ids` it grants access to, a regular price, and optional early-bird price + cutoff.
- **Tier capacity is derived** as the *minimum capacity across the days it covers* — a tier can never sell more than the smallest constituent day's room. The server is the authority. As for classes (§3.1), the member is never told a count: a tier with no room reads as full, and the catalogue sends no day's capacities.
- Workshops are **paid directly** — credits cannot be used. The card carries a clarification note: *"Direct payment only — credits cannot be used."*
- Status: upcoming / fully enrolled / ended.
- Free workshops (price 0) use **"Register"** copy and skip checkout entirely — go directly to a confirmation success page.
- Optional **waitlist** per `WorkshopDay` (capacity now decomposed into `waitlist + online_booking + buffer` — see admin spec).
- Promotions on workshops follow the same best-price-wins resolution as packages (§6.1).

**List layout**
- An **ended** workshop is left off the list: there is nothing left to book. The location chips list only locations with a workshop still to come.
- The rest is grouped: **Happening now** (started, not yet over), then one group per **month** of start date in studio time ("This month", then "October", with the year only when it differs), then **Dates to be announced**.
- The groups are an accordion, **at most one open**, behaving exactly as the class schedule's days (§3.1), scrolling included. The first group opens by default, each collapsed group shows its workshop count, and tapping the open group closes it. If a location filter empties the open group, the first remaining group opens.

**User journey**
1. List rendered as **expandable accordion cards**. Card header shows title, instructor, level badge (colour-coded), date, *"From S$X"* on the collapsed view. No seat count (§3.1).
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
- _As built:_ the dates under the title always carry the year (Singapore time, `formatWorkshopDates`): one day "Fri, 5 Mar 2027"; consecutive days date to date, "Fri, 5 – Sun, 7 Mar 2027"; days with gaps as their runs, "Sat, 15 – Sun, 16 Aug · Sat, 22 – Sun, 23 Aug 2026". The list's cards read start to end the same way.
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
3. **Preferred class type** — **Any** (the default) or **Selected**. Choosing Selected opens an overlay (a bottom sheet on a phone, a dialog from `sm` up) listing the active class types; the pick shows under the toggle with a "Change" button. Any sends no `class_type_id`. Helps the admin pick an instructor.
4. **Proposed slots** — 1..N rows of `{ date, start_time }`: a start time only, no end — the session's length is settled when the studio schedules it. Date picked via calendar within the studio's **Book in advance** window: at least its minimum (3 days by default) and at most its maximum days after today, on the Singapore calendar (`GET /public/pt-booking-config`). A light-blue notice over the times states it, e.g. "Book at least 3 days ahead, up to 7 days ahead (Wed 1 Oct – Sun 5 Oct)", and the picker is capped to match; the form checks each date itself in those words rather than the browser's validation bubble, and the server refuses either side (`slot_date_too_soon`, `slot_date_too_far`), read back as the same rule. Start time from a list on the hour and half hour (`00` / `30`). "Add another slot" button below the last row. Multiple slots maximise the chance the studio can schedule one of them.
5. **Note** — optional free-form message to the studio.

The studio can write back on the request: when it schedules a time none of the proposed slots, its **note** shows on the booking under "A different time from the ones you proposed"; when it cancels, its **reason** shows under "Why the studio cancelled". Both attendees of a 2-on-1 see them.
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
2. Fill the form: location, session type, preferred class type, one or more proposed start times, optional note, partner (if 2-on-1).
3. **Send request · N sessions** checks the form, then opens the **request sheet** — the PT request's Book sheet (§3.1), where nothing is debited yet (`components/private-sessions/confirm-pt-request-sheet.tsx`). The form itself has no package field. *"Request a {1-on-1 \| 2-on-1} session?"* states the Location, preferred class type (or "Any class type"), the partner and each proposed time, then **Pay with**: every PT package of that session type as a radio list, each with its sessions left and its clock ("starts when your first session is scheduled" while Dormant, else "until {date}"), and "Sessions with {instructor}" on a bound one. The first that can pay starts ticked; one with fewer sessions than the request needs is greyed with *"Only N sessions left — this request needs M"*. The cost line reads "Uses N sessions from {package}". With none able to pay, the sheet says so and offers **See packages**. **Send request** submits with the picked package; a refusal shows inside the sheet. A member with no PT package of that type at all still gets the "Buy a private session package" prompt on the form. Helpers: `lib/pt-package-picker.ts`.
4. Sent → the **"Request sent!"** celebration (as §3.1's, without a calendar — there is no time yet): a light line about hearing back on WhatsApp, and what was asked for, when and where. **Done** goes to `/account/private-sessions`, the new request in the **Pending** group.
5. Studio takes over on WhatsApp, then schedules in `/admin/pt-requests` → the member's app shows the **"Approved!"** celebration with the final time, place and instructor and Add to Google Calendar (§11.2), and the row moves to **Confirmed** on `/account/private-sessions`. _(No approval email is sent yet.)_
6. If the studio can't accommodate any proposed slot and the WhatsApp negotiation fails, either side can **cancel** the request from their UI. While `pending`, cancel refunds credits.

**Where admin comes in**
- **`/admin/pt-requests`** triage page is the single surface — see admin-restructure.md §9.
- The system enforces the invariant: **no `PtSession` exists without a backing `PtRequest`** in v1.
- Instructor profile pages on the staff side manage bio, photo, and eligible class types (no `available` flag, no availability slots — the surface was removed).

---

## 6. Packages

### 6.1 Packages `/packages`

**Business logic**
- Four-section catalogue:
  1. **Trial Pass** — quota-based intro pack (e.g. 3 trial classes / 30 days / S$30). **One purchase per client, ever** — enforced server-side at purchase time. A previously-purchased trial (active or expired) blocks further trial purchases and the card's button renders disabled as "Not eligible" ("New members only" for a member who holds other packages).
  2. **Credit Bundles** — N credits, validity in days, fixed SGD price. Examples: Bundle of 10 (S$300 / 90d), Bundle of 20 (S$550 / 180d), Bundle of 30/50/100.
  3. **Unlimited** — duration-based (1 / 3 / 6 months) at a fixed price; lets the holder book unlimited group classes **at one Home Location, chosen at checkout** (§7) — never both, unless the plan also carries a paid Cross-Location Add-On. The card reads "Covers one studio — you choose at checkout," not "Valid across both locations."
  4. **VIP Private Sessions** — 1-on-1 or 2-on-1 packs with a session count.
- **Where a package works.** A Trial Pass or Credit Bundle card carries a "Covers" row under its validity line holding one map-pin **All locations** chip — the same pill an Unlimited plan uses for its Locations, and the same wording at a studio with one Location. The Account's active packages card shows it in the same row where an Unlimited plan lists its Locations. _As built:_ the shop's Unlimited card carries one **One home studio, chosen at checkout** chip in that row, and a PT card an **All locations** chip (it replaced the "Any location" feature line), so every card answers "where?" in the same place.
- **How long it lasts.** The line under the headline reads **"Use within N days of your first class"** (PT: "…of your first session"; an Unlimited card: "Starts at your first class"). N is the studio's own `validity_days`, printed as stored — to show 60 rather than 59, the studio edits the package's validity in the portal.
- A user holding a Bundle cannot purchase Unlimited (and vice versa) until the existing one expires or is exhausted. UI flags this and blocks purchase with copy. Trial Pass and VIP are independent and can co-exist with any other holding.
- Trial sits at the top of the page above the Credits / Unlimited toggle. VIP sits as an independent fourth section.
- Who may buy a trial, and what happens if they turn out not to qualify, is **studio policy** and so studio data: `tenant_settings.copy->>'trial.terms'` (plain text). When set, it shows above the trial cards and in an acknowledgement dialog before checkout, whose checkbox reads `trial.acknowledgement` (a neutral "I have read and accept these terms." when unset). When `trial.terms` is unset there is no notice and no dialog.

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
2. On success → a pending corporate request is created; the user lands on `/account/corporate` (§8.8) with a WhatsApp contact button (number the studio's own `tenant_settings.copy->>'contact.whatsapp'`).
3. Studio negotiates on WhatsApp, then schedules → the request flips to **Scheduled** (date/time, location, instructor shown), and the member's app shows the **"Approved!"** celebration with Add to Google Calendar (§11.2). After the session, it moves to **done** (attended). Either side can end up at **Cancelled**.

_As built, a corporate request is sent from the package card's request form (preferred venue and notes, no payment — `submitCorporateRequest`); sending it shows the **"Request sent!"** celebration (§5.2 step 4) naming the package and venue, and **Done** goes to `/account/corporate`._

**Where admin comes in**
- Admin (superadmin) manages corporate packages under Packages.
- Admin handles requests on the **Corporate Requests** portal page and schedules them from the Schedule's "+ Corporate" picker — see `admin-restructure.md` §9b.

---

## 6b. Merch `/merch`

**Business logic**
- Grid of the studio's merch (`GET /public/merch`): photo, title, description, price. Signed-in or not — merch is priced the same for everyone, so there is no authenticated variant of the list.
- A **notice sits above the grid**: merch is paid for online and **handed over physically at the studio**. Nothing is shipped. The same sentence repeats on the confirmation page and in `/account/merch`, because it is the one thing a member could otherwise get wrong.
- **Buy** goes straight to Stripe — one item, no quantity, no Promo Code, and **no `/checkout` review step**: there is nothing to review. Unauthenticated taps hit the auth gate first (context "buy merch"), returning to `/merch` after sign-in.
- An item the studio priced at 0 skips Stripe and writes the order immediately, same as a free workshop.
- Archived items simply stop appearing; a checkout against one is refused (`400 merch_not_available`).

**User journey**
- Sidebar → Merch → reads the collect-in-person notice → Buy → Stripe → confirmation ("we'll hand it over at the studio") → `/account/merch`.

**Where admin comes in**
- Admin or superadmin adds items (title, description, price, photo) under Packages → Merch in the portal — see `be-portal.md` §`merch.ts`. There is no stock count and no fulfilment state: the front desk works off the member's purchase history.

---

## 7. Checkout `/checkout`

**Business logic — the review step is live, and every paid purchase routes through it.**

The dead `/checkout` page from the earlier spec is gone. `/checkout` is now a real review step, and it is the **only** surface in the member app with a code input anywhere — a Promo Code can be scoped to any product, so the picker's page and the code's page have to be the same page. A package or workshop tier priced above zero keeps its existing auth gate (login modal, return-to-page) and then pushes here; at zero it keeps the old post-and-grant, so a Promotion that drives a package to $0 falls into the free branch for free — the branch is decided by price, not by kind. The Trial card never used the buy button and is untouched.

**A studio that takes no online payments** (#293) — one that has not supplied its own payment account — shows "This studio isn't taking online payments yet." in place of every paid buy button and of the Pay button here, read from `GET /public/online-payments`. A $0 item keeps its button: it never reaches the payment provider. If the read is slow or fails the buttons stay, and the server's `payments_not_configured` refusal reads as the same sentence (`fe-client/src/lib/online-payments-rule.ts`).

**What the page carries, top to bottom** — rows marked *(unlimited)* render only when the item being bought is an Unlimited Plan:

1. **Order summary** — item, validity / event date, price.
2. **Home studio** *(unlimited)* — two radios, one per Location, address shown on each, **no pre-selected default**. Pay stays disabled and reads "Choose your home studio to continue" until one is picked. ~~**A renewal** — bought while the member already holds a live Unlimited Plan — replaces the radios with a locked row: "Your renewal continues at Harbour Studio. Ask us if you need to move it." A member may only renew at their existing plan's Home Location.~~ Superseded by `be/docs/adr/0010-several-packages-run-per-family.md`: a member holding a live plan may buy another at any Location, including one homed elsewhere, so a renewal gets the same radios; there is no cap on how many plans a member holds. Moving an existing plan's Home Location is still a portal-only, admin-audited action.
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
6. **Home studio, restated** *(unlimited)* — "Your home studio is Harbour Studio for the next 6 months." directly above Pay, so the member passes the irreversible choice twice before money moves.
7. **Pay.** A discount that takes the total to $0 skips the payment step entirely and grants immediately, the same free path packages and free workshop tiers already use.

**Two entry points for a standalone Add-On purchase** against a plan the member already holds — no new Unlimited purchase involved: the nudge on a blocked class (below), and the plan card on the account page. Same review page, entered with the target plan's id instead of a catalogue item.

**The blocked class is a nudge, not an ad.** On `/classes`, a class outside a member's plan coverage is shown, not hidden — the row dims, takes a "Not in your plan" lock chip where the Book button was, and carries one line under a hairline: "Your plan covers **Harbour Studio** only. [Add Parkside Studio for $30/month]". The link is weighted below the class itself — a louder treatment was tried and rejected because this state repeats on every wrong-Location class in the week's schedule, and at that density an accent border and a filled button read as an ad break. Coverage is read across **every** plan the member holds (`entitlements.unlimited_plans`), not one; a member who also holds credits, or a second plan homed at that Location, pays with it by picking it on the Book sheet (§3.1). *(The "· or [use 1 credit]" link that used to follow is gone with `use_credits` — `be/docs/adr/0010-several-packages-run-per-family.md`.)* A blocked class never silently spends a credit.

**Four confirmation emails**, one per completed purchase, none for an admin's complimentary grant:

| Purchase | Slug |
|---|---|
| Paid class / PT package | `package_purchase_confirmed` |
| Paid workshop | `workshop_purchase_confirmed` |
| Free trial pass | `trial_pass_purchase_confirmed` |
| Free workshop tier | `workshop_purchase_confirmed` |

Every purchase succeeds even if the email fails to send — the send is a fire-and-forget step after the entitlement is already granted. An Unlimited Plan's confirmation reads "Valid 6 months from your first class — your plan activates when you make your first booking" only when the purchase is actually Dormant — which, since every purchase lands Dormant (`be/docs/adr/0004-every-package-activates-on-first-booking.md`), is every purchase, whatever else the member holds; the dated "Expires {date}" line is left for a row that already has an expiry — see `be-client.md` §4e for the exact branch. The receipt link never points nowhere: a paid purchase links to the Stripe receipt, a free one falls back to the account page.

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

The account section is a sticky sidebar (desktop, from `lg`) listing **My bookings** (`/account/bookings`), **My activity** (`/account/practice`), **My packages** (`/account/packages`), **Merch**, **Profile & security**, **General settings**, then a red **Sign out**; the member's card at its top opens `/account`. All sub-pages share an `AccountShell`.

### 8.0 Account home `/account` (as built)

No greeting: the page opens on unfinished purchases (#93) and the checkout-cancelled banner (#274), then **Up next** only: the one ticket of the old "Coming up" below — the same component the schedule shows above its feed (`ComingUp`), with **Show my QR** and a red **Cancel**. Below `lg` the **My account** menu follows it: the member's card (→ Profile), My bookings, My practice, My packages, Merch, Profile & security, General settings, and a red **Sign out**. Every section page heads itself with "‹ Account" back to it below `lg`.

### 8.1 My bookings `/account/bookings` (as built)

Every booking and request the member holds, in one list (`lib/my-bookings.ts`, tested in `my-bookings.test.ts`):

- **Filters**, as the packages shop reads, centred: **Upcoming / Ongoing / Past** as the pill tabs with counts, then the booking type — **All / Classes / Private / Workshops / Corporate** — as words on a hairline under them (`SubTabs`). `?type=` (`class`, `pt`, `workshop`, `corporate`) and `?when=` open it filtered.
- **Placing**: a class is Upcoming until it starts, Ongoing while it runs, Past once it ends or is cancelled. A **pending PT or corporate request is Upcoming** (it can still be cancelled); a scheduled one follows its session; attended or cancelled is Past. A workshop with no dates yet is Upcoming; a cancelled one is Past.
- **One card for every kind** (`booking-cards.tsx`): date stub, one small line with the kind (class accent, PT gold, workshop green, corporate cyan) · its status, the name, the time, then instructor / location / room / partner / tier as plain icon-and-text details, the QR where there is one, and the check-in code with the action in the footer. Every cancel is **red** (`BTN_CANCEL`): Cancel on a class, Cancel request / Cancel on a PT request, Leave waitlist.
- **Tapping a card**: a class opens its detail (`BookedClassOverlay`), dressed as the schedule's class detail — the class type's description, instructor and any supporting ones, the Location with its address and map link, the room — with the member's own booking in place of seats and packages: where they stand ("You're booked into this class", "You checked in to this class", "You cancelled this booking", "Marked as a no-show"), what paid ("Unlimited" or the credits used), the cancel deadline and a red **Cancel booking** while it can be cancelled, and the check-in code while it is live. The class is read from `GET /public/classes/:id`, which serves one that has already run. A workshop card opens the workshop's page; a PT or corporate card, which already shows everything there is, opens nothing.
- **Waitlisted** places sit above the Upcoming list (All or Classes).
- The old per-kind pages — `/account/classes`, `/account/private-sessions`, `/account/workshops`, `/account/corporate` — redirect here with their filter set (`?submitted=1` from a PT request becomes the "Your request is in" banner).

### 8.1a My packages `/account/packages` (as built)

Every package the member has bought, each marked **Active**, **Not started** (Dormant until its first booking) or, once run out, **Expired** / **Used up**. Tabs **Current** (the default: Active and Not started) / **Active** / **Not started** / **Ended**, with counts, centred. Each card leads with one small line — the kind (Classes / Unlimited / Private) · its state — as My bookings' cards do. Current ones show their balance and what they Cover (plain icon-and-text, as everywhere a package's Locations are listed) (an Unlimited plan its Home Location and any Add-On; a bundle, trial or PT package "All locations"), and the Add-On offer where it applies. Ended ones come from the same `GET /me/packages` read (the rows `active` is false for, or whose expiry has passed), shown dimmed without a balance.

### 8.1-old Dashboard `/account` (superseded by §8.1 / §8.1a above)

**Business logic**
- Summary / hub view that consolidates:
  - **My Packages** card group (per studio): bundle credits with a CreditRing visual + expiry; unlimited with an "Unlimited" badge + expiry; PT sessions remaining per format (1-on-1 / 2-on-1) + expiry. Expired packages render greyed with an "Expired" badge. **Every running package is listed**, not one per kind — a member may have several running at once in either Family (`be/docs/adr/0010-several-packages-run-per-family.md`), and each clock is shown.
  - **Membership** card (per studio): plan name, status badge (Active / Expired), package expiry. **No "Cancel Membership" button** — replaced with **"Contact Sales Team"** → WhatsApp deep link (`wa.me/65...`).
  - **Expiry banner** appears at t-30 / 15 / 7 / 1 days / 12h / 2h before package end. Banner only renders if the chosen milestone is shorter than the package's full duration (avoids absurd "expires in 30 days" on a 1-day pass).
  - **Coming up**: only the one booking the member walks into next — a class, a PT session or a workshop, whichever starts first (a running one first) — as a ticket coloured by kind: class in the studio accent, PT gold, workshop green. It carries **Show my QR** and a red **Cancel** where the member may still cancel (a class until it starts; a PT session they requested, outside the PT window; never a workshop). Nothing after it is listed here; **Your classes** links to My Classes.
  - **Your packages**: every package the member holds, each marked **Active** or **Not started** (Dormant until its first booking), so a package that has not begun never reads as active. There is no summed balance (no "Class credits" / "PT sessions" tiles) and no "Your practice" attendance card — both were removed as not useful here. The attendance figures now have their own page, My practice (§8.1c).
  - Quick links to other account sections (My Classes / Workshops / Private Sessions / Invoices / Referral / Profile).
- Cards are grouped by studio (header with studio name + logo) so a member of both locations sees their entitlements split cleanly.
- If user has no active package: empty state with **"Explore Classes"** CTA → `/classes` and **"View packages"** CTA → `/packages`.

**User journey**
- Lands here after login. Glances at credits + upcoming sessions. Taps an upcoming booking → expanded view with QR + cancel/reschedule. Taps "Contact Sales Team" on membership → WhatsApp deep link with a prefilled message.

**Where admin comes in**
- Admin needs to issue / extend / pause / cancel memberships from a user-detail page (already partly built — D.4 commit).
- Admin sees the same expiry milestones to drive comms (auto reminders).

### 8.1c My activity `/account/practice` (as built, #340 / #341 / #342; once "My practice")

What the member attended in a week, month or year, from `GET /me/bookings/attendance?period=week|month|year[&on=YYYY-MM-DD]` (be-client §3). A **session** is a group class or a private session the member was marked attended at — imported history included; workshops are left out of the headline and the chart (the backend counts them by their first day, not by day) and shown only as a part of What you practised; no-shows, cancellations and sessions not yet ticked never show. Words and layout are `lib/practice.ts` (tested in `practice.test.ts`); the read is `lib/use-practice.ts`. A period is **current** while there is no later one to step to (`has_next`).

- **Placing**: in the account sidebar and the mobile account menu right after My bookings — "My activity", hint "Sessions you've attended". The page has the "‹ Account" back link below `lg`.
- **Title**: "My activity", with no line under it (the lifetime total is not shown).
- **One card height**: the chart's card keeps one height across Week, Month and Year — the head (count or empty line) holds a fixed height, and the chart area is sized to a six-week month, the tallest it gets, with the week's and year's columns stretching to fill it and the legend at its foot — so switching period never makes the card jump.
- **Period switch**: **Week / Month / Year** (the account's segmented tabs), opening on Month. Switching period goes to the current one.
- **Stepper**: ‹ and › either side of the period's dates — "28 Sep – 4 Oct" ("21 – 27 Sep" inside one month, "29 Dec 2025 – 4 Jan 2026" across a year end), "September 2026", "2026". ‹ asks for the day before the period opens, › for the day after it closes; each is disabled where the backend says there is nothing (`has_previous`: never before the year of the first attended session; `has_next`: never past the current period). While the next period loads the last one stays up, dimmed, with both steps disabled.
- **Headline**: at the top of the chart's card, "13 sessions" — the number large in the app's own type, not the period (the stepper names it) — and the comparison across from it: "3 more than August" — "than last week" (a past week: "than the week before"), "than August", "than 2025"; "Same as …", "… fewer than …". There is no classes / private sessions split: What you practised shows it.
- **The chart**, in the studio accent: solid for attended, dashed for a session still booked in the current period (a legend says Attended, and Booked when there is any):
  - **Week**: Monday to Sunday, a rounded column per day filled from its foot with the day's sessions on a shared scale (at least three), a dashed cap for what is booked, the count on top, today's weekday in bold ink, days after today with nothing booked faded. A column with sessions opens that day, as a month's tile does (below).
  - **Month**: a calendar, Monday first, a tile per day — solid for a day attended, dashed for one with only a booking, a dot per session under the date (up to three), faint for a day that passed with nothing, blank after today; today's date in bold (no ring, no dot). A tile with sessions opens that day in an overlay held mid-screen at every width (as is the class detail it opens): its classes and private sessions as My bookings' own cards (§8.1) — the ones the tile counted: a class or private session attended then, or booked and not yet started — each opening its detail and cancellable there as on My bookings; "Tap a day to see its sessions" sits under the legend. A cancel from a day reads the month again.
  - **Year**: a rounded column per month on one shared scale, the count on top; months not yet reached keep a faded track and initial, never drawn as zero.
  - Its text equivalent is the figure caption: "13 sessions attended in September 2026, and 1 booked.", "… in the week of 28 Sep – 4 Oct …", "… in 2026." On load the columns grow up, the month's tiles settle in one after another, What you practised's bars run out and the headline counts up; with reduced motion they are simply there.
- **Three figures**, each number large with its unit small after it: Time on the mat ("13h 45m"), **Days practised** — the days in the period with a session attended, not sessions and not what is only booked ("11 days"; a year, bucketed by month, reads **Months practised**, "9 months") — and **Total attended** — every session attended in the period, group classes, private sessions and workshops alike ("15 sessions"; the headline and chart leave workshops out, this counts them). Not shown before the first session ever.
- **What you practised**: the period's sessions as one bar split into parts (`practiceSplit`), each a share of the period's total — the (up to three) most-attended class types in shades of the studio accent, **Other classes** for the rest of the classes, palest, **Private sessions** in the PT gold and **Workshops** in the workshop green — then a row per part with its count and percent ("Ashtanga Led  1 · 33%"). There is no separate workshop line. Equal parts read as equal shares. The bar runs out from the left on load.
- **Empty period**: "No sessions in September yet." / "No sessions this week yet." / "No sessions in 2026 yet." — without "yet" for a period that has passed ("No sessions in August.") — with **Book a class**, in the chart card's head. **Book your next class** closes a period that has sessions; both go to the schedule.
- **Loading**: through `useCachedResource`, keyed by member, period and day, so a revisit draws at once and re-reads quietly, a slow reply for a period the member has moved off never replaces the one on screen, and a reply that lands after sign-out or for another member is dropped. The page holds under the page loader until its first read. A failed read shows "Couldn't load your practice." with Try again.

### 8.1b My Merch `/account/merch`

**Business logic**
- Purchase history for merch (`GET /me/merch-orders`), newest first: title, amount paid, purchase date. Read-only — collection is arranged at the front desk, not in-app.
- `title` and `amount_sgd` are frozen at purchase, so renaming or repricing an item never rewrites what a member sees they bought.
- Empty state → "Browse merch" CTA to `/merch`.

**Where admin comes in**
- The front desk hands the item over against this list on the member's next visit.

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

### 8.2a General settings `/account/settings` (as built)

How the app looks for the member: **Theme** (Light, Dark) and **Text size** (Small, the size the app was designed at, Medium, Large). A pick applies at once, with no Save button, and is saved to the member's account (`PATCH /me/display-prefs`), so every device they sign in on follows it: the profile read after sign-in adopts the account's choice (`lib/auth.ts`). A copy is kept in this hostname's `localStorage` so a reload paints in the member's choice before any fetch (`lib/display-prefs.ts`). A save that fails says so and leaves the change on this device, owed to the account: the next profile read sends it up rather than overwriting it. Saves go one at a time, each carrying both fields, so the last pick is the last write.

### 8.3 My Classes `/account/classes`

> **As built:** a filter of Your bookings (§8.1); the URL redirects to `/account/bookings?type=class`.

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

> **As built:** a filter of Your bookings (§8.1); the URL redirects to `/account/bookings?type=workshop`.

**Business logic**
- Same upcoming/past split, scoped to workshops.
- Includes refund status if a past workshop was cancelled.

**Where admin comes in**
- Admin manages refunds and roster. Can move attendees between dates.

### 8.5 My Private Sessions `/account/private-sessions`

> **As built:** a filter of Your bookings (§8.1); the URL redirects to `/account/bookings?type=pt`. Pending requests list under Upcoming, cancelled ones under Past.

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

> **As built:** a filter of Your bookings (§8.1); the URL redirects to `/account/bookings?type=corporate`.

**Business logic**
- Lists the user's corporate requests, one card per request, with a status that the FE reflects back from the backend:
  - **Pending** — request created on purchase; shows a **WhatsApp contact** button (deep link to the studio's own `tenant_settings.copy->>'contact.whatsapp'`) so the user can start the conversation. No in-app form.
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
- No credit balance in the top bar: the avatar alone, which opens `/account`, where each package shows its own balance.

### 9.2 Footer

- Studio info, location addresses, social links, legal links (Terms, Privacy), copyright.
- (No "For Business" / SaaS marketing link — a studio's client app is for that studio's members, not a pitch surface for the platform.)

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
| Class cancelled by user (in time, under the cap) | Banner | "Booking cancelled · 1 credit returned." |
| Class cancelled by user (in time, over the cap) | Banner | "Booking cancelled · the credit wasn't returned, because you've used up your cancellations this cycle." |
| Class cancelled by user (inside the window — a late cancellation) | Banner | "Booking cancelled · a late cancellation, so the credit wasn't returned." |
| Class cancel refused (the class has started) | Banner | "This class has already started, so it can no longer be cancelled." |
| Workshop purchased | Confirmation page | "You're registered for [workshop]. We've emailed your receipt." |
| Package purchased | Confirmation page | "[Package name] is now active. Start booking from /classes." |
| Private session requested | Confirmation page | "Your request is pending. We will update you within 12 hours." |
| Class waitlist join | Toast | "Class is full — you're #N on the waitlist. We'll book you in and email you if a seat opens." No email is sent on join; this toast and My Bookings are the only feedback. |
| Class waitlist left | Toast (class row) / Banner (My Bookings) | "Left the waitlist." |
| Workshop waitlist join | Toast | "You're on the waitlist. We'll notify you if a seat opens." _(workshop waitlists are not built — `spec-waitlist.md` §12)_ |
| Verification successful | Toast | "Email verified ✓" / "Phone verified ✓" |
| Payment failed | Inline error in checkout | "Payment failed. [reason]. Please try again." |

### 11.2 Out-of-session events (push to email / WhatsApp / in-app inbox)

| Event | Channel(s) | Notes |
|---|---|---|
| Booking confirmation (any) | Email | Includes per-booking QR link |
| Workshop purchase receipt | Email | PDF invoice attached or linked |
| Private-session request approved/rejected | Email + in-app | Approval includes QR; rejection may include alt-time suggestion. _Built: the in-app approval only (below); no email is sent yet._ |
| PT or Corporate Request approved (scheduled by the studio) | In-app celebration | The member's app shows **"Approved!"** once per request: a confetti burst, a light-hearted nudge to remember, the session's title, date, time, place and instructor, **Add to Google Calendar**, then **Done** (`components/approvals/approval-celebration.tsx`). Read from `GET /me/approvals` on every page a signed-in member opens, when the tab comes back into view, and every minute while it is visible, so a member online when the studio schedules sees it within a minute, and one who was away sees it on their next visit, on whichever device. Done (or closing it) sends `POST /me/approvals/{pt\|corporate}/:id/seen`, and it is not shown again. Only the requester's own (not a 2on1 partner's, nor a manual session staff made) and only a session still active and yet to start; one cancelled or already past is dropped. An admin impersonating the member sees it without clearing it. The flag is `approval_unseen` on `pt_requests` / `corporate_requests`, set by scheduling. |
| Promoted from a class waitlist | Email (`class_waitlist_promoted`) | "You're in — [class]": a seat opened and the member has been booked, with the credit used and the time they can cancel free until. No claim step — promotion books them (`spec-waitlist.md` §5, §11). |
| Workshop waitlist seat available | Email + in-app | Time-bound CTA to claim _(not built — `spec-waitlist.md` §12)_ |
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
