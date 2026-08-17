# Class Booking Lifecycle — Completion Spec

Status: **implemented (2026-06-07)** — steps 1–6 + 8 of the build order landed on
`feat/pt-typed-credits-package-active`. Scope: **classes only** (credit + unlimited). PT and
workshops are referenced where they share policy but are not the subject here.

## Implementation status

| Item | Status | File |
|---|---|---|
| Cancellation policy engine (G5) | ✅ done | `services/policy/evaluate-cancellation.ts` |
| Client self-cancel + admin force-cancel (G2, G3) | ✅ done | `services/bookings/cancel.ts`, routes `client/bookings.ts` `DELETE /:id`, `admin/bookings.ts` `/:id/cancel` |
| No-show (G9) | ✅ done | `services/bookings/no-show.ts`, `admin/bookings.ts` `/:id/no-show` |
| Admin cancel-class bulk refund (G6, G10) | ✅ done | `services/bookings/cancel-class.ts`, `admin/schedule.ts` `/classes/:id/cancel` |
| Attendee roster (G4) | ✅ done | `services/schedule/detail.ts` (`attendees`), exposed in `admin/schedule.ts` |
| Booking-time expiry validation (G1) | ✅ done | `services/bookings/book.ts` |
| Credit-movement ledger on refund (G8) | ✅ done | writes `manual_adjustments` rows in cancel paths |
| Inbox notifications (§13) | ✅ done | `services/inbox.ts` + inline `inbox_items` writes in cancel flows |
| Waitlist seat-free hook / promotion (G7) | ⛔ deferred | per `backend-architecture.md §8` |
| Admin bookings list/detail (G9 partial) | ⛔ still 501 | `admin/bookings.ts` `GET /`, `GET /:id` |

No DB migration was required — `cancellations`, `manual_adjustments`, `inbox_items`,
`classes.cancelled_*`, and the `refund_outcome`/`checkin_state` enum values already existed.

Locked decisions (see §5): **D1** refund returns to the original package (safe given G1 —
a client always cancels before class start ≤ package expiry); **D2** all client
cancellations count toward the shared cap uniformly (incl. unlimited); **D3** cancel is
always allowed and forfeits past the window.

Verified with `npx tsc --noEmit` in `be/` (no test infra per project convention).

Sources of truth: `be-client.md §4`, `be-portal.md`, `admin-restructure.md §4/§10/§13`,
`backend-architecture.md §5/§8`, `spec-pre-launch-batch.md §1–§3` (Location filter,
Activation, `use_credits`). This doc records the current implementation, the gaps,
and the build order to complete the lifecycle.

---

## 1. Lifecycle map (current state)

| Stage | Status | Location |
|---|---|---|
| Admin creates class | ✅ done | `routes/portal/admin/schedule.ts` → `services/schedule/classes.ts:createClass` |
| Client books class | ✅ done | `routes/client/bookings.ts` → `services/bookings/book.ts` |
| Admin views class detail | 🟡 count only, no roster | `services/schedule/detail.ts:getClassDetail` |
| Client cancels booking | ❌ 501 stub | `routes/client/bookings.ts:24`, `services/bookings/cancel.ts` |
| Cancellation policy eval | ❌ mock (always forfeit) | `services/policy/evaluate-cancellation.ts` |
| Admin cancels class (bulk refund) | ❌ 501 stub | `routes/portal/admin/schedule.ts` `/classes/:id/cancel` |
| Admin bookings list / force-cancel / no-show | ❌ all 501 | `routes/portal/admin/bookings.ts` |
| Refund outcome decision | ✅ pure fn done | `services/bookings/refund-outcome.ts:decideOutcome` |

### What already works

`book.ts` is correct and race-safe:
1. Locks the `classes` row `FOR UPDATE`; rejects non-active, already-started.
2. Rejects double-book (one `confirmed` booking per client per class).
3. Capacity check against `capacity_online` only.
4. Server-side package selection, via `services/packages/selection` (see §1a below):
   candidate Unlimited Plans are filtered to the class's Location, Activated preferred over
   Dormant, soonest-expiring first → debit 0; no covering plan and no `use_credits: true` →
   `409 location_not_covered`; else **soonest-expiring `credit_bundle`/`trial` with
   `remaining >= credit_cost` → debit `credit_cost`**; else `409 insufficient_credits`.
5. If the chosen package is a Dormant Unlimited Plan, stamps Activation on it (§1a).
6. Inserts `bookings` row with `state='confirmed'`, `creditsOrSessionsUsed`, `qrToken`, `code`.

Schema is already refund-ready: `bookings.clientPackageId` (which package paid),
`bookings.creditsOrSessionsUsed` (how much to return), `cancellations`
(`source`, `wasWithinWindow`, `wasWithinCap`, `refundFired`), and singleton `global_policy`
(`classWindowHours=2`, `ptWindowHours=24`, `cancelCapCount=3`, `cancelCapCycleDays=30`).

### 1a. Home Location, Activation and the `use_credits` escape (landed later, `spec-pre-launch-batch.md` §1–§3)

Package selection was pulled out of `book.ts` into a pure module,
`services/packages/selection`. `book.ts` loads and locks rows and calls in; the module
returns which package pays and why, or a refusal.

- **Location filter.** A candidate Unlimited Plan is one whose `location_id` equals the
  class's Location **or** whose `cross_location_paid_sgd` is non-null (it Covers both
  Locations via a Cross-Location Add-On). No covering Unlimited Plan → refuse
  `409 location_not_covered` — **not** a silent fall-through to credits.
- **Order.** Candidates sort Activated first (soonest-expiring), Dormant last. A Dormant
  candidate must also pass a *prospective* test — `now + duration_months >= class.startsAt`
  — or it is skipped; otherwise a member could book far enough out to activate a plan that
  the same booking would instantly invalidate.
- **The `use_credits` escape.** Selection only falls through to the credit/trial branch
  when the caller passes `use_credits: true`. This is the one place a client input
  overrides server-only package selection, so a member holding both a plan and credits can
  spend a credit on a class outside their plan's coverage instead of being blocked.
- **Activation.** The first confirmed booking a Dormant Unlimited Plan pays for stamps its
  `expires_at` — `now + duration_months` from the booking moment, not the class date —
  inside the same transaction that already locks the package rows. Activation is one-way;
  nothing un-stamps it automatically, only staff by hand. A member who pays with
  `use_credits: true` leaves their Dormant plan Dormant.
- **Coverage is tested once, at booking, and never re-tested.** A confirmed booking was
  paid for by the plan that covered it at the time; renewing without an Add-On does not
  retroactively strand an existing booking at the other Location.

---

## 2. Gaps

### Critical

- **G1 — Expiry checked at booking time, not class time.** `book.ts:90` filters packages on
  `expiresAt > now`, but never checks `class.startsAt <= package.expiresAt`. A client can
  spend a credit (or use unlimited) on a class scheduled *after* the package expires.
  Affects both credit and unlimited.

- **G2 — Refund-to-expired-package.** On cancel, credit returns to the original
  `clientPackageId`, which may have expired/deactivated since booking, leaving the refunded
  credit dead. Spec promises "full refund or nothing", so the credit must remain usable.

- **G3 — Unlimited cancel mislabels outcome.** `decideOutcome` returns `credit_returned`
  for any class cancel, but an unlimited booking had `creditsUsed=0`. Cancel must branch on
  `creditsOrSessionsUsed === 0` → seat-release only, `refundOutcome='n_a'`, no balance write.

- **G4 — No attendee roster.** `getClassDetail` returns `bookedCount` only; admin cannot
  see *who* booked. `admin-restructure.md §10` requires an attendees list.

- **G5 — `evaluate-cancellation.ts` is a hardcoded stub.** Always `forfeit`. Real policy
  (window + shared class/PT cap) is required before any refund path is meaningful.

- **G6 — Admin cancel-class does nothing.** No bulk refund, no lifecycle flip, no notification.

### Secondary

- **G7 — Waitlist/buffer unused.** `capacity_waitlist`/`capacity_buffer` are stored but
  booking only checks `capacity_online`; no waitlist booking, no promotion on seat-free.
  (Promotion is deferred per `backend-architecture.md §8`; the seat-free hook should still exist.)
- **G8 — No audit/credit-ledger writes.** `auditLog`/`manualAdjustments` exist but booking and
  cancel write neither; credit movements are only reconstructable from booking rows.
- **G9 — No-show flow missing.** Forfeit credit + mark check-in + exclude from cap; all 501.
- **G10 — Admin-cancel vs in-flight booking race.** Admin cancel must lock the class row or a
  booking can land mid-cancel.
- **G11 — Unlimited late-cancel governance undefined.** No refund exists to gate, so an
  unlimited client's repeated late cancels are ungoverned. Product decision needed.

---

## 3. Target behaviour

### 3.1 Client cancels a class booking — `cancelBooking`

`DELETE /client/bookings/:id`. In one transaction:

1. Load booking; assert ownership (`clientId`), `kind='class'`, `state='confirmed'`.
   404 if missing, 409 if already cancelled.
2. Load the class; capture `startsAt`.
3. `evaluation = evaluateCancellation({ clientId, kind:'class', sessionStartsAt: startsAt, now })`.
4. `outcome = decideOutcome('class', 'client', evaluation)`.
5. **Refund branch:**
   - If `booking.creditsOrSessionsUsed === 0` (unlimited) → no balance write,
     `refundOutcome='n_a'` (G3).
   - Else if `evaluation.refund === 'full'` → return `creditsOrSessionsUsed` to the package.
     If the original package is expired/inactive (G2), apply the resolved policy
     (see Open Decisions) rather than writing dead credit.
   - Else → forfeit, no balance change.
6. Insert `cancellations` row (`source='client'`, `wasWithinWindow`, `wasWithinCap`,
   `refundFired`).
7. Update booking: `state='cancelled'`, `refundOutcome`, `cancelledAt=now`.
8. (G7) Fire seat-free hook (no-op promotion in v1).
9. (G8) Write `auditLog`.

Cancellation is **always allowed**; window/cap only gate the refund, never the action.
A cancelled booking does not block re-booking (double-book check is `state='confirmed'` only).

### 3.2 Cancellation policy — `evaluateCancellation`

Pure-ish: read `global_policy` + count cancellations. For class:
- `wasWithinWindow = now <= sessionStartsAt - classWindowHours`.
- `wasWithinCap = clientCancelCountInCycle < cancelCapCount`, where the count is
  `cancellations` with `source='client'` and `cancelled_at >= now - cancelCapCycleDays`,
  **shared across class + PT** (one bucket). No-shows excluded.
- `refund = (wasWithinWindow && wasWithinCap) ? 'full' : 'forfeit'`.
- `reason` ∈ `within_window_within_cap | late | over_cap | late_and_over_cap`.

### 3.3 Admin views roster — extend `getClassDetail`

Add `attendees: { bookingId, client:{id,name}, packageKind, creditsUsed, checkInState, code }[]`,
joined from `bookings` + `clients` + `client_packages`, filtered `state='confirmed'`,
ordered by `bookedAt`. Keep `bookedCount` for back-compat.

### 3.4 Admin cancels a class — bulk refund

`POST /portal/admin/schedule/classes/:id/cancel`. One transaction:
1. Lock class `FOR UPDATE` (G10); assert `lifecycle='active'`; else idempotent 200/409.
2. Set `lifecycle='cancelled'`, `cancelled_at`, `cancelled_by_staff_id`.
3. For each `confirmed` booking:
   - Return `creditsOrSessionsUsed` to its package (skip if 0 / unlimited → `n_a`).
   - `state='cancelled'`, `refundOutcome` per `decideOutcome('class','admin')` (always full).
   - Insert `cancellations` (`source='admin'`, `refundFired = creditsUsed>0`).
4. Emit inbox notification + email per `admin-restructure.md §13`
   (actor, session, time, count refunded).
5. (G8) `auditLog`.

Admin cancel bypasses window/cap entirely (always full refund).

### 3.5 Booking-time hardening (G1)

In `book.ts`, after locking the class, reject when the chosen package's `expiresAt` is
non-null and `< class.startsAt` (both unlimited and credit). Surface `409 package_expires_before_class`.

---

## 4. Build order

1. **`evaluate-cancellation.ts`** (G5) — unblocks every refund path.
2. **Client `cancel.ts` + route** (G2, G3) — wire `DELETE /client/bookings/:id`.
3. **Attendee roster** in `getClassDetail` (G4).
4. **Admin cancel-class** bulk refund + notifications (G6, G10).
5. **No-show + admin bookings list/detail** (G9).
6. **Booking-time expiry validation** (G1).
7. **Waitlist seat-free hook + notifications** (G7).
8. **Audit/credit-ledger writes** threaded through 1–6 (G8).

Verify each step with `npx tsc --noEmit` in `be/` (no test infra).

---

## 5. Open product decisions

- **D1 (G2) — Refund to an expired package:** (a) reactivate/extend the original package,
  (b) re-route credit to another active package, or (c) accept the loss. Spec's
  "full refund or nothing" implies (a) or (b).
- **D2 (G11) — Unlimited late-cancel governance:** do unlimited clients' late cancels count
  toward the cap (deterrent) even though no refund is at stake, or are they exempt?
- **D3 — Cancel after class has started:** confirm always forfeit (window already covers it,
  but make explicit).
