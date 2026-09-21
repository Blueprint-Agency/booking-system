import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  frontendOrigin,
  harnessAddress,
  HARNESS_ROUTES,
  HARNESS_SERVICE_LOG_MESSAGE,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'
import { memberFixtures, type Staff } from './member-fixtures'

/**
 * What a log line says about where it came from (#162). Alert rules key on
 * these fields, so they are asserted on the JSON lines the app actually wrote —
 * captured by the harness — rather than on how any middleware set them.
 */
describe('log context', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fixtures!: ReturnType<typeof memberFixtures>
  let one!: { id: string; slug: string }
  let admin!: Staff
  let member!: { clientId: string; authUserId: string | null; headers: Record<string, string> }

  const DOMAIN = `log-context-${Date.now().toString(36)}.test`

  const lines = (level?: string) => harness.logs.lines().filter(l => !level || l.level === level)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ one } = harness.tenants)
    fixtures = memberFixtures(harness, schema, DOMAIN)
    admin = await fixtures.staffAt(one, `admin@${DOMAIN}`, 'admin')
    member = await fixtures.memberAt(one, admin.headers, `member@${DOMAIN}`)
  })

  after(async () => {
    if (!harness) return
    await fixtures?.cleanup()
    await harness.close()
  })

  beforeEach(() => harness.logs.clear())

  test('an unhandled error is one error line carrying the request, tenant and actor, with a stack', async () => {
    const res = await harness.app.request(HARNESS_ROUTES.throw, { headers: member.headers })
    assert.equal(res.status, 500)
    const body = (await res.json()) as { error: string; requestId: string }
    assert.equal(body.error, 'internal_error')
    assert.ok(body.requestId, 'the 500 body carries the requestId')

    const errors = lines('error')
    assert.equal(errors.length, 1, JSON.stringify(errors))
    const [line] = errors
    assert.equal(line!.requestId, body.requestId)
    assert.equal(line!.tenantId, one.id)
    assert.equal(line!.actorId, member.authUserId)
    assert.equal(line!.pool, 'client')
    assert.equal(line!.impersonatedBy, undefined)
    assert.match(String((line!.err as { stack?: string }).stack), /deliberately unhandled/)
  })

  test('under an impersonation grant the line names the acting admin', async () => {
    const minted = await harness.app.request(`/api/v1/portal/admin/clients/${member.clientId}/impersonate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin.headers },
      body: '{}',
    })
    assert.equal(minted.status, 200, await minted.clone().text())
    const { token, grant } = (await minted.json()) as { token: string; grant: string }
    harness.logs.clear()

    const res = await harness.app.request(HARNESS_ROUTES.throw, {
      headers: {
        'X-Tenant-Slug': one.slug,
        Origin: frontendOrigin('client', one),
        'X-Forwarded-For': harnessAddress(),
        Authorization: `Bearer ${token}`,
        'X-Impersonation-Grant': grant,
      },
    })
    assert.equal(res.status, 500)
    const errors = lines('error')
    assert.equal(errors.length, 1, JSON.stringify(errors))
    assert.equal(errors[0]!.actorId, member.authUserId)
    assert.equal(errors[0]!.impersonatedBy, admin.authUserId)
  })

  test('a typed error answers with its code and logs no error line', async () => {
    const res = await harness.app.request(`/api/v1/me/bookings/${randomUUID()}`, { headers: member.headers })
    assert.equal(res.status, 404)
    const body = (await res.json()) as { error: string }
    assert.equal(body.error, 'booking_not_found')
    assert.deepEqual(lines('error'), [])
  })

  test('a line a service writes during a signed-in request carries the same ids', async () => {
    const res = await harness.app.request(HARNESS_ROUTES.log, { headers: member.headers })
    assert.equal(res.status, 200)
    const requestId = res.headers.get('x-request-id')
    const serviceLines = lines().filter(l => l.msg === HARNESS_SERVICE_LOG_MESSAGE)
    assert.equal(serviceLines.length, 1)
    assert.equal(serviceLines[0]!.requestId, requestId)
    assert.equal(serviceLines[0]!.tenantId, one.id)
    assert.equal(serviceLines[0]!.actorId, member.authUserId)
  })

  describe('the Stripe webhook', () => {
    const secret = `whsec_${randomUUID()}`
    let previous: string | undefined

    before(() => {
      previous = process.env.STRIPE_WEBHOOK_SECRET
      process.env.STRIPE_WEBHOOK_SECRET = secret
    })
    after(() => {
      if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
      else process.env.STRIPE_WEBHOOK_SECRET = previous
    })

    const post = (payload: string, signature: string) =>
      harness.app.request('/api/v1/webhooks/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
        body: payload,
      })

    test('a refused signature is a 400 and one warn line', async () => {
      const res = await post('{}', 't=1,v1=nope')
      assert.equal(res.status, 400)
      const warns = lines('warn')
      assert.equal(warns.length, 1, JSON.stringify(warns))
      assert.equal(warns[0]!.webhook, 'stripe')
      assert.deepEqual(lines('error'), [])
    })

    test('a handler that throws is a 500 and one error line', async () => {
      const { stripePlatform } = await import('../lib/stripe')
      const stripe = stripePlatform()
      // Money captured for a member nobody can place: the handler refuses loudly.
      const payload = JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: 'event',
        type: 'checkout.session.completed',
        data: { object: { id: `cs_${randomUUID()}`, object: 'checkout.session', metadata: { client_id: randomUUID() } } },
      })
      const res = await post(payload, stripe.webhooks.generateTestHeaderString({ payload, secret }))
      assert.equal(res.status, 500)
      const errors = lines('error')
      assert.equal(errors.length, 1, JSON.stringify(errors))
      assert.equal(errors[0]!.webhook, 'stripe')
    })
  })

  describe('cron jobs', () => {
    test('a run that succeeds leaves one info line saying so', async () => {
      const { safeJob } = await import('../jobs')
      await safeJob('harness-ok', async () => {})()
      const info = lines('info').filter(l => l.job === 'harness-ok')
      assert.equal(info.length, 1, JSON.stringify(lines()))
      assert.equal(info[0]!.outcome, 'ok')
    })

    test('a run that throws leaves one error line naming the job', async () => {
      const { safeJob } = await import('../jobs')
      await safeJob('harness-throws', async () => {
        throw new Error('harness: job failed')
      })()
      const errors = lines('error')
      assert.equal(errors.length, 1, JSON.stringify(errors))
      assert.equal(errors[0]!.job, 'harness-throws')
    })

    test("a per-Tenant job's lines inside each step carry that Tenant's id", async () => {
      const { tenantJob } = await import('../jobs')
      const { logger } = await import('../shared/logger')
      const { sql } = await import('drizzle-orm')
      const { db } = await import('../db')
      await tenantJob('harness-per-tenant', async () => {
        // The Tenant the database context was opened for, to compare the line against.
        const [row] = await db.execute<{ id: string }>(sql`select current_setting('app.tenant_id', true) as id`)
        logger.info({ contextTenant: row!.id }, 'harness: step')
      })()
      const steps = lines().filter(l => l.msg === 'harness: step')
      assert.ok(steps.length >= 2, 'both harness tenants were swept')
      for (const step of steps) {
        assert.equal(step.job, 'harness-per-tenant')
        assert.equal(step.tenantId, step.contextTenant)
      }
      assert.ok(steps.some(s => s.tenantId === one.id))
      // Nothing written after the sweep still claims a Tenant.
      const done = lines('info').filter(l => l.job === 'harness-per-tenant' && l.outcome === 'ok')
      assert.equal(done.length, 1)
      assert.equal(done[0]!.tenantId, undefined)
    })
  })
})
