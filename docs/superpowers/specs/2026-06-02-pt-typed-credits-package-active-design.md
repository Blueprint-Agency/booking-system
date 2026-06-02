# Design: package `active` flag + typed PT credits

**Date:** 2026-06-02
**Status:** Approved (design); pending implementation plan

## Problem

Two related gaps in the package/credit model:

1. **No explicit consumability state on purchased packages.** `client_packages` validity is currently implicit — derived ad-hoc from `expires_at` + `credits_or_sessions_remaining`. PT purchases get `expires_at = null` (never expire). We want every purchased package to carry an explicit, maintained `active` flag plus a guaranteed `expires_at`, and to gate consumption on both.

2. **PT credits aren't typed at consumption.** PT catalog packages already carry `session_type` (`1on1` | `2on1`), but the read path collapses all PT balances into a single `pt_sessions_remaining`, and a 2-on-1 request is modelled as costing **2** of that shared pool. We want 1-on-1 and 2-on-1 to be **separate credit pools**: a 1-on-1 request consumes 1 credit from a 1-on-1 package; a 2-on-1 request consumes 1 credit from a 2-on-1 package.

The PT request flow (`submitPtRequest` / `cancelPtRequest` / list / partner-lookup) is fully schema-defined but every service + route is a 501 stub. We build the **client-facing** PT consumption for real as part of this change.

## Decisions (locked)

- **PT validity:** global constant `PT_VALIDITY_DAYS = 365`. PT purchases set `expires_at = purchased_at + 365 days` (was `null`).
- **Reuse `expires_at`** — do **not** add a `last_day` column.
- **`active`** is a maintained boolean reflecting real consumability (flips on expiry / exhaustion / refund).
- **Scope:** build the real backend client PT consumption now; frontend goes fully live for PT (drops the `pt-requests-mock` store).
- **2-on-1 consumes 1 credit** from the requester's 2-on-1 package (not 2). Only the requester's package is debited; the partner spends nothing.

## Out of scope (stays as-is / 501)

- Admin scheduling + admin cancel of PT requests (`schedulePtRequest`, portal `/admin/pt-sessions/*`) — separate, larger piece. Credit is already held at submit, so leaving scheduling stubbed is consistent.
- `expireStaleSessions()` (the pending-request TTL cron) — unrelated to package validity; remains a TODO.
- Class-booking consumption (`bookClass` 501) — unchanged.
- Refund-driven revocation from Stripe refunds — the `active` flag supports it, but the Stripe refund flow itself is not built here.

---

## Section 1 — Data model

One hand-authored migration (next number after `0011`), following the 0008+ hand-authored convention. **No drizzle-kit generate.**

- Add column `client_packages.active boolean NOT NULL DEFAULT true`.
- Update the Drizzle schema in `be/src/db/schema/packages.ts` to match (`active: boolean('active').notNull().default(true)`).
- **Backfill, in order:**
  1. PT rows missing an expiry: `UPDATE client_packages SET expires_at = purchased_at + interval '365 days' WHERE kind = 'pt' AND expires_at IS NULL;`
  2. Set `active` to current reality:
     `UPDATE client_packages SET active = false WHERE (expires_at IS NOT NULL AND expires_at <= now()) OR (kind <> 'unlimited' AND coalesce(credits_or_sessions_remaining, 0) <= 0);`
     (rows default to `true`; this flips the already-expired / already-exhausted ones to `false`.)

`expires_at` remains the validity timestamp. `active` is the authoritative consumability flag.

## Section 2 — Consumption rule and `active` maintenance

A package is **consumable** when:

```
active = true
AND (expires_at IS NULL OR expires_at > now())
AND (kind = 'unlimited' OR credits_or_sessions_remaining >= <amount needed>)
```

The live `not-expired` check guards the lag between the instant of expiry and the next cron sweep, so a just-expired package is never spent even if its `active` flag hasn't flipped yet.

`active` is flipped at every trigger so it always reflects consumability:

| Trigger | Effect |
|---|---|
| Purchase (`grantPackage`) | `active = true` (computed: non-expired & balance>0 / unlimited) |
| Consume (PT debit) | if `credits_or_sessions_remaining` reaches 0 after debit → `active = false`, same transaction |
| Refund (cancel-pending re-credits) | recompute `active`: `true` if non-expired & balance>0 |
| Expiry | daily `node-cron` sweep sets `active = false` for expired rows (Section 6) |

A small shared helper computes the flag from a row's state:

```
computeActive({ kind, expiresAt, remaining }, now): boolean
  = (expiresAt == null || expiresAt > now)
    && (kind === 'unlimited' || (remaining ?? 0) > 0)
```

Used at insert and after every balance mutation so the column stays correct.

## Section 3 — Typed PT credits (1-on-1 vs 2-on-1)

Stop aggregating PT into one number. Source of truth for a purchased PT package's type is `pt_packages.session_type` reached via `client_packages.source_pt_package_id`.

**`be/src/services/packages/entitlements.ts`:**
- `getClientEntitlements()` → return `pt1on1Remaining` and `pt2on1Remaining` (replace `ptSessionsRemaining`), each summed only over **consumable** PT packages of that `session_type`. Join `pt_packages` to read `session_type`.
- `listClientPackages()` → each returned package gains `active` (from the column) and, for PT, `sessionType` (`'1on1' | '2on1' | null`).
- Apply the Section-2 consumable rule (now including `active`) to the `trialUsed` / `hasActiveUnlimited` / `hasActiveBundleCredits` checks too, for consistency.

**`/me/packages` response (`be/src/routes/client/me.ts` serializer):**
- `entitlements`: replace `pt_sessions_remaining` with `pt_1on1_remaining` + `pt_2on1_remaining`.
- each `client_packages[]` entry gains `active` (bool) and `session_type` (string|null).

## Section 4 — Backend: wire the client PT surface live

Implement the stubbed services in `be/src/services/pt-sessions/` and un-stub the routes in `be/src/routes/client/pt-sessions.ts`. Routes stay thin (`auth → zod parse → service → format`); domain logic in services.

- **`POST /me/pt-sessions/request` → `submitPtRequest(input)`**
  - Validate: chosen `clientPackageId` belongs to the authed client, `kind='pt'`, **consumable**, and its `session_type` **matches** `input.sessionType`, with balance ≥ 1.
  - On failure raise a typed error → `409`/`402` (`insufficient_pt_credit` / `package_not_consumable` / `session_type_mismatch`).
  - In one transaction: insert `pt_requests` (+ `expires_at` from `pt_booking_config` TTL) and `pt_request_slots`; debit 1 from the package; recompute `active`.
  - Partner handling: `existing` → store `co_client_id`; `new` → store `co_client_name` + `co_client_email`.
  - Returns `{ ptRequestId }`.
- **`POST /me/pt-sessions/:id/cancel` → `cancelPtRequest(id, 'client')`** (pending only)
  - Set `cancelled_before_scheduled`, stamp `resolved_at`; **refund 1** to the originating package; recompute `active`. (Scheduled requests: client cancel stays out of scope / not exposed here.)
- **`GET /me/pt-sessions/` → list own requests** (with slots) so the post-submit screen reflects reality.
- **`GET /me/pt-sessions/partner-lookup?email=` → member lookup** for the 2-on-1 partner field.

## Section 5 — Frontend (`fe-client`)

- **`src/lib/use-client-packages.tsx`:** parse `pt_1on1_remaining` / `pt_2on1_remaining`; expose `pt1on1` + `pt2on1` (drop the single `ptSessions`); carry `active` + `sessionType` per `LivePackage`; prefer the BE `active` flag for the "active wallet" filter instead of recomputing from `expires_at`+balance.
- **`/private-sessions` request form:** the 1-on-1 / 2-on-1 selector validates against the **matching** balance; resolves the matching `clientPackageId` to send; submit-time "buy a private session package" prompt names the **specific** missing credit type (e.g. "You have no 2-on-1 credits"). Submit posts to the live endpoint; on success redirect as today.
- **`account/private-sessions`:** read the live list endpoint; cancel calls the live cancel endpoint.
- **Partner lookup:** the 2-on-1 email field calls the live `partner-lookup` endpoint.
- Remove the now-dead `src/lib/pt-requests-mock.ts` usage (delete the module if nothing else references it).

## Section 6 — Background job

Add `deactivateExpiredPackages()` to `be/src/jobs/` and register it as a daily `node-cron` task (alongside existing jobs):

```
UPDATE client_packages
SET active = false
WHERE active = true AND expires_at IS NOT NULL AND expires_at <= now();
```

This is the time-trigger that honors "active flips to false when it expires."

---

## Testing / verification

No BE test infra (no Vitest) — verify with `npm run typecheck --prefix be`. Frontend: `tsc --noEmit` + `next build` in `fe-client` (lint is broken). Manual end-to-end via the running app: purchase a PT package → see typed balance → submit a 1-on-1 and a 2-on-1 request → balances decrement from the correct pool → cancel a pending request → credit refunded → exhausted/expired package shows `active=false` and drops from the wallet.

## Risks / notes

- **Migration ordering:** the `active` backfill must run *after* the PT `expires_at` backfill, or freshly-back-dated PT rows could be wrongly deactivated. Single migration file, statements in order.
- **`/me/packages` shape change** (`pt_sessions_remaining` → two fields) is a breaking wire change; FE updated in the same change. No other consumers (single-tenant, two FEs; only `fe-client` reads `/me/packages`).
- **Cron lag** is mitigated by the live `not-expired` check in the consumption gate.
