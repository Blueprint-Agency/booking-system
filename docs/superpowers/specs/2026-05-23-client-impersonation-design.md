# Client Impersonation (Superadmin) — Design

**Status:** Approved 2026-05-23
**Scope:** fe-portal + fe-client + be
**Related:** existing staff→staff impersonation (`be/src/middleware/impersonate.ts`), spec §0.9

## Problem

Superadmins need to reproduce client-side issues, walk a member through a flow, and see exactly what a specific client sees. fe-portal already lets superadmin impersonate a studio admin (same Clerk app, header-based). This spec adds **staff → client impersonation**, which crosses Clerk-app boundaries (`CLERK_STAFF_*` vs `CLERK_CLIENT_*`) and therefore needs a different mechanism.

## User-visible behavior

1. Superadmin opens `/admin/clients` in fe-portal. Each row has an **Access** button (visible only when `staffRow.role === 'superadmin'`).
2. Clicking Access opens a **new browser tab** at fe-client, already signed in as that client.
3. A persistent red banner sits at the top of every fe-client page: `Impersonating Jane Doe · Stop impersonating`.
4. The superadmin has **full access** — every action the client could perform, including Stripe checkout, waiver signing, profile edits, bookings. No per-endpoint blocklist.
5. Clicking **Stop impersonating** signs out of the Clerk client app, clears the impersonation cookie, and closes the tab (best-effort `window.close`).
6. Every mutating BE call made while impersonating writes one `audit_log` row with `actorStaffId = <superadmin>` and `payload.impersonatedClientId = <client>`.

Out of scope for v1:
- Active grant revocation (rely on 1h expiry + signOut).
- A separate impersonation activity feed (audit_log queryable directly).
- Per-endpoint blocklist.
- Launching impersonation from the client profile page (only the list).

## Architecture

```
fe-portal                    BE                          fe-client
   |                          |                              |
   |--POST /portal/admin/----->| superadmin check            |
   |  clients/:id/impersonate |  Clerk.signInTokens.create  |
   |                          |  sign HS256 grant JWT       |
   |<-- {ticket, grant, url}--|                              |
   |                          |                              |
   |  window.open(url, _blank) ----------------------------->|
   |                          |                              | GET /__impersonate?ticket&grant
   |                          |                              | exchange ticket -> Clerk session
   |                          |                              | set __imp_grant cookie
   |                          |                              | 302 -> /account
   |                          |                              |
   |                          |<--Authorization: Bearer ----| every API call
   |                          |   + x-impersonation-grant   |
   |                          |  audit row: actor=sas,      |
   |                          |  payload.impersonatedClientId
```

Two layers of trust:
- **Clerk sign-in token** (`ticket`, 60s TTL, single-use) — establishes the *client-app session* in the browser. Without this, fe-client wouldn't know it's signed in as the target user.
- **BE-signed grant JWT** (`grant`, 1h TTL) — proves to the BE that this request is an impersonation and carries the superadmin's staff id for audit. The Clerk client JWT alone cannot carry this — fe-client is using the *target client's* Clerk session, not the superadmin's.

## Components

### BE

**New:** `be/src/lib/impersonation-grant.ts`
- `signGrant({ clientUserId, superadminStaffId }): string` — HS256 JWT, payload `{ sub: clientUserId, sas: superadminStaffId, exp: now+3600, jti: uuid }`, signed with `env.IMPERSONATION_SECRET`.
- `verifyGrant(jwt): { sub, sas } | null` — returns null on any failure (signature, exp, malformed). Never throws.

**New:** `be/src/services/impersonation/mint.ts`
- `mintClientImpersonation({ clientId, superadminStaffId }): Promise<{ ticket, grant, feClientUrl }>` — looks up the client, asserts `client.clerkUserId` exists (else throws `client_not_provisioned`), calls `clerkClientApp.signInTokens.createSignInToken({ userId: clerkUserId, expiresInSeconds: 60 })`, signs a grant, builds `feClientUrl = ${CLIENT_ORIGIN}/__impersonate?ticket=${ticket}&grant=${grant}`. Throws `client_origin_not_configured` if `CLIENT_ORIGIN` is unset.

**New:** `be/src/routes/portal/admin/impersonate.ts`
- `POST /portal/admin/clients/:id/impersonate` — wired under the existing `/portal/admin` Hono app. Requires `staffRow.role === 'superadmin'` (403 otherwise). Calls `mintClientImpersonation`, returns `{ ticket, grant, fe_client_url }` (snake_case). 422 if `client_not_provisioned`. Sets `auditTarget = { table: 'clients', id }` so the mint itself is audited.

**New:** `be/src/middleware/client-impersonation.ts`
- Reads `x-impersonation-grant` header. If absent → `next()`. If present → `verifyGrant`; if invalid → log a warn and `next()` (graceful, no 4xx). If valid → assert `grant.sub === clientUserId` (the authenticated client); on mismatch → 401 (`impersonation_subject_mismatch`). On match → `c.set('impersonatedBy', grant.sas); c.set('impersonatedClientId', grant.sub)`.
- Mount on the client router *after* `clerkClientAuth`, before any handler.

**Modify:** `be/src/middleware/clerk-staff.ts` — extend `ContextVariableMap` with `impersonatedClientId?: string` (the existing `impersonatedBy?: string` is already declared and reusable across audiences).

**Modify:** `be/src/middleware/audit.ts` — currently only fires when `staffRow` is set. Add a parallel branch: if no `staffRow` but `impersonatedBy` is set (client-side impersonation case), write a row with `actorStaffId = impersonatedBy`, `actorType = 'staff'`, `targetTable = c.get('auditTarget')?.table ?? c.req.path`, `payload = { method, path, impersonatedClientId }`. Refactor the existing branch so both cases share one `db.insert`.

**Modify:** `be/src/env.ts` — add `IMPERSONATION_SECRET: z.string().min(32)` (required). Sync with `.env.example` and `.github/workflows/deploy-be.yml` per `CLAUDE.md` convention (required-settings comment block + `echo "IMPERSONATION_SECRET=..."` line).

**Wiring:** in `be/src/routes/portal/index.ts`, mount the new impersonate route. In `be/src/routes/client/index.ts` (or wherever the client router composes), mount `clientImpersonation` middleware after `clerkClientAuth` and before route handlers.

### fe-portal

**Modify:** `fe-portal/src/app/admin/clients/page.tsx`
- Pull `role` from `useWorkspace()`.
- For each row, when `role === 'superadmin'` and the client `status === 'active'`, render an **Access** button (small, secondary variant, `KeyRound` icon from lucide) at the start of the row's action area.
- Onclick: `api.post('/portal/admin/clients/:id/impersonate', {})` → on success, `window.open(res.fe_client_url, '_blank', 'noopener')`. On `ApiError` 422, `toast.error("This client hasn't activated their account yet.")`; on 403, `toast.error("Only superadmins can impersonate.")`; otherwise generic network toast.

### fe-client

**New:** `fe-client/src/app/__impersonate/route.ts` (Next.js Route Handler, GET)
- Reads `ticket`, `grant` from URL. If either missing → 400.
- Uses Clerk client SDK server-side to convert the ticket into an active session. With Next 16 + `@clerk/nextjs`, this is done by redirecting through Clerk's sign-in flow with `__clerk_ticket=<ticket>&__clerk_status=sign_in` so the existing middleware picks it up. (Exact integration confirmed during implementation against current `@clerk/nextjs` docs.)
- Sets cookie `__imp_grant` = `<grant JWT>`, attributes: `httpOnly`, `secure`, `sameSite=lax`, `maxAge=3600`, `path=/`.
- 302 → `/account`.

**New:** `fe-client/src/components/impersonation-banner.tsx`
- Server component: reads `__imp_grant` cookie. If absent → render `null`.
- If present: fixed top bar, full width, `bg-red-600 text-white`, h-10, z-50: text `Impersonating <name> · ` + a form posting to `/__stop-impersonating` with a `<button>` styled as a link `Stop impersonating`.
- Name resolution: pass current client name in from the root layout (already fetched for the header). If unavailable, show `this client`.

**Modify:** root layout (`fe-client/src/app/layout.tsx` or the `(client)` group layout) — render `<ImpersonationBanner />` above all content; when active, add `pt-10` to the main wrapper to avoid overlap. Read decision: keep the shim conditional via a server-side cookie check in the same layout.

**Modify:** API fetch wrapper (whichever file owns `fetch` against the BE — likely `fe-client/src/lib/api.ts` or `src/proxy.ts`). On every request, if `document.cookie` contains `__imp_grant` (client-side) or the cookie is forwarded (server-side), attach header `x-impersonation-grant: <value>`.

**New:** `fe-client/src/app/__stop-impersonating/route.ts` (POST)
- Signs out of Clerk (`auth().signOut()` or the equivalent in current `@clerk/nextjs`).
- Clears `__imp_grant` cookie (set with maxAge=0).
- Returns an HTML response that does `window.close()` then falls back to redirecting to `about:blank` so the closed tab is visually clean if the browser blocks `close()`.

## Data flow — one mutating request during impersonation

1. fe-client calls `POST /api/v1/me/bookings` with `Authorization: Bearer <client JWT>` and `x-impersonation-grant: <BE JWT>`.
2. `clerkClientAuth` verifies the client JWT → resolves to `clientUserId`.
3. `clientImpersonation` middleware verifies the grant, confirms `sub === clientUserId`, sets `impersonatedBy=<sas>`, `impersonatedClientId=<clientUserId>`.
4. Handler runs as the client. Same code path as a real client booking — no business-logic branches.
5. `audit` middleware writes one row: `actorStaffId=sas, actorType='staff', action='POST /api/v1/me/bookings', targetTable=...(from auditTarget), payload={method, path, impersonatedClientId}`.

## Error handling

| Case | Behavior |
|---|---|
| Grant JWT expired or bad signature | Header ignored. Treated as a normal client request. (Graceful — a stale tab shouldn't 4xx the user.) |
| Grant `sub` ≠ authenticated client | 401 `impersonation_subject_mismatch`. Indicates the grant was minted for a different client than the current session — likely tampering or two overlapping impersonations. |
| Ticket already consumed at exchange | fe-client `__impersonate` route shows "This link has already been used. Return to portal and click Access again." (Plain HTML, no SPA shell.) |
| Client has no `clerk_user_id` (invited but never signed up) | Mint endpoint returns 422 `client_not_provisioned`. fe-portal toasts "This client hasn't activated their account yet." |
| Mint endpoint called by non-superadmin | 403 `impersonation_requires_superadmin`. |
| `IMPERSONATION_SECRET` not set on boot | Zod env validation fails at startup — service won't start. (Same pattern as other required env.) |

## Security notes

- Grant JWT signing key is server-only (`IMPERSONATION_SECRET`) and never exposed to fe-portal/fe-client. The cookie holds the grant verbatim — it's only useful to the BE.
- Grant is `httpOnly` so XSS in fe-client cannot exfiltrate it. The Clerk client session is unaffected by exfiltration (Clerk handles its own session cookies).
- 1h expiry caps blast radius. No revocation table in v1 — superadmin clicking Stop signs out of Clerk client, which makes the session unusable even if the grant cookie were copied out.
- The grant carries `superadminStaffId` opaquely (UUID). Audit log binds the staff id to a name via existing `staff_users` join.
- Mint endpoint goes through the existing audit middleware → every `Access` click is recorded with `targetTable='clients', targetId=<client>`.

## Testing

Per memory `project_no_be_test_infra`, no Vitest in `be/`. Verify with:

- `npm run typecheck --prefix be` after BE changes.
- `cd fe-portal && npm run build` + `tsc --noEmit` after fe-portal changes.
- `cd fe-client && npx tsc --noEmit && npm run build` after fe-client changes.
- Manual smoke walkthrough:
  1. Sign in to fe-portal as superadmin.
  2. /admin/clients → Access on an active client with a `clerk_user_id`.
  3. New tab opens at fe-client; verify red banner shows the right name.
  4. Book a class as the client; observe `audit_log` has a row with `actor_staff_id = <superadmin>` and `payload.impersonatedClientId = <client>`.
  5. Click Stop impersonating; tab closes (or shows about:blank).
  6. Sign in to fe-portal as a studio admin (non-superadmin); verify Access button is not rendered; verify direct curl to mint endpoint returns 403.

## Files changed

**BE — new:**
- `be/src/lib/impersonation-grant.ts`
- `be/src/services/impersonation/mint.ts`
- `be/src/routes/portal/admin/impersonate.ts`
- `be/src/middleware/client-impersonation.ts`

**BE — modified:**
- `be/src/env.ts` (add `IMPERSONATION_SECRET`)
- `be/src/middleware/audit.ts` (add client-side branch)
- `be/src/middleware/clerk-staff.ts` (extend `ContextVariableMap`)
- `be/src/routes/portal/index.ts` (mount route)
- `be/src/routes/client/index.ts` (mount middleware)
- `be/.env.example` (add `IMPERSONATION_SECRET`)
- `.github/workflows/deploy-be.yml` (add `IMPERSONATION_SECRET` to required-settings comment and `.env.booking-be` write block)

**fe-portal — modified:**
- `fe-portal/src/app/admin/clients/page.tsx` (Access button)

**fe-client — new:**
- `fe-client/src/app/__impersonate/route.ts`
- `fe-client/src/app/__stop-impersonating/route.ts`
- `fe-client/src/components/impersonation-banner.tsx`

**fe-client — modified:**
- `fe-client/src/app/layout.tsx` (or `(client)/layout.tsx` — mount banner + conditional pt-10)
- `fe-client/src/lib/api.ts` (attach `x-impersonation-grant` header)

## Open items deferred to implementation

- Exact Clerk ticket-exchange call shape (`__clerk_ticket` URL param vs server SDK call) — confirm against current `@clerk/nextjs` docs at implementation time. Both routes exist; we pick the one that fits Next 16 cleanly.
- Whether the API wrapper lives in `src/lib/api.ts` or is colocated with `src/proxy.ts` — discovered during implementation; doesn't change the design.
