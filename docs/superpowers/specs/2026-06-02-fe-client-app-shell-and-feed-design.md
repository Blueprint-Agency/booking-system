# fe-client: App Shell + Upcoming Feed — Design

**Date:** 2026-06-02
**App:** `fe-client/`
**Goal:** Make the member app *feel* like a booking app, not a website. Replace the website-style top nav with a mobile-first app shell (bottom tab bar → desktop left rail), and turn the home page into a continuous feed of all upcoming bookable classes.

Builds on the prior change (`2026-06-02-fe-client-booking-first-home-design.md`) where `/` became the schedule. This iteration replaces the month-calendar home with a feed and replaces the nav chrome.

---

## Decisions (locked)

| Question | Decision |
|---|---|
| Nav pattern | **Bottom tab bar on mobile; slim left rail on desktop.** A thin top status bar on both. |
| Home layout | **Continuous upcoming feed** — scroll of all bookable classes grouped by day header. No calendar. |
| Primary tabs | **Schedule · Workshops · Packages · Account** (4). |
| Private Sessions | Not a tab — **segmented toggle inside Schedule** (`Group Classes | Private Sessions`), routing to existing `/private-sessions`. |
| Corporate | Not a tab — reachable via **Account** (`/account/corporate` exists). `/corporate` route stays. |
| Footer | **Removed** from the app shell (legal/links live in Account). |
| Feed filters | Keep a compact **Location + Instructor** filter bar, defaulting to *all*. |

**Out of scope:** backend, middleware, auth flows, the BE-stubbed booking action (still "coming soon"). Account pages, packages, workshops content unchanged except their nav chrome.

---

## Architecture: the app shell

`(client)/layout.tsx` currently renders `<ClientNav/> <main/> <SiteFooter/>`. Replace with an `<AppShell>` that wraps children:

```
<AppShell impersonating>
  ├─ AppTopBar        slim, sticky. Left: logo. Right: credits pill + avatar menu (signed in)
  │                   or "Log in" (signed out).
  ├─ row (flex):
  │   ├─ SideRail     desktop only (md+): 4 icon+label nav items, persistent left column.
  │   └─ <main>       the page. pb-24 on mobile (clear the bottom bar), md:pb-0.
  └─ BottomTabBar     mobile only (md:hidden): fixed bottom, 4 icon+label tabs, safe-area padded.
```

```
DESKTOP (≥ md)                 MOBILE
┌─────────────────────────┐    ┌──────────────────┐
│ YS Yoga Sadhana    ◔ ▾ │    │ YS  Yoga…   ◔ ▾  │  AppTopBar
├────┬────────────────────┤    ├──────────────────┤
│▣Sc │  Today · Jun 4      │    │  Today · Jun 4   │
│◳Wk │  7:00 Hatha    Book │    │  7:00 Hatha Book │  <main> (ClassFeed)
│▤Pk │  9:30 Vinyasa  Book │    │  9:30 Vinyasa... │
│◔Me │  Tomorrow           │    ├──────────────────┤
└────┴────────────────────┘    │ ▣   ◳   ▤   ◔   │  BottomTabBar
  SideRail                     │Sch Shop Pkg  Me  │
                               └──────────────────┘
```

### Nav items (single source of truth)

`components/layout/app-nav-items.ts`:

| Label | href | Lucide icon | Active when pathname… |
|---|---|---|---|
| Schedule | `/` | `CalendarDays` | `=== "/"` or starts `/private-sessions` |
| Workshops | `/workshops` | `GraduationCap` | starts `/workshops` |
| Packages | `/packages` | `Ticket` | starts `/packages` |
| Account | `/account` | `User` | starts `/account` or `/corporate` |

Both `SideRail` and `BottomTabBar` consume this list (DRY). Each item carries an `isActive(pathname)` matcher so Private Sessions keeps Schedule lit and Corporate keeps Account lit.

### AppTopBar
- Client component. Uses `useUser`, `useClerk`, `useClientPackages` (reuse from existing `client-nav.tsx`).
- Signed in: the credits pill (`class credits` / `PT sessions`) + avatar dropdown (reuse the existing dropdown markup/menu from `client-nav.tsx`).
- Signed out: a **Log in** link → `/login`, and **Sign up** → `/register`.
- Sticky; offset by `top-10` when `impersonating` (parity with today).

### SideRail (desktop) & BottomTabBar (mobile)
- Render the 4 nav items. Active item: accent text + subtle background (match existing `text-accent-deep bg-accent/10` active style). Inactive: muted.
- `BottomTabBar`: `fixed bottom-0 inset-x-0 md:hidden`, `border-t`, `bg-paper/95 backdrop-blur`, `pb-[env(safe-area-inset-bottom)]`, items as vertical icon-over-label, equal width.
- `SideRail`: `hidden md:flex md:flex-col`, fixed-ish width (~`w-56`), `border-r`, items as horizontal icon+label rows.

### Footer
- Remove `<SiteFooter/>` from the layout. (Component file kept in repo for reuse in Account/legal pages, but no longer global.)

---

## Architecture: the upcoming feed

### `components/booking/class-row.tsx` (extracted)
Move the existing `ClassRow` and `FilterSelect` (and the imports they need) out of `class-schedule.tsx` into this shared file, exported. **No behavioural change** — same booking redirect (`?next=/`), credits, full/booked states, and the three modals (details, no-package, coming-soon). The feed and any future view reuse it.

### `components/booking/schedule-segments.tsx`
A segmented control: two pills `[ Group Classes | Private Sessions ]`.
- `Group Classes` → `/` (active on home)
- `Private Sessions` → `/private-sessions` (active on that route)
- Active determined by `usePathname`. Rendered at the top of **both** the feed and the `/private-sessions` page so users can switch either way.

### `components/booking/class-feed.tsx` (the home page body)
Client component. Replaces the calendar.

- **Fetch:** `useClasses({ from, to, location_id, instructor_id })` where `from = start of today (local) → ISO`, `to = today + 30 days → ISO`.
- **Filters:** local state `selectedLocation`, `instructor`; compact sticky filter row using `FilterSelect` (Location from `useLocations()`, Instructor derived from results). Default empty = all.
- **Group & sort:**
  - Keep only classes with `starts_at >= now` (hide already-started).
  - Group by `toLocalDateStr(starts_at)`; sort groups by date ascending; within a group sort by `starts_at`.
- **Day header label** for a date `d`:
  - today → `Today`; today+1 → `Tomorrow`; else `EEE` (e.g. `Sat`). Always followed by `· Mon D` (e.g. `Today · Jun 4`).
- **Render order:** `<SectionHeading eyebrow="Yoga Sadhana · Tai Seng & Outram Park" title="Book a class" description="…">` → `<ScheduleSegments/>` → filter row → grouped list (`day header` + `ClassRow[]`).
- **Loading:** "Loading schedule…". **Empty:** "No upcoming classes in the next 30 days."
- **Window note (YAGNI):** fixed 30-day window for v1; no infinite scroll/"load more" yet. If 30 days proves too short/long, adjust the constant. Documented, not silently capped.

### `(client)/page.tsx`
Renders `<ClassFeed/>` instead of `<ClassSchedule/>`.

### Removed
- `components/booking/class-schedule.tsx` (month calendar: `ClassSchedule`, `getMonthGrid`, `DAY_LABELS`/`MONTH_NAMES`) — superseded by the feed. `ClassRow`/`FilterSelect` survive in `class-row.tsx`.
- `components/layout/client-nav.tsx` — superseded by the app shell. (Confirm nothing else imports it before deleting.)

---

## Data flow (unchanged plumbing)

```
/ → <ClassFeed/> → useClasses({from: today, to: +30d, filters}) → live BE public classes
                 → ClassRow Book Now → signed out → /login?next=/
                                     → no package → /packages
                                     → signed in + package → "coming soon" (BE stub)
AppTopBar → useClientPackages() (credits), useUser()/useClerk() (auth)
Nav active state → usePathname()
```

## Files

| File | Action |
|---|---|
| `components/layout/app-nav-items.ts` | **new** — 4 nav items + active matchers |
| `components/layout/app-shell.tsx` | **new** — orchestrates top bar + rail + main + bottom bar |
| `components/layout/app-top-bar.tsx` | **new** — slim status bar (logo, credits/avatar, auth) |
| `components/layout/side-rail.tsx` | **new** — desktop left rail |
| `components/layout/bottom-tab-bar.tsx` | **new** — mobile bottom tabs |
| `components/booking/class-row.tsx` | **new** — extracted `ClassRow` + `FilterSelect` |
| `components/booking/schedule-segments.tsx` | **new** — Classes/Private toggle |
| `components/booking/class-feed.tsx` | **new** — upcoming feed (home body) |
| `app/(client)/page.tsx` | render `<ClassFeed/>` |
| `app/(client)/private-sessions/page.tsx` | add `<ScheduleSegments/>` at top |
| `app/(client)/layout.tsx` | use `<AppShell>`; drop `<SiteFooter/>` |
| `components/booking/class-schedule.tsx` | **delete** (calendar) |
| `components/layout/client-nav.tsx` | **delete** (after confirming no imports) |

## Verification
No test runner (per `fe_client_build_infra`). Gate on `npx tsc -p fe-client/tsconfig.json --noEmit` per step and `npm run build` at the end. Manual smoke: `/` shows the grouped upcoming feed; bottom tab bar on a narrow viewport, left rail on wide; tabs highlight correctly (Schedule lit on `/private-sessions`, Account lit on `/corporate`); credits pill + avatar still work; no global footer; signed-out Book Now → `/login?next=%2F`.
