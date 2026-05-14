# fe-portal + fe-client revisions — class types, location switcher, client package management, trial pass

**Date:** 2026-05-15
**Scope:** `fe-portal/` (admin) and `fe-client/` (member-facing) — Trial Pass touches both. Other revisions are admin-only. Mockup-layer changes — no backend wiring.
**Source of truth deltas:** `docs/md/admin-restructure.md`, `docs/md/backend-architecture.md` will need follow-up edits after this spec lands.

## 1. Goals

Eight independent revisions:

1. Richer **class type** model: description, parent/child hierarchy, difficulty level (including a new `general` level). *(fe-portal)*
2. **Per-page location filters** on the three location-scoped surfaces (Schedule, Workshops list, Check-in) — each owns its own control inline. A fresh-install gate forces the operator to create the first location before anything else is usable. No global topbar switcher. *(fe-portal)*
3. **Client package** management: admins can edit a purchased package's expiry date (credit_bundle + unlimited) and set credit balance directly (credit_bundle only). *(fe-portal)*
4. New **Trial Pass** package kind: unlimited classes within a fixed duration, purchasable once per client. Admin configures it in `/admin/classes`; client sees it on the packages page with a one-time-only purchase CTA. *(fe-portal + fe-client)*
5. Optional **promotions** on every package (trial / credit bundle / unlimited / PT 1-on-1 / PT 2-on-1). Admin can attach one or more dated discounts to a package (quick % buttons or manual override price); client sees discounted pricing during active promo windows. *(fe-portal + fe-client)*
6. Move **workshops** out of the scheduler and into the Packages group as a new `Packages → Workshops` configurator, and reshape them to a **multi-day** model. A workshop has 1..N days (each with its own time, capacity, and base price); pricing tiers bundle one or more days with their own price and optional early-bird discount. Clients can buy a single-day pass or a multi-day/full-event pass. The schedule page renders one tile per day automatically; its `+ Workshop` button becomes a dropdown of existing workshops for quick navigation. *(fe-portal)*
7. **Replace the Availability system with a PT Request inbox.** Remove `/admin/availability` and client-side availability browsing entirely. Clients submit a PT request specifying preferred date(s), time(s), duration, and instructor; admins triage requests in a dedicated `/admin/pt-requests` page where each request can be **scheduled** (creates a PtSession that appears on the scheduler and in the client's account) or **declined with a note** that the client sees. *(fe-portal + fe-client)*
8. **Structured capacity** on every scheduled event (class instance, workshop day, PT session): split a single `capacity` field into `waitlist`, `onlineBooking`, and `buffer`, with a derived `maxCapacity = waitlist + onlineBooking + buffer` shown live in the form. Edited only where the event is scheduled (scheduler forms; workshop-day editor). *(fe-portal)*

## 2. Class Types

### Type changes (`fe-portal/src/types/index.ts`)

```ts
export type ClassTypeDifficulty =
  | "general"
  | "beginner"
  | "intermediate"
  | "advanced";

export interface ClassType {
  id: string;
  name: string;
  description: string;          // new — short marketing/scheduling blurb, plain text
  parentId: string | null;      // new — null = top-level; otherwise references another ClassType.id
  difficulty: ClassTypeDifficulty; // new
  archivedAt: string | null;
}
```

### Rules

- **Single level of nesting only.** A class type with a non-null `parentId` cannot itself be referenced as a parent. Enforced in the create/edit dialog by filtering parent options to `parentId === null` AND `id !== self.id`.
- **Parent select** is optional. If left blank, the class type is top-level.
- **Archiving a parent** does not auto-archive children, but children whose parent is archived show an "Orphaned" subtle badge in the list.
- **Difficulty default** is `general`.

### Seed data updates (`fe-portal/src/data/class-types.ts`)

Existing entries get `description: ""`, `parentId: null`, `difficulty: "general"`. Add one demonstrative child relationship in the seed:

- `Aerial Yoga` (parent) → `Aerial Foundations` (child, difficulty `beginner`), `Aerial Flow` (child, difficulty `intermediate`).

### UI (`fe-portal/src/app/admin/class-types/page.tsx`)

- List renders as a **2-level tree**: top-level rows; immediate children indented under their parent with a subtle vertical guide. Archived parents and their children move to the existing "Archived" section, preserving the same hierarchy.
- Each row shows: name, difficulty pill (`General` / `Beginner` / `Intermediate` / `Advanced`), and a one-line truncated description tooltip. Existing Edit / Archive actions stay.
- "Add class type" dialog gains:
  - `Description` — textarea, optional, soft 200-char limit.
  - `Parent (optional)` — combobox listing active top-level class types. Hidden in edit mode when the row already has children.
  - `Difficulty` — segmented control with the four options.

### Out of scope

No bulk import, no drag-to-reorder, no archive cascade.

## 3. Location filters + fresh-install gate

### Concept

Most admin surfaces are global (catalogues, policies, staff, packages). Only **three** pages care about location:

- `/admin/schedule` — events happen at one location.
- `/admin/packages/workshops` — each workshop belongs to one location.
- `/admin/check-in` — operator is physically at one studio.

Rather than a global topbar switcher that implies wider influence than it delivers, each scoped page owns its own location control inline. Three remaining surfaces (`/admin/clients`, `/admin/inbox`, `/admin/pt-requests`) get optional location filter chips later if admins request them — not in this spec.

### Shared filter component (`fe-portal/src/components/locations/location-filter-chips.tsx` — new)

Used by Schedule and Workshops list:

```
Location  [All] [Breadtalk IHQ] [Outram Park]
```

- Chips are rendered from the active (non-archived) locations array, with an `All` chip prepended.
- Selection persists per-page in `localStorage` (keys: `ys.scheduleLocationFilter`, `ys.workshopsLocationFilter`). Pages do their own filtering on the resulting id.
- Default selection on first visit: `All`.
- When only one active location exists, the chips collapse to a static label "All events at Breadtalk IHQ" (no toggle needed).

Even when `All` is selected, each row on those pages shows a small location pill so the admin always sees which studio an item belongs to.

### Check-in pill (`/admin/check-in`)

Check-in is operationally different — the operator stands at one studio with a scanner; there's no "all locations" use case. Implementation:

- A single-select pill near the page title: `Checking in at: Outram Park ▾`. No `All` option.
- Tapping opens a small menu listing active locations, with a confirmation step ("Switch to Breadtalk IHQ?") to prevent fat-fingering during a busy class.
- Persists in `localStorage` under `ys.checkinLocationId`. On first visit, defaults to the first active location and shows a one-time onboarding hint: *"Confirm you're checking in at the right studio."*

### Fresh-install gate

Lives in `AdminShell`. When `locations.filter(l => !l.archivedAt).length === 0`:

- Sidebar nav is rendered but every link is disabled except `/admin/locations`.
- Main content area is replaced by:

  > **Add your first location**
  > The schedule, workshops, and check-in views all depend on at least one studio location. Add one to start configuring the rest of the system.
  > [Add location] (opens the existing `LocationFormDialog`).

- Once the first location is saved, the gate dismisses; nav re-enables; admin can keep configuring.

### Why this is right

- Honest about scope: a control's reach matches what it actually filters.
- Right defaults per surface: Schedule's `All` matches the "overview both studios" instinct; check-in's "must commit to one" matches physical reality.
- Inline context — chips live next to the content they filter, so there's no "why doesn't class types respect this?" confusion.
- Minimal infra: no `LocationContext` provider, no global state.

### Out of scope

- Topbar / global switcher.
- Per-staff server-side persistence (localStorage only).
- URL query-param sync.
- Filter chips on `/admin/clients`, `/admin/inbox`, `/admin/pt-requests` — add later if needed.

## 4. Client package management

### Type changes

No schema changes to `ClientPackage`. `ManualAdjustment.reason` is repurposed as a free-text "what happened" line, with the audit history covering both balance edits and expiry edits.

### UI (`fe-portal/src/components/clients/client-profile-client.tsx`)

Each package row in the "Active packages" section gets a kebab (⋯) menu in its top-right corner with:

- **Edit expiry** — for `credit_bundle` and `unlimited` (NOT `pt`, which is session-count based).
  - Opens dialog with current expiry date + new date picker + required reason textarea.
  - On save: updates `expiresAt`, appends a `ManualAdjustment` with `delta: 0` and `reason: "Expiry changed from {old} to {new}: {reason}"`.
- **Set credit balance** — for `credit_bundle` only.
  - Opens dialog with current balance, "new balance" numeric input (must be ≥ 0; no upper cap — admin can grant beyond the package's original total to account for goodwill gifts), and required reason textarea.
  - On save: computes `delta = newBalance - current` and reuses the existing `applyAdjustment` flow (so the existing ledger stays the single source of truth).
  - If `delta === 0`, the action is rejected with an inline error.
- **Manual adjustment** (existing) — kept for quick +/- nudges. The standalone "Manual adjustment" button at section header is removed; everything now lives inside each package's menu, with the kebab providing all three actions.

### Audit-trail UX

The "Manual adjustments" section is renamed to **"Package adjustments"**. Each entry renders a tone-appropriate badge:

- Expiry change: neutral badge "Expiry"
- Credit set: accent badge "Set"
- Delta adjustment: sage/error badge `+N` / `-N` (existing)

### Out of scope

- No "extend by N days" shortcut (admins enter the absolute date — fewer footguns).
- No bulk multi-package edit.
- PT package expiry editing — deferred; PT validity isn't in the current type.

## 5. Trial Pass (new package kind)

### Concept

A one-time-per-client "try us out" pass: pay a low price, get a small **quota of class credits** the client can spend at any class. Mechanically similar to `credit_bundle` (N credits, optional validity window) but with a hard one-purchase-per-client constraint and an explicit description (the marketing blurb the client sees on the packages page).

> **Correction from earlier draft:** trial is **quota-based** (e.g. "1 class" or "3 classes"), not duration-based. The `unlimited classes for N days` framing has been dropped.

### Type changes (`fe-portal/src/types/index.ts`)

```ts
export type ClassPackageKind = "credit_bundle" | "unlimited" | "trial";

export interface ClassPackage {
  id: string;
  name: string;
  description: string;          // new — required for trial, optional for others. Plain text, ~280 char soft cap.
  kind: ClassPackageKind;
  credits: number | null;       // credit_bundle + trial
  validityDays: number | null;  // credit_bundle + trial (optional for trial; null = no expiry)
  durationDays: number | null;  // unlimited only
  priceSgd: number;
  status: "active" | "archived";
}

// ClientPackage.kind extended:
export interface ClientPackage {
  // …existing fields…
  kind: "credit_bundle" | "unlimited" | "trial" | "pt";
}
```

`description` is added to all `ClassPackage`s so admins can optionally annotate any product, but the **Trial Pass** card is the only one that surfaces it prominently on the client.

### One-per-client enforcement

**Single source of truth:** a client has "used their trial" iff `clientPackages.some(p => p.clientId === currentClient.id && p.kind === "trial")`. This holds true even after the trial expires — the constraint is "purchased once," not "currently active once." No new flag on the `Client` model.

### Admin UX (`fe-portal/src/app/admin/classes/page.tsx`)

- Page gets a third section between Credit Bundles and Unlimited (visual ordering: Trial → Credit Bundles → Unlimited), reflecting the natural funnel.
- Section: **"Trial Pass"**, with helper text *"A one-time-only introductory pass. Each client can purchase at most one."*
- Re-uses the existing `ClassPackageDialog` with three kind tabs (`credit_bundle | unlimited | trial`). When `kind === "trial"`:
  - Name (required).
  - **Description (required, textarea)** — surfaced on the client app.
  - **Class quota** (required, numeric, ≥ 1) — number of class credits granted by the pass. Usually 1.
  - Validity in days (optional, numeric, > 0) — leave blank for no expiry. Sensible default value-hint shown: 30.
  - Price SGD (required, numeric, ≥ 0).
  - `durationDays` field hidden (trial is quota-based, not duration-based).
- Convention nudge (not enforced in v1): there is usually exactly one active Trial Pass at a time. The list allows multiple but the section header shows a warning chip `⚠ Multiple active trial passes — clients will see the first` if more than one is active. Resolving this in v2; for now, ordering is by `createdAt` ascending and the first active wins on the client.

### Client UX (`fe-client/src/app/(client)/packages/page.tsx`)

The packages page currently renders three main tabs (`Class Credits`, `PT 1-on-1`, `PT 2-on-1`) and inside Class Credits two sub-tabs (`bundle`, `unlimited`).

Trial Pass placement:

- Add a dedicated **hero card** at the very top of the Class Credits tab (above the bundle/unlimited sub-tabs), styled distinct from the standard package grid — wider card, accent border, "Limited offer" pill.
- Card shows: trial name, description (multi-line), price, and the quota line: `{N} class{N>1?"es":""}` plus the validity sub-line `Valid for {N} days from purchase` (omitted when `validityDays` is null), single CTA button.
- CTA states:
  - **Unauthenticated**: `Sign in to claim →` (uses existing `GatedLink`).
  - **Authenticated, not used**: `Claim Trial Pass — ${price}`.
  - **Authenticated, already used**: card collapses into a small inline notice: *"You've already claimed your Trial Pass on {date}."* — no purchase button.
  - **No active trial configured**: card not rendered.
- Hook into existing `useMockState` — add helpers `hasUsedTrial(state)` and `getActiveTrial(packages)` alongside the existing `hasActiveBundle` / `hasActiveUnlimited`.

### Booking eligibility

A trial `ClientPackage` behaves like a `credit_bundle`: each booking consumes one credit from `creditsOrSessionsRemaining`, and the pass is exhausted when the counter hits zero. If `expiresAt` is set and now > expiresAt, bookings refuse. The display layer distinguishes by `kind` for the badge label only ("Trial" vs "Credit").

### Seed data

- `fe-portal/src/data/class-packages.ts` (or equivalent): add one trial pass entry, e.g. `Trial Pass — 1 class, 30-day validity, $20, "Drop in for your first yoga class — see if we're the right fit."`.
- `fe-client/src/app/(client)/packages/page.tsx` inline `TRIAL` array (parallel to `BUNDLES` / `UNLIMITED`) seeded with the same values. (Long-term these converge into the backend; for now they shadow each other like the existing inline data.)

### Out of scope
- Referral / promo code gating.
- Per-location trial variants — a Trial Pass is global.
- Re-purchase after refund — if a trial is refunded, the client model still says "used"; admins handle exceptions out-of-band for v1.

## 6. Promotions (per-package, multi)

### Concept

Any package (ClassPackage: trial/credit_bundle/unlimited, PtPackage: 1on1/2on1) can have **zero or more** optional `Promotion` entries. A promotion is a dated discount: either a percentage off the base price (with one-tap buttons for 10/25/50%) or a hard-coded special price overriding the base for the window. Use cases: CNY promo, year-end promo, mid-year sale, etc.

The base `priceSgd` on the package itself is never mutated; the promo layer is additive.

### Type changes (`fe-portal/src/types/index.ts`)

```ts
export type PromotionMode = "percent" | "price";

export interface Promotion {
  id: string;
  label: string;            // shown to client, e.g. "CNY Promo", "Year-End Sale". Required.
  mode: PromotionMode;
  percent: number | null;   // 1–99, used when mode === "percent"
  priceSgd: number | null;  // ≥ 0, used when mode === "price"
  startsAt: string;         // ISO date (date-only, store as YYYY-MM-DDT00:00:00 in venue TZ)
  endsAt: string;           // ISO date (inclusive end, snapped to 23:59:59 in venue TZ)
}

export interface ClassPackage {
  // …existing fields…
  promotions: Promotion[];  // new — empty array when no promos
}

export interface PtPackage {
  // …existing fields…
  promotions: Promotion[];  // new
}
```

### Active-promo resolution

Helper `getActivePromotion(pkg, now): Promotion | null` lives in `lib/promotions.ts` (created in both fe-portal and fe-client; identical logic — eventually moved to shared once backend lands).

Rules, in order:

1. Filter `pkg.promotions` to those where `startsAt ≤ now ≤ endsAt`.
2. If empty → return `null` (sell at base price).
3. If multiple overlap → return the one with the **lowest effective price** (best for the client). Ties broken by earliest `startsAt`. Rationale: an admin who layers a CNY promo over a generic 10%-off banner expects the client to get the better of the two; surprise discounts are friendlier than surprise full-price.

Helper `getEffectivePrice(pkg, now): { price, original, promo }` returns:
- `price`: discounted price (or `pkg.priceSgd` when no active promo)
- `original`: `pkg.priceSgd` (only different from `price` when a promo is active)
- `promo`: the active `Promotion` or `null`

### Admin UX (`fe-portal/src/components/packages/class-package-dialog.tsx` + new `pt-package-dialog.tsx` parity)

A collapsible **"Promotions"** section appears at the bottom of the dialog (always visible, defaulting to collapsed when no promos exist; expanded when ≥ 1 exists). Inside:

- Each promotion is a card with these inline controls (so the section can hold multiple stacked):
  - `Label` text input (required) — placeholder "e.g. CNY Promo".
  - Discount mode toggle (segmented): **Percentage** | **Special price**.
  - When Percentage: three quick-pick buttons `10%` `25%` `50%` and a numeric input (1–99). Clicking a quick-pick fills the input; the input remains editable. Live preview shows resulting price: `S$X → S$Y`.
  - When Special price: numeric input for the override price in SGD (≥ 0, can be 0 for "free"). Live preview: `S$X → S$Y`.
  - `Starts` and `Ends` date pickers (inclusive). Default: today → +14 days.
  - Trash icon button to remove this promotion.
- Below the last promotion: a `+ Add promotion` button. Each click appends a new blank promotion card.
- If no promotions exist, the section shows a single muted line *"No promotions. + Add promotion"* with the same plus button.

Validation on submit:

- Label, mode-specific value, and both dates required for each promotion.
- `endsAt ≥ startsAt`.
- Percent must be `1–99`; price must be `≥ 0` and `< pkg.priceSgd` (otherwise the "promotion" is a price increase — block with inline error "Promo price must be below the base price").
- Overlapping date ranges are *allowed* (admin can stack promos intentionally; resolution rule above handles it). A subtle info chip flags overlaps: `⚠ This window overlaps with "CNY Promo"`.

### Admin list display (`/admin/classes`, PT pages)

Each package row gets a small inline indicator when it has any promotion:

- Active promo right now: green pill `Promo · -25% · ends Feb 18`.
- Future promo scheduled: neutral pill `Promo · starts Feb 10`.
- Only past promos: no indicator (treated as historical, not surfaced; admin can still see/edit them in the dialog).

### Client UX (`fe-client/src/app/(client)/packages/page.tsx`)

For every rendered card (bundle / unlimited / PT 1on1 / PT 2on1 / trial hero), compute `getEffectivePrice(pkg, now)`:

- **No active promo**: render as today.
- **Active promo**: replace the price line with
  - Strikethrough base price: `S$300`
  - Bold discounted price: `S$225`
  - Accent badge under the price: `CNY Promo · -25%` (uses `promo.label` + computed display).
- Card border picks up a subtle accent ring when any promo is active. No countdown timer in v1 (keeps the design from feeling like a flash-sale gimmick).

Trial hero card gets the same treatment, with the badge sitting next to the existing "Limited offer" pill.

### Booking / purchase flow

Out of scope for the mockup; the spec only covers display. When backend lands, the `purchase` mutation will record `amountPaidSgd = getEffectivePrice(pkg, now).price` and snapshot the applied `promotionId` for accounting. This spec calls out the intent so plan can include a TODO marker.

### Seed data

- `fe-portal/src/data/class-packages.ts`: add `promotions: []` to all existing entries. Seed one example: the demo "Bundle of 20" gets a `CNY Promo · 25%` running from a date 3 days before `today` to 14 days after, so the mockup is visibly live on first load.
- `fe-portal/src/data/pt-packages.ts`: same — `promotions: []` everywhere.
- `fe-client/src/app/(client)/packages/page.tsx` inline arrays mirror the same seeded promo on `b-20` so the client demo matches.

### Out of scope

- Per-client / promo-code redemption (this is a sitewide discount window, not a coupon system).
- Stacking multiple promos additively — only one wins per resolution.
- Per-location promotions — v1 is global; can be layered on via §3 active-location filter later if needed.
- Auto-archive expired promos — they stay in the array until an admin removes them (visible history in the dialog).

## 7. Workshops — multi-day model, moved to Packages

### Concept

Workshops are purchasable, schedulable events. A workshop can span **multiple days** (e.g. a 3-day intensive). Clients can buy either a **single-day pass** for one of the days or a **multi-day pass** covering several / all days. Each day has its own time, capacity, and base "single-day-pass" price; **pricing tiers** (a.k.a. passes) bundle one or more days with their own bundled price and optional early-bird discount.

Workshops are configured under `Packages → Workshops`. The scheduler renders one tile per workshop *day* automatically (since each day has its own startTime/endTime), keeping the calendar accurate. The scheduler's `+ Workshop` button is repurposed into a **dropdown of existing workshops** for quick navigation — new workshops can only be created from Packages.

### Type changes (`fe-portal/src/types/index.ts`)

```ts
export interface Workshop {
  id: string;
  name: string;
  classTypeId: string;
  locationId: string;
  instructorIds: string[];
  coverUrl: string | null;
  additionalImages: string[];
  descriptionHtml: string;
  days: WorkshopDay[];          // NEW — 1..N entries. Replaces top-level startsAt/endsAt.
  tiers: WorkshopTier[];        // NEW — moved inline (was a separate seed array)
  lifecycle: Lifecycle;
  cancelledAt: string | null;
  cancelledByStaffId: string | null;
}

export interface WorkshopDay {
  id: string;
  date: string;                 // YYYY-MM-DD (venue TZ)
  startTime: string;            // HH:mm
  endTime: string;              // HH:mm
  capacity: Capacity;           // per-day capacity split (waitlist / onlineBooking / buffer) — see §9
  basePriceSgd: number;         // list price for a single-day pass to THIS day
}

export interface WorkshopTier {
  id: string;
  workshopId: string;
  name: string;                 // e.g. "Day 1 Pass", "Full Event Pass", "Weekend Combo"
  description: string;
  dayIds: string[];             // which days this tier grants access to. ≥ 1.
  priceSgd: number;             // bundled total price for the tier (can be < sum of basePriceSgd for a discount)
  earlyBirdPriceSgd: number | null;
  earlyBirdCutoffAt: string | null; // ISO datetime; null when no early bird
}
```

`startsAt` / `endsAt` are removed from `Workshop`. The earliest day's startTime and latest day's endTime are derived at render time when a single "date range" string is needed (e.g. list rows).

> **Migration note (mockup):** existing seed workshops have a single `startsAt`/`endsAt` pair. Backfill produces a single `WorkshopDay` per existing workshop and a single Full-Event tier whose `priceSgd` matches the old tier values.

### Admin authoring flow — three stages in one page

The editor is one page with three stacked sections; later sections gate on earlier ones being filled, but no separate steps/routing.

**Stage 1 — Basics**
- Name (required)
- Description (rich text)
- Class type (select from active class types)
- Location (select; falls back to active-location pill from §3)
- Instructors (multi-select)
- Cover image + additional images

**Stage 2 — Days**
- Toggle: `Date range` | `Individual dates`
  - **Date range**: start date + end date pickers. On change, a row per date in the range is generated.
  - **Individual dates**: a "+ Add date" button appends date rows the admin picks one at a time. Useful for non-contiguous schedules (e.g. weekends only).
- Each generated `WorkshopDay` row inline-edits:
  - Date (locked when generated by range; editable in individual mode)
  - Start time
  - End time
  - Capacity (per-day) — uses the shared `<CapacityFields />` from §9 with three inputs (waitlist / online booking / buffer) and a live `Max capacity` derived total
  - Base single-day price (SGD)
- Reorder is by date ascending automatically; no drag.
- Removing a day prompts a confirm dialog if it's referenced by any tier.

**Stage 3 — Pricing tiers**
- Disabled until ≥ 1 valid day exists. Helper text when empty: *"Add at least one day before creating pricing tiers."*
- Each tier card has:
  - Name (required) — e.g. "Day 1 Pass", "Full Event".
  - Description (optional one-liner shown on the client purchase card).
  - **Days included** — a checkbox grid of the workshop's days (`Day 1 · Sat 15 Feb`, `Day 2 · Sun 16 Feb`, …) plus an `All days` quick-toggle. At least one must be selected.
  - **Price (SGD)** (required) — bundled total. A subtle hint shows the sum of base prices for the selected days as a reference (e.g. *"Sum of selected day base prices: $180 — your tier price applies as the bundled total."*).
  - **Early-bird price** (optional, ≥ 0).
  - **Early-bird cutoff** (datetime; required iff early-bird price is set).
- "+ Add tier" appends another tier card. Trash removes a tier (with confirm if any client has already purchased it — relevant once backend is wired).

Validation on save:
- ≥ 1 day; every day complete.
- ≥ 1 tier; every tier with ≥ 1 day, valid price, and (if early-bird price) a future-or-past cutoff (warn but don't block if cutoff is in the past — admin may be back-dating during setup).
- For each tier: `earlyBirdPriceSgd < priceSgd` when set.
- Days referenced by a tier must exist (enforced by the checkbox grid).
- Allowed: tiers may overlap freely (e.g. "Day 1 Pass" and "Weekend Combo" both include Day 1). Capacity per day is checked at purchase time, not at tier-creation time.

### Capacity enforcement (mockup)

- Each `WorkshopDay.capacity` is independent — a Day-1 pass and a Full-Event pass both consume one Day-1 seat each.
- "Seats remaining" per day = `day.capacity - count(active purchases that include this day)`.
- The purchase CTA on the client side is **disabled** for any tier where at least one included day has 0 seats remaining; admin's list shows a `Sold out` badge on such tiers.
- Block is at the tier level (atomic): a multi-day pass refuses if any constituent day is full — never half-books.
- Out of scope: waitlist, overflow seats, capacity overrides.

### Navigation

- Add nav item `Packages → Workshops` (`/admin/packages/workshops`) between "Classes" and "Private Sessions" in `nav-items.ts`.
- Schedule page (`/admin/schedule`):
  - The `+ Workshop` page-header CTA becomes a **dropdown trigger** labelled `Workshop ▾`. Opening it lists all active workshops (name, date range, location). Each item links to `/admin/packages/workshops/[id]/edit`. Footer: `+ New workshop →` linking to `/admin/packages/workshops/new`, plus `Manage workshops →` to the list page.
  - The workshop filter chip and per-day workshop tile rendering remain.

### Workshops list page (`/admin/packages/workshops` — new)

- Header: title "Workshops" + description "Configure upcoming workshops. Each day appears on the schedule automatically once configured." + primary CTA `+ New workshop`.
- List sectioned by lifecycle (Upcoming / In progress / Past / Cancelled), where status is derived from the workshop's days: upcoming = earliest day in future; in progress = today falls within the day range; past = latest day in the past.
- Each row shows: cover thumbnail, name, class type badge, location, derived date range (`15–17 Feb 2026` or `15 Feb · 22 Feb · 1 Mar` for non-contiguous), day count, instructor names, **tier count**, and inline actions (Edit, Cancel/Restore, View on schedule). A small `🛑 Sold out` indicator if every tier has at least one sold-out day.
- Empty state: "No workshops yet. Create one to see it appear on the schedule."

### Workshop editor route

- `/admin/packages/workshops/new` and `/admin/packages/workshops/[id]/edit` — same component, mode switched by presence of `[id]`. The form is the three-stage layout described above.
- The legacy form at `/admin/schedule/new/workshop` is removed; the path is replaced with a Next.js redirect to `/admin/packages/workshops/new` as bookmark insurance.

### Schedule auto-population

- Schedule reads `workshops[].days[]` and renders **one tile per `WorkshopDay`** at that day's startTime → endTime. The tile shows workshop name + a small `Day N/M` chip when M > 1 (e.g. "Day 2 / 3").
- Clicking a tile opens the workshop detail page (`/admin/schedule/workshop/[id]`) with the standard cancel/restore controls. The detail page's `Edit` button routes to `/admin/packages/workshops/[id]/edit`.

### Client UX (`fe-client`)

Not in this spec's primary scope, but flagged so the implementation plan knows: the client's workshop purchase page (when it lands) will show one card per tier, with:
- Tier name + description
- Day list (`Day 1 · Sat 15 Feb · 9–11am`, …)
- Effective price: early-bird if `now < earlyBirdCutoffAt`, else regular
- Per-day "seats remaining" indicator
- Purchase button disabled when any included day is at capacity

### Why this is right

- Single-day vs multi-day passes are a tier configuration, not a separate data model — keeps the schema lean.
- Day-level capacity matches physical reality (room limits don't change because someone bought a bundle pass).
- Early-bird is a tier-level mechanic: an "early discount on the Full-Event pass" is a different decision from "early discount on Day 1 only", so it belongs with the tier.

### Out of scope

- Standard `Promotion[]` system from §6 on workshops — workshop tiers + early-bird already serve the same purpose. Layering a second discount mechanism would double-discount.
- Workshop templates / cloning — deferred.
- Recurring workshop series — deferred.
- Per-day instructor assignment — instructors are shared across all days of a workshop in v1.
- Waitlist — deferred.

## 8. Availability → PT Request inbox

### Concept

The current PT flow leans on an availability-browsing model: clients pick a slot from instructor availability shown on the client app, the admin maintains availability windows. The new flow inverts it: **clients propose**, **admins decide**. Specifically:

1. The Availability surface is deleted everywhere (admin nav, page, client-side slot grids, all related types and seeds).
2. A new `PtRequest` model captures what the client wants: preferred slots, duration, instructor preference, optional note.
3. Admins triage requests in a dedicated `/admin/pt-requests` page (the "PT Session inbox"). For each request they can **Schedule** (creates a `PtSession` and links it back) or **Decline** with a required note.
4. The client sees status updates on their account; declined requests show the admin's note inline.

### Type changes (`fe-portal/src/types/index.ts`)

```ts
export type PtRequestStatus = "pending" | "scheduled" | "declined" | "cancelled";

export interface PtRequestSlot {
  date: string;      // YYYY-MM-DD
  startTime: string; // HH:mm
}

export interface PtRequest {
  id: string;
  clientId: string;
  preferredInstructorId: string | null;  // null = "any instructor"
  sessionType: PtSessionType;            // existing "1on1" | "2on1"
  durationMinutes: number;               // e.g. 60, 90
  preferredSlots: PtRequestSlot[];       // ≥ 1, ≤ 5 (cap to keep admin UX sane)
  clientNote: string;                    // free text, optional. Defaults to "".
  status: PtRequestStatus;
  ptSessionId: string | null;            // populated when scheduled
  declineNote: string | null;            // populated when declined; client-visible
  decidedByStaffId: string | null;
  decidedAt: string | null;              // ISO datetime
  createdAt: string;
}
```

### Removed types

- Any `InstructorAvailability` / `AvailabilitySlot` / `WeeklyAvailability` interfaces and data files. (Sweep `fe-portal/src/types` and `fe-portal/src/data` for these names and delete.)
- The `InboxType` value `"pt_request"` is removed; PT requests no longer flow through the generic inbox. Existing inbox seed entries of that type are deleted from `data/inbox.ts`. The remaining `InboxType` values (`client_cancellation | admin_cancel_class_pt | admin_cancel_workshop`) stay.
- The `EmailTemplateSlug` values `pt_request_submitted | pt_session_approved | pt_session_declined` stay — they're still relevant — but their trigger now hangs off the `PtRequest` model lifecycle, not the inbox.

### fe-portal — removed surfaces

- **Delete** `fe-portal/src/app/admin/availability/page.tsx`.
- **Remove** the `Availability` nav entry (`Schedule → Availability`) from `nav-items.ts`.
- **Sweep** any seed availability data: `fe-portal/src/data/availability*.ts` if present.

### fe-portal — new surface: PT Requests page

Add nav entry `Operations → PT Requests` (`/admin/pt-requests`), placed right above `Inbox` in the `Operations` group. Badge count = number of `pending` requests (mirrors the existing `inboxUnread` badgeKey pattern — register a new `ptRequestsPending` badgeKey).

Page layout:

- Header: title "PT Requests" + description "Triage client-submitted private session requests. Schedule, or decline with a reason." No primary CTA (requests are inbound only).
- Filter chips: `Pending` (default), `Scheduled`, `Declined`, `All`.
- List: each row shows
  - Client avatar + name
  - Session type badge (1-on-1 / 2-on-1)
  - Duration (e.g. `60 min`)
  - Preferred instructor name or `Any instructor`
  - Compact preferred-slots preview: first slot + `+N more` if applicable (e.g. `Sat 22 Feb · 9am +2 more`)
  - Status badge
  - Relative `createdAt` time
- Empty states per filter ("No pending requests" / "No scheduled PT requests yet" / etc.).
- Click row → opens a side drawer (or full detail page) with full request data:
  - Client info + their existing PT credit balance (read from existing `clientPackages` data)
  - All preferred slots in a vertical list
  - Session type, duration, preferred instructor
  - Client note (rendered as a quoted block when present)
  - Two CTAs at the bottom: **Schedule** and **Decline**
- **Already-decided requests** render the same detail view but with the actions replaced by a read-only outcome card: `Scheduled on {date}, links to PtSession {time at location}` or `Declined on {date} — "{declineNote}"`.

### Schedule action (`/admin/pt-requests` drawer)

Opens a sub-dialog pre-filled from the request:

- Date + start time (default: the first preferred slot; quick-pick chips for the other preferred slots)
- Duration (default: request's duration; editable)
- Instructor (default: preferred; falls back to a select of eligible instructors when preferred is `null`)
- Location (select; defaults to the request's location preference if added later — for now defaults to active-location pill from §3)
- Session type — read-only, mirrors the request
- Capacity (shared `<CapacityFields />` from §9) — defaulted from sessionType: `1on1 → {0, 1, 0}`, `2on1 → {0, 2, 0}`
- Confirm button: `Schedule session`

On confirm:
- Create a new `PtSession` with the chosen values.
- Update `PtRequest.status = "scheduled"`, `ptSessionId`, `decidedByStaffId`, `decidedAt`.
- Drawer collapses to the "outcome card" state.
- Optimistic update: scheduled session immediately renders on `/admin/schedule` and on the client's `/account/private-sessions` view (since both read from the shared `ptSessions` seed in the mockup).

### Alternate entry point: scheduling from the scheduler page

Admins commonly think in calendar terms. To support workflow from either direction, scheduling a PT session has **two entry points** that converge on the same outcome:

1. **From `/admin/pt-requests`** — open a request's drawer and click `Schedule`. The schedule sub-dialog opens pre-filled from the request. *(described above)*
2. **From `/admin/schedule`** — click the new `+ PT Session` page-header button. A picker dialog opens listing **all pending `PtRequest`s** (newest first) with the same row info shown on the PT Requests list (client name, session type, duration, preferred instructor, preferred-slot preview). Selecting a request opens the **same schedule sub-dialog**, pre-filled from that request.

Behaviour notes:

- The picker only shows `status === "pending"` requests. Empty state: *"No pending PT requests. Clients submit requests from their app."* with a quiet link `Go to PT Requests →`.
- The schedule sub-dialog is the **single shared component** (`schedule-from-request-dialog.tsx`) — both entry points import it. There is **no path to create a PtSession without a corresponding PtRequest** in v1; this enforces the new flow's invariant ("clients propose, admins decide") without leaking a back-door admin-initiated PT.
- After scheduling: identical effects regardless of entry point — PtRequest status flips to `scheduled`, ptSessionId is set, the session appears on `/admin/schedule` and on the client's `/account/private-sessions` view, the PT Requests nav badge decrements.
- The `+ PT Session` button on the schedule shows a small `(N)` count of pending requests when N > 0, so admins notice when there's something to triage even when they didn't visit the requests page directly.

### Decline action

Opens a sub-dialog with a single required `Reason` textarea (≥ 5 chars). Confirm button: `Decline request`.

On confirm:
- Update `PtRequest.status = "declined"`, `declineNote`, `decidedByStaffId`, `decidedAt`.
- Drawer collapses to outcome card.
- Client sees the note on their account-side request detail.

### fe-client — submission flow

Replace the existing availability-browse UX with a request-submission UX. The legacy `/private-sessions` (list of instructors with slot grids) and `/private-sessions/[id]` (mock slot picker) become:

- **`/private-sessions`** — landing page lists active instructors as cards with a tap-to-request action. Top of the page shows a "Request a private session" hero with the new flow's expectations: *"Pick your preferred times and instructor. We'll confirm within 24 hours."*
- **`/private-sessions/[id]`** — instructor-specific request form. Renders the instructor's bio + photo + eligible class types, then a form:
  - **Duration** — segmented control (60, 90 min — derived from PT packages config).
  - **Session type** — segmented control (1-on-1 / 2-on-1).
  - **Preferred date + time** repeater. Default one row; `+ Add another preferred time` appends up to 5. Each row: date picker + time picker.
  - **Note for the instructor** — optional textarea.
  - **Submit request** → creates a `PtRequest` and routes to a confirmation screen.
- Add **`/account/private-sessions`** updates so the same page lists the user's `PtRequest`s with status pills (`Pending`, `Scheduled`, `Declined`). Declined entries show the admin's note inline. Scheduled entries link to the resulting `PtSession` row already shown on the page.

Remove from fe-client:
- `seededAvailable`, mock slot generation, `TIMES_OF_DAY`, `MOCK_SLOTS`, slot picker UI in `/private-sessions/[id]/page.tsx`.

### Auth gating

The request form is gated behind the existing `useAuthGate` / `GatedLink` — clicking `Submit request` when unauthenticated routes to login as today.

### Refund / cancellation of a scheduled PT session

Out of scope for this revision — the existing PtSession cancel/refund flow keeps working unchanged once a request has been promoted.

### Out of scope

- Counter-offer flow (admin proposes alternative times instead of declining) — deferred. Decline-with-note is the only non-schedule path for v1.
- Request auto-expiry — deferred.
- Reshuffling decided requests back to pending — deferred. Once scheduled or declined, the request is terminal in v1; admin handles exceptions by editing the resulting PtSession on the scheduler or creating a new request from scratch.
- "Any time on this date" preference — clients must commit to a specific time per preferred slot.
- Instructor-side view of PT requests (instructors don't triage; admins do).

## 9. Structured capacity model (cross-cutting)

### Concept

A single `capacity: number` field on schedulable events is too blunt — admins want to split a room's seats into three operational buckets so the booking system can route accordingly:

- **Waitlist** — seats held back for clients to queue against once online booking is full.
- **Online booking** — seats available for self-serve booking via the client app.
- **Buffer** — seats reserved for walk-ins, comp tickets, or admin-added bookings.

`maxCapacity` is **derived**, never stored independently: `maxCapacity = waitlist + onlineBooking + buffer`. The form previews this live as the admin types.

Capacity is only edited where the event is **scheduled**:
- `ClassInstance` — in the scheduler new-class form.
- `WorkshopDay` — in the workshop days editor (`Packages → Workshops` editor §7 stage 2). Even though the editor lives under Packages, it's the canonical "scheduling" surface for the workshop's days; the schedule page renders them read-only, so it makes sense to keep the capacity controls in the days editor rather than duplicating them on the timetable.
- `PtSession` — in the schedule-from-request dialog (§8), with sensible defaults derived from `sessionType`.

### Type changes (`fe-portal/src/types/index.ts`)

```ts
export interface Capacity {
  waitlist: number;      // ≥ 0
  onlineBooking: number; // ≥ 0
  buffer: number;        // ≥ 0
  // maxCapacity is derived at render time: waitlist + onlineBooking + buffer
}

export interface ClassInstance {
  // …existing fields…
  capacity: Capacity;    // replaces existing scalar `capacity: number`
}

export interface WorkshopDay {
  // …existing fields…
  capacity: Capacity;    // replaces scalar `capacity: number` introduced in §7
}

export interface PtSession {
  // …existing fields…
  capacity: Capacity;    // NEW — defaults applied in the schedule-from-request dialog
}
```

A small helper in `fe-portal/src/lib/capacity.ts`:

```ts
export function maxCapacity(c: Capacity): number {
  return c.waitlist + c.onlineBooking + c.buffer;
}
```

Reads that previously used `event.capacity` (e.g. for "seats remaining" math) move to `maxCapacity(event.capacity)`.

### Shared form component (`fe-portal/src/components/schedule/capacity-fields.tsx` — new)

A controlled triple-input block reused everywhere capacity is edited:

```
Capacity
┌────────────────────────┐
│ Waitlist        [ 10 ] │
│ Online booking  [ 30 ] │
│ Buffer          [  5 ] │
│ ── Max capacity: 45    │
└────────────────────────┘
```

- Each input is numeric, min 0, integer only.
- `Max capacity` line is derived (read-only label, not a field).
- Validation: at least one of the three values must be > 0 (a session with `max = 0` makes no sense).
- All three inputs share a `tabIndex` order so admins can tab through them quickly.

### Sensible defaults per event type

- **Class instance** — Waitlist 0, Online booking 18, Buffer 2. Admin can override and these become the seeded values per-class-type later (out of scope for now).
- **Workshop day** — Waitlist 0, Online booking *(value the admin enters as the day's main capacity)*, Buffer 0. The placeholder text on Online booking nudges with a comment about the room size.
- **PT session** — Defaults derived from the request's `sessionType`: `1on1 → {0, 1, 0}`, `2on1 → {0, 2, 0}`. Admin can override (rare). Waitlist > 0 on PT is legal but unusual; no warning shown.

### Migration (mockup seeds)

- `fe-portal/src/data/class-instances.ts` (or equivalent) — replace `capacity: 18` with `capacity: { waitlist: 0, onlineBooking: 18, buffer: 2 }`.
- `fe-portal/src/data/workshops.ts` — replace each day's scalar capacity with the object form.
- `fe-portal/src/data/pt-sessions.ts` — backfill with the sessionType-default shape.

### Display

The schedule page event tiles continue to show "X / Y" with X = current bookings and Y = `maxCapacity(event.capacity)`. The breakdown (10/30/5) only surfaces in:
- Admin edit / scheduling forms.
- The schedule detail page for that event (`/admin/schedule/[type]/[id]`) — under a "Capacity breakdown" sub-section so admins can verify the split without entering edit mode.

Client-facing surfaces show only `maxCapacity` — never the breakdown.

### Booking math (mockup-layer note)

How the system later treats these buckets at booking time:

- Online booking attempts consume from `onlineBooking` first; once that's full, new attempts go to `waitlist` (up to its size); once waitlist is full, booking fails.
- `buffer` is admin-only — never consumed by online flows; admin manual-add actions check against `buffer` first, then `onlineBooking`.

This is documented here for the implementation plan; v1 mockup just renders the totals correctly. Wiring the bucket-routing logic happens with the backend.

### Out of scope

- Per-class-type capacity defaults (a future "templating" feature).
- Auto-promote-from-waitlist logic when an online booking is cancelled — backend work.
- Showing the bucket breakdown on client-facing surfaces.

## 10. File-level change list

**New:**
- `fe-portal/src/components/locations/location-filter-chips.tsx` — shared chips used by Schedule + Workshops list.
- `fe-portal/src/components/locations/checkin-location-pill.tsx` — single-select location pill with confirm step.
- `fe-portal/src/components/layout/location-gate.tsx` — fresh-install gate.
- `fe-portal/src/components/clients/package-expiry-dialog.tsx`
- `fe-portal/src/components/clients/package-set-balance-dialog.tsx`
- `fe-portal/src/components/packages/promotions-editor.tsx` — multi-promo editor reused by class + PT dialogs.
- `fe-portal/src/lib/promotions.ts` — `getActivePromotion`, `getEffectivePrice`.
- `fe-client/src/lib/promotions.ts` — same helpers (mirrored).
- `fe-portal/src/app/admin/packages/workshops/page.tsx` — workshops list.
- `fe-portal/src/app/admin/packages/workshops/new/page.tsx` — three-stage editor (basics / days / tiers).
- `fe-portal/src/app/admin/packages/workshops/[id]/edit/page.tsx` — edit variant of the editor.
- `fe-portal/src/components/workshops/workshop-editor.tsx` — shared form component for new + edit.
- `fe-portal/src/components/workshops/workshop-days-editor.tsx` — date-range vs individual-dates input + per-day rows.
- `fe-portal/src/components/workshops/workshop-tiers-editor.tsx` — tier cards with day-checkbox grid, price, early-bird controls.
- `fe-portal/src/components/schedule/workshop-picker-dropdown.tsx` — replacement for the `+ Workshop` button on the schedule.
- `fe-portal/src/app/admin/pt-requests/page.tsx` — PT Requests list + filters.
- `fe-portal/src/components/pt-requests/pt-request-drawer.tsx` — detail drawer with Schedule/Decline actions.
- `fe-portal/src/components/pt-requests/schedule-from-request-dialog.tsx` — schedule sub-dialog (shared by both entry points: PT Requests drawer + scheduler picker).
- `fe-portal/src/components/pt-requests/decline-request-dialog.tsx` — decline sub-dialog.
- `fe-portal/src/components/schedule/pt-request-picker-dialog.tsx` — scheduler-side picker that lists pending PT requests and opens the shared schedule sub-dialog.
- `fe-portal/src/data/pt-requests.ts` — seed requests in mixed statuses.
- `fe-portal/src/components/schedule/capacity-fields.tsx` — shared waitlist/online/buffer triple-input block with derived `Max capacity` line (§9).
- `fe-portal/src/lib/capacity.ts` — `maxCapacity(c: Capacity)` helper.
- `fe-client/src/app/(client)/private-sessions/request/page.tsx` (or co-located) — request form component if extracted.
- `fe-client/src/data/pt-requests.json` — client-visible request seed mirroring the portal's.

**Edited (fe-portal):**
- `fe-portal/src/types/index.ts` — `ClassType` fields + `ClassTypeDifficulty`; `ClassPackageKind` adds `"trial"`; `ClassPackage.description`; `ClientPackage.kind` adds `"trial"`; `Promotion` interface; `promotions: Promotion[]` on `ClassPackage` and `PtPackage`.
- `fe-portal/src/data/class-types.ts` — backfill new fields + add Aerial children.
- `fe-portal/src/data/class-packages.ts` — add seed trial pass + `description` + `promotions` on existing entries + one demo CNY promo on Bundle of 20.
- `fe-portal/src/data/pt-packages.ts` — backfill `promotions: []`.
- `fe-portal/src/app/admin/class-types/page.tsx` — tree rendering, dialog fields.
- `fe-portal/src/app/admin/classes/page.tsx` — Trial Pass section, duplicate-trial warning, active-promo pill on rows.
- `fe-portal/src/app/admin/private-sessions/page.tsx` — active-promo pill on rows.
- `fe-portal/src/components/packages/class-package-dialog.tsx` — `trial` kind tab + description field + `<PromotionsEditor />` slot.
- `fe-portal/src/components/packages/pt-package-dialog.tsx` (or its current equivalent) — `<PromotionsEditor />` slot.
- `fe-portal/src/components/layout/admin-shell.tsx` — wires the fresh-install gate; no provider needed.
- `fe-portal/src/components/clients/client-profile-client.tsx` — per-row kebab + new dialogs; render `trial`-kind packages in the active packages list with a "Trial" badge.
- `fe-portal/src/components/layout/nav-items.ts` — add `Packages → Workshops` entry between Classes and Private Sessions.
- `fe-portal/src/types/index.ts` — restructure `Workshop` (remove `startsAt`/`endsAt`, add `days`, inline `tiers`); add `WorkshopDay`; reshape `WorkshopTier` to reference `dayIds[]`.
- `fe-portal/src/data/workshops.ts` — migrate seed entries to days-array shape; add at least one multi-day demo workshop with multiple tiers ("Day 1", "Day 2", "Full Event").
- `fe-portal/src/app/admin/schedule/page.tsx` — swap the `+ Workshop` page-header button for the workshop picker dropdown; tile rendering reads from `workshop.days[]` (one tile per day with `Day N/M` chip when M > 1). Add `+ PT Session` page-header button opening the PT request picker dialog (with pending-count badge).
- `fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx` — workshop detail keeps cancel/restore; "Edit" button routes to `/admin/packages/workshops/[id]/edit`; per-day capacity display.
- `fe-portal/src/components/schedule/workshop-detail-client.tsx` — render per-day breakdown; Edit-button reroute.
- `fe-portal/src/app/admin/schedule/page.tsx` — mount `<LocationFilterChips />` near the page header; filter rows by selected location.
- `fe-portal/src/app/admin/packages/workshops/page.tsx` — same chip group; filter the list.
- `fe-portal/src/app/admin/check-in/page.tsx` — mount `<CheckinLocationPill />` near the title; restrict scanning UI to the picked location.

**Deleted:**
- `fe-portal/src/app/admin/schedule/new/workshop/page.tsx` — content moved to `app/admin/packages/workshops/new/page.tsx`; old path replaced with a thin redirect file pointing to the new location.
- `fe-portal/src/app/admin/availability/page.tsx` — Availability surface removed entirely.
- Any `fe-portal/src/data/availability*.ts` and `fe-portal/src/types/index.ts` `Availability*` interfaces — swept.
- Inbox seed entries of `type === "pt_request"` in `fe-portal/src/data/inbox.ts` — replaced by `pt-requests.ts` seed.

**Edited (fe-portal, PT request flow):**
- `fe-portal/src/types/index.ts` — add `PtRequest`, `PtRequestStatus`, `PtRequestSlot`; remove `InboxType` value `"pt_request"`; remove any `Availability*` interfaces; add `Capacity` and switch `ClassInstance.capacity` / `WorkshopDay.capacity` / `PtSession.capacity` to it (§9).
- `fe-portal/src/data/class-instances.ts`, `data/workshops.ts`, `data/pt-sessions.ts` — migrate scalar capacities to `{ waitlist, onlineBooking, buffer }` shape.
- `fe-portal/src/app/admin/schedule/new/class/page.tsx` — replace the single `capacity` input with `<CapacityFields />`.
- `fe-portal/src/app/admin/schedule/[type]/[id]/page.tsx` — render the per-event capacity breakdown under a "Capacity breakdown" sub-section; tile bookings continue to display `current / maxCapacity`.
- `fe-portal/src/components/layout/nav-items.ts` — remove `Schedule → Availability`; add `Operations → PT Requests` (above `Inbox`) with `badgeKey: "ptRequestsPending"`.
- `fe-portal/src/components/layout/admin-shell.tsx` (or wherever badge counts are computed) — register `ptRequestsPending` count.
- `fe-portal/src/app/admin/inbox/page.tsx` — drop `pt_request` type from filters and the type labels map.
- `fe-portal/src/data/inbox.ts` — drop `pt_request` seed entries.

**Edited (fe-client):**
- `fe-client/src/app/(client)/packages/page.tsx` — Trial Pass hero card + state-aware CTA; per-card promo strikethrough + label badge via `getEffectivePrice`.
- `fe-client/src/lib/mock-state.ts` — `hasUsedTrial()` helper; trial seeded into mock client packages; add `submitPtRequest()` mutator.
- `fe-client/src/app/(client)/private-sessions/page.tsx` — strip availability-slot logic (`seededAvailable`, `TIMES_OF_DAY`, `Slot` generation); turn into instructor picker + request hero.
- `fe-client/src/app/(client)/private-sessions/[id]/page.tsx` — strip `MOCK_SLOTS` slot picker; replace with request form (duration / session type / preferred-times repeater / note / submit).
- `fe-client/src/app/(client)/account/private-sessions/page.tsx` — list the user's PT requests with status pills; show admin's decline note for declined entries; link scheduled entries to their PtSession row.

## 11. Acceptance criteria

1. Adding a class type with description + parent + difficulty persists in seed-style state, renders nested in the list, with a difficulty pill.
2. With zero active locations, the entire admin app shows the fresh-install gate and refuses navigation; adding one dismisses it.
3. Schedule and Workshops list each have a `[All] [Location A] [Location B]` chip row; selection persists per page in localStorage. Each row shows its own location pill regardless of filter.
4. Check-in shows a single-location pill (no `All`) with a confirmation step when switching; selection persists.
5. No location control appears on Class Types, Instructors, Packages (Classes/Private Sessions/Trial), Policy, Waiver, Notifications, Staff, Clients, Inbox, or PT Requests.
6. On a credit_bundle package row, "Set credit balance" updates the displayed remaining credits and creates a single ledger row whose delta matches the change.
7. On any credit_bundle or unlimited package, "Edit expiry" changes the "Valid until" line and creates a ledger row tagged "Expiry".
8. Admin can create a Trial Pass with name, description, quota, and price; it appears in its own section on `/admin/classes`.
9. A client with no prior trial sees the Trial Pass hero card with a `Claim` CTA; after claiming (mock-state flag flipped), reload shows the "already claimed" inline notice and no CTA.
10. A trial `ClientPackage` lets the client book classes by spending its credit quota; the pass exhausts when the quota hits zero, or earlier if `validityDays` expires.
11. Admin can attach 2+ promotions to the same package via repeated clicks of `+ Add promotion`; each row has independent label, mode, value, and date range; trash removes a row.
12. When `now` falls inside an active promo window, the matching package card on `/packages` shows the strikethrough base price, the discounted price, and the promo label badge. Outside any window, pricing reverts to base.
13. With overlapping promotions, the one yielding the lowest effective price wins.
14. The schedule page's `Workshop ▾` dropdown lists all configured workshops; clicking one routes to its edit page. New workshops can only be created via `+ New workshop` in the dropdown footer or from the Packages list — the schedule page does not host a new-workshop form.
15. A multi-day workshop with three days renders as three separate tiles on the schedule, each at its own time, each chipped `Day 1/3`, `Day 2/3`, `Day 3/3`.
16. The Packages → Workshops editor refuses to save a workshop with zero days or zero tiers; refuses tiers whose `earlyBirdPriceSgd >= priceSgd`.
17. A client-side purchase button is disabled for a multi-day tier when any of its constituent days hits capacity; admin sees a `Sold out` indicator on that tier in the list.
18. Editing a workshop from the schedule detail page routes to `/admin/packages/workshops/[id]/edit`; cancelling/restoring still works from the schedule detail.
19. `/admin/availability` is gone (returns 404) and the nav entry no longer appears. The client `/private-sessions` view has no availability grids — only an instructor picker leading to a request form.
20. Submitting a PT request creates a `PtRequest` row visible at `/admin/pt-requests` with status `Pending`; the nav badge for PT Requests increments.
21. Scheduling a PT request from the admin drawer creates a `PtSession` on the schedule for the chosen date/time/instructor, sets the request status to `Scheduled` and links `ptSessionId`. The session appears in the client's `/account/private-sessions` list.
22. Declining a PT request with a note sets status to `Declined`; the client sees the admin's note inline on their account-side request entry.
23. The schedule page has a `+ PT Session` page-header button. Clicking it opens a picker listing pending PT requests; selecting a request opens the same schedule sub-dialog used in the PT Requests page. The resulting PtSession and request-status updates are identical regardless of which entry point was used.
24. The `+ PT Session` button shows a `(N)` count badge when there are pending requests; when N == 0 the picker shows an empty state and no PtSession can be created via this path.
25. The scheduler new-class form shows three capacity inputs (`Waitlist`, `Online booking`, `Buffer`) with a live `Max capacity` total below; saving stores them as a `Capacity` object on the `ClassInstance`.
26. The workshop day editor (§7 stage 2) and the schedule-from-request dialog (§8) use the same `<CapacityFields />` block; the `WorkshopDay.capacity` and `PtSession.capacity` are stored in the same structured shape.
27. Schedule event tiles and the schedule detail page show `current / maxCapacity` summed from the breakdown; the detail page additionally renders the per-bucket split in a "Capacity breakdown" sub-section.

## 12. Open questions (none blocking)

- Whether to surface the active-location pill on the public-side or instructor-side mockups too — not in this spec's scope.
- Whether the gate should also block when *all* locations are archived (treating it the same as zero active) — proposal: yes, same behaviour.
- Whether duplicate active Trial Passes should be hard-blocked (only one active at a time) rather than warned about — proposal: warn in v1, enforce in v2 when wired to backend.
- Whether workshops should eventually pick up the standard `Promotion[]` system in addition to tiers — proposal: defer; tiers cover the common case (early-bird) cleanly.
- Whether a request's `cancelled` status should be reachable by the client (e.g. "I no longer need this") in v1 — proposal: yes, allow `cancelled` self-service while status === `pending`; not visible in admin's queue, only in history.
- Whether to support a "counter-offer" path where admin proposes alternative times rather than declining — proposal: not in v1; instructors and admins use the decline-note for now.
