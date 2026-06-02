# fe-client Booking-First Home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` render the live class schedule (the booking surface) instead of a marketing landing page, so members open the app straight onto booking.

**Architecture:** Extract the existing `/classes` schedule UI into a reusable `<ClassSchedule />` component and render it at `/`. Redirect `/classes` → `/`. Repoint nav, drop the transparent-over-hero header effect, and delete the now-orphaned marketing components. No backend, middleware, or data-flow changes — routes are already public and login-at-booking is already wired.

**Tech Stack:** Next.js 16 (App Router), React, Tailwind, Clerk, shadcn/ui.

**Verification model:** `fe-client` has **no test runner** (lint is also broken). Per project convention, every task is gated on `npx tsc --noEmit` and the final task on `npm run build`, both run from the `fe-client/` directory. Commands below assume you are in `fe-client/`.

---

### Task 1: Extract the schedule into `<ClassSchedule />`

**Files:**
- Create: `fe-client/src/components/booking/class-schedule.tsx`
- Source: `fe-client/src/app/(client)/classes/page.tsx` (its full current contents)

- [ ] **Step 1: Create the component file as a verbatim copy of the schedule page**

Copy the **entire current contents** of `fe-client/src/app/(client)/classes/page.tsx` into the new file `fe-client/src/components/booking/class-schedule.tsx`. Keep all helpers (`getMonthGrid`, `ClassRow`, `FilterSelect`, the `DAY_LABELS`/`MONTH_NAMES` constants) and all imports in the same file. The file already starts with `"use client";` — keep that as the first line.

- [ ] **Step 2: Convert the default page export into a named component export**

In the new `class-schedule.tsx`, change the export line:

```tsx
// from:
export default function ClassesPage() {
// to:
export function ClassSchedule() {
```

- [ ] **Step 3: Repoint the logged-out booking redirect to `/`**

In `class-schedule.tsx`, inside `ClassRow`'s `handleBookClick`, change the signed-out redirect target from `/classes` to `/`:

```tsx
    if (!isSignedIn) {
      router.push(`/login?next=${encodeURIComponent("/")}`);
      return;
    }
```

- [ ] **Step 4: Update the heading to orient first-time/logged-out visitors**

In `class-schedule.tsx`, change the `SectionHeading` eyebrow from `"Schedule"` to the brand + locations line (title and description stay the same):

```tsx
        <SectionHeading
          eyebrow="Yoga Sadhana · Tai Seng & Outram Park"
          title="Book a class"
          description="Pick a day, filter the schedule, and reserve your spot."
        />
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The old `classes/page.tsx` still exists and still compiles at this point.

- [ ] **Step 6: Commit**

```bash
git add fe-client/src/components/booking/class-schedule.tsx
git commit -m "fe-client: extract class schedule into reusable ClassSchedule component"
```

---

### Task 2: Render the schedule at `/`

**Files:**
- Modify (replace whole file): `fe-client/src/app/(client)/page.tsx`

- [ ] **Step 1: Replace the marketing homepage with the schedule**

Replace the **entire contents** of `fe-client/src/app/(client)/page.tsx` with:

```tsx
import { ClassSchedule } from "@/components/booking/class-schedule";

export default function HomePage() {
  return <ClassSchedule />;
}
```

This drops all 7 marketing imports (`Hero`, `Locations`, `FeatureGrid`, `FeatureDeepDive`, `ShowcaseGrid`, `Testimonial`, `CtaBanner`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (The marketing component files are now unimported but still present, so no missing-module errors.)

- [ ] **Step 3: Commit**

```bash
git add "fe-client/src/app/(client)/page.tsx"
git commit -m "fe-client: render class schedule at / (was marketing landing)"
```

---

### Task 3: Redirect `/classes` → `/`

**Files:**
- Modify: `fe-client/next.config.ts`
- Delete: `fe-client/src/app/(client)/classes/page.tsx` (and the now-empty `classes/` directory)

- [ ] **Step 1: Add a permanent redirect in `next.config.ts`**

Add a `redirects()` async function to the config object. The full file becomes:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "placehold.co" },
      { protocol: "https", hostname: "placeholder.co" },
      { protocol: "https", hostname: "i0.wp.com" },
      { protocol: "https", hostname: "yogasadhana.sg" },
    ],
  },
  async redirects() {
    return [{ source: "/classes", destination: "/", permanent: true }];
  },
};

export default nextConfig;
```

- [ ] **Step 2: Delete the old `/classes` route**

Delete `fe-client/src/app/(client)/classes/page.tsx`. If the `classes/` directory is now empty, remove it too.

```bash
git rm "fe-client/src/app/(client)/classes/page.tsx"
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (The `next.config.ts` redirect shadows the deleted route; `/classes` requests now 308 to `/`.)

- [ ] **Step 4: Commit**

```bash
git add fe-client/next.config.ts
git commit -m "fe-client: redirect /classes to / (single canonical schedule URL)"
```

---

### Task 4: Make the nav booking-first

**Files:**
- Modify: `fe-client/src/components/layout/client-nav.tsx`

- [ ] **Step 1: Rename the first nav link to Schedule → `/`**

In `client-nav.tsx`, change the first entry of `NAV_LINKS`:

```tsx
const NAV_LINKS = [
  { href: "/", label: "Schedule" },
  { href: "/workshops", label: "Workshops" },
  { href: "/private-sessions", label: "Private Sessions" },
  { href: "/packages", label: "Packages" },
  { href: "/corporate", label: "Corporate" },
];
```

- [ ] **Step 2: Remove the transparent-over-hero scroll effect**

The header was transparent at the top of the old hero homepage and turned solid on scroll. With `/` now a schedule, make the header always solid.

Delete the `scrolled` state and its `useEffect`, and the `isHome` / `isTransparent` derivations:

```tsx
// DELETE these lines:
const [scrolled, setScrolled] = useState(false);
// ...
const isHome = pathname === "/";

useEffect(() => {
  if (!isHome) {
    setScrolled(false);
    return;
  }
  const handleScroll = () => setScrolled(window.scrollY > 40);
  handleScroll();
  window.addEventListener("scroll", handleScroll, { passive: true });
  return () => window.removeEventListener("scroll", handleScroll);
}, [isHome]);

const isTransparent = isHome && !scrolled;
```

Then simplify the `<header>` className so it is always solid — replace the `isTransparent ? ... : ...` ternary with the solid styles:

```tsx
    <header
      className={cn(
        "sticky z-50 transition-all duration-300",
        impersonating ? "top-10" : "top-0",
        "bg-paper/95 backdrop-blur-sm border-b border-border"
      )}
    >
```

Remove the now-unused `useEffect` import if nothing else in the file uses it (check the top-of-file React import; `useState` is still used by `mobileOpen`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (Watch for an unused-import error on `useEffect` — remove it from the import if flagged.)

- [ ] **Step 4: Commit**

```bash
git add fe-client/src/components/layout/client-nav.tsx
git commit -m "fe-client: nav Classes->Schedule, drop transparent-over-hero header"
```

---

### Task 5: Delete the orphaned marketing components

**Files:**
- Delete: `fe-client/src/components/marketing/` (entire directory)

Verified during planning: every `@/components/marketing/*` import lived only in the old `page.tsx`, which Task 2 rewrote. The `tsc` pass is the safety net for any straggler.

- [ ] **Step 1: Delete the marketing directory**

```bash
git rm -r fe-client/src/components/marketing
```

- [ ] **Step 2: Typecheck — this is the real verification**

Run: `npx tsc --noEmit`
Expected: PASS. If it fails with a missing module from `@/components/marketing/...`, that file is still referenced somewhere — `git checkout` just that one file back, leave the rest deleted, and note the remaining reference.

- [ ] **Step 3: Commit**

```bash
git add -A fe-client/src/components/marketing
git commit -m "fe-client: remove unused marketing landing components"
```

---

### Task 6: Full build + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build succeeds with no type or compile errors. The route list should show `/` (and `/workshops`, `/packages`, etc.) but **no** `/classes` page route.

- [ ] **Step 2: Manual smoke (dev server)**

Run: `npm run dev`, then verify:
- Visiting `/` shows the month calendar + day class list (the schedule), not a hero/landing.
- The header is solid (no transparent flash) on `/` and on `/packages`.
- Top nav reads **Schedule · Workshops · Private Sessions · Packages · Corporate** (+ My Account when signed in).
- Signed out, clicking **Book Now** on a class navigates to `/login?next=%2F`.
- Visiting `/classes` 308-redirects to `/`.

- [ ] **Step 3: Commit (only if Step 1/2 required any fix)**

```bash
git add -A
git commit -m "fe-client: booking-first home verification fixes"
```

---

## Self-Review

**Spec coverage:**
- `/` renders the schedule → Tasks 1–2. ✓
- Browse public / login-at-booking → already wired; redirect repointed to `/` in Task 1 Step 3. ✓
- `/classes` permanent redirect → Task 3. ✓
- Nav "Classes" → "Schedule" → Task 4 Step 1. ✓
- Marketing landing removed → Tasks 2 (page) + 5 (components). ✓
- Orientation header → Task 1 Step 4. ✓
- Transparent-nav cleanup (spec extra) → Task 4 Step 2. ✓
- Out of scope (BE booking stub, account dashboard, middleware) → untouched. ✓

**Placeholder scan:** none — every code step shows the exact change.

**Type/name consistency:** `ClassSchedule` (named export) defined in Task 1, imported identically in Task 2. `NAV_LINKS` shape unchanged. `redirects()` matches Next.js config typing.
