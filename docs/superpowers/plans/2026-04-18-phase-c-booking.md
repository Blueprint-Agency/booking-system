# Frontend Redesign — Phase C: Functional Booking Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the eight functional booking routes (`/classes`, `/packages`, `/workshops`, `/workshops/[id]`, `/private-sessions`, `/private-sessions/[id]`, `/checkout`, `/booking/confirmation`) with the Phase A/B rezerv-inspired visual language, while preserving all existing behavior, data imports, and information architecture.

**Architecture:** Visual-only refactor. Every page keeps its current data wiring (`mock-user`, `sessions.json`, `instructors.json`, `locations.json`, etc.) and existing client-side state. The new pattern: (1) open with a **compact `<Hero>`** (reuse the Phase B `marketing/hero.tsx` with `variant="compact"`), (2) wrap the functional surface in a cream card on warm background per spec §3.8, (3) close long pages with the shared `<CtaBanner>`. Two small shared booking primitives are extracted — `booking-surface.tsx` (the cream card wrapper) and `section-heading.tsx` (eyebrow + h2 + rule) — to keep pages DRY without premature abstraction.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS v4 (`@theme` in `globals.css`) · TypeScript · framer-motion · lucide-react · `next/image` (unsplash domain already configured in Phase B).

**Reference spec:** `docs/superpowers/specs/2026-04-18-frontend-redesign-design.md` — §3.8 (inline functional surface), §5.2 (per-page application).

**Out of scope for Phase C** (handled later):
- Account + auth re-skin (Phase D)
- Empty states, loading skeletons, mobile polish (Phase D)
- Any change to `products.json`, `sessions.json`, or other data shapes
- Any new functional behavior (no new filters, no new flows)

---

## Working Conventions for All Phase C Tasks

- **Branch:** work on a new branch `redesign/phase-c-booking` created from `redesign/phase-b-marketing`. Do not switch branches mid-plan.
- **Verification per page:** after each page restyle, run `cd fe && npx tsc --noEmit && npm run build`. Both must exit 0. Spot-check the route in a browser before committing.
- **Keep data imports and handlers:** do not rename props, data shapes, or event handlers. This is a skin-only refactor. If a handler or variable is unreferenced after restyle, delete it; do not re-wire logic.
- **Reuse Phase B components:** `<Hero variant="compact">`, `<CtaBanner>`, and `<SectionHeading>` (new, Task 1) should appear on most pages. Do not re-create hero bands inline.
- **No new routes. No PRD changes. No copy rewrites** beyond trivial wording to fit the new headings (e.g., "Book a class" → keep).
- **Image keys:** pages should use existing keys from `fe/src/data/images.ts`. If a key is missing, add it to the manifest in the same commit.
- **Commit cadence:** one commit per task. Use `feat(fe): phase C …` for restyles and `chore(fe): phase C …` for scaffolding/snapshots.

---

## File Map

**Create:**
- `fe/src/components/booking/section-heading.tsx` — eyebrow + h2 + thin rule primitive (Task 1)
- `fe/src/components/booking/booking-surface.tsx` — cream card wrapper with max-width + padding presets (Task 1)

**Modify (full rewrite of the JSX tree, preserving data/state):**
- `fe/src/app/(client)/classes/page.tsx` (Task 2)
- `fe/src/app/(client)/packages/page.tsx` (Task 3)
- `fe/src/app/(client)/workshops/page.tsx` (Task 4)
- `fe/src/app/(client)/workshops/[id]/page.tsx` (Task 5)
- `fe/src/app/(client)/private-sessions/page.tsx` (Task 6)
- `fe/src/app/(client)/private-sessions/[id]/page.tsx` (Task 7)
- `fe/src/app/(client)/checkout/page.tsx` (Task 8)
- `fe/src/app/(client)/booking/confirmation/page.tsx` (Task 9)

**Create (verification output):**
- `docs/superpowers/specs/phase-c-snapshots/*.png` (Task 10)

---

## Task 1: Booking primitives — `SectionHeading` + `BookingSurface`

**Goal:** Two small shared components so every Phase C page composes the same way.

**Files:**
- Create: `fe/src/components/booking/section-heading.tsx`
- Create: `fe/src/components/booking/booking-surface.tsx`

- [ ] **Step 1: Create `fe/src/components/booking/section-heading.tsx`**

```tsx
type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
}: SectionHeadingProps) {
  const alignClass = align === "center" ? "text-center mx-auto" : "";
  return (
    <div className={`max-w-3xl mb-10 ${alignClass}`}>
      {eyebrow ? (
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-accent-deep mb-3">
          {eyebrow}
        </div>
      ) : null}
      <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-ink leading-[1.1]">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-lg text-muted leading-relaxed">{description}</p>
      ) : null}
      <div
        className={`mt-6 h-px w-16 bg-ink/20 ${align === "center" ? "mx-auto" : ""}`}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `fe/src/components/booking/booking-surface.tsx`**

```tsx
import { cn } from "@/lib/utils";

type BookingSurfaceProps = {
  children: React.ReactNode;
  className?: string;
  padding?: "tight" | "default" | "loose";
  maxWidth?: "md" | "lg" | "xl" | "full";
};

const paddingMap = {
  tight: "p-6 md:p-8",
  default: "p-8 md:p-12",
  loose: "p-10 md:p-16",
};

const widthMap = {
  md: "max-w-3xl",
  lg: "max-w-5xl",
  xl: "max-w-7xl",
  full: "max-w-none",
};

export function BookingSurface({
  children,
  className,
  padding = "default",
  maxWidth = "xl",
}: BookingSurfaceProps) {
  return (
    <section className="bg-warm py-16 md:py-24">
      <div
        className={cn(
          "mx-auto w-full rounded-3xl bg-card shadow-soft border border-ink/5",
          widthMap[maxWidth],
          paddingMap[padding],
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Verify both compile**

Run: `cd fe && npx tsc --noEmit`
Expected: exit 0.

If `cn` import fails, create `fe/src/lib/utils.ts` with the standard `clsx + tailwind-merge` helper — but check first; Phase A/B likely already added it.

- [ ] **Step 4: Commit**

```bash
git add fe/src/components/booking/
git commit -m "feat(fe): phase C booking primitives — SectionHeading + BookingSurface"
```

---

## Task 2: Restyle `/classes`

**Goal:** Compact hero → weekly calendar grid inside a `BookingSurface` → closing `CtaBanner`. Preserve the existing `ClassCard` sub-component, week navigation, and all data loading from `sessions.json` + `instructors.json`.

**File:** Replace `fe/src/app/(client)/classes/page.tsx`.

### Composition (top to bottom)

1. `<Hero variant="compact" imageKey="hero-yoga-01" eyebrow="Book a class" headline="This week at Yoga Sadhana" subheadline="Browse scheduled classes across both locations." primaryCta={{ href: "#schedule", label: "Jump to schedule" }} />`
2. `<BookingSurface maxWidth="xl" padding="default">` containing:
   - `<SectionHeading eyebrow="Schedule" title="Weekly view" description="Switch weeks with the arrows below." />`
   - Week-nav bar: two icon buttons (lucide `ChevronLeft` / `ChevronRight`) + current week range text (`font-medium text-ink`). Use flexbox, `border-b border-ink/10 pb-4 mb-6`.
   - Day columns grid: `grid grid-cols-1 md:grid-cols-7 gap-4`. Each column = day label + list of class cards.
   - `ClassCard` (keep the existing component's data shape but update its outer class to: `rounded-2xl border border-ink/10 bg-paper p-4 hover:shadow-hover hover:-translate-y-0.5 transition-all`. Instructor avatar circle `h-8 w-8 rounded-full bg-warm`. Duration + location as small muted chips.)
3. `<CtaBanner imageKey="cta-community" headline="Can't find a time that works?" subheadline="Private 1:1 sessions are available 7 days a week." primaryCta={{ href: "/private-sessions", label: "Book 1:1" }} />`

### Steps

- [ ] **Step 1: Read current page to preserve state logic**

Read `fe/src/app/(client)/classes/page.tsx` with the Read tool. Identify: the data loading (sessions + instructors + mock-user), the week-navigation state (`useState` for current week offset), the `ClassCard` sub-component's props contract, any filters. These all survive the restyle unchanged.

- [ ] **Step 2: Replace the page**

Rewrite `page.tsx` with the composition above. Keep the `"use client"` directive (calendar is interactive). Keep every import needed for state/data. Replace the outer `<main>` / section wrappers with the new Hero + BookingSurface + CtaBanner tree. Move the `ClassCard` sub-component into the same file if it already lives there; update only its className strings per §Composition.

- [ ] **Step 3: Verify build**

```bash
cd fe && npx tsc --noEmit && npm run build
```
Expected: both exit 0.

- [ ] **Step 4: Smoke-check in browser**

`cd fe && npm run dev`, visit `/classes`. Confirm: hero renders, week-nav works, at least one class card visible, no console errors.

- [ ] **Step 5: Commit**

```bash
git add fe/src/app/\(client\)/classes/page.tsx
git commit -m "feat(fe): phase C classes — compact hero + booking-surface calendar"
```

### Done criteria

- Hero `variant="compact"` renders with a cream-toned photo
- Weekly grid is wrapped in the new `BookingSurface`
- Week navigation still works (state preserved)
- `ClassCard` cards use new radii + hover-lift
- Closing CTA banner present
- TypeScript clean, build passes

---

## Task 3: Restyle `/packages`

**Goal:** Compact hero → tabbed package grid (Class Credits / PT 1-on-1 / PT 2-on-1) inside `BookingSurface` → closing CTA. Preserve existing tab state and `products.json` wiring.

**File:** Replace `fe/src/app/(client)/packages/page.tsx`.

### Composition

1. `<Hero variant="compact" imageKey="hero-pilates-01" eyebrow="Packages" headline="Credit packages for every practice" subheadline="Buy once, use across both locations. Credits never expire." primaryCta={{ href: "#packages", label: "See packages" }} />`
2. `<BookingSurface maxWidth="xl" padding="default">`:
   - `<SectionHeading eyebrow="Choose your track" title="Three package families" />`
   - **Tab strip:** three buttons in a horizontal row — `rounded-full px-6 py-2.5 text-sm font-medium transition-colors`, active = `bg-ink text-paper`, inactive = `bg-transparent text-muted hover:text-ink border border-ink/10`. Center-aligned on desktop.
   - **Package cards grid:** `grid grid-cols-1 md:grid-cols-3 gap-6`. Each card: `rounded-2xl bg-paper border border-ink/10 p-8 flex flex-col`. Inside: credit count (large `text-4xl font-extrabold text-ink`), package name (`text-base font-medium`), price (`text-2xl font-bold mt-4`), bullet list of benefits (`text-sm text-muted space-y-2 mt-6 flex-1`), "Purchase" button (primary: `rounded-full bg-ink text-paper px-5 py-3 text-sm font-medium hover:bg-ink/90`).
3. `<CtaBanner imageKey="cta-community" headline="Not sure which package fits?" subheadline="Book a free intro call and we'll help you pick." primaryCta={{ href: "/private-sessions", label: "Talk to us" }} />`

### Steps

- [ ] **Step 1: Read `packages/page.tsx`** to confirm tab state and product mapping. The three tabs map to product categories present in `products.json`. Preserve the same filter logic.
- [ ] **Step 2: Replace the page** with the composition above. Keep `"use client"`. Preserve the `useState` for active tab and the derived product list per tab.
- [ ] **Step 3: Verify** — `cd fe && npx tsc --noEmit && npm run build`. Both exit 0.
- [ ] **Step 4: Smoke-check** `/packages` in browser — tabs switch, three cards per tab, CTA renders.
- [ ] **Step 5: Commit**
  ```bash
  git add fe/src/app/\(client\)/packages/page.tsx
  git commit -m "feat(fe): phase C packages — tabbed rounded cards on booking-surface"
  ```

### Done criteria

- Three tabs switch visible product set
- Each card shows credits, name, price, benefits, CTA
- Hover state works on cards (subtle lift optional)
- TypeScript clean, build passes

---

## Task 4: Restyle `/workshops` (list)

**Goal:** Compact hero → workshop card grid inside `BookingSurface`. No CTA banner (workshops themselves are the CTA).

**File:** Replace `fe/src/app/(client)/workshops/page.tsx`.

### Composition

1. `<Hero variant="compact" imageKey="cat-workshop" eyebrow="Workshops" headline="Deep-dive sessions with masters" subheadline="Multi-hour intensives, limited seats, often one-off." primaryCta={{ href: "#list", label: "See workshops" }} />`
2. `<BookingSurface maxWidth="xl" padding="default">`:
   - `<SectionHeading eyebrow="Upcoming" title="Scheduled workshops" />`
   - If the existing page has sort/filter UI, keep it as a thin bar above the grid: `flex items-center gap-3 border-b border-ink/10 pb-4 mb-6`.
   - `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`. Each workshop card: `rounded-2xl overflow-hidden border border-ink/10 bg-paper hover:shadow-hover transition-shadow group`. Top: `<Image>` via `next/image` at `aspect-[4/3] object-cover`, wrapped in a div with the `photo-warm` utility (defined in Phase A). Body: `p-6`. Title = `text-xl font-bold text-ink`. Instructor + date = `text-sm text-muted mt-1`. Price + "View details" link on the same row, `mt-4 flex items-center justify-between`.

### Steps

- [ ] **Step 1: Read current `workshops/page.tsx`** — preserve the data import from `sessions.json` + `instructors.json` and any sort state.
- [ ] **Step 2: Replace** with the composition above. Use `<Link href={\`/workshops/${workshop.id}\`}>` on the card. Keep `"use client"` only if sort state exists.
- [ ] **Step 3: Verify** — `cd fe && npx tsc --noEmit && npm run build`.
- [ ] **Step 4: Smoke-check** `/workshops` — cards render with images, clicking a card navigates to `/workshops/[id]`.
- [ ] **Step 5: Commit**
  ```bash
  git add fe/src/app/\(client\)/workshops/page.tsx
  git commit -m "feat(fe): phase C workshops list — photo card grid"
  ```

### Done criteria

- 3-column grid at `lg`, 2 at `md`, 1 at mobile
- Photos have warm tint
- Card click navigates to detail page
- TypeScript clean, build passes

---

## Task 5: Restyle `/workshops/[id]`

**Goal:** Compact hero (with this workshop's photo) → two-column detail layout inside `BookingSurface` (left: description, instructor bio, date/location; right: sticky purchase card) → closing CTA banner.

**File:** Replace `fe/src/app/(client)/workshops/[id]/page.tsx`.

### Composition

1. `<Hero variant="compact" imageKey={workshop.imageKey ?? "cat-workshop"} eyebrow="Workshop" headline={workshop.title} subheadline={\`with \${instructor.name} · \${formatDate(workshop.date)}\`} primaryCta={{ href: "#purchase", label: "Reserve seat" }} />`
2. `<BookingSurface maxWidth="lg" padding="default">`:
   - `grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10`.
   - **Left column:** `<SectionHeading eyebrow="About" title="What to expect" />` then the description paragraphs (`prose text-ink/80 max-w-none space-y-4`). Below: instructor card — small avatar + name + bio (`flex gap-4 items-start border-t border-ink/10 pt-8 mt-10`). Below: Date + Location rows using lucide icons (`Calendar`, `MapPin`) and muted text.
   - **Right column (sticky):** `sticky top-24 self-start rounded-2xl border border-ink/10 bg-paper p-6`. Inside: price (`text-3xl font-extrabold`), seats left (`text-xs uppercase tracking-wider text-muted`), "Reserve your seat" button (`rounded-full bg-ink text-paper w-full py-3 text-sm font-medium mt-4 hover:bg-ink/90`), small print (`text-xs text-muted mt-3 text-center`).
3. `<CtaBanner imageKey="cta-community" headline="Browse more workshops" subheadline="New intensives added monthly." primaryCta={{ href: "/workshops", label: "See all" }} />`

### Steps

- [ ] **Step 1: Read current `workshops/[id]/page.tsx`** — preserve params unpacking (Next.js 16 style: `params: Promise<{ id: string }>` + `await params`) and the workshop lookup.
- [ ] **Step 2: Replace** with the composition above.
- [ ] **Step 3: Verify** — `cd fe && npx tsc --noEmit && npm run build`.
- [ ] **Step 4: Smoke-check** one workshop detail URL (e.g., `/workshops/ws-001`).
- [ ] **Step 5: Commit**
  ```bash
  git add fe/src/app/\(client\)/workshops/\[id\]/page.tsx
  git commit -m "feat(fe): phase C workshop detail — sticky purchase card layout"
  ```

### Done criteria

- Two-column desktop, single-column mobile
- Sticky purchase card does not overflow viewport
- TypeScript clean, build passes

---

## Task 6: Restyle `/private-sessions`

**Goal:** Compact hero → availability surface (instructor picker + location picker + date picker) in `BookingSurface` → closing CTA.

**File:** Replace `fe/src/app/(client)/private-sessions/page.tsx`.

### Composition

1. `<Hero variant="compact" imageKey="hero-meditation-01" eyebrow="Private 1:1" headline="Book a session with an instructor" subheadline="Flexible scheduling. 60 or 90 minutes. Both locations." primaryCta={{ href: "#form", label: "Start booking" }} />`
2. `<BookingSurface maxWidth="lg" padding="default">`:
   - `<SectionHeading eyebrow="Step 1 of 2" title="Who and where" />`
   - Form grid: `grid grid-cols-1 md:grid-cols-2 gap-6`. Three selects rendered as labelled stacks:
     - Instructor picker: label `text-xs uppercase tracking-wider text-muted mb-2`, then a grid of instructor tiles (`rounded-2xl border border-ink/10 p-4 hover:border-accent cursor-pointer` — selected state adds `border-accent bg-accent/5`).
     - Location picker: two radio cards (Breadtalk IHQ, Outram Park) — same tile pattern.
     - Date picker: keep the existing date picker component; wrap its outer in `rounded-2xl border border-ink/10 p-4`.
   - Bottom bar: `mt-10 pt-6 border-t border-ink/10 flex justify-end`. Primary button "Find availability" goes to the existing availability view (preserve whatever the current "next step" is — likely an inline panel or route push).
3. `<CtaBanner imageKey="cta-community" headline="Prefer group classes?" subheadline="See this week's schedule." primaryCta={{ href: "/classes", label: "View classes" }} />`

### Steps

- [ ] **Step 1: Read the current page** — preserve the instructor/location/date state and the submit handler.
- [ ] **Step 2: Replace** with the composition. Keep `"use client"`. Do not alter the handler logic.
- [ ] **Step 3: Verify** — `cd fe && npx tsc --noEmit && npm run build`.
- [ ] **Step 4: Smoke-check** — selecting instructor + location + date still produces whatever result it did before.
- [ ] **Step 5: Commit**
  ```bash
  git add fe/src/app/\(client\)/private-sessions/page.tsx
  git commit -m "feat(fe): phase C private-sessions list — instructor/location/date picker"
  ```

### Done criteria

- All three picker controls render
- Selection state survives (instructor + location highlight)
- TypeScript clean, build passes

---

## Task 7: Restyle `/private-sessions/[id]`

**Goal:** Compact hero → two-column layout similar to workshop detail, but right column is a time-slot chooser instead of a single "reserve" button.

**File:** Replace `fe/src/app/(client)/private-sessions/[id]/page.tsx`.

### Composition

1. `<Hero variant="compact" imageKey="hero-meditation-01" eyebrow="1:1 Session" headline={\`Session with \${instructor.name}\`} subheadline={\`\${duration} min · \${location.name}\`} primaryCta={{ href: "#slots", label: "Pick a time" }} />`
2. `<BookingSurface maxWidth="lg" padding="default">`:
   - `grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10`.
   - Left: instructor bio, bullet list of what's included, policies (reschedule, cancellation) using the same typography patterns as Task 5.
   - Right (sticky): list of available time slots — rendered as a vertical list of buttons, each `rounded-xl border border-ink/10 px-4 py-3 text-sm flex items-center justify-between hover:border-accent`. Selected slot adds `border-accent bg-accent/5`. Below the list: price + "Continue to checkout" primary button (full width).
3. No closing CTA (user is mid-flow).

### Steps

- [ ] **Step 1: Read current page** — preserve slot state + selection handler + the "continue" handler that routes to `/checkout`.
- [ ] **Step 2: Replace** with the composition.
- [ ] **Step 3: Verify** build + smoke-check.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/private-sessions/\[id\]/page.tsx
  git commit -m "feat(fe): phase C private-session detail — time-slot chooser"
  ```

### Done criteria

- Slot selection highlights correctly
- Continue button routes to checkout
- TypeScript clean, build passes

---

## Task 8: Restyle `/checkout`

**Goal:** Compact hero (tiny — `eyebrow="Checkout"`) → two-column layout (left: 3-step form, right: sticky order summary) inside `BookingSurface`.

**File:** Replace `fe/src/app/(client)/checkout/page.tsx`.

### Composition

1. `<Hero variant="compact" imageKey="hero-yoga-01" eyebrow="Checkout" headline="One last step" subheadline="Review your order and complete payment." primaryCta={{ href: "#form", label: "Begin" }} />` (OK for this hero to be very slim — it's flow context.)
2. `<BookingSurface maxWidth="lg" padding="default">`:
   - Step indicator: a horizontal row of three circles (1-2-3) with connecting lines, labels "Personal info", "Pay with", "Review". Active step = `bg-ink text-paper`, inactive = `bg-warm text-muted`.
   - `grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 mt-10`.
   - Left: the current step's fields, each labelled (`label` tag with `text-xs uppercase tracking-wider text-muted mb-2 block`). Inputs: `rounded-xl border border-ink/10 bg-paper px-4 py-3 text-sm w-full focus:border-accent focus:outline-none`. Step footer: "Back" (secondary, `rounded-full border border-ink/10 px-5 py-3`) + "Continue" (primary) buttons.
   - Right (sticky): order summary card — `sticky top-24 self-start rounded-2xl border border-ink/10 bg-paper p-6`. Items: product image thumbnail (`rounded-lg h-12 w-12 object-cover`) + name + price, one row each. Divider. Subtotal + total rows. Small legal text (`text-xs text-muted mt-4`).
3. No CTA banner.

### Steps

- [ ] **Step 1: Read current page** — preserve step state (`useState<1 | 2 | 3>`), form data, and the submit handler.
- [ ] **Step 2: Replace** with the composition.
- [ ] **Step 3: Verify** build + smoke-check the three steps manually.
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/checkout/page.tsx
  git commit -m "feat(fe): phase C checkout — 3-step form + sticky order summary"
  ```

### Done criteria

- Stepper visually updates as user proceeds
- Order summary is sticky on desktop, not on mobile (stacked below)
- TypeScript clean, build passes

---

## Task 9: Restyle `/booking/confirmation`

**Goal:** Full-bleed compact hero with success tone → confirmation summary card with QR → "Next steps" list → closing CTA to `/account`.

**File:** Replace `fe/src/app/(client)/booking/confirmation/page.tsx`.

### Composition

1. `<Hero variant="compact" imageKey="hero-yoga-01" eyebrow="You're booked" headline="See you on the mat" subheadline="A confirmation email is on its way." primaryCta={{ href: "#summary", label: "View details" }} />`
2. `<BookingSurface maxWidth="md" padding="loose">`:
   - `<SectionHeading eyebrow="Your booking" title="Session details" align="center" />`
   - Summary stack (center-aligned): class name (`text-2xl font-bold`), date/time (`text-lg text-muted`), location (`text-sm text-muted`), instructor. Each line separated by `mt-2`.
   - QR block: centered square `h-48 w-48 mx-auto mt-8 rounded-2xl border border-ink/10 bg-paper p-4` containing the existing QR render (`<QRCode value={bookingRef} />`). Below QR: `text-xs uppercase tracking-wider text-muted` saying "Scan at the studio".
   - Action row: "Add to calendar" (secondary) + "View in account" (primary) — `mt-10 flex gap-3 justify-center`.
3. **"Next steps" section** (`py-16 bg-paper`): centered `<SectionHeading align="center" eyebrow="What's next" title="Before your class" />` + 3 bullet cards (arrive 10 min early, bring water, wear comfortable clothing) — reuse the visual of `FeatureGrid` but inline here in 3 columns.
4. `<CtaBanner imageKey="cta-community" headline="Keep your momentum" subheadline="Book your next class while you're here." primaryCta={{ href: "/classes", label: "Browse classes" }} />`

### Steps

- [ ] **Step 1: Read current page** — preserve `bookingRef`, the data lookup (likely via `useSearchParams`), and the QR component import.
- [ ] **Step 2: Replace** with the composition.
- [ ] **Step 3: Verify** build + smoke-check via `/booking/confirmation?ref=TEST123` (or however the current page is reached).
- [ ] **Step 4: Commit**
  ```bash
  git add fe/src/app/\(client\)/booking/confirmation/page.tsx
  git commit -m "feat(fe): phase C confirmation — success hero + QR + next steps"
  ```

### Done criteria

- QR still renders against a known value
- All three action buttons are present
- TypeScript clean, build passes

---

## Task 10: Visual smoke verification

**Goal:** Capture snapshots across all eight restyled routes on desktop + mobile viewports, confirm no regressions on Phase A/B pages.

**Files to create:**
- `docs/superpowers/specs/phase-c-snapshots/` (directory)

### Routes to capture (desktop 1440×900 + mobile 375×812)

Desktop:
- `/classes` → `classes-desktop.png`
- `/packages` → `packages-desktop.png`
- `/workshops` → `workshops-desktop.png`
- `/workshops/<first-id>` → `workshop-detail-desktop.png`
- `/private-sessions` → `private-sessions-desktop.png`
- `/private-sessions/<first-id>` → `private-session-detail-desktop.png`
- `/checkout` → `checkout-desktop.png`
- `/booking/confirmation` → `confirmation-desktop.png`
- `/` → `home-desktop.png` (regression — Phase B)
- `/pricing` → `pricing-desktop.png` (regression — Phase B)

Mobile:
- `/classes` → `classes-mobile.png`
- `/checkout` → `checkout-mobile.png`
- `/booking/confirmation` → `confirmation-mobile.png`

### Acceptance criteria

1. ✅/❌ **Every Phase C page opens with a compact hero** using a cream-toned photo.
2. ✅/❌ **Every Phase C page wraps functional content in a `BookingSurface`** (rounded cream card on warm background).
3. ✅/❌ **Classes weekly grid navigates** (at least one week forward + back works).
4. ✅/❌ **Packages tabs switch** visible products.
5. ✅/❌ **Workshops detail page has sticky purchase card** on desktop.
6. ✅/❌ **Checkout stepper advances** through the 3 steps.
7. ✅/❌ **Confirmation QR renders** (no broken-image icon).
8. ✅/❌ **Phase B landing + pricing unchanged** — no regression.
9. ✅/❌ **Phase A nav + footer render on all 8 new pages** — top nav 72px, dark footer present.
10. ✅/❌ **No console errors** on any of the 8 desktop routes.

### Steps

- [ ] **Step 1:** `cd fe && npm run dev` in background; wait for ready.
- [ ] **Step 2:** Capture all 13 screenshots via Playwright MCP. Save to `docs/superpowers/specs/phase-c-snapshots/`.
- [ ] **Step 3:** Open DevTools console on each desktop route; note any errors.
- [ ] **Step 4:** Evaluate criteria 1–10 against the screenshots.
- [ ] **Step 5:** If any criterion fails, file issues to `docs/superpowers/specs/phase-c-issues.md`. If all pass, skip.
- [ ] **Step 6: Commit + tag.**

```bash
git add docs/superpowers/specs/phase-c-snapshots/
[ -f docs/superpowers/specs/phase-c-issues.md ] && git add docs/superpowers/specs/phase-c-issues.md
git commit -m "chore(fe): phase C visual verification snapshots" --allow-empty
git tag phase-c-booking
```

- [ ] **Step 7:** Stop the dev server. If the harness blocks process kill, leave it and report to controller.

### Done criteria

- All 10 acceptance criteria evaluated (each ✅ or ❌)
- Snapshots committed
- Tag `phase-c-booking` created

---

## Phase C Done Criteria

All ten tasks complete AND:
- 2 new booking primitives live in `fe/src/components/booking/`
- 8 functional pages rebuilt using Phase A/B components + new primitives
- `npm run build` exits 0 from `fe/`
- `phase-c-booking` tag exists
- Visual snapshots committed
- Data shapes and handlers untouched (grep check: no changes to `fe/src/data/`)
- All review issues either resolved or escalated

When all are green, hand off to Phase D planning (account pages, auth pages, polish).

---

## Notes for the Controller

- **Stitch MCP is available** — use for any page where the visual structure feels unclear (especially `/checkout` stepper and `/booking/confirmation` QR layout).
- **Frontend-design skill is also available** — alternative to Stitch.
- **Worktree:** branch `redesign/phase-c-booking` is the workspace; do not switch branches.
- **Rollback:** each page is a single commit. `git revert <sha>` is safer than in-place fixes if a restyle lands wrong.
- **Data integrity check before each commit:** `git diff HEAD -- fe/src/data/` must be empty. Phase C does not touch data.
