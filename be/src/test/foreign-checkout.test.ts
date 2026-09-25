import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { StripeFake } from './stripe-fake'

/**
 * A provider account tells every endpoint on it about every payment. When one
 * account backs this studio and somebody else's checkout — the same studio on
 * another deployment, say — this studio's endpoint is delivered sales it never
 * started, for members it has never had. Those are acknowledged and left alone;
 * a sale this studio *did* start whose member has gone is still a loud failure.
 */
describe('a checkout begun elsewhere', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let fake!: StripeFake
  let accountId!: string
  let handler!: typeof import('../services/billing/webhook-handler')
  const run = randomUUID().slice(0, 8)

  before(async () => {
    harness = await startTestApp()
    fake = (await import('./stripe-fake')).installStripeFake()
    accountId = fake.ownAccount(harness.tenants.one).accountId
    handler = await import('../services/billing/webhook-handler')
  })

  after(async () => {
    if (!harness) return
    fake.restore()
    await harness.close()
  })

  /** A paid package checkout for a member nobody here has heard of, started by `startedBy`. */
  const completed = (label: string, startedBy: string): Stripe.Event =>
    ({
      id: `evt_${run}_${label}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${run}_${label}`,
          object: 'checkout.session',
          payment_intent: `pi_${run}_${label}`,
          amount_total: 77400,
          metadata: {
            kind: 'class_package',
            client_id: randomUUID(),
            package_id: randomUUID(),
            amount_sgd: '774.00',
            tenant_id: startedBy,
          },
        },
      },
    }) as unknown as Stripe.Event

  const paymentsFor = async (label: string) =>
    harness.db.execute(sql`SELECT 1 FROM stripe_payments WHERE payment_intent_id = ${`pi_${run}_${label}`}`)

  test('PAY-44 a completed checkout another deployment started, on an account this studio shares, is acknowledged and records nothing', async () => {
    const elsewhere = randomUUID()
    await handler.handleStripeEvent(completed('foreign', elsewhere), harness.tenants.one.id, accountId)
    assert.equal((await paymentsFor('foreign')).length, 0)
  })

  test('PAY-45 a completed checkout this studio started, for a member it cannot find, still fails loudly', async () => {
    await assert.rejects(
      handler.handleStripeEvent(completed('ours', harness.tenants.one.id), harness.tenants.one.id, accountId),
      (err: { code?: string }) => err.code === 'client_not_found',
    )
    assert.equal((await paymentsFor('ours')).length, 0)
  })
})
