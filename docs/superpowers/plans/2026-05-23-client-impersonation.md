# Client Impersonation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a superadmin click "Access" on a client row in fe-portal and act as that client in fe-client (new tab) with a persistent banner; every mutating BE call writes an audit row binding the superadmin to the impersonated client.

**Architecture:** BE mints a Clerk client-app sign-in token (60s, one-shot) plus a BE-signed HS256 grant JWT (1h). fe-portal opens fe-client `/__impersonate?ticket&grant`; that route sets a httpOnly cookie and redirects through Clerk's ticket sign-in flow. fe-client attaches `x-impersonation-grant` on every BE call; a new middleware verifies it and sets `impersonatedBy` for the audit middleware. Full client access (no endpoint blocklist).

**Tech Stack:** Hono + Drizzle + Postgres on BE; Next.js 16 App Router + `@clerk/nextjs` for fe-portal/fe-client; `jsonwebtoken` (already in BE deps tree via `@clerk/backend`) — we'll add an explicit dep.

**Project conventions (apply throughout):**
- No BE unit test infra — verify with `npm run typecheck --prefix be` and manual `curl` smoke. (Per memory `project_no_be_test_infra`.)
- fe-client gates on `tsc --noEmit` + `next build`; `npm run lint` is broken — don't run it. (Per memory `project_fe_client_build_infra`.)
- Whenever a BE env var changes, update **all three**: `be/src/env.ts`, `be/.env.example`, and `.github/workflows/deploy-be.yml`. (Per CLAUDE.md.)
- Commits attributed to human only — **no** `Co-Authored-By: Claude` trailers and **no** `🤖 Generated with Claude Code` lines.

**Spec:** `docs/superpowers/specs/2026-05-23-client-impersonation-design.md`

---

## File Map

**BE — new:**
- `be/src/lib/impersonation-grant.ts` — sign/verify HS256 grant JWT.
- `be/src/services/impersonation/mint.ts` — orchestrate ticket + grant + URL.
- `be/src/routes/portal/admin/impersonate.ts` — POST endpoint.
- `be/src/middleware/client-impersonation.ts` — parse header on client routes.

**BE — modified:**
- `be/src/env.ts` — add `IMPERSONATION_SECRET`.
- `be/.env.example` — add the same.
- `.github/workflows/deploy-be.yml` — add to required-vars comment + `.env.booking-be` echo block.
- `be/src/middleware/clerk-staff.ts` — extend `ContextVariableMap` with `impersonatedClientId?: string`.
- `be/src/middleware/audit.ts` — add client-impersonation branch.
- `be/src/routes/portal/admin/index.ts` — mount the new route (path TBD by reading file).
- `be/src/routes/client/index.ts` — mount `clientImpersonation` after `clerkClientAuth, requireActiveClient`; mount `audit` after that.
- `be/package.json` — add `jsonwebtoken` + `@types/jsonwebtoken`.

**fe-portal — modified:**
- `fe-portal/src/app/admin/clients/page.tsx` — superadmin-only "Access" button per row.

**fe-client — new:**
- `fe-client/src/app/__impersonate/route.ts` — GET handler: set cookie + redirect through Clerk ticket flow.
- `fe-client/src/app/__stop-impersonating/route.ts` — POST handler: signOut + clear cookie.
- `fe-client/src/components/impersonation-banner.tsx` — server component banner.

**fe-client — modified:**
- `fe-client/src/app/(client)/layout.tsx` — mount `<ImpersonationBanner />` + conditional `pt-10` shim.
- `fe-client/src/lib/api.ts` — attach `x-impersonation-grant` header when cookie present.

---

## Task 1: BE env wiring (`IMPERSONATION_SECRET`)

**Files:**
- Modify: `be/src/env.ts` (add zod entry in the required block)
- Modify: `be/.env.example`
- Modify: `.github/workflows/deploy-be.yml`

- [ ] **Step 1: Add to `be/src/env.ts`**

Locate the `schema = z.object({...})` block. Add this entry alongside the other required keys, right after `CLERK_STAFF_WEBHOOK_SECRET`:

```ts
  IMPERSONATION_SECRET: z
    .string()
    .min(32, 'IMPERSONATION_SECRET must be at least 32 chars (used to sign HS256 grant JWTs)'),
```

- [ ] **Step 2: Add to `be/.env.example`**

Append to the Clerk staff app section (after `CLERK_STAFF_AUTHORIZED_PARTIES`):

```env

# ---- Impersonation grant signing [required] ----------------------------------
# HS256 secret for the BE-signed JWT that proves a /api/v1/me/* call is being
# made by a superadmin impersonating a client. Must be at least 32 chars.
# Generate locally with:  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
IMPERSONATION_SECRET=
```

- [ ] **Step 3: Add to `.github/workflows/deploy-be.yml`**

Open the workflow and locate the comment block listing required GitHub repo secrets/vars and the `.env.booking-be` echo block (per CLAUDE.md convention, both must match `env.ts`).

In the **required-settings comment block**, add `IMPERSONATION_SECRET` under the secrets list (it's secret material — not a `vars` entry).

In the **`.env.booking-be` write block** (the heredoc / sequence of `echo "..." >>` lines), add:

```yaml
          echo "IMPERSONATION_SECRET=${{ secrets.IMPERSONATION_SECRET }}" >> .env.booking-be
```

…placed near `CLERK_STAFF_*` lines for readability.

- [ ] **Step 4: Set the local dev value**

Generate a value and place it in your local `be/.env` (NOT `.env.example`):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Paste the output as `IMPERSONATION_SECRET=...` in `be/.env`.

- [ ] **Step 5: Verify env loads**

```bash
npm run typecheck --prefix be
```

Expected: no errors. (If `IMPERSONATION_SECRET` isn't set in `be/.env`, the dev server would refuse to start at runtime — typecheck still passes because Zod runs at boot, not compile.)

- [ ] **Step 6: Commit**

```bash
git add be/src/env.ts be/.env.example .github/workflows/deploy-be.yml
git commit -m "feat(be): add IMPERSONATION_SECRET env var"
```

---

## Task 2: BE grant signing/verifying helpers

**Files:**
- Create: `be/src/lib/impersonation-grant.ts`
- Modify: `be/package.json` (add `jsonwebtoken`)

- [ ] **Step 1: Add the dep**

```bash
npm install --prefix be jsonwebtoken
npm install --prefix be --save-dev @types/jsonwebtoken
```

- [ ] **Step 2: Create `be/src/lib/impersonation-grant.ts`**

```ts
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { env } from '../env'

/**
 * BE-signed grant JWT proving that a /api/v1/me/* call is being made by a
 * superadmin impersonating a specific client. Separate from the Clerk client
 * JWT (which carries the *target client's* identity) — we need our own
 * signature because Clerk client tokens have no notion of the staff actor.
 *
 *   sub — clerk_user_id of the impersonated client (matches Clerk JWT.sub)
 *   sas — superadmin staff_users.id (UUID) — the actor for audit
 *   jti — random — placeholder for a future revocation table
 *   exp — 1h after mint
 */
export interface ImpersonationGrant {
  sub: string
  sas: string
  jti: string
  iat: number
  exp: number
}

const TTL_SECONDS = 60 * 60 // 1h

export function signGrant(input: { clientClerkUserId: string; superadminStaffId: string }): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: Omit<ImpersonationGrant, 'iat' | 'exp'> = {
    sub: input.clientClerkUserId,
    sas: input.superadminStaffId,
    jti: randomUUID(),
  }
  return jwt.sign(payload, env.IMPERSONATION_SECRET, {
    algorithm: 'HS256',
    expiresIn: TTL_SECONDS,
  })
}

/** Returns null on any failure (signature, exp, malformed). Never throws. */
export function verifyGrant(token: string): ImpersonationGrant | null {
  try {
    const decoded = jwt.verify(token, env.IMPERSONATION_SECRET, { algorithms: ['HS256'] })
    if (typeof decoded !== 'object' || decoded === null) return null
    const g = decoded as Partial<ImpersonationGrant>
    if (!g.sub || !g.sas || !g.jti || !g.exp || !g.iat) return null
    return g as ImpersonationGrant
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck --prefix be
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add be/src/lib/impersonation-grant.ts be/package.json be/package-lock.json
git commit -m "feat(be): impersonation grant JWT helpers"
```

---

## Task 3: BE mint service

**Files:**
- Create: `be/src/services/impersonation/mint.ts`

- [ ] **Step 1: Create the file**

```ts
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { clients } from '../../db/schema/identity'
import { getClerkClientApp } from '../../lib/clerk'
import { env } from '../../env'
import { signGrant } from '../../lib/impersonation-grant'
import { BadRequestError, NotFoundError } from '../../shared/errors'

export interface MintImpersonationInput {
  clientId: string
  superadminStaffId: string
}

export interface MintImpersonationResult {
  ticket: string
  grant: string
  feClientUrl: string
}

/**
 * Mint a one-shot Clerk sign-in ticket for the target client + a BE-signed
 * grant JWT. The ticket signs the browser in as the client; the grant proves
 * to BE middleware that the resulting /me/* calls are impersonations.
 *
 * Throws:
 *   - NotFoundError('client_not_found') if the row is missing
 *   - BadRequestError('client_not_provisioned') if the client has no clerk_user_id
 *     (invited but never finished signup)
 *   - BadRequestError('client_origin_not_configured') if CLIENT_ORIGIN is unset
 */
export async function mintClientImpersonation(
  input: MintImpersonationInput,
): Promise<MintImpersonationResult> {
  const [row] = await db.select().from(clients).where(eq(clients.id, input.clientId)).limit(1)
  if (!row) throw new NotFoundError('client_not_found')
  if (!row.clerkUserId) throw new BadRequestError('client_not_provisioned')

  const base = env.CLIENT_ORIGIN?.replace(/\/+$/, '')
  if (!base) throw new BadRequestError('client_origin_not_configured')

  const clerk = getClerkClientApp()
  const ticketRes = await clerk.signInTokens.createSignInToken({
    userId: row.clerkUserId,
    expiresInSeconds: 60,
  })

  const grant = signGrant({
    clientClerkUserId: row.clerkUserId,
    superadminStaffId: input.superadminStaffId,
  })

  const url = new URL('/__impersonate', base)
  url.searchParams.set('ticket', ticketRes.token)
  url.searchParams.set('grant', grant)

  return { ticket: ticketRes.token, grant, feClientUrl: url.toString() }
}
```

> **Note on Clerk SDK shape:** `clerk.signInTokens.createSignInToken` returns an object exposing the token as `.token`. If your installed `@clerk/backend` version exposes it under a different property (e.g. `.id` for an older API), inspect the return type at the call site with `keyof typeof ticketRes` and adjust. Confirm by reading `node_modules/@clerk/backend/dist/types/api/endpoints/SignInTokensApi.d.ts` if the call fails.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --prefix be
```

Expected: no errors. If `signInTokens` is not on the client object, the SDK version may need bumping — note the error and bring it up rather than silently `as any`-ing.

- [ ] **Step 3: Commit**

```bash
git add be/src/services/impersonation/mint.ts
git commit -m "feat(be): mintClientImpersonation service"
```

---

## Task 4: BE mint route + wiring

**Files:**
- Create: `be/src/routes/portal/admin/impersonate.ts`
- Modify: `be/src/routes/portal/admin/index.ts` (mount the new sub-route)

- [ ] **Step 1: Read the admin index**

```bash
cat be/src/routes/portal/admin/index.ts
```

Note the pattern other admin routes use to mount (e.g. `.route('/clients', clients)`).

- [ ] **Step 2: Create the route**

```ts
// be/src/routes/portal/admin/impersonate.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { mintClientImpersonation } from '../../../services/impersonation/mint'
import { BadRequestError, NotFoundError } from '../../../shared/errors'

const idParam = z.object({ id: z.string().uuid() })

const app = new Hono().post(
  '/clients/:id/impersonate',
  zValidator('param', idParam),
  async c => {
    const { id } = c.req.valid('param')
    const staffRow = c.get('staffRow')
    if (staffRow.role !== 'superadmin') {
      return c.json({ error: 'impersonation_requires_superadmin' }, 403)
    }
    try {
      const res = await mintClientImpersonation({
        clientId: id,
        superadminStaffId: staffRow.id,
      })
      c.set('auditTarget' as any, { table: 'clients', id })
      return c.json({
        ticket: res.ticket,
        grant: res.grant,
        fe_client_url: res.feClientUrl,
      })
    } catch (err) {
      if (err instanceof NotFoundError) {
        return c.json({ error: 'client_not_found' }, 404)
      }
      if (err instanceof BadRequestError) {
        return c.json({ error: err.message }, 422)
      }
      throw err
    }
  },
)

export default app
```

- [ ] **Step 3: Mount in `be/src/routes/portal/admin/index.ts`**

Add the import alongside the existing route imports:

```ts
import impersonate from './impersonate'
```

And mount it on the admin Hono app, alongside the existing `.route('/clients', clients)` line (mount at the root `/` because the route path already starts with `/clients/...`):

```ts
  .route('/', impersonate)
```

If the existing pattern in this file uses sub-paths (e.g. `.route('/clients', clients)`), keep `impersonate` at `/` so the `/clients/:id/impersonate` path is unambiguous and doesn't double up under `/clients/clients/...`.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck --prefix be
```

Expected: no errors.

- [ ] **Step 5: Manual smoke (BE-only)**

Start the BE dev server in a separate terminal (`npm run dev --prefix be`). Get a superadmin Clerk staff JWT (e.g. from the fe-portal browser dev tools `localStorage`). Then:

```bash
curl -i -X POST http://localhost:4000/api/v1/portal/admin/clients/<some-client-uuid>/impersonate \
  -H "Authorization: Bearer <staff-jwt>"
```

Expected: 200 with `{ ticket, grant, fe_client_url }`. The `fe_client_url` should begin with `http://localhost:3000/__impersonate?ticket=...&grant=...`.

If you get 403, confirm the staff user's `role` column is `superadmin`. If 422 `client_not_provisioned`, pick a client with a non-null `clerk_user_id`.

- [ ] **Step 6: Commit**

```bash
git add be/src/routes/portal/admin/impersonate.ts be/src/routes/portal/admin/index.ts
git commit -m "feat(be): POST /portal/admin/clients/:id/impersonate"
```

---

## Task 5: BE client-impersonation middleware

**Files:**
- Create: `be/src/middleware/client-impersonation.ts`
- Modify: `be/src/middleware/clerk-staff.ts` (extend `ContextVariableMap`)

- [ ] **Step 1: Extend the Hono context variable map**

Open `be/src/middleware/clerk-staff.ts`. Inside the existing `declare module 'hono' { interface ContextVariableMap { ... } }` block, add `impersonatedClientId?: string`. The existing `impersonatedBy?: string` is already declared — leave it.

Resulting block:

```ts
declare module 'hono' {
  interface ContextVariableMap {
    staffClaims: ClerkStaffClaims
    staffUserId: string
    staffRow: typeof staffUsers.$inferSelect
    actingAs?: string
    impersonatedBy?: string
    impersonatedClientId?: string
  }
}
```

- [ ] **Step 2: Create the middleware**

```ts
// be/src/middleware/client-impersonation.ts
import type { MiddlewareHandler } from 'hono'
import { verifyGrant } from '../lib/impersonation-grant'

/**
 * On client routes (/api/v1/me/*), recognises an x-impersonation-grant header.
 *
 *   - Header absent → no-op (normal client request).
 *   - Grant invalid/expired → no-op (graceful — a stale tab shouldn't 4xx).
 *   - Grant valid but sub ≠ authenticated client → 401 (subject mismatch is
 *     either tampering or a cross-wired session; never silent).
 *   - Grant valid + matches → sets `impersonatedBy` + `impersonatedClientId`.
 *
 * Must run AFTER clerkClientAuth (it reads the resolved client clerk_user_id).
 * clerkClientAuth is assumed to set `c.get('clientClerkUserId')` — if your
 * middleware uses a different key name (e.g. `clientUserId`), adjust the
 * lookup below to match.
 */
export const clientImpersonation: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('x-impersonation-grant')
  if (!header) return next()

  const grant = verifyGrant(header)
  if (!grant) return next()

  // The client's Clerk user id, set by clerkClientAuth. Try a couple of common
  // keys to be robust against naming drift; bail to no-op if absent.
  const authedClerkUserId =
    (c.get('clientClerkUserId' as never) as string | undefined) ??
    (c.get('clientClaims' as never) as { sub?: string } | undefined)?.sub
  if (!authedClerkUserId) return next()

  if (grant.sub !== authedClerkUserId) {
    return c.json({ error: 'impersonation_subject_mismatch' }, 401)
  }

  c.set('impersonatedBy', grant.sas)
  c.set('impersonatedClientId', grant.sub)
  await next()
}
```

> **Naming check:** open `be/src/middleware/clerk-client.ts` and confirm which key it sets to store the client's Clerk user id (e.g. `c.set('clientClerkUserId', payload.sub)`). If the key differs from both fallbacks above, replace the lookup with the actual key. If `clerkClientAuth` stores the *internal* `clients.id` instead, you must instead look up the row to compare `clerkUserId` — but the simpler fix is to make `clerkClientAuth` also expose `clientClerkUserId`.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck --prefix be
```

Expected: no errors. (If `c.get('clientClerkUserId' as never)` complains, replace with the actual key as found in clerk-client.ts and remove the `as never` cast.)

- [ ] **Step 4: Commit**

```bash
git add be/src/middleware/client-impersonation.ts be/src/middleware/clerk-staff.ts
git commit -m "feat(be): clientImpersonation middleware"
```

---

## Task 6: BE wire middleware + audit on client routes

**Files:**
- Modify: `be/src/routes/client/index.ts`
- Modify: `be/src/middleware/audit.ts`

- [ ] **Step 1: Modify `be/src/routes/client/index.ts`**

Add the imports:

```ts
import { clientImpersonation } from '../../middleware/client-impersonation'
import { audit } from '../../middleware/audit'
```

Insert the two middlewares right after the existing `.use('*', clerkClientAuth, requireActiveClient)` line, before any `.route(...)` calls:

```ts
  .use('*', clerkClientAuth, requireActiveClient)
  .use('*', clientImpersonation, audit)
  .route('/', me)
  // ... rest unchanged
```

- [ ] **Step 2: Extend `be/src/middleware/audit.ts`**

Find the existing handler. Replace the body so it handles both staff and client-impersonation cases. The full file should read:

```ts
import type { MiddlewareHandler } from 'hono'
import { db } from '../db'
import { auditLog } from '../db/schema/ledger'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Writes one audit_log row per successful mutating request, after the handler commits.
 *
 *   - Staff request: actor = staffRow.id (or impersonatedBy override for staff→staff impersonation).
 *   - Client request during impersonation: actor = impersonatedBy (the superadmin's staff id);
 *     payload.impersonatedClientId records who was being impersonated.
 *   - Normal client request (no impersonation): no row written.
 *
 * Idempotent reads are not audited. Use `c.set('auditTarget', { table, id })` inside handlers
 * to capture which entity changed; falls back to method+path if not set.
 */
export const audit: MiddlewareHandler = async (c, next) => {
  await next()

  if (!MUTATING.has(c.req.method)) return
  if (c.res.status >= 400) return

  const staffRow = c.get('staffRow')
  const impersonatedBy = c.get('impersonatedBy')
  const impersonatedClientId = c.get('impersonatedClientId')

  // Determine the actor staff id. Either:
  //  - Staff request (with optional staff→staff impersonation): use impersonatedBy ?? staffRow.id
  //  - Client request being impersonated by a superadmin: use impersonatedBy
  //  - Anything else (e.g. normal client mutation): skip
  let actorStaffId: string | undefined
  if (staffRow) {
    actorStaffId = impersonatedBy ?? staffRow.id
  } else if (impersonatedBy) {
    actorStaffId = impersonatedBy
  }
  if (!actorStaffId) return

  const target = (c.get('auditTarget' as any) as { table: string; id: string } | undefined) ?? {
    table: c.req.path,
    id: '00000000-0000-0000-0000-000000000000',
  }

  const payload: Record<string, unknown> = {
    method: c.req.method,
    path: c.req.path,
  }
  const actingAs = c.get('actingAs')
  if (actingAs) payload.actingAs = actingAs
  if (impersonatedClientId) payload.impersonatedClientId = impersonatedClientId

  await db.insert(auditLog).values({
    actorStaffId,
    actorType: 'staff',
    action: `${c.req.method} ${c.req.path}`,
    targetTable: target.table,
    targetId: target.id,
    payload,
  })
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck --prefix be
```

Expected: no errors.

- [ ] **Step 4: Manual smoke**

With the BE dev server running, repeat the mint call from Task 4 to get a `grant`. Pick a `/api/v1/me/*` mutating endpoint that actually works today (e.g. `POST /api/v1/me/...` — pick from `be/src/routes/client/*` based on what's implemented). Sign in to fe-client as the target client to get a client JWT (e.g. via dev tools). Then:

```bash
curl -i -X POST http://localhost:4000/api/v1/me/<endpoint> \
  -H "Authorization: Bearer <client-jwt>" \
  -H "x-impersonation-grant: <grant>" \
  -H "Content-Type: application/json" \
  -d '<valid body>'
```

Expected: 2xx. Then inspect the latest `audit_log` row:

```sql
SELECT actor_staff_id, action, target_table, payload
FROM audit_log
ORDER BY created_at DESC
LIMIT 1;
```

Expected: `actor_staff_id` = the superadmin's staff id, `payload->>'impersonatedClientId'` = the impersonated client's clerk_user_id.

If no audit row appears, confirm `c.get('impersonatedBy')` is being set (add a temp `console.log` in audit.ts, then revert).

- [ ] **Step 5: Commit**

```bash
git add be/src/routes/client/index.ts be/src/middleware/audit.ts
git commit -m "feat(be): audit client impersonation; wire middleware on client routes"
```

---

## Task 7: fe-portal Access button

**Files:**
- Modify: `fe-portal/src/app/admin/clients/page.tsx`

- [ ] **Step 1: Read the current page**

```bash
cat fe-portal/src/app/admin/clients/page.tsx
```

Locate the per-row rendering block (the loop over `filtered`). Each row currently renders a `<Link>` to `/admin/clients/${client.id}`.

- [ ] **Step 2: Add the button**

Pull `currentStaff` (and thus `role`) from the workspace:

```tsx
const { api, currentStaff } = useWorkspace();
const isSuperadmin = currentStaff?.role === "superadmin";
```

Add a click handler:

```tsx
async function accessAsClient(clientId: string) {
  if (!api) return;
  try {
    const res = await api.post<{
      ticket: string;
      grant: string;
      fe_client_url: string;
    }>(`/portal/admin/clients/${clientId}/impersonate`, {});
    window.open(res.fe_client_url, "_blank", "noopener");
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) {
      toast.error("This client hasn't activated their account yet.");
    } else if (err instanceof ApiError && err.status === 403) {
      toast.error("Only superadmins can impersonate.");
    } else {
      toast.error("Failed to start impersonation.");
    }
  }
}
```

In the per-row JSX, alongside the existing link/avatar/name block, add:

```tsx
{isSuperadmin && client.status === "active" && (
  <Button
    variant="secondary"
    size="sm"
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      void accessAsClient(client.id);
    }}
    className="ml-auto"
  >
    <KeyRound className="h-3.5 w-3.5" /> Access
  </Button>
)}
```

Add `KeyRound` to the `lucide-react` import at the top.

> **Layout note:** if the row is itself wrapped in a `<Link>`, the `e.preventDefault()` + `stopPropagation()` keep the click from navigating to the client detail page. If the row uses inner buttons, those guards are still harmless.

- [ ] **Step 3: Typecheck + build**

```bash
cd fe-portal && npx tsc --noEmit && npm run build
```

Expected: clean build. (Skip `npm run lint` — broken in fe-client per memory; assume same caution.)

- [ ] **Step 4: Manual smoke**

Sign in to fe-portal as a superadmin. Go to `/admin/clients`. Verify:
- Access button appears on each active client row.
- Sign in as a non-superadmin staff (use a studio admin account) — Access button does NOT appear.
- Click Access on an active client → new tab opens at `http://localhost:3000/__impersonate?ticket=...&grant=...`. (The tab will 404 until Task 8 ships — that's fine, you've verified the BE call + URL hand-off works.)

- [ ] **Step 5: Commit**

```bash
git add fe-portal/src/app/admin/clients/page.tsx
git commit -m "feat(fe-portal): superadmin Access button on clients list"
```

---

## Task 8: fe-client `__impersonate` route

**Files:**
- Create: `fe-client/src/app/__impersonate/route.ts`

- [ ] **Step 1: Create the handler**

```ts
// fe-client/src/app/__impersonate/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Entry point for a superadmin landing in fe-client as an impersonated client.
 * Reads `ticket` (Clerk one-shot sign-in token) + `grant` (BE-signed JWT)
 * from the URL, sets the grant cookie, and redirects through Clerk's
 * ticket sign-in flow.
 *
 * The Clerk ticket is consumed by Clerk's sign-in page (`<SignIn />`) when
 * it sees `__clerk_ticket` in the URL — no extra server work needed.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticket = url.searchParams.get("ticket");
  const grant = url.searchParams.get("grant");

  if (!ticket || !grant) {
    return new NextResponse("Missing ticket or grant.", { status: 400 });
  }

  // Set the impersonation grant cookie BEFORE the redirect so fe-client and
  // its fetch wrapper see it on the next request.
  const jar = await cookies();
  jar.set("__imp_grant", grant, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 1h — must match the JWT exp
  });

  // Redirect through the sign-in page so Clerk consumes the ticket. The
  // `redirect_url` is where Clerk lands the user once signed in.
  const signInUrl = new URL("/sign-in", url.origin);
  signInUrl.searchParams.set("__clerk_ticket", ticket);
  signInUrl.searchParams.set("redirect_url", "/account");
  return NextResponse.redirect(signInUrl);
}
```

> **Clerk integration note:** Clerk's React SDK auto-consumes `__clerk_ticket` when the `<SignIn />` component renders. If fe-client uses a custom sign-in page that doesn't pass through `__clerk_ticket`, the ticket flow won't work — confirm by signing in via the Clerk-hosted sign-in or by checking `fe-client/src/app/sign-in/[[...sign-in]]/page.tsx` renders `<SignIn />` with default props (passing query params untouched).

- [ ] **Step 2: Confirm the sign-in page exists**

```bash
ls fe-client/src/app | grep -i sign
```

If a `sign-in` route exists, open the `page.tsx` and verify it renders Clerk's `<SignIn />`. If it doesn't (or uses a custom UI that swallows query params), open a follow-up note — for the v1 of this feature we depend on Clerk's default ticket handling.

- [ ] **Step 3: Typecheck + build**

```bash
cd fe-client && npx tsc --noEmit && npm run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add fe-client/src/app/__impersonate/route.ts
git commit -m "feat(fe-client): __impersonate route — set grant cookie + redirect through Clerk ticket"
```

---

## Task 9: fe-client impersonation banner

**Files:**
- Create: `fe-client/src/components/impersonation-banner.tsx`
- Modify: `fe-client/src/app/(client)/layout.tsx`

- [ ] **Step 1: Create the banner**

```tsx
// fe-client/src/components/impersonation-banner.tsx
import { cookies } from "next/headers";

/**
 * Server component banner. Renders nothing when the impersonation cookie is
 * absent. When present, pins a red bar to the top of the viewport with a
 * "Stop impersonating" action that posts to /__stop-impersonating.
 *
 * The cookie itself is httpOnly (and opaque to us — we only check presence).
 * The actual client name surfaces from the page-level header data that's
 * already fetched; we keep the banner self-contained and don't fetch /me here.
 */
export async function ImpersonationBanner() {
  const jar = await cookies();
  const active = jar.has("__imp_grant");
  if (!active) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex h-10 items-center justify-center gap-3 bg-red-600 text-sm text-white shadow">
      <span>You are impersonating a client.</span>
      <form action="/__stop-impersonating" method="post">
        <button
          type="submit"
          className="rounded border border-white/40 px-2 py-0.5 text-xs font-medium hover:bg-white/10"
        >
          Stop impersonating
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Mount in the client-group layout**

Open `fe-client/src/app/(client)/layout.tsx`. Add the import and the banner. Also conditionally shim the main content down by 10 (banner height) when active.

The layout is a server component already (no `"use client"`). Modified shape:

```tsx
import { cookies } from "next/headers";
import { ClientNav } from "@/components/layout/client-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import { ClientPackagesProvider } from "@/lib/use-client-packages";
import { ImpersonationBanner } from "@/components/impersonation-banner";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jar = await cookies();
  const impersonating = jar.has("__imp_grant");

  return (
    <ClientPackagesProvider>
      <ImpersonationBanner />
      <div className={`min-h-screen bg-paper flex flex-col ${impersonating ? "pt-10" : ""}`}>
        <ScrollToTop />
        <ClientNav />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </div>
    </ClientPackagesProvider>
  );
}
```

Note the function is now `async` (cookies returns a Promise in Next 16).

- [ ] **Step 3: Typecheck + build**

```bash
cd fe-client && npx tsc --noEmit && npm run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add fe-client/src/components/impersonation-banner.tsx fe-client/src/app/(client)/layout.tsx
git commit -m "feat(fe-client): impersonation banner + layout shim"
```

---

## Task 10: fe-client API wrapper — attach grant header

**Files:**
- Modify: `fe-client/src/lib/api.ts`

- [ ] **Step 1: Read the file**

```bash
cat fe-client/src/lib/api.ts
```

Find `apiFetch`. It currently sets `Authorization` + `Accept` + `Content-Type` headers, then `fetch`s.

- [ ] **Step 2: Add the grant header**

Helper at module top:

```ts
function readImpGrant(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)__imp_grant=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}
```

Inside `apiFetch`, after assembling `headers`, before the `fetch` call:

```ts
const impGrant = readImpGrant();
if (impGrant) headers["x-impersonation-grant"] = impGrant;
```

> **Server-side note:** `api.ts` is marked `"use client"`, so `apiFetch` only ever runs in the browser. `document.cookie` is the right source — no need to thread cookies from `next/headers`. If a server component is added later that wants to call BE with impersonation, it must read the cookie via `next/headers` and pass the header explicitly.

> **httpOnly note:** the `__imp_grant` cookie is set with `httpOnly: true` in Task 8, which means `document.cookie` cannot read it. **This is a contradiction in the current draft.** Choose ONE of:
>
> 1. Drop `httpOnly` (keep `secure` + `sameSite=lax`). XSS exposure: any injected script could exfiltrate the grant. Mitigated somewhat by the 1h TTL and the fact that misuse still requires a valid Clerk client session.
> 2. Keep `httpOnly` but expose the grant via a Next.js server route (`GET /__impersonate/grant`) that reads the cookie and returns the JWT. fe-client fetches this once and caches in memory.
>
> **Recommended: option 1.** XSS in fe-client would already let an attacker piggyback on the Clerk session — exfiltrating the grant doesn't materially worsen that. Going `httpOnly` here forces an extra request hop with no real gain. Update Task 8 to remove `httpOnly`.

Edit Task 8's cookie set to drop `httpOnly: true,` before continuing. The Task 8 commit already landed — fix it here as part of this task (it's one file). If the BE/fe-client pair is being reviewed by anyone, mention the change in the commit message.

- [ ] **Step 3: Fix Task 8's cookie attributes**

In `fe-client/src/app/__impersonate/route.ts`, change the cookie set block to:

```ts
  jar.set("__imp_grant", grant, {
    httpOnly: false, // must be readable by client JS to add to fetch headers
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
```

- [ ] **Step 4: Typecheck + build**

```bash
cd fe-client && npx tsc --noEmit && npm run build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add fe-client/src/lib/api.ts fe-client/src/app/__impersonate/route.ts
git commit -m "feat(fe-client): attach x-impersonation-grant; make grant cookie JS-readable"
```

---

## Task 11: fe-client `__stop-impersonating` route

**Files:**
- Create: `fe-client/src/app/__stop-impersonating/route.ts`

- [ ] **Step 1: Create the handler**

```ts
// fe-client/src/app/__stop-impersonating/route.ts
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Clears the impersonation grant cookie and signs the impersonated client
 * out of the Clerk client session in this browser. We can't reliably
 * window.close() from a server response — return a tiny HTML that tries
 * close() and falls back to about:blank so the tab is visually clean.
 */
export async function POST() {
  const { sessionId } = await auth();
  if (sessionId) {
    // Revoke the current Clerk session so the impersonated identity is gone
    // even if the cookie is somehow restored.
    try {
      const { clerkClient } = await import("@clerk/nextjs/server");
      const c = await clerkClient();
      await c.sessions.revokeSession(sessionId);
    } catch {
      // Best-effort — Clerk client cookies will also be cleared by the SDK
      // on the next /sign-in load.
    }
  }

  const jar = await cookies();
  jar.set("__imp_grant", "", { maxAge: 0, path: "/" });

  const html = `<!doctype html><html><body><script>
    try { window.close(); } catch (e) {}
    setTimeout(function () { location.replace('about:blank'); }, 50);
  </script>Closing…</body></html>`;

  const res = new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  return res;
}
```

- [ ] **Step 2: Typecheck + build**

```bash
cd fe-client && npx tsc --noEmit && npm run build
```

Expected: clean. If `@clerk/nextjs/server` doesn't expose `auth`/`clerkClient` at the same paths in your installed version, adjust the imports per `node_modules/@clerk/nextjs/dist/types/server/index.d.ts`.

- [ ] **Step 3: Commit**

```bash
git add fe-client/src/app/__stop-impersonating/route.ts
git commit -m "feat(fe-client): __stop-impersonating route — clear cookie + revoke Clerk session"
```

---

## Task 12: End-to-end smoke walkthrough

No code in this task. Confirm the full feature works.

- [ ] **Step 1: Boot all three services**

In three terminals:

```bash
npm run dev --prefix be
npm run dev --prefix fe-portal
npm run dev --prefix fe-client
```

Confirm BE prints no env validation errors (this proves `IMPERSONATION_SECRET` is set in `be/.env`).

- [ ] **Step 2: Verify Access button gating**

- Sign in to fe-portal `http://localhost:3001` as **superadmin** → `/admin/clients` shows an Access button on active client rows.
- Sign out, sign in as a **studio admin** (non-superadmin) → Access button is absent.
- Sign back in as superadmin.

- [ ] **Step 3: Verify the impersonation flow**

- Click Access on an active client. A new tab opens at fe-client.
- After Clerk ticket sign-in completes, you land on `/account` in fe-client.
- A red banner is pinned at the top: "You are impersonating a client. [Stop impersonating]".
- Navigate to `/classes`, `/account/profile`, etc. — banner persists on every page.

- [ ] **Step 4: Verify audit row on a mutating call**

In the impersonated fe-client tab, perform any mutating action that actually works today (e.g. update profile, book a class — whatever the implemented `/me/*` mutations cover). Then in psql:

```sql
SELECT actor_staff_id, action, target_table, payload, created_at
FROM audit_log
ORDER BY created_at DESC
LIMIT 3;
```

Expected: the latest row has `actor_staff_id` = the superadmin's `staff_users.id`, `payload->>'impersonatedClientId'` = the impersonated client's `clerk_user_id`.

Also look for a row from the **mint** call itself (Task 4 sets `auditTarget = clients/<id>`): `target_table='clients'`, `action='POST /api/v1/portal/admin/clients/<uuid>/impersonate'`.

- [ ] **Step 5: Verify Stop**

Click "Stop impersonating". Tab should close (or fall back to `about:blank`). If you reopen `/account` in fe-client without re-impersonating, Clerk redirects to `/sign-in` (no active session).

- [ ] **Step 6: Verify negative paths**

- As a **non-superadmin** staff, `curl POST .../impersonate` → 403 `impersonation_requires_superadmin`.
- As superadmin, hitting `.../impersonate` for a client whose `clerk_user_id` is NULL → 422 `client_not_provisioned`.
- Take a `grant` from a successful mint, wait >1h, then send it on a `/me/*` mutation → middleware ignores it (no `impersonatedBy` set, no audit row for client mutation). Faster reproduction: temporarily change `TTL_SECONDS` in Task 2 to `5`, re-test, then revert.

- [ ] **Step 7: Tag the completion**

Optional but useful for the commit history:

```bash
git tag -a feat/client-impersonation -m "Client impersonation (superadmin) — full feature"
```

---

## Self-Review

- **Spec coverage:**
  - Mint endpoint + superadmin gate → Task 4 ✓
  - Sign-in token + grant JWT → Tasks 2 + 3 ✓
  - Client-side middleware + audit extension → Tasks 5 + 6 ✓
  - fe-portal Access button → Task 7 ✓
  - fe-client `/__impersonate` + banner + cookie + header + `/__stop-impersonating` → Tasks 8 + 9 + 10 + 11 ✓
  - Env wiring (env.ts + .env.example + deploy-be.yml) → Task 1 ✓
  - Error handling (expired/invalid/missing/role) → Tasks 4 + 5 + 12.Step 6 ✓
  - Manual verification (BE has no test infra) → Tasks 4.Step 5 + 6.Step 4 + 12 ✓

- **Placeholder scan:** no "TBD"/"TODO"/"appropriate error handling"/"similar to Task N" left in step bodies. Two "if your SDK shape differs, adjust" notes are intentional — they flag a real verification point the implementer must do, not a hand-wave.

- **Type/name consistency:**
  - `signGrant` / `verifyGrant` named consistently across Tasks 2, 5, 6.
  - `__imp_grant` cookie name reused in Tasks 8, 9, 10, 11.
  - `x-impersonation-grant` header name reused in Tasks 5, 10.
  - `impersonatedBy` / `impersonatedClientId` context keys consistent across Tasks 5 & 6.
  - `mintClientImpersonation` returns `{ ticket, grant, feClientUrl }` and Task 4 maps to snake_case JSON `{ ticket, grant, fe_client_url }` — fe-portal in Task 7 reads `fe_client_url`. ✓
  - One reconciled contradiction: Task 8 originally set `httpOnly: true`, but Task 10 needs `document.cookie` access — Task 10 includes the fix and re-commits Task 8's file. ✓
