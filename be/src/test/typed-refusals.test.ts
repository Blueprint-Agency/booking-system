import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

/**
 * A caller's mistake is a named refusal, never `internal_error` (#165).
 *
 * Each of these used to be a bare `throw new Error` a request could reach, so
 * the member or staff member saw a 500 for something that was theirs to fix.
 */
describe('typed refusals', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let admin!: Record<string, string>

  const run = Date.now().toString(36)
  const email = `typed-refusals-${run}@typed-refusals.test`

  const post = (path: string, body: unknown) =>
    harness.app.request(`/api/v1/portal/admin${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...admin },
      body: JSON.stringify(body),
    })

  const refusal = async (res: Response, status: number, code: string) => {
    const text = await res.text()
    assert.equal(res.status, status, text)
    assert.equal((JSON.parse(text) as { error: string }).error, code)
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    const tenant = harness.tenants.one
    admin = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: email, role: 'admin', status: 'active', authUserId: user!.id })
  })

  after(async () => {
    if (!harness) return
    try {
      await harness.db.delete(schema.staffUsers).where(eq(schema.staffUsers.email, email))
    } finally {
      await harness.close()
    }
  })

  test('a negative class package price is invalid_price', async () => {
    await refusal(await post('/class-packages', { price_sgd: -1 }), 400, 'invalid_price')
  })

  test('a negative PT package price is invalid_price', async () => {
    await refusal(await post('/pt-packages', { price_sgd: '-5' }), 400, 'invalid_price')
  })

  test('a non-numeric merch price is invalid_price', async () => {
    await refusal(await post('/merch', { price_sgd: 'free' }), 400, 'invalid_price')
  })

  test('a negative workshop tier price is invalid_price', async () => {
    await refusal(await post(`/workshops/${randomUUID()}/tiers`, { regular_price_sgd: -1 }), 400, 'invalid_price')
  })

  test('a zero promo code amount is invalid_promo_amount', async () => {
    await refusal(await post('/promo-codes', { amount_off_sgd: 0 }), 400, 'invalid_promo_amount')
  })
})
