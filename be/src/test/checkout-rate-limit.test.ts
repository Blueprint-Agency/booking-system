import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { CHECKOUT_RATE_LIMIT } from '../middleware/checkout-rate-limit'

const run = Date.now().toString(36)

/**
 * Checkout's own budget (#142), over real HTTP: tighter than the general
 * signed-in budget, and counted per member, not per address.
 */
describe('checkout rate limit', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  const FIRST = `first-${run}@checkout-limit.test`
  const SECOND = `second-${run}@checkout-limit.test`
  const EMAILS = [FIRST, SECOND]

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.clients).where(inArray(schema.clients.email, EMAILS))
    await harness.db.delete(schema.emailLog).where(inArray(schema.emailLog.recipientEmail, EMAILS))
    await harness.db.delete(schema.clientAuthUsers).where(inArray(schema.clientAuthUsers.email, EMAILS))
    await harness.close()
  })

  const member = async (email: string) => {
    const { one } = harness.tenants
    const headers = await harness.signInAs('client', email, one)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    await harness.db.insert(schema.clients).values({
      tenantId: one.id,
      email,
      name: 'Probe Member',
      phone: '+10000000000',
      authUserId: user!.id,
    })
    return headers
  }

  // The same address for both members: a studio's wifi, where the general
  // budget cannot tell them apart and this one must.
  const SHARED_ADDRESS = { 'X-Forwarded-For': '198.51.100.7' }

  /** Any checkout call will do; an empty promo check is the cheapest. */
  const checkoutCall = (headers: Record<string, string>) =>
    harness.app.request('/api/v1/me/checkout/validate-promo', {
      method: 'POST',
      headers: { ...headers, ...SHARED_ADDRESS, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

  test('a member over the limit gets 429; another member and the rest of /me do not', async () => {
    const first = await member(FIRST)
    const second = await member(SECOND)

    for (let i = 0; i < CHECKOUT_RATE_LIMIT.limit; i++) {
      assert.notEqual((await checkoutCall(first)).status, 429, `request ${i + 1}`)
    }
    const refused = await checkoutCall(first)
    assert.equal(refused.status, 429)
    assert.deepEqual(await refused.json(), { error: 'rate_limited' })

    assert.notEqual((await checkoutCall(second)).status, 429, 'a second member has a budget of their own')

    const profile = await harness.app.request('/api/v1/me', { headers: { ...first, ...SHARED_ADDRESS } })
    assert.equal(profile.status, 200, 'non-checkout /me routes stay on the general budget')
  })
})
