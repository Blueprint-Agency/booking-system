# fe-client: Booking-First Home — Design

**Date:** 2026-06-02
**App:** `fe-client/`
**Goal:** Turn the member-facing app from a marketing landing page into a booking tool. Opening the app should drop you straight onto the bookable class schedule — no marketing homepage to scroll past.

---

## Decisions (locked)

| Question | Decision |
|---|---|
| What does `/` show? | The **class schedule** itself, rendered in place (not a redirect). Root *is* the booking surface. |
| Logged-out visitors? | **Browse freely.** Anyone can view the schedule/workshops/packages without an account; login is prompted only at the moment of booking/buying. |
| `/classes` route? | Becomes a **permanent redirect to `/`** so old links and `?next=/classes` params keep resolving. |
| Nav "Classes" item? | **Renamed "Schedule", pointing to `/`.** |
| Marketing landing? | **Removed from this app.** Acquisition lives elsewhere (separate site / `docs/html`). |

---

## Why this is small

The booking architecture already exists; only the front door is wrong.

- **Routes are already public.** `src/proxy.ts` gates only `/account(.*)` and `/checkout`. `/`, `/classes`, `/workshops`, `/packages`, `/corporate` are already browsable logged-out. No middleware change needed.
- **Login-at-booking is already wired.** In `classes/page.tsx`, `handleBookClick` does `router.push('/login?next=/classes')` when `!isSignedIn`. That is exactly the chosen model.
- **A real booking surface already exists at `/classes`** — month calendar, day list, location/instructor filters, credit cost, "need a package" funnel, built on the existing `BookingSurface` / `SectionHeading` components. We reuse it, not rebuild it.
- The only thing that is a "landing page" is `page.tsx` (7 marketing sections).

> **Out of scope (flagged, not done):** the actual booking action still shows a *"online booking coming soon"* modal because the BE booking endpoint is stubbed (501). That is a backend gap, unrelated to this UI change. No account-dashboard redesign — schedule-as-home was chosen over a dashboard.

---

## Changes

### 1. Extract the schedule into a reusable component
- **New:** `src/components/booking/class-schedule.tsx` — move the entire body of `ClassesPage` (calendar grid, filters, `ClassRow`, modals, hooks) into an exported `<ClassSchedule />` component. No behavioural change.
- This keeps the schedule renderable from more than one route without duplication.

### 2. `/` renders the schedule
- **Edit:** `src/app/(client)/page.tsx` — replace the entire marketing composition with `<ClassSchedule />`.
- Remove the 7 marketing imports (`Hero`, `Locations`, `FeatureGrid`, `FeatureDeepDive`, `ShowcaseGrid`, `Testimonial`, `CtaBanner`).

### 3. `/classes` → permanent redirect to `/`
- **Edit:** `src/app/(client)/classes/page.tsx` — replace its body with a server-side `redirect("/")` (or add a permanent redirect in `next.config`). One canonical URL for the schedule.
- **Edit:** in the extracted schedule, change the logged-out booking redirect from `?next=/classes` to `?next=/`.

### 4. Nav becomes booking-first
- **Edit:** `src/components/layout/client-nav.tsx`:
  - `NAV_LINKS[0]`: `{ href: "/classes", label: "Classes" }` → `{ href: "/", label: "Schedule" }`.
  - **Remove the transparent-over-hero scroll behavior**: delete the `scrolled` state, the `useEffect` scroll listener, `isHome`, and `isTransparent`. Header is always solid (`bg-paper/95 backdrop-blur-sm border-b border-border`). It only existed to sit over the hero image.
  - Leave everything else (logo → `/`, credit pill, account dropdown, auth CTAs, mobile drawer) unchanged.

### 5. Light orientation instead of a hero
- **Edit:** the `SectionHeading` at the top of the schedule — set the eyebrow to carry brand + locations, e.g. eyebrow `"Yoga Sadhana · Tai Seng & Outram Park"`, title `"Book a class"`, keep the existing one-line description. This orients a first-time/logged-out visitor without a marketing wall. The existing `SiteFooter` continues to carry fuller brand/location info.

### 6. Remove now-unused marketing components
- After (2), grep each `@/components/marketing/*` file for other usages. **Delete only those referenced solely by the old homepage.** Keep any reused elsewhere (e.g. `Hero` may appear on other pages — verify before deleting).

---

## Data flow (unchanged)

```
/  ─renders→  <ClassSchedule/>  ─useClasses()→  GET /api/v1/public classes (live BE)
                                 ─useUser()→     Clerk (signed-in state)
   Book Now ─signed out→ /login?next=/  ─signed in, has pkg→ (book; currently "coming soon")
                         └ no package→ "buy a package" modal → /packages
/classes ─redirect→ /
```

## Files touched

| File | Action |
|---|---|
| `src/components/booking/class-schedule.tsx` | **new** — extracted schedule |
| `src/app/(client)/page.tsx` | replace landing with `<ClassSchedule />` |
| `src/app/(client)/classes/page.tsx` | replace with redirect to `/` |
| `src/components/layout/client-nav.tsx` | rename link, drop transparent-nav effect |
| `src/components/marketing/*` | delete those used only by old homepage (verify first) |

## Verification

Per project convention (`fe_client_build_infra`): no lint gate — verify with `tsc --noEmit` + `next build`. Manual smoke: `/` shows the schedule; logged-out Book Now → login with `next=/`; `/classes` redirects to `/`; nav reads "Schedule"; header is solid (no transparent flash) on every route.
