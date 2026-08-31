import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { rateLimiter } from 'hono-rate-limiter'
import { sql } from 'drizzle-orm'
import { db } from './db'
import { originAllowed } from './lib/allowed-origins'
import { errorBoundary } from './middleware/error'
import { requestId } from './middleware/request-id'
import { requestLogger } from './middleware/logger'
import { resolveTenant } from './middleware/tenant'

import { requireActiveTenant } from './middleware/require-active-tenant'

import publicRoutes from './routes/public'
import clientRoutes from './routes/client'
import portalRoutes from './routes/portal'
import platformRoutes from './routes/platform'
import webhookRoutes from './routes/webhooks'

const app = new Hono()

app.use('*', requestId)
app.use('*', requestLogger)
app.use('*', errorBoundary)
app.use('*', secureHeaders())

// CORS — every tenant subdomain in this environment, plus the single-valued
// origins that predate tenancy. A tenant is created by inserting a row, so its
// origin cannot be listed in advance; `TENANT_ORIGIN_PATTERNS` carries the
// wildcards and lib/origin.ts does the matching, one label deep. The same
// allowlist backs the Clerk `azp` check and the public-route slug validation —
// see lib/allowed-origins.ts.
//
// Credentials required because Clerk uses cookies on the auth handshake; the
// frontend then carries the bearer JWT.
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
    ],
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
//   - both webhooks resolve their OWN tenant, off the signed body: the payment
//     provider's off the payment intent (services/billing/webhook-handler.ts),
//     Clerk's off the organization on the event
//     (services/auth/webhook-tenant.ts). Opening a tenant-#1 context here would
//     wrap the real one in an unrelated transaction and hold two pooled
//     connections for the length of a call to the provider — and, worse, would
//     give an event that names no tenant a tenant anyway.
//   - the super portal's own branch is cross-tenant by definition: it lists
//     every studio and creates the ones that do not exist yet, so there is no
//     single tenant to resolve and no honest context to open. Its gate is
//     `requirePlatformAdmin`, which reads no tenant at all.
const TENANT_CONTEXT_EXEMPT = (path: string) =>
  path === '/api/v1/healthz' ||
  path === '/api/v1/webhooks/stripe' ||
  path === '/api/v1/webhooks/clerk' ||
  path === '/api/v1/platform' ||
  path.startsWith('/api/v1/platform/') ||
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

// Unmatched routes — consistent JSON shape instead of Hono's default text 404.
app.notFound(c => c.json({ error: 'not_found' }, 404))

export default app
