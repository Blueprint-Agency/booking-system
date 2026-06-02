# fe-client App Shell + Upcoming Feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the website-style top nav with a mobile-first app shell (bottom tab bar → desktop left rail + slim top bar) and turn the home page into a continuous feed of all upcoming bookable classes.

**Architecture:** A new `AppShell` (top bar + side rail + bottom tab bar) wraps the client layout, driven by one shared nav-items list. The home page renders a `ClassFeed` that fetches a 30-day window, hides past classes, and groups by day. The existing `ClassRow` is extracted for reuse; the month-calendar and old top-nav are deleted.

**Tech Stack:** Next.js 16 App Router, React, Tailwind, Clerk, lucide-react.

**Verification model:** `fe-client` has no test runner. Each task is gated on `npx tsc -p fe-client/tsconfig.json --noEmit`; the final task runs `npm run build --prefix fe-client`.

---

### Task 1: Shared nav-items list

**Files:** Create `fe-client/src/components/layout/app-nav-items.ts`

- [ ] **Step 1: Create the file**

```ts
import { CalendarDays, GraduationCap, Ticket, User, type LucideIcon } from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: "/", label: "Schedule", icon: CalendarDays, isActive: (p) => p === "/" || p.startsWith("/private-sessions") },
  { href: "/workshops", label: "Workshops", icon: GraduationCap, isActive: (p) => p.startsWith("/workshops") },
  { href: "/packages", label: "Packages", icon: Ticket, isActive: (p) => p.startsWith("/packages") },
  { href: "/account", label: "Account", icon: User, isActive: (p) => p.startsWith("/account") || p.startsWith("/corporate") },
];
```

- [ ] **Step 2:** `npx tsc -p fe-client/tsconfig.json --noEmit` → PASS. **Commit:** `git add fe-client/src/components/layout/app-nav-items.ts && git commit -m "fe-client: shared app nav items"`

---

### Task 2: Bottom tab bar + side rail

**Files:** Create `fe-client/src/components/layout/bottom-tab-bar.tsx`, `fe-client/src/components/layout/side-rail.tsx`

- [ ] **Step 1: `bottom-tab-bar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_NAV_ITEMS } from "./app-nav-items";

export function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-paper/95 backdrop-blur-sm border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="grid grid-cols-4">
        {APP_NAV_ITEMS.map(({ href, label, icon: Icon, isActive }) => {
          const active = isActive(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                active ? "text-accent-deep" : "text-muted hover:text-ink",
              )}
            >
              <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: `side-rail.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { APP_NAV_ITEMS } from "./app-nav-items";

export function SideRail() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:flex-col md:w-56 shrink-0 border-r border-border bg-paper">
      <nav className="flex flex-col gap-1 p-3 sticky top-16">
        {APP_NAV_ITEMS.map(({ href, label, icon: Icon, isActive }) => {
          const active = isActive(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors",
                active ? "text-accent-deep bg-accent/10" : "text-muted hover:text-ink hover:bg-warm",
              )}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3:** `npx tsc -p fe-client/tsconfig.json --noEmit` → PASS. **Commit:** `git add fe-client/src/components/layout/bottom-tab-bar.tsx fe-client/src/components/layout/side-rail.tsx && git commit -m "fe-client: bottom tab bar + desktop side rail"`

---

### Task 3: Slim top bar

**Files:** Create `fe-client/src/components/layout/app-top-bar.tsx`

- [ ] **Step 1: Create the file** (credits pill + avatar menu reused from `client-nav.tsx`)

```tsx
"use client";

import Link from "next/link";
import { useUser, useClerk } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { useClientPackages } from "@/lib/use-client-packages";

export function AppTopBar({ impersonating = false }: { impersonating?: boolean }) {
  const { user, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const isAuth = !!isSignedIn;
  const { classCredits, ptSessions: sessionCredits, isUnlimited: unlimited } = useClientPackages();
  const firstName = user?.firstName ?? "";
  const lastName = user?.lastName ?? "";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const userInitials = isAuth ? (firstName.charAt(0) + lastName.charAt(0)).toUpperCase() || "U" : "";

  return (
    <header
      className={cn(
        "sticky z-40 h-16 bg-paper/95 backdrop-blur-sm border-b border-border",
        impersonating ? "top-10" : "top-0",
      )}
    >
      <div className="h-full max-w-[1280px] mx-auto px-4 sm:px-6 flex items-center justify-between">
        <Link href="/" className="flex items-center shrink-0" aria-label="Yoga Sadhana home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://i0.wp.com/yogasadhana.sg/wp-content/uploads/2025/02/Yoga_Sadhana_header_logo_circle.png?w=294&ssl=1"
            alt="Yoga Sadhana"
            className="h-10 w-auto"
          />
        </Link>

        {isAuth ? (
          <div className="relative group flex items-center gap-2.5">
            <Link href="/account" className="flex items-center gap-2 px-3 py-2 rounded-md bg-warm border border-ink/10 hover:border-ink/20 transition-colors">
              <span className="flex items-center gap-1.5" title="Class credits">
                <span className="w-1.5 h-1.5 rounded-full bg-sage" />
                <span className="text-[12px] font-bold text-sage">{unlimited ? "∞" : classCredits}</span>
                <span className="hidden sm:inline text-[10px] font-medium text-muted">class credits</span>
              </span>
              <span className="w-px h-3 bg-ink/15" />
              <span className="flex items-center gap-1.5" title="PT sessions">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="text-[12px] font-bold text-accent-deep">{sessionCredits}</span>
                <span className="hidden sm:inline text-[10px] font-medium text-muted">PT sessions</span>
              </span>
            </Link>
            <button className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center text-[12px] font-bold text-accent-deep group-hover:bg-accent group-hover:text-inverse transition-colors" aria-label="Account menu">
              {userInitials}
            </button>
            <div className="absolute right-0 top-full mt-2 w-64 bg-card border border-border rounded-lg shadow-hover opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
              <div className="px-4 pt-4 pb-3">
                <p className="text-[13px] font-semibold text-ink truncate leading-tight">{firstName} {lastName}</p>
                <p className="text-[11px] text-muted truncate leading-tight mt-0.5">{email}</p>
              </div>
              <div className="border-t border-border py-1">
                <Link href="/account" className="block px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">Overview</Link>
                <Link href="/account/classes" className="block px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">Classes</Link>
                <Link href="/account/profile" className="block px-4 py-2 text-[13px] font-medium text-muted hover:text-ink hover:bg-warm transition-colors">Profile</Link>
              </div>
              <div className="border-t border-border">
                <button onClick={() => signOut({ redirectUrl: "/" })} className="block w-full text-left px-4 py-2.5 text-[13px] font-medium text-error hover:bg-error/10 transition-colors">Log out</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Link href="/login" className="px-4 py-2 text-sm font-semibold text-ink hover:text-accent-deep transition-colors">Log in</Link>
            <Link href="/register" className="px-4 py-2 text-sm font-bold text-inverse bg-accent rounded-md hover:bg-accent-deep transition-colors">Sign up</Link>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2:** `npx tsc -p fe-client/tsconfig.json --noEmit` → PASS. **Commit:** `git add fe-client/src/components/layout/app-top-bar.tsx && git commit -m "fe-client: slim app top bar"`

---

### Task 4: AppShell + wire into layout

**Files:** Create `fe-client/src/components/layout/app-shell.tsx`; Modify `fe-client/src/app/(client)/layout.tsx`

- [ ] **Step 1: `app-shell.tsx`**

```tsx
"use client";

import { AppTopBar } from "./app-top-bar";
import { SideRail } from "./side-rail";
import { BottomTabBar } from "./bottom-tab-bar";

export function AppShell({
  children,
  impersonating = false,
}: {
  children: React.ReactNode;
  impersonating?: boolean;
}) {
  return (
    <>
      <AppTopBar impersonating={impersonating} />
      <div className="flex flex-1">
        <SideRail />
        <main className="flex-1 min-w-0 pb-24 md:pb-0">{children}</main>
      </div>
      <BottomTabBar />
    </>
  );
}
```

- [ ] **Step 2: Replace `(client)/layout.tsx`** (drop `ClientNav` + `SiteFooter`)

```tsx
import { cookies } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import { ClientPackagesProvider } from "@/lib/use-client-packages";
import { ImpersonationBanner } from "@/components/impersonation-banner";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const impersonating = jar.has("__imp_grant");

  return (
    <ClientPackagesProvider>
      <ImpersonationBanner />
      <div className={`min-h-screen bg-paper flex flex-col ${impersonating ? "pt-10" : ""}`}>
        <ScrollToTop />
        <AppShell impersonating={impersonating}>{children}</AppShell>
      </div>
    </ClientPackagesProvider>
  );
}
```

- [ ] **Step 3:** `npx tsc -p fe-client/tsconfig.json --noEmit` → PASS. **Commit:** `git add fe-client/src/components/layout/app-shell.tsx "fe-client/src/app/(client)/layout.tsx" && git commit -m "fe-client: app shell replaces website nav + footer"`

---

### Task 5: Extract ClassRow + FilterSelect

**Files:** Create `fe-client/src/components/booking/class-row.tsx`; will delete `class-schedule.tsx` in Task 8.

- [ ] **Step 1: Create `class-row.tsx`** — move `ClassRow` and `FilterSelect` verbatim out of `class-schedule.tsx`, with their imports. The file begins:

```tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatClassTime, durationMinutes, type ApiClassCard } from "@/lib/classes";
```

Then paste the **exact** `ClassRow` component (lines 32–226 of the current `class-schedule.tsx`, the function `function ClassRow({...}) { ... }`) and the **exact** `FilterSelect` (its `type FilterSelectProps` + `function FilterSelect(...)`, lines 228–253), changing both `function ClassRow` → `export function ClassRow` and `function FilterSelect` → `export function FilterSelect`. No logic changes — the signed-out redirect already targets `?next=/`.

- [ ] **Step 2:** `npx tsc -p fe-client/tsconfig.json --noEmit` → PASS (both `class-schedule.tsx` and `class-row.tsx` now define the components; that's fine, they're separate modules). **Commit:** `git add fe-client/src/components/booking/class-row.tsx && git commit -m "fe-client: extract ClassRow + FilterSelect for reuse"`

---

### Task 6: Schedule segmented toggle

**Files:** Create `fe-client/src/components/booking/schedule-segments.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SEGMENTS = [
  { href: "/", label: "Group Classes" },
  { href: "/private-sessions", label: "Private Sessions" },
];

export function ScheduleSegments() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <div className="inline-flex items-center rounded-full bg-warm border border-ink/10 p-1 mb-6">
      {SEGMENTS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "px-4 py-1.5 text-sm font-semibold rounded-full transition-colors",
            isActive(href) ? "bg-paper text-accent-deep shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2:** `npx tsc -p fe-client/tsconfig.json --noEmit` → PASS. **Commit:** `git add fe-client/src/components/booking/schedule-segments.tsx && git commit -m "fe-client: schedule segmented toggle (classes/private)"`

---

### Task 7: ClassFeed + render at `/` + private-sessions toggle

**Files:** Create `fe-client/src/components/booking/class-feed.tsx`; Modify `fe-client/src/app/(client)/page.tsx`, `fe-client/src/app/(client)/private-sessions/page.tsx`

- [ ] **Step 1: Create `class-feed.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useClasses, useLocations, useCanBookClass, toLocalDateStr, type ApiClassCard } from "@/lib/classes";
import { BookingSurface } from "@/components/booking/booking-surface";
import { SectionHeading } from "@/components/booking/section-heading";
import { ClassRow, FilterSelect } from "@/components/booking/class-row";
import { ScheduleSegments } from "@/components/booking/schedule-segments";

const WINDOW_DAYS = 30;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function windowEndISO(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function dayHeaderLabel(dateStr: string): string {
  const todayStr = toLocalDateStr(new Date().toISOString());
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const tomorrowStr = toLocalDateStr(t.toISOString());
  const d = new Date(dateStr + "T00:00:00");
  const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (dateStr === todayStr) return `Today · ${md}`;
  if (dateStr === tomorrowStr) return `Tomorrow · ${md}`;
  return `${d.toLocaleDateString("en-SG", { weekday: "short" })} · ${md}`;
}

export function ClassFeed() {
  const [selectedLocation, setSelectedLocation] = useState("");
  const [instructor, setInstructor] = useState("");

  const from = useMemo(() => startOfTodayISO(), []);
  const to = useMemo(() => windowEndISO(WINDOW_DAYS), []);
  const nowMs = useMemo(() => Date.now(), []);

  const { data: classes, loading } = useClasses({
    from,
    to,
    location_id: selectedLocation || undefined,
    instructor_id: instructor || undefined,
  });
  const { data: locations } = useLocations();
  const { isSignedIn } = useUser();
  const { canBook, loaded: canBookLoaded } = useCanBookClass();

  const all = useMemo(() => classes ?? [], [classes]);
  const showLocationBadge = !selectedLocation;

  const instructorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of all) seen.set(c.instructor.id, c.instructor.name);
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [all]);

  const groups = useMemo(() => {
    const upcoming = all
      .filter((c) => new Date(c.starts_at).getTime() >= nowMs)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const byDay = new Map<string, ApiClassCard[]>();
    for (const c of upcoming) {
      const k = toLocalDateStr(c.starts_at);
      const arr = byDay.get(k);
      if (arr) arr.push(c);
      else byDay.set(k, [c]);
    }
    return Array.from(byDay, ([date, items]) => ({ date, items }));
  }, [all, nowMs]);

  return (
    <BookingSurface maxWidth="xl" padding="default">
      <SectionHeading
        eyebrow="Yoga Sadhana · Tai Seng & Outram Park"
        title="Book a class"
        description="All upcoming classes across both studios — book your spot."
      />
      <ScheduleSegments />

      <div className="flex flex-wrap gap-2 mb-6">
        <FilterSelect
          value={selectedLocation}
          onChange={setSelectedLocation}
          options={(locations ?? []).map((l) => ({ value: l.id, label: l.name }))}
          placeholder="All locations"
        />
        <FilterSelect value={instructor} onChange={setInstructor} options={instructorOptions} placeholder="All instructors" />
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm text-muted">Loading schedule…</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted">No upcoming classes in the next {WINDOW_DAYS} days.</div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(({ date, items }) => (
            <div key={date}>
              <p className="font-serif text-base text-ink mb-3 sticky top-16 bg-paper/95 backdrop-blur-sm py-1 z-10">
                {dayHeaderLabel(date)}
              </p>
              <div className="flex flex-col gap-3">
                {items.map((c) => (
                  <ClassRow
                    key={c.id}
                    cls={c}
                    showLocation={showLocationBadge}
                    canBook={canBook}
                    canBookLoaded={canBookLoaded}
                    isSignedIn={!!isSignedIn}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </BookingSurface>
  );
}
```

- [ ] **Step 2: Repoint `(client)/page.tsx`**

```tsx
import { ClassFeed } from "@/components/booking/class-feed";

export default function HomePage() {
  return <ClassFeed />;
}
```

- [ ] **Step 3: Add the toggle to `/private-sessions`** — in `private-sessions/page.tsx`, add the import `import { ScheduleSegments } from "@/components/booking/schedule-segments";` and render `<ScheduleSegments />` immediately after the page's `<SectionHeading … />` element (inside its `BookingSurface`).

- [ ] **Step 4:** `npx tsc -p fe-client/tsconfig.json --noEmit` → PASS. **Commit:** `git add fe-client/src/components/booking/class-feed.tsx "fe-client/src/app/(client)/page.tsx" "fe-client/src/app/(client)/private-sessions/page.tsx" && git commit -m "fe-client: home is an upcoming class feed; private-sessions toggle"`

---

### Task 8: Delete superseded files + build

**Files:** Delete `fe-client/src/components/booking/class-schedule.tsx`, `fe-client/src/components/layout/client-nav.tsx`

- [ ] **Step 1: Delete**

```bash
git rm fe-client/src/components/booking/class-schedule.tsx fe-client/src/components/layout/client-nav.tsx
```

- [ ] **Step 2: Typecheck** — `npx tsc -p fe-client/tsconfig.json --noEmit` → PASS. If it flags a missing import from either deleted file, that file was still referenced — restore just that one and note the reference.

- [ ] **Step 3: Build** — `npm run build --prefix fe-client` → succeeds; route list shows `/`, `/workshops`, `/packages`, `/account`, `/private-sessions`, no `/classes` page.

- [ ] **Step 4: Manual smoke (`npm run dev --prefix fe-client`):**
  - `/` shows the grouped upcoming feed (Today/Tomorrow/… headers).
  - Narrow viewport → bottom tab bar; wide → left rail. Active tab tracks route (Schedule lit on `/private-sessions`, Account lit on `/corporate`).
  - Credits pill + avatar menu work; signed out shows Log in / Sign up; Book Now signed-out → `/login?next=%2F`.
  - No global footer.
  - Segmented toggle switches `/` ↔ `/private-sessions`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "fe-client: remove month calendar + website nav"`

---

## Self-Review

**Spec coverage:** app shell (top bar/rail/bottom tabs) → T2–T4; nav items + active matchers → T1; ClassRow extraction → T5; segmented toggle → T6 (+ rendered both places in T7); upcoming feed → T7; footer removed → T4; deletions → T8. ✓

**Placeholder scan:** none — full code in every create step; T5/T7-step3 reference exact existing components to move/anchor against.

**Type consistency:** `APP_NAV_ITEMS`/`AppNavItem` used identically in T2; `ClassRow` props (`cls`, `showLocation`, `canBook`, `canBookLoaded`, `isSignedIn`) match the original and the feed's call site; `useClasses`/`useLocations`/`useCanBookClass`/`toLocalDateStr`/`ApiClassCard` are existing exports of `@/lib/classes`; `useClientPackages` fields (`classCredits`, `ptSessions`, `isUnlimited`) match `client-nav.tsx` usage.
