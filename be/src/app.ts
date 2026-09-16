import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { rateLimiter } from 'hono-rate-limiter'
import { sql } from 'drizzle-orm'
import { db } from './db'
import { originAllowed } from './lib/allowed-origins'
import { errorBoundary, onAppError } from './middleware/error'
import { requestId } from './middleware/request-id'
import { requestLogger } from './middleware/logger'
import { resolveTenant } from './middleware/tenant'

import { requireActiveTenant } from './middleware/require-active-tenant'
import {
  AUTH_BASE_PATH,
  authPools,
  type AuthPool,
  type AuthPoolHandler,
} from './services/auth/better-auth'

import publicRoutes from './routes/public'
import clientRoutes from './routes/client'
import portalRoutes from './routes/portal'
import platformRoutes from './routes/platform'
import webhookRoutes from './routes/webhooks'

const app = new Hono()

app.use('*', requestId)
app.use('*', requestLogger)
app.use('*', errorBoundary)
app.onError(onAppError)
app.use('*', secureHeaders())

// CORS — every tenant subdomain in this environment, plus the single-valued
// origins that predate tenancy. A tenant is created by inserting a row, so its
// origin cannot be listed in advance; `FRONTEND_URLS` carries the
// wildcards and lib/origin.ts does the matching, one label deep. The same
// allowlist backs the auth pools' trusted origins and the public-route slug
// validation — see lib/allowed-origins.ts.
//
// Sessions travel as bearer tokens, not cookies (services/auth/better-auth.ts).
app.use(
  '*',
  cors({
    origin: origin => (originAllowed(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'X-Impersonate-Staff-Id',
      'X-Impersonation-Grant',
      'X-Request-Id',
      'X-Tenant-Slug',
      'X-Two-Factor-Challenge',
    ],
    // Better Auth hands a new session's bearer token back in this header, and a
    // cross-origin page cannot read a header CORS does not expose. The
    // second-factor challenge travels the same way (`two-factor-challenge.ts`).
    exposeHeaders: ['set-auth-token', 'set-two-factor-challenge'],
  }),
)

const publicLimiter = rateLimiter({
  windowMs: 60_000,
  limit: 100,
  keyGenerator: c => c.req.header('x-forwarded-for') ?? 'global',
})
const authedLimiter = rateLimiter({
  windowMs: 60_000,
  limit: 300,
  keyGenerator: c =>
    c.get('clientId') ?? c.get('staffUserId') ?? c.req.header('x-forwarded-for') ?? 'global',
})

// Tenant slug resolution is the one public route on *every* request path — the
// frontend proxies call it per incoming Host header, server-side, so those calls
// carry no `x-forwarded-for` and would all collapse into the single 'global'
// bucket and 429 the whole platform under ordinary traffic. It gets its own,
// much larger budget instead of an exemption.
const TENANT_LOOKUP_PREFIX = '/api/v1/public/tenants/by-slug/'
const isTenantLookup = (path: string) => path.startsWith(TENANT_LOOKUP_PREFIX)
const tenantLookupLimiter = rateLimiter({
  windowMs: 60_000,
  limit: 6_000,
  keyGenerator: c => c.req.header('x-forwarded-for') ?? 'global',
})

app.use('/api/v1/public/*', (c, next) =>
  isTenantLookup(c.req.path) ? tenantLookupLimiter(c, next) : publicLimiter(c, next),
)
app.use('/api/v1/me/*', authedLimiter)
app.use('/api/v1/portal/*', authedLimiter)
app.use('/api/v1/platform/*', authedLimiter)

// Which tenant is this request about? After the rate limiters, so a flood of
// forged slugs is throttled before it reaches the lookup, and before the routes,
// which all read `c.get('tenantId')`.
//
// Three paths are exempt, because resolution now also opens a database
// transaction (see middleware/tenant.ts):
//
//   - `/api/v1/healthz` is a liveness probe, and a liveness probe that needs the
//     database is a liveness probe that fails a deploy for the wrong reason.
//     (`/health` is the one that deliberately checks the database.)
//   - the slug lookup reads only `tenants`, which carries no policy — and it
//     sits on every request the frontends make, at a budget of 6,000/min, so
//     wrapping it would buy a transaction per page view for nothing.
//   - the payment provider's webhook resolves its OWN tenant, off the signed
//     body's payment intent (services/billing/webhook-handler.ts). Opening a
//     context here would wrap the real one in an unrelated transaction and hold
//     two pooled connections for the length of a call to the provider — and,
//     worse, would give an event that names no tenant a tenant anyway. The mail
//     provider's webhook is exempt for the same reason: it reads its tenant off
//     the event's signed tag (services/notifications/delivery-outcomes.ts).
//   - the super portal's own branch is cross-tenant by definition: it lists
//     every studio and creates the ones that do not exist yet, so there is no
//     single tenant to resolve and no honest context to open. Its gate is
//     `requirePlatformAdmin`, which reads no tenant at all. Its auth pool is
//     exempt for the same reason: the super portal signs in on no studio.
//   - a staff password-reset link. It is opened from an inbox, so it carries
//     no `X-Tenant-Slug` and no `Origin`; it only checks the token and
//     redirects to the portal page that sets the password, which does run
//     inside a context. The mail was sent from inside one when it was asked for.
const TENANT_CONTEXT_EXEMPT = (path: string) =>
  path === '/api/v1/healthz' ||
  path === '/api/v1/webhooks/stripe' ||
  path === '/api/v1/webhooks/resend' ||
  path === '/api/v1/platform' ||
  path.startsWith('/api/v1/platform/') ||
  path.startsWith(`${AUTH_BASE_PATH.platform}/`) ||
  path.startsWith(`${AUTH_BASE_PATH.staff}/reset-password/`) ||
  isTenantLookup(path)

app.use('/api/v1/*', (c, next) =>
  TENANT_CONTEXT_EXEMPT(c.req.path) ? next() : resolveTenant(c, next),
)

app.get('/', c =>
  c.json({
    name: 'reservetoday-be',
    status: 'running',
  }),
)

// Smoke-test endpoint per spec — Phase E verification step.
app.get('/api/v1/healthz', c => c.json({ ok: true }))

app.get('/health', async c => {
  try {
    await db.execute(sql`SELECT 1`)
    return c.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() })
  } catch {
    return c.json({ status: 'error', db: 'unreachable', timestamp: new Date().toISOString() }, 503)
  }
})

// Suspension, enforced. A suspended studio still *resolves* — the frontends
// render a paused page rather than a 404 — but nothing it owns may be read or
// written until it is reactivated. The super portal is exempt, because it is
// what lifts the suspension.
app.use('/api/v1/me/*', requireActiveTenant)
app.use('/api/v1/portal/*', requireActiveTenant)

app.route('/api/v1/public', publicRoutes)
app.route('/api/v1/me', clientRoutes)
app.route('/api/v1/portal', portalRoutes)
app.route('/api/v1/platform', platformRoutes)
app.route('/api/v1/webhooks', webhookRoutes)

// The three Better Auth pools (services/auth/better-auth.ts), each answering on
// its own base path, mounted the way Better Auth's Hono integration describes.
// `client` and `staff` run inside the Tenant context `resolveTenant` opened, so
// the codes they mail are worded and signed by that studio.
for (const [pool, auth] of Object.entries(authPools) as Array<[AuthPool, AuthPoolHandler]>) {
  app.on(['GET', 'POST'], `${AUTH_BASE_PATH[pool]}/*`, c => auth.handler(c.req.raw))
}

// Unmatched routes — consistent JSON shape instead of Hono's default text 404.
app.notFound(c => c.json({ error: 'not_found' }, 404))

export default app
