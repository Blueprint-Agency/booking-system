import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { rateLimiter } from 'hono-rate-limiter'
import { sql } from 'drizzle-orm'
import { env } from './env'
import { db } from './db'
import { errorBoundary } from './middleware/error'
import { requestId } from './middleware/request-id'
import { requestLogger } from './middleware/logger'
import { resolveTenant } from './middleware/tenant'

import publicRoutes from './routes/public'
import clientRoutes from './routes/client'
import portalRoutes from './routes/portal'
import webhookRoutes from './routes/webhooks'

const app = new Hono()

app.use('*', requestId)
app.use('*', requestLogger)
app.use('*', errorBoundary)
app.use('*', secureHeaders())

// CORS — allow both fe-portal and (when configured) fe-client origins.
// Credentials required because Clerk uses cookies on the auth handshake; the
// frontend then carries the bearer JWT.
const allowedOrigins = [env.PORTAL_ORIGIN, env.CLIENT_ORIGIN].filter(
  (o): o is string => Boolean(o),
)

function isAllowedOrigin(origin: string) {
  return allowedOrigins.some(allowedOrigin => originMatchesPattern(origin, allowedOrigin))
}

function originMatchesPattern(origin: string, pattern: string) {
  if (!pattern.includes('*')) return origin === pattern
  if (!pattern.includes('://*.')) return false

  try {
    const originUrl = new URL(origin)
    const patternUrl = new URL(pattern.replace('://*.', '://wildcard.'))
    const suffix = patternUrl.hostname.replace(/^wildcard\./, '').toLowerCase()
    const hostname = originUrl.hostname.toLowerCase()

    return (
      originUrl.protocol === patternUrl.protocol &&
      (!patternUrl.port || originUrl.port === patternUrl.port) &&
      hostname !== suffix &&
      hostname.endsWith(`.${suffix}`)
    )
  } catch {
    return false
  }
}

app.use(
  '*',
  cors({
    origin: origin => (isAllowedOrigin(origin) ? origin : null),
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
const tenantLookupLimiter = rateLimiter({
  windowMs: 60_000,
  limit: 6_000,
  keyGenerator: c => c.req.header('x-forwarded-for') ?? 'global',
})

app.use('/api/v1/public/*', (c, next) =>
  c.req.path.startsWith(TENANT_LOOKUP_PREFIX)
    ? tenantLookupLimiter(c, next)
    : publicLimiter(c, next),
)
app.use('/api/v1/me/*', authedLimiter)
app.use('/api/v1/portal/*', authedLimiter)

// Which tenant is this request about? After the rate limiters, so a flood of
// forged slugs is throttled before it reaches the lookup, and before the routes,
// which all read `c.get('tenantId')`.
app.use('/api/v1/*', resolveTenant)

app.get('/', c =>
  c.json({
    name: 'yoga-sadhana-be',
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

app.route('/api/v1/public', publicRoutes)
app.route('/api/v1/me', clientRoutes)
app.route('/api/v1/portal', portalRoutes)
app.route('/api/v1/webhooks', webhookRoutes)

// Unmatched routes — consistent JSON shape instead of Hono's default text 404.
app.notFound(c => c.json({ error: 'not_found' }, 404))

export default app
