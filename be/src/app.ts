import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { rateLimiter } from 'hono-rate-limiter'
import { sql } from 'drizzle-orm'
import { env } from './env'
import { db } from './db'
import { errorBoundary } from './middleware/error'
import { requestId } from './middleware/request-id'

import publicRoutes from './routes/public'
import clientRoutes from './routes/client'
import portalRoutes from './routes/portal'
import webhookRoutes from './routes/webhooks'

const app = new Hono()

app.use('*', requestId)
app.use('*', errorBoundary)
app.use('*', secureHeaders())

// CORS — allow both fe-portal and (when configured) fe-client origins.
// Credentials required because Clerk uses cookies on the auth handshake; the
// frontend then carries the bearer JWT.
const allowedOrigins = [env.PORTAL_ORIGIN, env.CLIENT_ORIGIN].filter(
  (o): o is string => Boolean(o),
)
app.use(
  '*',
  cors({
    origin: origin => (allowedOrigins.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'X-Impersonate-Staff-Id',
      'X-Impersonation-Grant',
      'X-Request-Id',
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

app.use('/api/v1/public/*', publicLimiter)
app.use('/api/v1/me/*', authedLimiter)
app.use('/api/v1/portal/*', authedLimiter)

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

export default app
