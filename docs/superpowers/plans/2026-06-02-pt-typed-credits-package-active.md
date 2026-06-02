# Package `active` flag + typed PT credits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every purchased package a maintained `active` flag + guaranteed `expires_at`, split PT credits into separate 1-on-1 / 2-on-1 pools, and build the real client PT-request consumption (submit/cancel/list/partner-lookup).

**Architecture:** `client_packages.active` is the authoritative consumability flag, kept in sync at purchase / debit / refund / expiry. PT balances are derived per `session_type` via `source_pt_package_id → pt_packages.session_type`. The client PT-request services are un-stubbed; debit happens at submit, refund at cancel-while-pending (deterministic via a new `pt_requests.debited_client_package_id`). The frontend drops its mock store and goes live.

**Tech Stack:** Hono + Drizzle + Postgres (be), Next.js + Tailwind (fe-client). Hand-authored SQL migrations (0008+ convention; **do NOT run drizzle-kit generate**). **No BE test infra** — gate every BE task on `npm run typecheck --prefix be`. FE gate: `npx tsc --noEmit` + `npm run build` in `fe-client` (lint is broken).

**Spec:** `docs/superpowers/specs/2026-06-02-pt-typed-credits-package-active-design.md`

**Commit style:** No `Co-Authored-By` / `Generated with` trailers (per CLAUDE.md). Branch: `feat/pt-typed-credits-package-active` (already created).

---

## File map

**Backend (`be/`)**
- Create: `src/db/migrations/0012_client_package_active.sql` — add `client_packages.active`, backfill, add `pt_requests.debited_client_package_id`.
- Modify: `src/db/migrations/meta/_journal.json` — register 0012.
- Modify: `src/db/schema/packages.ts` — `active` column on `client_packages`.
- Modify: `src/db/schema/schedule.ts` — `debitedClientPackageId` column on `pt_requests`.
- Create: `src/services/packages/validity.ts` — `PT_VALIDITY_DAYS`, `computeActive()`.
- Modify: `src/services/packages/purchase.ts` — PT expiry = now+365d; set `active` at insert.
- Modify: `src/services/packages/entitlements.ts` — typed PT balances; `active`/`sessionType` in wallet; consumable rule uses `active`.
- Modify: `src/routes/client/me.ts` — `/me/packages` serializer (`active`, `session_type`, typed PT counts).
- Modify: `src/services/pt-sessions/request.ts` — implement `submitPtRequest`.
- Modify: `src/services/pt-sessions/cancel.ts` — implement client `cancelPtRequest` (pending → refund).
- Create: `src/services/pt-sessions/list.ts` — `listClientPtRequests()`, `lookupPartnerByEmail()`.
- Modify: `src/routes/client/pt-sessions.ts` — un-stub all four routes.
- Modify: `src/services/packages/expire.ts` — implement `expirePackages()` to flip `active=false`.

**Frontend (`fe-client/`)**
- Create: `src/lib/pt-sessions.ts` — live API calls (submit/list/cancel/partner-lookup).
- Modify: `src/lib/use-client-packages.tsx` — typed PT balances, `active`/`sessionType` per package.
- Modify: `src/app/(client)/private-sessions/page.tsx` — typed-credit validation + live submit.
- Modify: `src/app/(client)/account/private-sessions/page.tsx` — live list + cancel.
- Delete: `src/lib/pt-requests-mock.ts` — once unreferenced.

---

## Task 1: Migration + schema — `active` column & debited-package link

**Files:**
- Create: `be/src/db/migrations/0012_client_package_active.sql`
- Modify: `be/src/db/migrations/meta/_journal.json`
- Modify: `be/src/db/schema/packages.ts:161-166` (add column)
- Modify: `be/src/db/schema/schedule.ts:339` (add column)

- [ ] **Step 1: Write the migration SQL**

Create `be/src/db/migrations/0012_client_package_active.sql`:

```sql
-- 0012_client_package_active.sql
-- Every purchased package now carries an explicit `active` flag (the authoritative
-- consumability state) alongside expires_at. PT purchases previously had no expiry;
-- they now expire 365 days after purchase. pt_requests records which client_package
-- was debited so a cancel-while-pending can refund the exact package.
--
-- Hand-authored (matching 0008–0011): the migrator reads _journal.json + these .sql
-- files, not the meta snapshots (which stop at 0007).

-- 1. active flag — defaults true; existing rows get true, then corrected below.
ALTER TABLE client_packages
  ADD COLUMN active boolean NOT NULL DEFAULT true;

-- 2. Backfill PT expiry FIRST (so step 3 evaluates against the real expiry).
UPDATE client_packages
  SET expires_at = purchased_at + interval '365 days'
  WHERE kind = 'pt' AND expires_at IS NULL;

-- 3. Correct active to current reality: deactivate expired or exhausted packages.
UPDATE client_packages
  SET active = false
  WHERE (expires_at IS NOT NULL AND expires_at <= now())
     OR (kind <> 'unlimited' AND coalesce(credits_or_sessions_remaining, 0) <= 0);

-- 4. Record the debited package on a PT request (empty table today; route was 501).
ALTER TABLE pt_requests
  ADD COLUMN debited_client_package_id uuid REFERENCES client_packages(id) ON DELETE RESTRICT;
```

- [ ] **Step 2: Register the migration in the journal**

In `be/src/db/migrations/meta/_journal.json`, append to the `entries` array (after the `0011` entry, before the closing `]`):

```json
    ,{
      "idx": 12,
      "version": "7",
      "when": 1780300000000,
      "tag": "0012_client_package_active",
      "breakpoints": true
    }
```

- [ ] **Step 3: Add `active` to the Drizzle schema**

In `be/src/db/schema/packages.ts`, inside the `clientPackages` columns (right after `expiresAt`, line 162), add:

```ts
    active: boolean('active').notNull().default(true),
```

Ensure `boolean` is in the `drizzle-orm/pg-core` import at the top of the file (add it if missing).

- [ ] **Step 4: Add `debitedClientPackageId` to `pt_requests` schema**

In `be/src/db/schema/schedule.ts`, inside the `ptRequests` columns (after `scheduledPtSessionId`, line 339), add:

```ts
    // The client_packages row debited at submit, so a cancel-while-pending refunds the exact package.
    debitedClientPackageId: uuid('debited_client_package_id').references(() => clientPackages.id, {
      onDelete: 'restrict',
    }),
```

Add the import at the top of `schedule.ts`: `import { clientPackages } from './packages'` (verify it isn't already imported; `packages.ts` does not import `schedule.ts`, so no cycle).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck --prefix be`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add be/src/db/migrations/0012_client_package_active.sql be/src/db/migrations/meta/_journal.json be/src/db/schema/packages.ts be/src/db/schema/schedule.ts
git commit -m "feat(be): add client_packages.active + pt_requests.debited_client_package_id (migration 0012)"
```

---

## Task 2: `computeActive` helper + grantPackage sets active & PT 365d expiry

**Files:**
- Create: `be/src/services/packages/validity.ts`
- Modify: `be/src/services/packages/purchase.ts:16-31` (computeExpiry) and `:103-118` (insert)

- [ ] **Step 1: Create the validity helper**

Create `be/src/services/packages/validity.ts`:

```ts
/** Global validity for PT packages — the PT catalog has no per-package validity. */
export const PT_VALIDITY_DAYS = 365

export interface PackageValidity {
  kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
  expiresAt: Date | null
  creditsOrSessionsRemaining: number | null
}

/** A package is consumable (active) when not expired AND (unlimited OR balance > 0). */
export function computeActive(p: PackageValidity, now: Date = new Date()): boolean {
  const notExpired = p.expiresAt === null || p.expiresAt > now
  if (!notExpired) return false
  if (p.kind === 'unlimited') return true
  return (p.creditsOrSessionsRemaining ?? 0) > 0
}
```

- [ ] **Step 2: PT purchases get a 365-day expiry**

In `be/src/services/packages/purchase.ts`, replace the `computeExpiry` function body's PT branch. Change line 21 from `if (kind === 'pt') return null` to:

```ts
  if (kind === 'pt') {
    const d = new Date(now)
    d.setDate(d.getDate() + PT_VALIDITY_DAYS)
    return d
  }
```

Add to the imports at the top: `import { PT_VALIDITY_DAYS, computeActive } from './validity'`. Update the JSDoc comment above `computeExpiry` (lines 10-15): change the `pt:` line to `pt: now + PT_VALIDITY_DAYS (365)`.

- [ ] **Step 3: Set `active` at insert**

In `grantPackage`, in the `.insert(clientPackages).values({...})` block (lines 108-118), add after `expiresAt,`:

```ts
        active: computeActive({ kind, expiresAt, creditsOrSessionsRemaining }, now),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --prefix be`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add be/src/services/packages/validity.ts be/src/services/packages/purchase.ts
git commit -m "feat(be): PT packages expire after 365d; grantPackage records active"
```

---

## Task 3: entitlements — typed PT balances + `active` in consumable rule

**Files:**
- Modify: `be/src/services/packages/entitlements.ts` (whole file)

- [ ] **Step 1: Update `ClientEntitlements` and `getClientEntitlements`**

Replace the `ClientEntitlements` interface (lines 5-10) with:

```ts
export interface ClientEntitlements {
  trialUsed: boolean
  hasActiveUnlimited: boolean
  hasActiveBundleCredits: boolean
  pt1on1Remaining: number
  pt2on1Remaining: number
}
```

Replace the body of `getClientEntitlements` (lines 18-46) with:

```ts
export async function getClientEntitlements(clientId: string): Promise<ClientEntitlements> {
  const now = new Date()

  const rows = await db
    .select({
      kind: clientPackages.kind,
      active: clientPackages.active,
      expiresAt: clientPackages.expiresAt,
      remaining: clientPackages.creditsOrSessionsRemaining,
      ptSessionType: ptPackages.sessionType,
    })
    .from(clientPackages)
    .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
    .where(eq(clientPackages.clientId, clientId))

  let trialUsed = false
  let hasActiveUnlimited = false
  let hasActiveBundleCredits = false
  let pt1on1Remaining = 0
  let pt2on1Remaining = 0

  for (const r of rows) {
    // active is authoritative; the live expiry check covers cron lag.
    const consumable = r.active && (r.expiresAt === null || r.expiresAt > now)
    const balance = r.remaining ?? 0
    if (r.kind === 'trial') {
      trialUsed = true // any trial ever (active or expired) counts as used
      if (consumable && balance > 0) hasActiveBundleCredits = true
    } else if (r.kind === 'unlimited') {
      if (consumable) hasActiveUnlimited = true
    } else if (r.kind === 'credit_bundle') {
      if (consumable && balance > 0) hasActiveBundleCredits = true
    } else if (r.kind === 'pt') {
      if (consumable && balance > 0) {
        if (r.ptSessionType === '2on1') pt2on1Remaining += balance
        else pt1on1Remaining += balance
      }
    }
  }

  return { trialUsed, hasActiveUnlimited, hasActiveBundleCredits, pt1on1Remaining, pt2on1Remaining }
}
```

- [ ] **Step 2: Add `active` + `sessionType` to the wallet**

In `ClientPackageWithSource` (lines 48-59) add two fields:

```ts
  active: boolean
  /** '1on1' | '2on1' for PT packages; null otherwise. */
  sessionType: '1on1' | '2on1' | null
```

In `listClientPackages`, change the `onlyActive` filter (lines 71-75) to use the column:

```ts
  if (onlyActive) baseConds.push(eq(clientPackages.active, true))
```

Add to the `.select({...})` object: `active: clientPackages.active,` and `ptSessionType: ptPackages.sessionType,`. Add to the `.map(r => ({...}))` result: `active: r.active,` and `sessionType: (r.ptSessionType ?? null) as '1on1' | '2on1' | null,`.

(`isNull`, `gt`, `or` may become unused after the filter change — remove any now-unused imports from line 1 to keep typecheck/lint clean.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --prefix be`
Expected: no errors. (This will surface a type error in `routes/client/me.ts` referencing `ptSessionsRemaining` — fixed in Task 4. If executing strictly task-by-task, expect that one error and resolve it in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add be/src/services/packages/entitlements.ts
git commit -m "feat(be): split PT entitlements into 1on1/2on1; active-aware consumable rule"
```

---

## Task 4: `/me/packages` serializer

**Files:**
- Modify: `be/src/routes/client/me.ts:22-33` (serializer) and `:73-81` (entitlements block)

- [ ] **Step 1: Add `active` + `session_type` to the package serializer**

Replace `serializeClientPackage` (lines 22-33) with:

```ts
function serializeClientPackage(r: Awaited<ReturnType<typeof listClientPackages>>[number]) {
  return {
    id: r.id,
    kind: r.kind,
    source_package_id: r.sourcePackageId,
    package_name: r.packageName,
    credits_or_sessions_remaining: r.creditsOrSessionsRemaining,
    expires_at: r.expiresAt,
    purchased_at: r.purchasedAt,
    amount_paid_sgd: r.amountPaidSgd,
    active: r.active,
    session_type: r.sessionType,
  }
}
```

- [ ] **Step 2: Replace the PT count in the entitlements block**

In the `/packages` handler `c.json({...})` (lines 73-81), replace `pt_sessions_remaining: ent.ptSessionsRemaining,` with:

```ts
        pt_1on1_remaining: ent.pt1on1Remaining,
        pt_2on1_remaining: ent.pt2on1Remaining,
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --prefix be`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add be/src/routes/client/me.ts
git commit -m "feat(be): /me/packages exposes active, session_type, typed PT balances"
```

---

## Task 5: implement `submitPtRequest`

**Files:**
- Modify: `be/src/services/pt-sessions/request.ts` (replace the stub at lines 42-44, add imports)

- [ ] **Step 1: Implement the service**

Add imports at the top of `request.ts` (above the interfaces):

```ts
import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages, ptPackages } from '../../db/schema/packages'
import { ptRequests, ptRequestSlots } from '../../db/schema/schedule'
import { ptBookingConfig } from '../../db/schema/policy'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { computeActive } from '../packages/validity'

const PT_CONFIG_SINGLETON_ID = '00000000-0000-0000-0000-000000000002'
```

Replace the stub function (lines 42-44) with:

```ts
export async function submitPtRequest(input: PtRequestInput): Promise<{ ptRequestId: string }> {
  if (input.slots.length === 0) throw new BadRequestError('no_slots')
  for (const s of input.slots) {
    if (s.endTime <= s.startTime) throw new BadRequestError('slot_end_before_start')
  }
  if (input.sessionType === '2on1' && !input.partner) throw new BadRequestError('partner_required')
  if (input.sessionType === '1on1' && input.partner) throw new BadRequestError('partner_not_allowed')

  return db.transaction(async tx => {
    const [pkg] = await tx
      .select({
        id: clientPackages.id,
        kind: clientPackages.kind,
        active: clientPackages.active,
        expiresAt: clientPackages.expiresAt,
        remaining: clientPackages.creditsOrSessionsRemaining,
        sessionType: ptPackages.sessionType,
      })
      .from(clientPackages)
      .leftJoin(ptPackages, eq(ptPackages.id, clientPackages.sourcePtPackageId))
      .where(and(eq(clientPackages.id, input.clientPackageId), eq(clientPackages.clientId, input.clientId)))
      .for('update')
      .limit(1)

    if (!pkg) throw new NotFoundError('client_package_not_found')
    if (pkg.kind !== 'pt') throw new BadRequestError('not_a_pt_package')
    if (pkg.sessionType !== input.sessionType) throw new BadRequestError('session_type_mismatch')

    const now = new Date()
    const notExpired = pkg.expiresAt === null || pkg.expiresAt > now
    if (!pkg.active || !notExpired) throw new ConflictError('package_not_consumable')
    if ((pkg.remaining ?? 0) < 1) throw new ConflictError('insufficient_pt_credit')

    const [cfg] = await tx
      .select({ days: ptBookingConfig.bookInAdvanceDays })
      .from(ptBookingConfig)
      .where(eq(ptBookingConfig.id, PT_CONFIG_SINGLETON_ID))
      .limit(1)
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + (cfg?.days ?? 14))

    const newRemaining = (pkg.remaining ?? 0) - 1
    await tx
      .update(clientPackages)
      .set({
        creditsOrSessionsRemaining: newRemaining,
        active: computeActive({ kind: 'pt', expiresAt: pkg.expiresAt, creditsOrSessionsRemaining: newRemaining }, now),
      })
      .where(eq(clientPackages.id, pkg.id))

    const [req] = await tx
      .insert(ptRequests)
      .values({
        clientId: input.clientId,
        classTypeId: input.classTypeId,
        locationId: input.locationId,
        sessionType: input.sessionType,
        coClientId: input.partner?.kind === 'existing' ? input.partner.coClientId : null,
        coClientName: input.partner?.kind === 'new' ? input.partner.name : null,
        coClientEmail: input.partner?.kind === 'new' ? input.partner.email : null,
        message: input.message ?? null,
        expiresAt,
        debitedClientPackageId: pkg.id,
      })
      .returning({ id: ptRequests.id })

    await tx.insert(ptRequestSlots).values(
      input.slots.map(s => ({
        ptRequestId: req!.id,
        proposedDate: s.proposedDate,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    )

    return { ptRequestId: req!.id }
  })
}
```

Also delete the now-stale "debits 1 (1on1) or 2 (2on1)" sentence from the file header comment (lines 1-8) and replace with: "debits 1 session from the chosen PT package (whose session_type must match)."

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --prefix be`
Expected: no errors. (If `BadRequestError`/`ConflictError`/`NotFoundError` aren't exported from `../../shared/errors`, confirm the names against `purchase.ts` which imports the same three.)

- [ ] **Step 3: Commit**

```bash
git add be/src/services/pt-sessions/request.ts
git commit -m "feat(be): implement submitPtRequest — typed debit + slots in one tx"
```

---

## Task 6: implement client `cancelPtRequest` (pending → refund)

**Files:**
- Modify: `be/src/services/pt-sessions/cancel.ts` (replace stub at lines 16-22, add imports)

- [ ] **Step 1: Implement the pending-cancel + refund path**

Add imports at the top of `cancel.ts`:

```ts
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { ptRequests } from '../../db/schema/schedule'
import { clientPackages } from '../../db/schema/packages'
import { ConflictError, NotFoundError } from '../../shared/errors'
import { computeActive } from '../packages/validity'
```

Replace the `cancelPtRequest` stub (lines 16-22) with:

```ts
export async function cancelPtRequest(
  ptRequestId: string,
  source: 'client' | 'admin',
  actorStaffId?: string,
): Promise<void> {
  await db.transaction(async tx => {
    const [req] = await tx
      .select()
      .from(ptRequests)
      .where(eq(ptRequests.id, ptRequestId))
      .for('update')
      .limit(1)
    if (!req) throw new NotFoundError('pt_request_not_found')

    // Terminal states → idempotent no-op.
    if (
      req.status === 'cancelled_before_scheduled' ||
      req.status === 'cancelled_after_scheduled' ||
      req.status === 'attended'
    ) {
      return
    }
    // Scheduled-request cancellation (with its no-refund + session cascade) is out of
    // scope for this change — admin scheduling itself isn't built yet.
    if (req.status !== 'pending') throw new ConflictError('cannot_cancel_non_pending')

    // Refund 1 to the exact debited package.
    if (req.debitedClientPackageId) {
      const [pkg] = await tx
        .select({
          kind: clientPackages.kind,
          expiresAt: clientPackages.expiresAt,
          remaining: clientPackages.creditsOrSessionsRemaining,
        })
        .from(clientPackages)
        .where(eq(clientPackages.id, req.debitedClientPackageId))
        .for('update')
        .limit(1)
      if (pkg) {
        const newRemaining = (pkg.remaining ?? 0) + 1
        await tx
          .update(clientPackages)
          .set({
            creditsOrSessionsRemaining: newRemaining,
            active: computeActive({ kind: pkg.kind, expiresAt: pkg.expiresAt, creditsOrSessionsRemaining: newRemaining }),
          })
          .where(eq(clientPackages.id, req.debitedClientPackageId))
      }
    }

    await tx
      .update(ptRequests)
      .set({
        status: 'cancelled_before_scheduled',
        resolvedAt: new Date(),
        resolvedByStaffId: source === 'admin' ? (actorStaffId ?? null) : null,
      })
      .where(eq(ptRequests.id, ptRequestId))
  })
}
```

Leave `expireStaleSessions` as-is (out of scope).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --prefix be`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add be/src/services/pt-sessions/cancel.ts
git commit -m "feat(be): implement client cancelPtRequest — pending refund to debited package"
```

---

## Task 7: list + partner-lookup services

**Files:**
- Create: `be/src/services/pt-sessions/list.ts`

- [ ] **Step 1: Write the service**

Create `be/src/services/pt-sessions/list.ts`:

```ts
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { classTypes, locations } from '../../db/schema/catalog'
import { ptRequests, ptRequestSlots } from '../../db/schema/schedule'

export interface ClientPtRequestView {
  id: string
  classTypeId: string
  className: string
  locationId: string
  locationName: string
  sessionType: '1on1' | '2on1'
  status: string
  message: string | null
  coClientName: string | null
  createdAt: Date
  expiresAt: Date
  slots: { proposedDate: string; startTime: string; endTime: string }[]
}

export async function listClientPtRequests(clientId: string): Promise<ClientPtRequestView[]> {
  const reqRows = await db
    .select({
      id: ptRequests.id,
      classTypeId: ptRequests.classTypeId,
      className: classTypes.name,
      locationId: ptRequests.locationId,
      locationName: locations.name,
      sessionType: ptRequests.sessionType,
      status: ptRequests.status,
      message: ptRequests.message,
      coClientName: ptRequests.coClientName,
      createdAt: ptRequests.createdAt,
      expiresAt: ptRequests.expiresAt,
    })
    .from(ptRequests)
    .leftJoin(classTypes, eq(classTypes.id, ptRequests.classTypeId))
    .leftJoin(locations, eq(locations.id, ptRequests.locationId))
    .where(eq(ptRequests.clientId, clientId))
    .orderBy(desc(ptRequests.createdAt))

  if (reqRows.length === 0) return []

  const ids = reqRows.map(r => r.id)
  const slotRows = await db
    .select()
    .from(ptRequestSlots)
    .where(inArray(ptRequestSlots.ptRequestId, ids))
    .orderBy(asc(ptRequestSlots.proposedDate), asc(ptRequestSlots.startTime))

  const slotsByReq = new Map<string, ClientPtRequestView['slots']>()
  for (const s of slotRows) {
    const list = slotsByReq.get(s.ptRequestId) ?? []
    list.push({ proposedDate: s.proposedDate, startTime: s.startTime, endTime: s.endTime })
    slotsByReq.set(s.ptRequestId, list)
  }

  return reqRows.map(r => ({
    id: r.id,
    classTypeId: r.classTypeId,
    className: r.className ?? 'Class',
    locationId: r.locationId,
    locationName: r.locationName ?? 'Studio',
    sessionType: r.sessionType as '1on1' | '2on1',
    status: r.status,
    message: r.message,
    coClientName: r.coClientName,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    slots: slotsByReq.get(r.id) ?? [],
  }))
}

export interface PartnerLookupResult {
  found: boolean
  clientId?: string
  name?: string
}

export async function lookupPartnerByEmail(
  email: string,
  requesterClientId: string,
): Promise<PartnerLookupResult> {
  const [row] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(sql`lower(${clients.email}) = ${email.trim().toLowerCase()}`, ne(clients.id, requesterClientId)))
    .limit(1)
  if (!row) return { found: false }
  return { found: true, clientId: row.id, name: row.name }
}
```

**Before writing**, confirm the import paths: open `be/src/db/schema/catalog.ts` and verify `classTypes` and `locations` are exported there (grep `export const classTypes` / `export const locations`). If `locations` lives in a different schema module, fix the import accordingly. Verify `clients` is exported from `db/schema/identity` (it is — `routes/client/me.ts` imports it there).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --prefix be`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add be/src/services/pt-sessions/list.ts
git commit -m "feat(be): listClientPtRequests + lookupPartnerByEmail services"
```

---

## Task 8: un-stub the client PT routes

**Files:**
- Modify: `be/src/routes/client/pt-sessions.ts` (whole file)

- [ ] **Step 1: Wire all four routes**

Replace the whole file with:

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { submitPtRequest } from '../../services/pt-sessions/request'
import { cancelPtRequest } from '../../services/pt-sessions/cancel'
import { listClientPtRequests, lookupPartnerByEmail } from '../../services/pt-sessions/list'

const slotSchema = z.object({
  proposedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
})

const requestSchema = z.object({
  classTypeId: z.string().uuid(),
  locationId: z.string().uuid(),
  sessionType: z.enum(['1on1', '2on1']),
  clientPackageId: z.string().uuid(),
  slots: z.array(slotSchema).min(1),
  message: z.string().max(2000).optional(),
  partner: z
    .union([
      z.object({ kind: z.literal('existing'), coClientId: z.string().uuid() }),
      z.object({ kind: z.literal('new'), name: z.string().min(1).max(160), email: z.string().email() }),
    ])
    .optional(),
})

function serializeRequest(r: Awaited<ReturnType<typeof listClientPtRequests>>[number]) {
  return {
    id: r.id,
    class_type_id: r.classTypeId,
    class_name: r.className,
    location_id: r.locationId,
    location_name: r.locationName,
    session_type: r.sessionType,
    status: r.status,
    message: r.message,
    co_client_name: r.coClientName,
    created_at: r.createdAt,
    expires_at: r.expiresAt,
    slots: r.slots.map(s => ({ proposed_date: s.proposedDate, start_time: s.startTime, end_time: s.endTime })),
  }
}

const app = new Hono()
  .get('/', async c => {
    const rows = await listClientPtRequests(c.get('clientId'))
    return c.json({ pt_requests: rows.map(serializeRequest) })
  })
  .get('/partner-lookup', zValidator('query', z.object({ email: z.string().email() })), async c => {
    const { email } = c.req.valid('query')
    const r = await lookupPartnerByEmail(email, c.get('clientId'))
    return c.json({ found: r.found, client_id: r.clientId ?? null, name: r.name ?? null })
  })
  .post('/request', zValidator('json', requestSchema), async c => {
    const body = c.req.valid('json')
    const { ptRequestId } = await submitPtRequest({ clientId: c.get('clientId'), ...body })
    return c.json({ pt_request_id: ptRequestId }, 201)
  })
  .post('/:id/cancel', async c => {
    await cancelPtRequest(c.req.param('id'), 'client')
    return c.json({ ok: true })
  })

export default app
```

**Before writing**, confirm how `clientId` is accessed in this router context — `routes/client/me.ts` uses `c.get('clientId')`, so the same applies (the client auth middleware sets it). Confirm `@hono/zod-validator` is already a dependency (used in `me.ts`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --prefix be`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add be/src/routes/client/pt-sessions.ts
git commit -m "feat(be): wire client PT routes (list, partner-lookup, request, cancel)"
```

---

## Task 9: `expirePackages` job flips `active=false`

**Files:**
- Modify: `be/src/services/packages/expire.ts:1-6`

- [ ] **Step 1: Implement the expiry sweep**

Replace `expirePackages` (lines 1-6) with:

```ts
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clientPackages } from '../../db/schema/packages'

/**
 * Daily cron: deactivate client_packages whose expiry has passed. This is the
 * time-trigger that flips `active=false` on expiry (debit/refund handle the
 * balance-driven flips inline). Already registered in jobs/index.ts (01:00 SGT).
 */
export async function expirePackages(): Promise<void> {
  await db
    .update(clientPackages)
    .set({ active: false })
    .where(
      and(
        eq(clientPackages.active, true),
        isNotNull(clientPackages.expiresAt),
        lte(clientPackages.expiresAt, sql`now()`),
      ),
    )
}
```

(Keep `sendLapsingAlerts` / `sendExpiredNotifications` stubs untouched.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --prefix be`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add be/src/services/packages/expire.ts
git commit -m "feat(be): expirePackages cron flips active=false on expiry"
```

---

## Task 10: FE — typed PT balances in the packages hook

**Files:**
- Modify: `fe-client/src/lib/use-client-packages.tsx`

- [ ] **Step 1: Update the wire types and exposed shape**

In `use-client-packages.tsx`:

- `LivePackage` (lines 15-23): add `active: boolean;` and `sessionType: "1on1" | "2on1" | null;`.
- `RawClientPackage` (lines 48-56): add `active: boolean;` and `session_type: "1on1" | "2on1" | null;`.
- `RawPackagesResponse.entitlements` (lines 59-64): replace `pt_sessions_remaining: number;` with `pt_1on1_remaining: number;` and `pt_2on1_remaining: number;`.
- `ClientPackagesData` (lines 25-33): replace `ptSessions: { total: number };` with `ptSessions: { oneOnOne: number; twoOnOne: number };`.
- `ClientPackagesValue` (lines 35-43): replace `ptSessions: number;` with `pt1on1: number;` and `pt2on1: number;`.

In `mapPackagesResponse`:
- The `ent` default (lines 76-81): replace `pt_sessions_remaining: 0,` with `pt_1on1_remaining: 0, pt_2on1_remaining: 0,`.
- Replace the local `isActive` helper (lines 85-89) usage with the authoritative flag: `const isActive = (p: RawClientPackage) => p.active;` (BE now owns this).
- In the `.map` (lines 105-114) add `active: p.active,` and `sessionType: p.session_type,`.
- The return (lines 116-124): replace `ptSessions: { total: ent.pt_sessions_remaining ?? 0 },` with `ptSessions: { oneOnOne: ent.pt_1on1_remaining ?? 0, twoOnOne: ent.pt_2on1_remaining ?? 0 },`.

In the `value` object (lines 179-187): replace `ptSessions: data?.ptSessions?.total ?? 0,` with:

```ts
    pt1on1: data?.ptSessions?.oneOnOne ?? 0,
    pt2on1: data?.ptSessions?.twoOnOne ?? 0,
```

- [ ] **Step 2: Typecheck**

Run: `cd fe-client && npx tsc --noEmit`
Expected: errors only in `private-sessions/page.tsx` (which still reads `ptSessions`) — fixed in Task 11.

- [ ] **Step 3: Commit**

```bash
git add fe-client/src/lib/use-client-packages.tsx
git commit -m "feat(fe-client): expose typed PT balances (pt1on1/pt2on1) + active/sessionType"
```

---

## Task 11: FE — request form typed-credit validation + live submit

**Files:**
- Create: `fe-client/src/lib/pt-sessions.ts`
- Modify: `fe-client/src/app/(client)/private-sessions/page.tsx`

- [ ] **Step 1: Add the live API module**

Inspect `fe-client/src/lib/api.ts` and `use-client-packages.tsx` for the existing authed-fetch pattern (Clerk `getToken` + `getApiBaseUrl()`). Create `fe-client/src/lib/pt-sessions.ts` exposing typed helpers that call:
- `POST /me/pt-sessions/request` with `{ classTypeId, locationId, sessionType, clientPackageId, slots, message?, partner? }` → returns `{ pt_request_id }`.
- `GET /me/pt-sessions/` → `{ pt_requests: [...] }`.
- `POST /me/pt-sessions/:id/cancel`.
- `GET /me/pt-sessions/partner-lookup?email=` → `{ found, client_id, name }`.

Match the existing module's auth/error conventions exactly (do not invent a new fetch wrapper if `api.ts` already provides one). If `api.ts` exposes a hook-based client (like the packages provider), follow that; otherwise export async functions that take a token-getter.

- [ ] **Step 2: Rewire the request form**

In `private-sessions/page.tsx`:
- Replace `const { ptSessions, packages, loading: pkgLoading } = useClientPackages();` to also pull `pt1on1`, `pt2on1`.
- Replace the single-pool logic: `const required = ...; const hasEnoughCredits = ptSessions >= required;` with type-aware balances:

```ts
  const balanceForType = (t: "1on1" | "2on1") => (t === "2on1" ? pt2on1 : pt1on1);
  const matchingPackage = ptPackages.find((p) => p.sessionType === computedSessionType);
  const hasEnoughCredits = balanceForType(computedSessionType) >= 1;
```

  (`ptPackages` already filters `packages` to `kind === "pt"`; it now carries `sessionType`.)
- The session-type "remaining" hint: show `You have {pt1on1} 1-on-1 and {pt2on1} 2-on-1 sessions remaining.`
- The submit gate `handleSubmit`: the buy-prompt condition becomes `if (!matchingPackage || !hasEnoughCredits)`; the prompt text names the specific type, e.g. `You have no ${computedSessionType === "2on1" ? "2-on-1" : "1-on-1"} credits.`
- On valid submit, call the live `submitPtRequest` helper with `clientPackageId: matchingPackage!.id` and the chosen `sessionType: computedSessionType`; map slots to `{ proposedDate, startTime, endTime }`; on success `router.push("/account/private-sessions?submitted=1")`. Surface a thrown API error (e.g. `insufficient_pt_credit`) into the existing `errors` list. Remove the `submitPtRequest`/`mockPartnerLookup` imports from `pt-requests-mock`.
- 2-on-1 partner lookup: call the live `partner-lookup` helper instead of `mockPartnerLookup`; keep the same `partnerLookup` state machine.

- [ ] **Step 3: Typecheck + build**

Run: `cd fe-client && npx tsc --noEmit && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add fe-client/src/lib/pt-sessions.ts "fe-client/src/app/(client)/private-sessions/page.tsx"
git commit -m "feat(fe-client): PT request form validates typed credits + submits live"
```

---

## Task 12: FE — account list/cancel live; remove mock

**Files:**
- Modify: `fe-client/src/app/(client)/account/private-sessions/page.tsx`
- Delete: `fe-client/src/lib/pt-requests-mock.ts`

- [ ] **Step 1: Wire the account list + cancel to live endpoints**

Read `account/private-sessions/page.tsx` and `pt-requests-mock.ts` to learn the current data shape and the tab/cancel UI. Replace the mock-store reads with the live `GET /me/pt-sessions/` helper (map snake_case → the view-model the page renders), and wire the cancel action to the live `POST /me/pt-sessions/:id/cancel` helper, refetching the list and (if exposed) calling the packages `refetch()` afterward so the refunded credit shows. Keep the existing tabs/empty-state/`?submitted=1` behavior.

- [ ] **Step 2: Remove the mock module**

After confirming nothing imports it (`grep -r "pt-requests-mock" fe-client/src`), delete `fe-client/src/lib/pt-requests-mock.ts`.

- [ ] **Step 3: Typecheck + build**

Run: `cd fe-client && npx tsc --noEmit && npm run build`
Expected: success, no remaining references to the mock.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(fe-client): account PT list/cancel go live; drop pt-requests mock"
```

---

## Final verification

- [ ] `npm run typecheck --prefix be` → clean.
- [ ] `cd fe-client && npx tsc --noEmit && npm run build` → clean.
- [ ] Manual end-to-end (running app, against a DB with migration 0012 applied): buy a 1-on-1 PT package → `/private-sessions` shows `1-on-1` balance; submit a 1-on-1 request → balance decrements, request appears in `account/private-sessions`; cancel the pending request → credit refunded; attempt a 2-on-1 with no 2-on-1 package → buy-prompt names the 2-on-1 credit; let a package reach 0 → it drops from the active wallet (`active=false`).

---

## Notes / deviations from spec

- **Added `pt_requests.debited_client_package_id`** (not in the original spec) — required to refund the *exact* package on cancel, as the spec's Section 4 demands ("refund 1 to the originating package"). It rides in migration 0012.
- **`expirePackages` reused** instead of a new `deactivateExpiredPackages` job — the daily cron already exists and was a stub; implementing it there satisfies Section 6 with no new registration.
- **Admin scheduling/cancel, `expireStaleSessions`, Stripe-refund revocation, and class-booking consumption remain out of scope** (per spec) and stay 501/TODO.
