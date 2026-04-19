# Admin Portal Phase 2 — Core Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the four day-to-day operational modules of the Yoga Sadhana admin portal — **Schedule**, **Session Detail**, **Check-in**, and **Private Session Requests** — replacing the Phase 1 `<ComingSoon />` placeholders with fully interactive screens backed by the in-memory mock store.

**Architecture:** All mutations go through new methods on the existing `mock-state.ts` store (`useSyncExternalStore` + `localStorage` key `admin-mock-state:v1`). Schedule math (week/month ranges, grouping) lives in a pure helper `lib/schedule.ts`. Each module gets its own folder under `src/components/`. Pages are thin — they compose components and call store mutators. All date/time strings stay as `YYYY-MM-DD` / `HH:mm` to match seeded data.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Tailwind v4, existing UI primitives (`Button`, `Badge`, `Card`, `Modal`, `Table`, `SlaChip`, `EmptyState`, `PageHeader`), `date-fns` for date math, `qrcode.react` (already installed) for the check-in code preview (optional visual), `lucide-react` for icons.

**Spec reference:** `docs/md/prd-admin.md` §§ 6.3, 6.4, 6.5, 6.6.

**Phase 1 commit range it builds on:** `c5f5337`…`ab72565`.

---

## Working directory

All file paths are **relative to** `C:\Users\chris\Desktop\blueprint\teeko\booking-system`.

Unless otherwise noted, run every `npm`/`npx` command from inside `fe-admin/`:

```bash
cd fe-admin
```

---

## File Structure

**New files:**

```
fe-admin/src/
├── lib/
│   └── schedule.ts                               # week/month/day math, grouping
├── components/
│   ├── schedule/
│   │   ├── session-chip.tsx                      # compact session cell
│   │   ├── week-view.tsx                         # 7-col grid
│   │   ├── month-view.tsx                        # 7×N grid
│   │   ├── schedule-toolbar.tsx                  # view toggle + nav
│   │   ├── create-class-modal.tsx                # recurring class creator
│   │   ├── add-workshop-modal.tsx                # one-off workshop
│   │   └── cancel-session-modal.tsx              # cancel + auto-refund confirmation
│   ├── session/
│   │   ├── roster-table.tsx
│   │   ├── manual-book-modal.tsx
│   │   └── session-actions.tsx                   # cancel / swap-instructor bar
│   ├── check-in/
│   │   ├── scanner-sim.tsx                       # "Simulate scan" cycler
│   │   ├── manual-input.tsx                      # booking-id fallback
│   │   └── recent-check-ins.tsx                  # last 20 list
│   └── requests/
│       ├── request-inbox.tsx                     # grouped list w/ SLA chips
│       ├── request-summary.tsx                   # row in inbox
│       ├── accept-modal.tsx
│       └── decline-modal.tsx
└── app/(admin)/
    ├── schedule/[id]/page.tsx                    # session detail
    └── requests/[id]/page.tsx                    # request detail
```

**Modified files:**

```
fe-admin/src/lib/mock-state.ts                     # new mutators
fe-admin/src/app/(admin)/schedule/page.tsx         # replace ComingSoon with calendar
fe-admin/src/app/(admin)/check-in/page.tsx         # replace ComingSoon
fe-admin/src/app/(admin)/requests/page.tsx         # replace ComingSoon
fe-admin/src/app/(admin)/page.tsx                  # dashboard: wire live counts
```

---

## Verification Strategy

- **Type check:** `npx tsc --noEmit` after every task that changes `.ts`/`.tsx`.
- **Build check:** `npm run build` once at the end of each batch and at Task 20.
- **Manual smoke:** after Task 20, run `npm run dev` and exercise the golden path described in the acceptance checklist.
- No unit tests in this phase — mockup only.

---

## Task 1 — Schedule date helpers

**Files:**
- Create: `fe-admin/src/lib/schedule.ts`

- [ ] **Step 1: Create the helper module**

Write `fe-admin/src/lib/schedule.ts`:

```ts
import {
  addDays,
  addWeeks,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { Session } from "@/types";

/** Anchor: weeks start Monday for the studio. */
const WEEK_OPTS = { weekStartsOn: 1 as const };

export type CalendarView = "week" | "month";

export function weekRange(anchor: Date): { start: Date; end: Date; days: Date[] } {
  const start = startOfWeek(anchor, WEEK_OPTS);
  const end = endOfWeek(anchor, WEEK_OPTS);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return { start, end, days };
}

export function monthRange(anchor: Date): { start: Date; end: Date; days: Date[] } {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, WEEK_OPTS);
  const gridEnd = endOfWeek(monthEnd, WEEK_OPTS);
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  return { start: gridStart, end: gridEnd, days };
}

export function stepAnchor(anchor: Date, view: CalendarView, dir: 1 | -1): Date {
  return view === "week" ? addWeeks(anchor, dir) : addMonths(anchor, dir);
}

export function formatAnchorLabel(anchor: Date, view: CalendarView): string {
  if (view === "week") {
    const { start, end } = weekRange(anchor);
    const sameMonth = start.getMonth() === end.getMonth();
    return sameMonth
      ? `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`
      : `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return format(anchor, "MMMM yyyy");
}

export function isoDay(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function sessionsOn(sessions: Session[], date: Date): Session[] {
  const iso = isoDay(date);
  return sessions
    .filter((s) => s.date === iso)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function sessionsInRange(sessions: Session[], start: Date, end: Date): Session[] {
  return sessions.filter((s) => {
    const d = parseISO(s.date);
    return d >= start && d <= end;
  });
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}

/** Generate forward instances of a recurring class template. */
export function generateInstancesFromTemplate(args: {
  tenantId: string;
  locationId: string;
  name: string;
  category: string;
  level: Session["level"];
  instructorId: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  time: string;
  duration: number;
  capacity: number;
  weeks?: number;
  startDate?: Date;
}): Omit<Session, "id">[] {
  const weeks = args.weeks ?? 12;
  const startDate = args.startDate ?? new Date();
  const out: Omit<Session, "id">[] = [];
  let cursor = startOfWeek(startDate, WEEK_OPTS);
  const offset = (args.dayOfWeek + 6) % 7; // Mon=0 ... Sun=6
  cursor = addDays(cursor, offset);
  if (cursor < startDate) cursor = addDays(cursor, 7);
  for (let i = 0; i < weeks; i++) {
    const date = addDays(cursor, i * 7);
    out.push({
      tenantId: args.tenantId,
      locationId: args.locationId,
      templateId: null,
      name: args.name,
      category: args.category,
      level: args.level,
      type: "regular",
      instructorId: args.instructorId,
      capacity: args.capacity,
      bookedCount: 0,
      waitlistCount: 0,
      date: isoDay(date),
      time: args.time,
      duration: args.duration,
      price: 0,
      status: "scheduled",
      recurrence: `weekly:${args.dayOfWeek}:${args.time}`,
    });
  }
  return out;
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe-admin/src/lib/schedule.ts
git commit -m "feat(fe-admin): add schedule date/range/template helpers"
```

---

## Task 2 — Mock state mutators for schedule + session + check-in + requests

**Files:**
- Modify: `fe-admin/src/lib/mock-state.ts`

- [ ] **Step 1: Append mutator functions**

Open `fe-admin/src/lib/mock-state.ts` and append the following to the end of the file (after `listSeededAdmins`):

```ts
// =====================================================
// --- Phase 2: Core Ops mutators ---------------------
// =====================================================

import type { SessionTemplate } from "@/types";

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- Schedule ----

export function cancelSession(sessionId: string, reason: string): {
  creditsRefunded: number;
  clientsAffected: string[];
} {
  const state = getState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session || session.status === "cancelled") {
    return { creditsRefunded: 0, clientsAffected: [] };
  }
  const affectedBookings = state.bookings.filter(
    (b) => b.sessionId === sessionId && b.status === "confirmed",
  );
  const clientsAffected = affectedBookings.map((b) => b.clientId);

  const adjustments: CreditAdjustment[] = affectedBookings.map((b) => ({
    id: nextId("ca"),
    clientId: b.clientId,
    packageId: b.packageId,
    delta: 1,
    reason: `session cancelled: ${reason}`,
    adminId: state.adminId ?? "system",
    createdAt: nowIso(),
  }));

  const cancellation: SessionCancellation = {
    id: nextId("sc"),
    sessionId,
    reason,
    adminId: state.adminId ?? "system",
    creditsRefunded: affectedBookings.length,
    clientsAffected,
    createdAt: nowIso(),
  };

  setState({
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === sessionId ? { ...s, status: "cancelled", bookedCount: 0 } : s,
    ),
    bookings: state.bookings.map((b) =>
      b.sessionId === sessionId && b.status === "confirmed"
        ? { ...b, status: "cancelled" }
        : b,
    ),
    creditAdjustments: [...state.creditAdjustments, ...adjustments],
    sessionCancellations: [...state.sessionCancellations, cancellation],
  });
  return { creditsRefunded: affectedBookings.length, clientsAffected };
}

export function createSessionInstances(instances: Omit<Session, "id">[]): Session[] {
  const state = getState();
  const withIds: Session[] = instances.map((i) => ({ ...i, id: nextId("sess") }));
  setState({ ...state, sessions: [...state.sessions, ...withIds] });
  return withIds;
}

export function createWorkshop(input: {
  tenantId: string;
  locationId: string;
  name: string;
  instructorId: string;
  date: string;
  time: string;
  duration: number;
  capacity: number;
  price: number;
  level: Session["level"];
  category?: string;
}): Session {
  const state = getState();
  const workshop: Session = {
    id: nextId("sess"),
    tenantId: input.tenantId,
    locationId: input.locationId,
    templateId: null,
    name: input.name,
    category: input.category ?? "Workshop",
    level: input.level,
    type: "workshop",
    instructorId: input.instructorId,
    capacity: input.capacity,
    bookedCount: 0,
    waitlistCount: 0,
    date: input.date,
    time: input.time,
    duration: input.duration,
    price: input.price,
    status: "scheduled",
    recurrence: null,
  };
  setState({ ...state, sessions: [...state.sessions, workshop] });
  return workshop;
}

export function swapSessionInstructor(sessionId: string, instructorId: string): void {
  const state = getState();
  setState({
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === sessionId ? { ...s, instructorId } : s,
    ),
  });
}

// ---- Session Detail / Booking ----

export function manualBook(sessionId: string, clientId: string): Booking | null {
  const state = getState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const exists = state.bookings.find(
    (b) => b.sessionId === sessionId && b.clientId === clientId && b.status === "confirmed",
  );
  if (exists) return exists;
  const atCapacity = session.bookedCount >= session.capacity;
  const booking: Booking = {
    id: nextId("bk"),
    clientId,
    sessionId,
    status: atCapacity ? "waitlisted" : "confirmed",
    checkInStatus: "pending",
    packageId: null,
    rating: null,
    createdAt: nowIso(),
  };
  setState({
    ...state,
    bookings: [...state.bookings, booking],
    sessions: state.sessions.map((s) =>
      s.id === sessionId
        ? atCapacity
          ? { ...s, waitlistCount: s.waitlistCount + 1 }
          : { ...s, bookedCount: s.bookedCount + 1 }
        : s,
    ),
  });
  return booking;
}

export function cancelBooking(bookingId: string): void {
  const state = getState();
  const booking = state.bookings.find((b) => b.id === bookingId);
  if (!booking || booking.status === "cancelled") return;
  setState({
    ...state,
    bookings: state.bookings.map((b) =>
      b.id === bookingId ? { ...b, status: "cancelled" } : b,
    ),
    sessions: state.sessions.map((s) =>
      s.id === booking.sessionId
        ? { ...s, bookedCount: Math.max(0, s.bookedCount - 1) }
        : s,
    ),
  });
}

export function markNoShow(bookingId: string): void {
  const state = getState();
  setState({
    ...state,
    bookings: state.bookings.map((b) =>
      b.id === bookingId ? { ...b, checkInStatus: "no-show" } : b,
    ),
  });
}

// ---- Check-in ----

export function checkInByBookingId(bookingId: string): {
  booking: Booking;
  session: Session;
} | null {
  const state = getState();
  const booking = state.bookings.find((b) => b.id === bookingId);
  if (!booking || booking.status !== "confirmed") return null;
  const session = state.sessions.find((s) => s.id === booking.sessionId);
  if (!session) return null;
  setState({
    ...state,
    bookings: state.bookings.map((b) =>
      b.id === bookingId ? { ...b, checkInStatus: "attended" } : b,
    ),
  });
  return { booking: { ...booking, checkInStatus: "attended" }, session };
}

// ---- Private Requests ----

export function approveRequest(
  requestId: string,
  scheduled: { date: string; time: string },
): void {
  const state = getState();
  setState({
    ...state,
    privateRequests: state.privateRequests.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: "approved",
            resolution: {
              resolvedAt: nowIso(),
              resolvedBy: state.adminId ?? "system",
              scheduledDate: scheduled.date,
              scheduledTime: scheduled.time,
            },
          }
        : r,
    ),
  });
}

export function declineRequest(requestId: string, reason: string): void {
  const state = getState();
  setState({
    ...state,
    privateRequests: state.privateRequests.map((r) =>
      r.id === requestId
        ? {
            ...r,
            status: "declined",
            resolution: {
              resolvedAt: nowIso(),
              resolvedBy: state.adminId ?? "system",
              declineReason: reason,
            },
          }
        : r,
    ),
  });
}
```

- [ ] **Step 2: Fix the duplicate-import lint**

The `SessionTemplate` import appears below; remove the previous top-of-file unused type import if it already exists. Then reorganise: move the new `import type { SessionTemplate } from "@/types";` up to the existing type-import block so the file has only one import block.

Replace the top import block with:

```ts
import {
  AdminUser,
  Booking,
  CreditAdjustment,
  EmailTemplate,
  Invoice,
  PrivateRequest,
  Refund,
  Session,
  SessionCancellation,
  SessionTemplate,
  WaiverSignature,
} from "@/types";
```

(Drop the standalone `import type { SessionTemplate } from "@/types";` at the bottom.)

`SessionTemplate` is imported for future use in Task 8 but keep it listed — no further change needed.

- [ ] **Step 3: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors. If `SessionTemplate` produces an "imported but never used" error under a strict rule, re-export it at the bottom instead:

```ts
export type { SessionTemplate };
```

- [ ] **Step 4: Commit**

```bash
git add fe-admin/src/lib/mock-state.ts
git commit -m "feat(fe-admin): add core-ops mutators (schedule, bookings, check-in, requests)"
```

---

## Task 3 — SessionChip component

**Files:**
- Create: `fe-admin/src/components/schedule/session-chip.tsx`

- [ ] **Step 1: Create the chip**

Write `fe-admin/src/components/schedule/session-chip.tsx`:

```tsx
import Link from "next/link";
import type { Session, Instructor } from "@/types";
import { cn } from "@/lib/utils";

export function SessionChip({
  session,
  instructors,
}: {
  session: Session;
  instructors: Instructor[];
}) {
  const instructor = instructors.find((i) => i.id === session.instructorId);
  const capacityPct = session.capacity === 0 ? 0 : session.bookedCount / session.capacity;
  const isFull = capacityPct >= 1;
  const cancelled = session.status === "cancelled";
  return (
    <Link
      href={`/schedule/${session.id}`}
      className={cn(
        "group block rounded-lg border border-ink/10 bg-white px-2 py-1.5 text-xs transition-colors hover:border-accent/40 hover:bg-accent/[0.03]",
        cancelled && "opacity-50 line-through",
        session.type === "workshop" && "border-l-4 border-l-cyan",
        session.type === "private" && "border-l-4 border-l-sage",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[11px] text-ink/70">{session.time}</span>
        <span
          className={cn(
            "font-mono text-[10px]",
            isFull ? "text-error" : "text-ink/60",
          )}
        >
          {session.bookedCount}/{session.capacity}
        </span>
      </div>
      <div className="truncate font-medium text-ink">{session.name}</div>
      <div className="truncate text-[11px] text-ink/60">
        {instructor?.name ?? "—"}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe-admin/src/components/schedule/session-chip.tsx
git commit -m "feat(fe-admin): add SessionChip for calendar cells"
```

---

## Task 4 — Week view

**Files:**
- Create: `fe-admin/src/components/schedule/week-view.tsx`

- [ ] **Step 1: Create the week grid**

Write `fe-admin/src/components/schedule/week-view.tsx`:

```tsx
import { format } from "date-fns";
import type { Session, Instructor } from "@/types";
import { isSameCalendarDay, sessionsOn, weekRange } from "@/lib/schedule";
import { SessionChip } from "./session-chip";

export function WeekView({
  anchor,
  sessions,
  instructors,
  today,
}: {
  anchor: Date;
  sessions: Session[];
  instructors: Instructor[];
  today: Date;
}) {
  const { days } = weekRange(anchor);
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const daySessions = sessionsOn(sessions, day);
        const isToday = isSameCalendarDay(day, today);
        return (
          <div
            key={day.toISOString()}
            className="min-h-[320px] rounded-xl border border-ink/10 bg-paper/40 p-2"
          >
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                {format(day, "EEE")}
              </span>
              <span
                className={
                  isToday
                    ? "rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white"
                    : "text-sm font-semibold text-ink"
                }
              >
                {format(day, "d")}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {daySessions.length === 0 ? (
                <div className="mt-4 text-center text-[11px] text-ink/30">—</div>
              ) : (
                daySessions.map((s) => (
                  <SessionChip key={s.id} session={s} instructors={instructors} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe-admin/src/components/schedule/week-view.tsx
git commit -m "feat(fe-admin): add WeekView 7-column calendar"
```

---

## Task 5 — Month view

**Files:**
- Create: `fe-admin/src/components/schedule/month-view.tsx`

- [ ] **Step 1: Create the month grid**

Write `fe-admin/src/components/schedule/month-view.tsx`:

```tsx
import { format, isSameMonth } from "date-fns";
import type { Session, Instructor } from "@/types";
import { isSameCalendarDay, monthRange, sessionsOn } from "@/lib/schedule";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView({
  anchor,
  sessions,
  instructors,
  today,
}: {
  anchor: Date;
  sessions: Session[];
  instructors: Instructor[];
  today: Date;
}) {
  const { days } = monthRange(anchor);
  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-2">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-[11px] font-semibold uppercase tracking-wide text-ink/50"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const inMonth = isSameMonth(day, anchor);
          const daySessions = sessionsOn(sessions, day);
          const isToday = isSameCalendarDay(day, today);
          const visible = daySessions.slice(0, 3);
          const extra = daySessions.length - visible.length;
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "min-h-[120px] rounded-xl border p-2",
                inMonth ? "border-ink/10 bg-paper/40" : "border-ink/5 bg-paper/20 opacity-60",
              )}
            >
              <div className="mb-1 flex items-center justify-end">
                <span
                  className={
                    isToday
                      ? "rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white"
                      : "text-[12px] font-semibold text-ink"
                  }
                >
                  {format(day, "d")}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {visible.map((s) => {
                  const inst = instructors.find((i) => i.id === s.instructorId);
                  return (
                    <a
                      key={s.id}
                      href={`/schedule/${s.id}`}
                      className="truncate rounded-md bg-white px-1.5 py-1 text-[11px] text-ink hover:bg-accent/5"
                      title={`${s.name} · ${inst?.name ?? "—"}`}
                    >
                      <span className="font-mono text-ink/60">{s.time}</span>{" "}
                      {s.name}
                    </a>
                  );
                })}
                {extra > 0 && (
                  <span className="text-[10px] text-ink/50">+{extra} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe-admin/src/components/schedule/month-view.tsx
git commit -m "feat(fe-admin): add MonthView grid with overflow indicator"
```

---

## Task 6 — Schedule toolbar

**Files:**
- Create: `fe-admin/src/components/schedule/schedule-toolbar.tsx`

- [ ] **Step 1: Create toolbar**

Write `fe-admin/src/components/schedule/schedule-toolbar.tsx`:

```tsx
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAnchorLabel, stepAnchor, type CalendarView } from "@/lib/schedule";

export function ScheduleToolbar({
  anchor,
  view,
  onAnchorChange,
  onViewChange,
  onToday,
  onCreateClass,
  onAddWorkshop,
}: {
  anchor: Date;
  view: CalendarView;
  onAnchorChange: (d: Date) => void;
  onViewChange: (v: CalendarView) => void;
  onToday: () => void;
  onCreateClass: () => void;
  onAddWorkshop: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => onAnchorChange(stepAnchor(anchor, view, -1))} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onAnchorChange(stepAnchor(anchor, view, 1))} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onToday}>Today</Button>
        <span className="ml-2 text-lg font-semibold text-ink">{formatAnchorLabel(anchor, view)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-ink/10 bg-white p-0.5">
          {(["week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onViewChange(v)}
              className={
                "rounded-md px-3 py-1 text-sm capitalize " +
                (view === v ? "bg-accent text-white" : "text-ink/70 hover:text-ink")
              }
            >
              {v}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={onAddWorkshop}>Add workshop</Button>
        <Button variant="primary" size="sm" onClick={onCreateClass}>Create class</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors. If `Button` variants `secondary`/`primary`/`ghost`/`icon` don't match your existing API, open `fe-admin/src/components/ui/button.tsx` and align the names — use whatever the Phase 1 file exports. Common Phase 1 exports are `default`, `outline`, `ghost` sizes `sm`/`md`/`icon`. Update the JSX to match.

- [ ] **Step 3: Commit**

```bash
git add fe-admin/src/components/schedule/schedule-toolbar.tsx
git commit -m "feat(fe-admin): add schedule toolbar with view toggle + nav"
```

---

## Task 7 — Cancel session modal

**Files:**
- Create: `fe-admin/src/components/schedule/cancel-session-modal.tsx`

- [ ] **Step 1: Create the modal**

Write `fe-admin/src/components/schedule/cancel-session-modal.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { Session } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cancelSession } from "@/lib/mock-state";

export function CancelSessionModal({
  session,
  open,
  onClose,
  onCancelled,
}: {
  session: Session;
  open: boolean;
  onClose: () => void;
  onCancelled?: (result: { creditsRefunded: number; clientsAffected: string[] }) => void;
}) {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = () => {
    setConfirming(true);
    const result = cancelSession(session.id, reason.trim() || "No reason given");
    setConfirming(false);
    onCancelled?.(result);
    setReason("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Cancel session">
      <div className="space-y-4">
        <p className="text-sm text-ink/70">
          Cancelling <span className="font-semibold">{session.name}</span> on{" "}
          <span className="font-mono">{session.date}</span> at{" "}
          <span className="font-mono">{session.time}</span>. All{" "}
          <span className="font-semibold">{session.bookedCount}</span> booked clients will be
          auto-refunded one credit each.
        </p>
        <div>
          <Label htmlFor="cancel-reason">Reason</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Instructor sick, venue unavailable, etc."
            rows={3}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Keep session</Button>
          <Button onClick={handleConfirm} disabled={confirming} className="bg-error text-white hover:bg-error/90">
            Cancel session
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors. Align `Button`/`Modal`/`Textarea`/`Label` props to your Phase 1 component APIs if names differ.

- [ ] **Step 3: Commit**

```bash
git add fe-admin/src/components/schedule/cancel-session-modal.tsx
git commit -m "feat(fe-admin): add cancel-session modal with auto-refund flow"
```

---

## Task 8 — Create recurring class modal

**Files:**
- Create: `fe-admin/src/components/schedule/create-class-modal.tsx`

- [ ] **Step 1: Create the modal**

Write `fe-admin/src/components/schedule/create-class-modal.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { Instructor, Location, Session } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { generateInstancesFromTemplate } from "@/lib/schedule";
import { createSessionInstances } from "@/lib/mock-state";

const DAYS = [
  { v: 1, l: "Mon" },
  { v: 2, l: "Tue" },
  { v: 3, l: "Wed" },
  { v: 4, l: "Thu" },
  { v: 5, l: "Fri" },
  { v: 6, l: "Sat" },
  { v: 0, l: "Sun" },
] as const;

export function CreateClassModal({
  open,
  onClose,
  instructors,
  locations,
  tenantId,
}: {
  open: boolean;
  onClose: () => void;
  instructors: Instructor[];
  locations: Location[];
  tenantId: string;
}) {
  const [name, setName] = useState("Vinyasa");
  const [category, setCategory] = useState("Vinyasa");
  const [level, setLevel] = useState<Session["level"]>("all");
  const [instructorId, setInstructorId] = useState(instructors[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [dayOfWeek, setDayOfWeek] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(1);
  const [time, setTime] = useState("07:00");
  const [duration, setDuration] = useState(60);
  const [capacity, setCapacity] = useState(15);
  const [weeks, setWeeks] = useState(12);

  const submit = () => {
    const instances = generateInstancesFromTemplate({
      tenantId,
      locationId,
      name,
      category,
      level,
      instructorId,
      dayOfWeek,
      time,
      duration,
      capacity,
      weeks,
    });
    createSessionInstances(instances);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Create recurring class">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="cc-name">Class name</Label>
          <Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cc-cat">Category</Label>
          <Input id="cc-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cc-level">Level</Label>
          <Select
            id="cc-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as Session["level"])}
          >
            <option value="all">All</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="cc-inst">Instructor</Label>
          <Select id="cc-inst" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cc-loc">Location</Label>
          <Select id="cc-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cc-day">Day of week</Label>
          <Select
            id="cc-day"
            value={String(dayOfWeek)}
            onChange={(e) => setDayOfWeek(Number(e.target.value) as 0 | 1 | 2 | 3 | 4 | 5 | 6)}
          >
            {DAYS.map((d) => (
              <option key={d.v} value={d.v}>{d.l}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cc-time">Time</Label>
          <Input id="cc-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cc-dur">Duration (min)</Label>
          <Input id="cc-dur" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="cc-cap">Capacity</Label>
          <Input id="cc-cap" type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="cc-weeks">Generate weeks</Label>
          <Input id="cc-weeks" type="number" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!instructorId || !locationId}>Create {weeks} instances</Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe-admin/src/components/schedule/create-class-modal.tsx
git commit -m "feat(fe-admin): add create-recurring-class modal"
```

---

## Task 9 — Add workshop modal

**Files:**
- Create: `fe-admin/src/components/schedule/add-workshop-modal.tsx`

- [ ] **Step 1: Create the modal**

Write `fe-admin/src/components/schedule/add-workshop-modal.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { Instructor, Location, Session } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createWorkshop } from "@/lib/mock-state";

export function AddWorkshopModal({
  open,
  onClose,
  instructors,
  locations,
  tenantId,
}: {
  open: boolean;
  onClose: () => void;
  instructors: Instructor[];
  locations: Location[];
  tenantId: string;
}) {
  const [name, setName] = useState("Intro to Yin");
  const [instructorId, setInstructorId] = useState(instructors[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(90);
  const [capacity, setCapacity] = useState(20);
  const [price, setPrice] = useState(45);
  const [level, setLevel] = useState<Session["level"]>("all");

  const submit = () => {
    if (!date) return;
    createWorkshop({
      tenantId,
      locationId,
      name,
      instructorId,
      date,
      time,
      duration,
      capacity,
      price,
      level,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add workshop">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="ws-name">Workshop name</Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ws-inst">Instructor</Label>
          <Select id="ws-inst" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ws-loc">Location</Label>
          <Select id="ws-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ws-date">Date</Label>
          <Input id="ws-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ws-time">Time</Label>
          <Input id="ws-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ws-dur">Duration (min)</Label>
          <Input id="ws-dur" type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="ws-cap">Capacity</Label>
          <Input id="ws-cap" type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="ws-price">Price (SGD)</Label>
          <Input id="ws-price" type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="ws-level">Level</Label>
          <Select id="ws-level" value={level} onChange={(e) => setLevel(e.target.value as Session["level"])}>
            <option value="all">All</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Select>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!date}>Add workshop</Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check & Commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/schedule/add-workshop-modal.tsx
git commit -m "feat(fe-admin): add add-workshop modal"
```

---

## Task 10 — Schedule page

**Files:**
- Modify: `fe-admin/src/app/(admin)/schedule/page.tsx`

- [ ] **Step 1: Replace the placeholder**

Overwrite `fe-admin/src/app/(admin)/schedule/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { WeekView } from "@/components/schedule/week-view";
import { MonthView } from "@/components/schedule/month-view";
import { ScheduleToolbar } from "@/components/schedule/schedule-toolbar";
import { CreateClassModal } from "@/components/schedule/create-class-modal";
import { AddWorkshopModal } from "@/components/schedule/add-workshop-modal";
import { useAdminState } from "@/lib/mock-state";
import type { CalendarView } from "@/lib/schedule";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";
import tenantsData from "@/data/tenants.json";
import type { Instructor, Location, Tenant } from "@/types";

const TODAY = new Date("2026-04-20T00:00:00");

export default function SchedulePage() {
  const state = useAdminState();
  const instructors = instructorsData as Instructor[];
  const locations = locationsData as Location[];
  const tenantId = (tenantsData as Tenant[])[0].id;

  const [anchor, setAnchor] = useState<Date>(TODAY);
  const [view, setView] = useState<CalendarView>("week");
  const [createOpen, setCreateOpen] = useState(false);
  const [workshopOpen, setWorkshopOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader title="Schedule" subtitle="Recurring classes, workshops, and one-off sessions." />

      <ScheduleToolbar
        anchor={anchor}
        view={view}
        onAnchorChange={setAnchor}
        onViewChange={setView}
        onToday={() => setAnchor(TODAY)}
        onCreateClass={() => setCreateOpen(true)}
        onAddWorkshop={() => setWorkshopOpen(true)}
      />

      {view === "week" ? (
        <WeekView anchor={anchor} sessions={state.sessions} instructors={instructors} today={TODAY} />
      ) : (
        <MonthView anchor={anchor} sessions={state.sessions} instructors={instructors} today={TODAY} />
      )}

      <CreateClassModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        instructors={instructors}
        locations={locations}
        tenantId={tenantId}
      />
      <AddWorkshopModal
        open={workshopOpen}
        onClose={() => setWorkshopOpen(false)}
        instructors={instructors}
        locations={locations}
        tenantId={tenantId}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe-admin/src/app/\(admin\)/schedule/page.tsx
git commit -m "feat(fe-admin): wire schedule page with week/month views"
```

---

## Task 11 — Roster table

**Files:**
- Create: `fe-admin/src/components/session/roster-table.tsx`

- [ ] **Step 1: Create the roster**

Write `fe-admin/src/components/session/roster-table.tsx`:

```tsx
"use client";

import type { Booking, Client, ClientPackage, Product } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cancelBooking, markNoShow } from "@/lib/mock-state";

function statusColor(s: Booking["checkInStatus"]): string {
  switch (s) {
    case "attended":
      return "bg-sage/10 text-sage";
    case "no-show":
      return "bg-error/10 text-error";
    case "late":
      return "bg-warning/10 text-warning";
    default:
      return "bg-ink/5 text-ink/60";
  }
}

export function RosterTable({
  bookings,
  clients,
  clientPackages,
  products,
}: {
  bookings: Booking[];
  clients: Client[];
  clientPackages: ClientPackage[];
  products: Product[];
}) {
  if (bookings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink/15 bg-paper/40 p-8 text-center text-sm text-ink/60">
        No bookings yet. Use <span className="font-semibold">Manual book</span> to add a client.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-paper/60 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/60">
          <tr>
            <th className="px-4 py-2">Client</th>
            <th className="px-4 py-2">Package used</th>
            <th className="px-4 py-2">Credit cost</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => {
            const client = clients.find((c) => c.id === b.clientId);
            const pkg = clientPackages.find((p) => p.id === b.packageId);
            const product = pkg ? products.find((p) => p.id === pkg.productId) : null;
            return (
              <tr key={b.id} className="border-t border-ink/5">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">
                    {client ? `${client.firstName} ${client.lastName}` : "Unknown"}
                  </div>
                  <div className="text-xs text-ink/50">{client?.email ?? ""}</div>
                </td>
                <td className="px-4 py-3 text-ink/70">{product?.name ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-ink/70">{b.packageId ? "1" : "—"}</td>
                <td className="px-4 py-3">
                  {b.status === "cancelled" ? (
                    <Badge className="bg-ink/5 text-ink/60">cancelled</Badge>
                  ) : (
                    <Badge className={statusColor(b.checkInStatus)}>{b.checkInStatus}</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {b.status === "confirmed" && b.checkInStatus === "pending" && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => markNoShow(b.id)}>
                        No-show
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => cancelBooking(b.id)}>
                        Cancel
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Type-check & Commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/session/roster-table.tsx
git commit -m "feat(fe-admin): add roster table with status + action column"
```

---

## Task 12 — Manual book modal

**Files:**
- Create: `fe-admin/src/components/session/manual-book-modal.tsx`

- [ ] **Step 1: Create modal**

Write `fe-admin/src/components/session/manual-book-modal.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Client } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { manualBook } from "@/lib/mock-state";

export function ManualBookModal({
  sessionId,
  clients,
  open,
  onClose,
}: {
  sessionId: string;
  clients: Client[];
  open: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return clients.slice(0, 20);
    return clients
      .filter(
        (c) =>
          `${c.firstName} ${c.lastName}`.toLowerCase().includes(t) ||
          c.email.toLowerCase().includes(t),
      )
      .slice(0, 20);
  }, [q, clients]);

  const submit = () => {
    if (!selected) return;
    manualBook(sessionId, selected);
    setSelected(null);
    setQ("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Manual book">
      <Label htmlFor="mb-search">Search client</Label>
      <Input
        id="mb-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Name or email"
      />
      <div className="mt-3 max-h-60 overflow-auto rounded-lg border border-ink/10 bg-paper/40">
        {filtered.length === 0 ? (
          <div className="p-4 text-sm text-ink/50">No matches.</div>
        ) : (
          filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={
                "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent/5 " +
                (selected === c.id ? "bg-accent/10" : "")
              }
            >
              <div>
                <div className="font-medium text-ink">
                  {c.firstName} {c.lastName}
                </div>
                <div className="text-xs text-ink/50">{c.email}</div>
              </div>
              {selected === c.id && <span className="text-accent text-xs">Selected</span>}
            </button>
          ))
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!selected}>Book</Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check & Commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/session/manual-book-modal.tsx
git commit -m "feat(fe-admin): add manual-book modal with client search"
```

---

## Task 13 — Session detail page

**Files:**
- Create: `fe-admin/src/app/(admin)/schedule/[id]/page.tsx`

- [ ] **Step 1: Create the detail page**

Write `fe-admin/src/app/(admin)/schedule/[id]/page.tsx`:

```tsx
"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RosterTable } from "@/components/session/roster-table";
import { ManualBookModal } from "@/components/session/manual-book-modal";
import { CancelSessionModal } from "@/components/schedule/cancel-session-modal";
import { useAdminState, swapSessionInstructor } from "@/lib/mock-state";
import clientsData from "@/data/clients.json";
import instructorsData from "@/data/instructors.json";
import locationsData from "@/data/locations.json";
import clientPackagesData from "@/data/client-packages.json";
import productsData from "@/data/products.json";
import type { Client, ClientPackage, Instructor, Location, Product } from "@/types";

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const state = useAdminState();
  const session = state.sessions.find((s) => s.id === id);
  const [bookOpen, setBookOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (!session) return notFound();

  const clients = clientsData as Client[];
  const instructors = instructorsData as Instructor[];
  const locations = locationsData as Location[];
  const clientPackages = clientPackagesData as ClientPackage[];
  const products = productsData as Product[];

  const roster = state.bookings.filter((b) => b.sessionId === session.id);
  const instructor = instructors.find((i) => i.id === session.instructorId);
  const location = locations.find((l) => l.id === session.locationId);

  return (
    <div className="space-y-6">
      <Link href="/schedule" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to schedule
      </Link>

      <PageHeader
        title={session.name}
        subtitle={`${session.date} · ${session.time} · ${session.duration} min · ${location?.shortName ?? "—"}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setBookOpen(true)} disabled={session.status === "cancelled"}>
              Manual book
            </Button>
            <Button onClick={() => setCancelOpen(true)} disabled={session.status === "cancelled"} className="bg-error text-white hover:bg-error/90">
              Cancel session
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink/50">Status</div>
          <div className="mt-1">
            <Badge
              className={
                session.status === "cancelled"
                  ? "bg-error/10 text-error"
                  : session.status === "completed"
                  ? "bg-ink/10 text-ink/60"
                  : "bg-sage/10 text-sage"
              }
            >
              {session.status}
            </Badge>
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink/50">Attendance</div>
          <div className="mt-1 font-mono text-lg text-ink">
            {session.bookedCount}/{session.capacity}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink/50">Instructor</div>
          <div className="mt-1 text-sm font-medium text-ink">{instructor?.name ?? "—"}</div>
          <select
            className="mt-2 w-full rounded-md border border-ink/10 bg-white px-2 py-1 text-xs"
            value={session.instructorId}
            onChange={(e) => swapSessionInstructor(session.id, e.target.value)}
            disabled={session.status === "cancelled"}
          >
            {instructors.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink/50">Waitlist</div>
          <div className="mt-1 font-mono text-lg text-ink">{session.waitlistCount}</div>
        </Card>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">Roster</h3>
        <RosterTable
          bookings={roster}
          clients={clients}
          clientPackages={clientPackages}
          products={products}
        />
      </div>

      <ManualBookModal
        sessionId={session.id}
        clients={clients}
        open={bookOpen}
        onClose={() => setBookOpen(false)}
      />
      <CancelSessionModal
        session={session}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors. If `params` is typed as a plain object in your Next 16 setup (rather than a Promise), remove `use()` and destructure directly. Check `fe/src/app/(client)/private-sessions/[id]/page.tsx` for the pattern your project uses.

- [ ] **Step 3: Commit**

```bash
git add fe-admin/src/app/\(admin\)/schedule/\[id\]/page.tsx
git commit -m "feat(fe-admin): add session detail page with roster + actions"
```

---

## Task 14 — Check-in scanner simulator

**Files:**
- Create: `fe-admin/src/components/check-in/scanner-sim.tsx`

- [ ] **Step 1: Create scanner**

Write `fe-admin/src/components/check-in/scanner-sim.tsx`:

```tsx
"use client";

import { useState } from "react";
import { QrCode } from "lucide-react";
import type { Booking } from "@/types";
import { Button } from "@/components/ui/button";

export function ScannerSim({
  validBookings,
  onScan,
}: {
  validBookings: Booking[];
  onScan: (bookingId: string) => void;
}) {
  const [cursor, setCursor] = useState(0);

  const simulate = () => {
    if (validBookings.length === 0) return;
    const b = validBookings[cursor % validBookings.length];
    setCursor((c) => c + 1);
    onScan(b.id);
  };

  return (
    <div className="rounded-2xl border border-ink/10 bg-paper/40 p-6">
      <div className="mb-4 flex aspect-video items-center justify-center rounded-xl border-2 border-dashed border-ink/15 bg-white">
        <div className="text-center text-ink/40">
          <QrCode className="mx-auto h-14 w-14" />
          <div className="mt-2 text-xs uppercase tracking-wide">Camera preview (mock)</div>
        </div>
      </div>
      <Button onClick={simulate} disabled={validBookings.length === 0} className="w-full">
        Simulate scan{validBookings.length > 0 ? ` (${validBookings.length} valid)` : ""}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check & Commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/check-in/scanner-sim.tsx
git commit -m "feat(fe-admin): add check-in scanner simulator"
```

---

## Task 15 — Manual booking-id input + recent check-ins + page wire-up

**Files:**
- Create: `fe-admin/src/components/check-in/manual-input.tsx`
- Create: `fe-admin/src/components/check-in/recent-check-ins.tsx`
- Modify: `fe-admin/src/app/(admin)/check-in/page.tsx`

- [ ] **Step 1: Manual input**

Write `fe-admin/src/components/check-in/manual-input.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ManualInput({ onSubmit }: { onSubmit: (id: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-center gap-2">
      <Input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Booking ID (e.g. bk_abc123)"
        className="flex-1"
      />
      <Button
        onClick={() => {
          if (!val.trim()) return;
          onSubmit(val.trim());
          setVal("");
        }}
      >
        Check in
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Recent list**

Write `fe-admin/src/components/check-in/recent-check-ins.tsx`:

```tsx
import type { Booking, Client, Session } from "@/types";

export function RecentCheckIns({
  bookings,
  clients,
  sessions,
}: {
  bookings: Booking[];
  clients: Client[];
  sessions: Session[];
}) {
  const recent = [...bookings]
    .filter((b) => b.checkInStatus === "attended")
    .slice(-20)
    .reverse();

  if (recent.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink/15 p-6 text-center text-sm text-ink/50">
        No check-ins yet.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-ink/5 rounded-xl border border-ink/10 bg-white">
      {recent.map((b) => {
        const c = clients.find((x) => x.id === b.clientId);
        const s = sessions.find((x) => x.id === b.sessionId);
        return (
          <li key={b.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="font-medium text-ink">
              {c ? `${c.firstName} ${c.lastName}` : "Unknown"}
            </span>
            <span className="text-ink/60">{s?.name ?? "—"}</span>
            <span className="font-mono text-xs text-ink/50">{s?.time ?? ""}</span>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: Page wire-up**

Overwrite `fe-admin/src/app/(admin)/check-in/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { ScannerSim } from "@/components/check-in/scanner-sim";
import { ManualInput } from "@/components/check-in/manual-input";
import { RecentCheckIns } from "@/components/check-in/recent-check-ins";
import { Card } from "@/components/ui/card";
import { useAdminState, checkInByBookingId } from "@/lib/mock-state";
import clientsData from "@/data/clients.json";
import type { Client } from "@/types";

const TODAY = "2026-04-20";

export default function CheckInPage() {
  const state = useAdminState();
  const clients = clientsData as Client[];
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const todaySessionIds = new Set(state.sessions.filter((s) => s.date === TODAY).map((s) => s.id));
  const validBookings = state.bookings.filter(
    (b) => todaySessionIds.has(b.sessionId) && b.status === "confirmed" && b.checkInStatus === "pending",
  );

  const handleCheckIn = (id: string) => {
    const result = checkInByBookingId(id);
    if (!result) {
      setFlash({ kind: "err", msg: `Booking ${id} not found or not checkable.` });
    } else {
      const client = clients.find((c) => c.id === result.booking.clientId);
      setFlash({
        kind: "ok",
        msg: `${client ? client.firstName + " " + client.lastName : "Client"} checked in for ${result.session.name}.`,
      });
    }
    setTimeout(() => setFlash(null), 4000);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Check-in" subtitle="Scan QR or enter booking ID to check clients in." />

      {flash && (
        <div
          className={
            "rounded-xl px-4 py-3 text-sm " +
            (flash.kind === "ok" ? "bg-sage/10 text-sage" : "bg-error/10 text-error")
          }
        >
          {flash.msg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ScannerSim validBookings={validBookings} onScan={handleCheckIn} />
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Manual entry
          </h3>
          <ManualInput onSubmit={handleCheckIn} />
          <div className="mt-4 text-[11px] text-ink/50">
            Valid today: {validBookings.length} bookings pending check-in.
          </div>
        </Card>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
          Recent check-ins
        </h3>
        <RecentCheckIns bookings={state.bookings} clients={clients} sessions={state.sessions} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add fe-admin/src/components/check-in/ fe-admin/src/app/\(admin\)/check-in/page.tsx
git commit -m "feat(fe-admin): wire check-in page with scanner sim + manual + recent"
```

---

## Task 16 — Private request inbox components

**Files:**
- Create: `fe-admin/src/components/requests/request-summary.tsx`
- Create: `fe-admin/src/components/requests/request-inbox.tsx`

- [ ] **Step 1: Row summary**

Write `fe-admin/src/components/requests/request-summary.tsx`:

```tsx
import Link from "next/link";
import type { Client, Instructor, PrivateRequest } from "@/types";
import { SlaChip } from "@/components/ui/sla-chip";

export function RequestSummary({
  request,
  clients,
  instructors,
  now,
}: {
  request: PrivateRequest;
  clients: Client[];
  instructors: Instructor[];
  now: Date;
}) {
  const client = clients.find((c) => c.id === request.clientId);
  const inst = instructors.find((i) => i.id === request.preferredInstructorId ?? "");
  return (
    <Link
      href={`/requests/${request.id}`}
      className="flex items-center justify-between rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm transition-colors hover:border-accent/30"
    >
      <div>
        <div className="font-medium text-ink">
          {client ? `${client.firstName} ${client.lastName}` : "Unknown client"}
        </div>
        <div className="text-xs text-ink/50">
          Preferred: {inst?.name ?? "Any"} · {request.proposedSlots.length} slot(s) proposed
        </div>
      </div>
      <div className="flex items-center gap-3">
        {request.status === "pending" && <SlaChip deadlineAt={request.deadlineAt} now={now} />}
        {request.status !== "pending" && (
          <span
            className={
              "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide " +
              (request.status === "approved"
                ? "bg-sage/10 text-sage"
                : "bg-error/10 text-error")
            }
          >
            {request.status}
          </span>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Inbox**

Write `fe-admin/src/components/requests/request-inbox.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import type { Client, Instructor, PrivateRequest } from "@/types";
import { RequestSummary } from "./request-summary";
import { slaTier } from "@/lib/sla";

export function RequestInbox({
  requests,
  clients,
  instructors,
  now,
}: {
  requests: PrivateRequest[];
  clients: Client[];
  instructors: Instructor[];
  now: Date;
}) {
  const { pending, approved, declined } = useMemo(() => {
    const sortPending = (a: PrivateRequest, b: PrivateRequest) =>
      new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime();
    const pending = requests.filter((r) => r.status === "pending").sort(sortPending);
    const approved = requests.filter((r) => r.status === "approved");
    const declined = requests.filter((r) => r.status === "declined");
    return { pending, approved, declined };
  }, [requests]);

  const tierCounts = pending.reduce(
    (acc, r) => {
      const t = slaTier(r.deadlineAt, now);
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/70">
            Pending · {pending.length}
          </h3>
          <div className="flex gap-3 text-[11px] text-ink/50">
            {tierCounts.overdue ? <span>overdue: {tierCounts.overdue}</span> : null}
            {tierCounts.red ? <span>&lt;2h: {tierCounts.red}</span> : null}
            {tierCounts.amber ? <span>2–6h: {tierCounts.amber}</span> : null}
            {tierCounts.green ? <span>&gt;6h: {tierCounts.green}</span> : null}
          </div>
        </div>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink/15 p-6 text-center text-sm text-ink/50">
            Inbox zero.
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((r) => (
              <RequestSummary key={r.id} request={r} clients={clients} instructors={instructors} now={now} />
            ))}
          </div>
        )}
      </section>

      {approved.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Approved · {approved.length}
          </h3>
          <div className="space-y-2">
            {approved.map((r) => (
              <RequestSummary key={r.id} request={r} clients={clients} instructors={instructors} now={now} />
            ))}
          </div>
        </section>
      )}
      {declined.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
            Declined · {declined.length}
          </h3>
          <div className="space-y-2">
            {declined.map((r) => (
              <RequestSummary key={r.id} request={r} clients={clients} instructors={instructors} now={now} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check & Commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/requests/
git commit -m "feat(fe-admin): add private-request inbox with SLA grouping"
```

---

## Task 17 — Requests list page

**Files:**
- Modify: `fe-admin/src/app/(admin)/requests/page.tsx`

- [ ] **Step 1: Wire the page**

Overwrite `fe-admin/src/app/(admin)/requests/page.tsx`:

```tsx
"use client";

import { PageHeader } from "@/components/ui/page-header";
import { RequestInbox } from "@/components/requests/request-inbox";
import { useAdminState } from "@/lib/mock-state";
import clientsData from "@/data/clients.json";
import instructorsData from "@/data/instructors.json";
import type { Client, Instructor } from "@/types";

const NOW = new Date("2026-04-20T10:00:00");

export default function RequestsPage() {
  const state = useAdminState();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Private session requests"
        subtitle="Sorted by SLA deadline. Respond within 12 hours of submission."
      />
      <RequestInbox
        requests={state.privateRequests}
        clients={clientsData as Client[]}
        instructors={instructorsData as Instructor[]}
        now={NOW}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check & Commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/app/\(admin\)/requests/page.tsx
git commit -m "feat(fe-admin): wire requests list page"
```

---

## Task 18 — Accept request modal

**Files:**
- Create: `fe-admin/src/components/requests/accept-modal.tsx`

- [ ] **Step 1: Create modal**

Write `fe-admin/src/components/requests/accept-modal.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { PrivateRequest } from "@/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { approveRequest } from "@/lib/mock-state";

export function AcceptRequestModal({
  request,
  open,
  onClose,
}: {
  request: PrivateRequest;
  open: boolean;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const submit = () => {
    const slot = request.proposedSlots[idx];
    if (!slot) return;
    approveRequest(request.id, { date: slot.date, time: slot.time });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Accept request">
      <p className="mb-3 text-sm text-ink/70">Pick a time from the client&apos;s proposed slots.</p>
      <div className="space-y-2">
        {request.proposedSlots.map((s, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={
              "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm " +
              (idx === i ? "border-accent bg-accent/10" : "border-ink/10 bg-white hover:bg-paper/40")
            }
          >
            <span className="font-mono text-ink">
              {s.date} · {s.time}
            </span>
            {idx === i && <span className="text-xs text-accent">Selected</span>}
          </button>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={request.proposedSlots.length === 0}>Approve</Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check & Commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/requests/accept-modal.tsx
git commit -m "feat(fe-admin): add accept-request modal"
```

---

## Task 19 — Decline request modal + request detail page

**Files:**
- Create: `fe-admin/src/components/requests/decline-modal.tsx`
- Create: `fe-admin/src/app/(admin)/requests/[id]/page.tsx`

- [ ] **Step 1: Decline modal**

Write `fe-admin/src/components/requests/decline-modal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { declineRequest } from "@/lib/mock-state";

export function DeclineRequestModal({
  requestId,
  open,
  onClose,
}: {
  requestId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const submit = () => {
    if (!reason.trim()) return;
    declineRequest(requestId, reason.trim());
    setReason("");
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Decline request">
      <Label htmlFor="dec-reason">Reason (shown to client)</Label>
      <Textarea
        id="dec-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="No instructor availability this week, etc."
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          onClick={submit}
          disabled={!reason.trim()}
          className="bg-error text-white hover:bg-error/90"
        >
          Decline
        </Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Request detail page**

Write `fe-admin/src/app/(admin)/requests/[id]/page.tsx`:

```tsx
"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SlaChip } from "@/components/ui/sla-chip";
import { AcceptRequestModal } from "@/components/requests/accept-modal";
import { DeclineRequestModal } from "@/components/requests/decline-modal";
import { useAdminState } from "@/lib/mock-state";
import clientsData from "@/data/clients.json";
import instructorsData from "@/data/instructors.json";
import type { Client, Instructor } from "@/types";

const NOW = new Date("2026-04-20T10:00:00");

export default function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const state = useAdminState();
  const request = state.privateRequests.find((r) => r.id === id);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);

  if (!request) return notFound();

  const clients = clientsData as Client[];
  const instructors = instructorsData as Instructor[];
  const client = clients.find((c) => c.id === request.clientId);
  const inst = instructors.find((i) => i.id === request.preferredInstructorId ?? "");
  const resolver = request.resolution
    ? state.adminId === request.resolution.resolvedBy
      ? "you"
      : request.resolution.resolvedBy
    : null;

  return (
    <div className="space-y-6">
      <Link href="/requests" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back to inbox
      </Link>
      <PageHeader
        title={client ? `${client.firstName} ${client.lastName}` : "Request"}
        subtitle={`Submitted ${request.submittedAt}`}
        actions={
          request.status === "pending" ? (
            <div className="flex items-center gap-2">
              <SlaChip deadlineAt={request.deadlineAt} now={NOW} />
              <Button variant="ghost" onClick={() => setDeclineOpen(true)} className="text-error">
                Decline
              </Button>
              <Button onClick={() => setAcceptOpen(true)}>Approve</Button>
            </div>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink/50">Preferred instructor</div>
          <div className="mt-1 font-medium text-ink">{inst?.name ?? "Any"}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-ink/50">Status</div>
          <div className="mt-1 font-medium capitalize text-ink">{request.status}</div>
          {request.resolution && (
            <div className="mt-1 text-xs text-ink/50">
              Resolved by {resolver} at {request.resolution.resolvedAt}
              {request.resolution.scheduledDate &&
                ` · scheduled ${request.resolution.scheduledDate} ${request.resolution.scheduledTime}`}
              {request.resolution.declineReason &&
                ` · reason: ${request.resolution.declineReason}`}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">
          Proposed slots
        </h3>
        <ul className="space-y-1">
          {request.proposedSlots.map((s, i) => (
            <li key={i} className="font-mono text-sm text-ink/80">
              {s.date} · {s.time}
            </li>
          ))}
        </ul>
      </Card>

      {request.notes && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/70">Notes</h3>
          <p className="text-sm text-ink/80">{request.notes}</p>
        </Card>
      )}

      <AcceptRequestModal request={request} open={acceptOpen} onClose={() => setAcceptOpen(false)} />
      <DeclineRequestModal requestId={request.id} open={declineOpen} onClose={() => setDeclineOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 3: Type-check & Commit**

```bash
cd fe-admin && npx tsc --noEmit
git add fe-admin/src/components/requests/decline-modal.tsx fe-admin/src/app/\(admin\)/requests/\[id\]/page.tsx
git commit -m "feat(fe-admin): add request detail page with approve/decline flow"
```

---

## Task 20 — Dashboard live wiring + build & smoke test

**Files:**
- Modify: `fe-admin/src/app/(admin)/page.tsx`

- [ ] **Step 1: Swap stub counts for live state**

Open `fe-admin/src/app/(admin)/page.tsx` and replace it with (keeping whatever existing `PageHeader`, `StatCard`, layout components are imported from Phase 1 — if any names differ, use what the file currently imports):

```tsx
"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { SlaChip } from "@/components/ui/sla-chip";
import { Button } from "@/components/ui/button";
import { useAdminState } from "@/lib/mock-state";
import clientsData from "@/data/clients.json";
import instructorsData from "@/data/instructors.json";
import { slaTier } from "@/lib/sla";
import type { Client, Instructor } from "@/types";

const TODAY = "2026-04-20";
const NOW = new Date("2026-04-20T10:00:00");

export default function DashboardPage() {
  const state = useAdminState();
  const clients = clientsData as Client[];
  const instructors = instructorsData as Instructor[];

  const todaySessions = state.sessions
    .filter((s) => s.date === TODAY && s.status !== "cancelled")
    .sort((a, b) => a.time.localeCompare(b.time));
  const totalCapacity = todaySessions.reduce((acc, s) => acc + s.capacity, 0);
  const totalBooked = todaySessions.reduce((acc, s) => acc + s.bookedCount, 0);

  const pending = state.privateRequests.filter((r) => r.status === "pending");
  const under2h = pending.filter((r) => {
    const t = slaTier(r.deadlineAt, NOW);
    return t === "red" || t === "overdue";
  });

  const paidToday = state.invoices.filter(
    (i) => i.status === "paid" && i.issuedAt.startsWith(TODAY),
  );
  const revenueToday = paidToday.reduce((acc, i) => acc + i.total, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Today" subtitle={TODAY} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Classes today" value={String(todaySessions.length)} />
        <StatCard label="Attendance" value={`${totalBooked}/${totalCapacity}`} />
        <StatCard
          label="Pending requests"
          value={String(pending.length)}
          hint={under2h.length ? `${under2h.length} under 2h` : undefined}
        />
        <StatCard label="Revenue today" value={`S$${revenueToday.toFixed(0)}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/70">
              Today&apos;s classes
            </h3>
            <Link href="/schedule" className="text-xs text-accent hover:underline">
              Schedule →
            </Link>
          </div>
          {todaySessions.length === 0 ? (
            <div className="text-sm text-ink/50">No classes scheduled.</div>
          ) : (
            <ul className="divide-y divide-ink/5">
              {todaySessions.map((s) => {
                const inst = instructors.find((i) => i.id === s.instructorId);
                return (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/schedule/${s.id}`} className="font-medium text-ink hover:text-accent">
                      {s.name}
                    </Link>
                    <span className="text-ink/60">{inst?.name ?? "—"}</span>
                    <span className="font-mono text-xs text-ink/50">
                      {s.time} · {s.bookedCount}/{s.capacity}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4">
            <Link href="/check-in">
              <Button variant="ghost" size="sm">Open check-in</Button>
            </Link>
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/70">
              Pending requests
            </h3>
            <Link href="/requests" className="text-xs text-accent hover:underline">
              Inbox →
            </Link>
          </div>
          {pending.length === 0 ? (
            <div className="text-sm text-ink/50">Inbox zero.</div>
          ) : (
            <ul className="divide-y divide-ink/5">
              {pending.slice(0, 5).map((r) => {
                const c = clients.find((x) => x.id === r.clientId);
                return (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/requests/${r.id}`} className="font-medium text-ink hover:text-accent">
                      {c ? `${c.firstName} ${c.lastName}` : "Unknown"}
                    </Link>
                    <SlaChip deadlineAt={r.deadlineAt} now={NOW} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
```

If `StatCard` doesn't accept an `hint` prop, drop that line or add the prop. If the Phase 1 file currently has different prop names, keep them and adapt only the body.

- [ ] **Step 2: Type-check**

```bash
cd fe-admin && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Build**

```bash
cd fe-admin && npm run build
```
Expected: success. All new routes (`/schedule/[id]`, `/requests/[id]`) listed under "Route (app)". No warnings beyond the Next 16 workspace-lockfile warning from Phase 1.

- [ ] **Step 4: Smoke test**

Start the dev server:
```bash
cd fe-admin && npm run dev
```

In a browser, sign in with a seeded admin email and step through:
1. `/` → four StatCards show non-zero values; today's classes list populated.
2. Click a class → `/schedule/[id]` loads with roster.
3. Click **Manual book** → search for a client → book; booking appears in roster.
4. Click **Cancel session** → provide reason → confirm; session shows cancelled.
5. `/check-in` → click **Simulate scan** → see green flash; row appears in Recent.
6. `/requests` → SLA chips render with correct colours; click a pending request.
7. On request detail, click **Approve**, pick a slot, confirm; status flips.
8. Back on `/requests`, same request shows under "Approved".
9. Visit `/schedule` in **Month** view → classes render across the grid.

Stop the dev server with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add fe-admin/src/app/\(admin\)/page.tsx
git commit -m "feat(fe-admin): wire dashboard with live counts + links"
```

---

## Phase 2 Acceptance Checklist

- [ ] `npm run build` succeeds with no new warnings.
- [ ] Schedule page renders week + month views; both respect today highlight.
- [ ] "Create class" produces 12 weekly instances across the grid.
- [ ] "Add workshop" produces one non-recurring session with workshop styling.
- [ ] "Cancel session" marks the session cancelled, zeros its bookedCount, and writes one `credit-adjustment` row per previously confirmed booking.
- [ ] Session detail shows roster, allows manual book / cancel booking / no-show / instructor swap.
- [ ] Check-in **Simulate scan** cycles through today's pending bookings and flips their status to `attended`.
- [ ] Manual booking-id check-in works for any valid booking id; bogus ids show the error flash.
- [ ] Requests inbox groups by status, sorts pending by SLA, and renders chips with correct tier colours.
- [ ] Approve picks a slot and stores it in `resolution.scheduledDate/Time`; decline requires a reason.
- [ ] Dashboard counts reflect live state — cancelling a class reduces "Classes today"; approving a request reduces "Pending requests".
- [ ] Reloading the page preserves mutations (localStorage key `admin-mock-state:v1`).

---

## Phase 3 Preview (not in this plan)

Clients & Catalog: `/clients` list + `/clients/[id]` profile with timeline, credit adjustment modal, waiver status; `/catalog/packages` + `/catalog/workshops` + `/catalog/classes` CRUD; `/instructors` + `/instructors/[id]`; `/locations`.

## Phase 4 Preview (not in this plan)

Finance & Governance: `/invoices` + `/invoices/[id]` with refund modal; `/reports` (attendance heatmap, revenue, sell-through, no-show); `/notifications` template editor; `/waivers` tracking + version bump; `/referrals` referrer + referee lists; `/settings` (studio profile, policy, admin users CRUD).

---

## Self-Review

**Spec coverage (PRD §§ 6.3 – 6.6):**
- §6.3 Schedule — ✅ Task 3–10 (week/month views, create class, add workshop, cancel session, instructor swap).
- §6.4 Session Detail — ✅ Task 11–13 (roster, manual book, cancel, no-show).
- §6.5 Check-in — ✅ Task 14–15 (scanner sim, manual input, recent list).
- §6.6 Private Requests — ✅ Task 16–19 (inbox, SLA chips, accept, decline).
- §7.1 Audit trail for cancellations — ✅ Task 2 (`cancelSession` writes both `credit-adjustments` and `session-cancellations`).
- §7.2 SLA timers — ✅ reuses Phase 1 `SlaChip` / `lib/sla.ts`.
- §7.3 Mock persistence — ✅ all mutators go through existing `setState` → localStorage path.

**Placeholder scan:** no "TBD" / "implement later" / vague-handler steps. Every code step has complete source.

**Type consistency:** `cancelSession`, `createSessionInstances`, `createWorkshop`, `swapSessionInstructor`, `manualBook`, `cancelBooking`, `markNoShow`, `checkInByBookingId`, `approveRequest`, `declineRequest` — defined once in Task 2 and referenced by the same names in Tasks 7/8/9/10/11/12/13/15/18/19. Types match `fe-admin/src/types/index.ts` exactly (`Session`, `Booking`, `PrivateRequest`, `CreditAdjustment`, `SessionCancellation`).
