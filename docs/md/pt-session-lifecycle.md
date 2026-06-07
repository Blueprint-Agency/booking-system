# PT Session Lifecycle — Completion Spec

Status: **backend lifecycle implemented (2026-06-07)** on `feat/pt-typed-credits-package-active`.
Scope: **personal-training (PT) sessions only** — 1-on-1 and 2-on-1. Classes and workshops
are referenced where they share policy but are not the subject here. Companion to
`class-booking-lifecycle.md`.

## Implementation status (this change)

| Gap | Status | File |
|---|---|---|
| P1 — scheduling service + admin routes | ✅ done | `services/pt-sessions/schedule.ts`, `routes/portal/admin/pt-sessions.ts` |
| P1 — instructor routes (instructor_id forced) | ✅ done | `routes/portal/instructor/pt-requests.ts` |
| P2 — scheduled-session cancel cascade | ✅ done | `services/pt-sessions/cancel.ts` (`scheduled` branch) |
| P3 — 2-on-1 debits/refunds 2 (not 1) | ✅ done | `services/pt-sessions/cost.ts`, `request.ts`, `cancel.ts` |
| P4 — window-based refund via `evaluateCancellation` | ✅ done | `cancel.ts` (client scheduled-cancel) |
| P5 — `manual_adjustments` ledger on debit/refund | ✅ done | `request.ts`, `cancel.ts` |
| P6 — `expireStaleSessions` cron body | ✅ done | `cancel.ts` (cron already registered, every 5 min) |
| Client cancel ownership assertion | ✅ done | `cancel.ts`, `routes/client/pt-sessions.ts` |
| P7 — fe-portal pt-requests list/schedule/cancel wired to BE | ⛔ deferred | blocked on a portal-wide live-data pattern (no admin page calls `makeApi` yet; sibling corporate dialog is also seed-based) |
| P8 — 2-on-1 new-partner "create account" loop | ⛔ deferred | needs P7 + admin client-create surface |
| email notifications (`pt_session_approved`, `pt_cancelled_*`) | ⛔ deferred | inbox-only in v1, matching the class cancel path |

Verified with `npx tsc --noEmit` in `be/` (EXIT=0; no test infra per project convention).
**D1 resolved**: client scheduled-cancels are gated by the PT window + shared cap
(`evaluateCancellation(kind='pt')`); admin cancels are always full refund. `be-portal.md §3c`'s
"v1 = always forfeit" wording is superseded by this change and should be updated.

The PT lifecycle has two halves. The **client request + pending-cancel + refund** half is
built and live. The **admin-schedules → session materialises → scheduled-cancel** half is
entirely stubbed (501 / `throw not implemented`). The lifecycle is therefore severed in the
middle: a client can submit a request and be debited, but no request can ever be scheduled,
and no scheduled session can be cancelled.

Sources of truth: `be-client.md §4d` (request/cancel contract), `be-portal.md §3c` (schedule +
cancel cascade), `admin-restructure.md §6/§9` (packages, triage, scheduling), `backend-architecture.md §5`
(expiry cron). Where this doc and `be-portal.md §3c`'s "v1 = always forfeit on scheduled cancel"
disagree, see **Open decision D1** — the shared policy engine already contradicts that wording.

Verify each step with `npx tsc --noEmit` in `be/` (no test infra per project convention).

---

## 1. Lifecycle map (current state)

| Stage | Status | Location |
|---|---|---|
| Admin creates PT packages (typed 1on1 / 2on1) | ✅ done | `routes/portal/admin/` pt-packages, `fe-portal/admin/private-sessions` |
| Client buys PT package (Stripe) | 🟡 per packages flow | `services/packages/purchase.ts` |
| Client lists entitlements (`pt1on1Remaining` / `pt2on1Remaining`) | ✅ done | `services/packages/entitlements.ts` |
| Client submits PT request (debits on submit) | ✅ done | `routes/client/pt-sessions.ts` → `services/pt-sessions/request.ts:submitPtRequest` |
| Partner email lookup (2on1 autocomplete) | ✅ done | `services/pt-sessions/list.ts:lookupPartnerByEmail` |
| Client lists own requests / sessions | ✅ done | `services/pt-sessions/list.ts` |
| Client cancels **pending** request (refund) | ✅ done | `services/pt-sessions/cancel.ts:cancelPtRequest` (`pending` branch only) |
| Client cancels **scheduled** session | ❌ throws `cannot_cancel_non_pending` | `services/pt-sessions/cancel.ts:47` |
| Admin triage queue (list requests) | ❌ 501 stub | `routes/portal/admin/pt-sessions.ts` |
| Admin schedules a request → creates session | ❌ `throw not implemented` | `services/pt-sessions/schedule.ts:schedulePtRequest` |
| Admin cancels (pending or scheduled) | ❌ 501 stub | `routes/portal/admin/pt-sessions.ts` |
| Instructor list / schedule / cancel | ❌ all 501 | `routes/portal/instructor/pt-requests.ts` |
| Stale-request auto-expiry cron | ❌ empty TODO | `services/pt-sessions/cancel.ts:89 expireStaleSessions` |
| Cancellation policy engine (window + shared cap) | ✅ **already PT-aware** | `services/policy/evaluate-cancellation.ts` (`kind:'pt'`, `ptWindowHours`) |

### What already works

`submitPtRequest` (`request.ts`) is race-safe: locks `client_packages FOR UPDATE`, validates
`kind='pt'`, `session_type` match, not expired, `remaining >= 1`; debits, recomputes `active`,
inserts `pt_requests` (`status='pending'`, `expires_at = now + book_in_advance_days`) +
`pt_request_slots`, and stores `debited_client_package_id` for precise reversal. The `pending`
cancel branch refunds against that exact package and is idempotent on terminal states.

The schema is fully scheduling-ready and **needs no migration**: `pt_sessions`
(`pt_request_id NOT NULL UNIQUE`, instructor/location/room, `starts_at`/`ends_at`, `session_type`,
capacities, `lifecycle`, `cancelled_*`, `scheduled_*`), `pt_session_clients` (M:N for 2on1),
and `global_policy.ptWindowHours = 24`. `evaluateCancellation` already accepts `kind:'pt'` and
reads `ptWindowHours` — the engine the user's "cancel before the window = refund" requirement
needs is **built but unwired**.

---

## 2. Gaps

### Critical (lifecycle-severing)

- **P1 — Admin/instructor scheduling is entirely stubbed.** `schedulePtRequest` throws; all 3
  admin routes (`GET /pt-requests`, `POST /:id/schedule`, `POST /:id/cancel`) and all 3 instructor
  routes are 501. A debited `pending` request has no path forward. **Blocks the whole feature.**

- **P2 — Scheduled-session cancellation does not exist.** `cancel.ts:47` throws
  `cannot_cancel_non_pending`. The entire `scheduled → cancelled_after_scheduled` cascade
  (cancel `pt_sessions`, forfeit/refund `bookings`, write `cancellations` + `inbox_items`, email)
  is unbuilt. This is the surface the user's "client cancels before the window to get refunded /
  admin cancels to refund" requirement lives on.

- **P3 — 2-on-1 debits and refunds the wrong amount.** Spec (`be-client.md §4d.5`,
  `be-portal.md §3c`) says **2** sessions for 2on1; `request.ts:93` hardcodes `-1` and
  `cancel.ts:62` refunds `+1`. A 2-on-1 currently costs one session. Money bug.

### Secondary

- **P4 — Window-based refund not wired for PT (the user's core ask).** `evaluateCancellation`
  is PT-aware but no PT path calls it. To honour "cancel before the window → refund" on a
  *scheduled* session, the scheduled-cancel branch must call
  `evaluateCancellation({ clientId, kind:'pt', sessionStartsAt: pt_session.starts_at, now })`
  and `decideOutcome('pt', source, evaluation)` — exactly like `bookings/cancel.ts` does for
  classes — rather than hardcoding forfeit. Contradicts `be-portal §3c` v1 wording → see D1.

- **P5 — No credit-movement ledger on PT debit/refund.** Spec wants a `manual_adjustments` row
  (`reason='pt_request_submit'` / refund reason) per `class-booking-lifecycle.md` G8; impl raw-decrements
  `credits_or_sessions_remaining`. No audit trail, harder reconciliation.

- **P6 — Auto-expiry cron is an empty TODO.** `expireStaleSessions()` is unimplemented, so a
  `pending` request holds a debited credit indefinitely and never auto-refunds. Interval is also
  inconsistent across docs: `be-client.md §4d` says every 5 min, `backend-architecture.md §5` says
  hourly, the code comment says daily — pick one.

- **P7 — Portal PT-requests list runs on mock seed data.** `fe-portal/admin/pt-requests/page.tsx`
  has a TODO to compare real location UUIDs once wired — naturally blocked by P1.

- **P8 — 2-on-1 "new partner" has no closing loop.** Client submits a non-member partner
  (`co_client_name`/`co_client_email`); `schedule` 409s with `partner_account_required` until
  `co_client_id` is non-null, but nothing surfaces the "create this partner first" task to the
  admin (no inbox row, no badge wired). Friction with no guardrail.

---

## 3. Target behaviour

### 3.1 Admin/instructor schedules a request — `schedulePtRequest`

`POST /portal/admin/pt-requests/:id/schedule` (and the instructor route, which forces
`instructor_id = ctx.instructor_id`). One transaction (per `be-portal.md §3c`):

1. `SELECT pt_requests FOR UPDATE WHERE id=:id AND status='pending'` → else `409 request_not_pending`.
2. For 2on1: `co_client_id` MUST be non-null → else `409 partner_account_required`.
3. Conflict check: no class / workshop_day / active `pt_session` for `instructor_id` overlaps
   `[starts_at, ends_at]`; room belongs to location and is clash-free (`assertRoomInLocation`,
   `assertRoomAvailable`).
4. Workspace check: `location_id ∈ actor.granted_location_ids` (superadmin bypasses).
5. Insert `pt_sessions` (`session_type` copied from request, `capacity_online` 1/2, `lifecycle='active'`,
   `scheduled_*`).
6. Insert `pt_session_clients`: requester + co_client (if 2on1).
7. Insert `bookings` (`kind='pt'`, `state='confirmed'`, `credits_or_sessions_used` for audit —
   **do not re-debit**, the debit happened at submit; generate `qr_token` + `code`) per attendee.
8. Update `pt_requests`: `status='scheduled'`, `scheduled_pt_session_id`, `resolved_*`.
9. `enqueueEmail('pt_session_scheduled')` to client (and partner if 2on1).

Scheduling **is** the approval — no approve/decline. Reflects to the client account view and
the portal schedule (`schedule.ts:listScheduleItems`).

### 3.2 Cancellation — extend `cancelPtRequest` to the `scheduled` branch

Single entry point for client (`/me/pt-sessions/:id/cancel`, `source='client'`) and admin
(`/portal/admin/pt-requests/:id/cancel`, `source='admin'`). Branch on `pt_requests.status`:

- **`pending`** (already built — fix P3): `status='cancelled_before_scheduled'`; refund
  **1 for 1on1 / 2 for 2on1** to `debited_client_package_id`; recompute `active`;
  email `pt_cancelled_session_returned`.
- **`scheduled`** (build — P2/P4): load the linked `pt_sessions.starts_at`. If
  `now >= starts_at` → `422 session_already_started` (mirror class path).
  - `source='admin'` → always full refund (bypass window/cap), per `be-portal.md §3b`.
  - `source='client'` → `evaluateCancellation({ clientId, kind:'pt', sessionStartsAt, now })`
    then `decideOutcome('pt','client',evaluation)`; refund the session(s) **only on `full`**,
    else forfeit.
  - Set `pt_requests.status='cancelled_after_scheduled'`; `pt_sessions.lifecycle='cancelled'`,
    `cancelled_*`; every booking `state='cancelled'`, `refund_outcome` per outcome.
  - Insert `cancellations` rows (`kind='pt'`, `source`, `was_within_window`, `was_within_cap`,
    `refund_fired`) — **admin rows excluded from cap**, consistent with the class path.
  - Insert `inbox_items` (`type='admin_cancel_class_pt'` for admin; `client_cancellation` for client).
  - Email `pt_cancelled_session_returned` or `pt_cancelled_forfeited`.
- **terminal** → idempotent no-op.

This makes "client cancels before the window → refunded; admin cancels → always refunded" true,
and unifies PT with the class cancellation policy (shared cap, `ptWindowHours` window).

### 3.3 Auto-expiry cron — `expireStaleSessions` (P6)

`SELECT pt_requests WHERE status='pending' AND expires_at < now()`; route each through the
`pending` cancel branch with `source='system'` (refund, `resolved_by_staff_id=NULL`), email
`pt_cancelled_session_returned` (auto-expiry subject). Settle the interval (recommend matching
`be-client.md §4d`: every 5 min) and register in the cron table.

### 3.4 2-on-1 credit correctness (P3)

Parameterise the debit/refund amount: `amount = sessionType === '2on1' ? 2 : 1`. Apply in
`request.ts` (debit), the `pending` refund, and the `scheduled` refund. Add a `manual_adjustments`
ledger row at each movement (P5).

### 3.5 Portal wiring (P7) + partner loop (P8)

Once P1 lands, replace `fe-portal/admin/pt-requests` seed data with the live list endpoint and
delete the location-UUID bridge. For P8, when a 2on1 request arrives with `co_client_id=null`,
surface a "create partner account" affordance (inbox row or queue badge) so the schedule 409 is
pre-empted rather than hit.

---

## 4. Build order

1. **`schedulePtRequest` + admin routes** (P1) — unblocks the whole lifecycle and P7.
2. **2-on-1 debit/refund amount + ledger** (P3, P5) — small, correctness-critical, touches
   `request.ts` + both cancel branches.
3. **Scheduled-cancel branch** wired through `evaluateCancellation`/`decideOutcome` (P2, P4) —
   delivers the user's refund-window requirement; reuse the class cancel path as the template.
4. **Instructor schedule/cancel routes** (P1 cont.) — same services, `instructor_id` forced.
5. **`expireStaleSessions` cron** (P6) — settle interval, register job.
6. **Portal list wiring + partner-account loop** (P7, P8).

Verify each step with `npx tsc --noEmit` in `be/`.

---

## 5. Open product decisions

- **D1 — Scheduled-PT refund policy.** `be-portal.md §3c` documents "v1 = always forfeit on
  scheduled cancel" (hardcodes `was_within_window=false`), but `evaluate-cancellation.ts` was
  deliberately built PT-aware with a configurable `ptWindowHours=24`, and the user wants
  window-based refund. **Recommendation: supersede the §3c wording** — route client scheduled-cancels
  through `evaluateCancellation` (full refund within window+cap, forfeit otherwise), keep admin
  cancels always-full. Confirm before building step 3, and update `be-portal.md §3c` to match.
- **D2 — Refund to an expired PT package.** Same question as the class doc's D1 (G2): a scheduled
  session could start after the source package expired. PT packages have **no validity period**
  per `admin-restructure.md §6`, which likely makes this moot — confirm `expires_at` is always null
  for PT, else resolve as for classes.
- **D3 — Does an admin-initiated PT cancel count toward the client's cap?** Class path excludes
  `source='admin'` rows from the cap. Confirm PT follows the same rule (recommended: yes, exclude).
