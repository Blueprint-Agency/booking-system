/**
 * A delivery arriving on one studio's own webhook endpoint (#100).
 *
 * The signatures here are real ones — computed the way the provider computes
 * them and checked by the provider's own library — because the property under
 * test is *which secret was used*, and a faked verifier could only assert that
 * the code called something. Nothing else in this file touches a network or a
 * database.
 */
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { before, afterEach, describe, test } from 'node:test'
import Stripe from 'stripe'

// Set before anything imports `env` or `../../db`: both read the environment at
// module load, so the modules under test are pulled in dynamically below.
process.env.DATABASE_APP_URL ||= 'postgres://booking_app:none@127.0.0.1:5432/none'

const STUDIO_A = '11111111-1111-4111-8111-111111111111'
const STUDIO_B = '22222222-2222-4222-8222-222222222222'
const SECRET_A = 'whsec_studio_a_signing_secret'
const SECRET_B = 'whsec_studio_b_signing_secret'

type Subject = {
  verifyTenantDelivery: typeof import('./webhook-verification').verifyTenantDelivery
  installStripeFake: typeof import('../../test/stripe-fake').installStripeFake
}

let subject: Subject

before(async () => {
  const [verification, fake] = await Promise.all([
    import('./webhook-verification'),
    import('../../test/stripe-fake'),
  ])
  subject = {
    verifyTenantDelivery: verification.verifyTenantDelivery,
    installStripeFake: fake.installStripeFake,
  }
})

let fake: ReturnType<Subject['installStripeFake']>

/**
 * The fake for the credentials half, and the provider's own library for the
 * signature half — which is the half being asserted. A recorded
 * `constructEvent` would verify nothing at all, so every test here would pass
 * whichever secret the code reached for.
 */
function install() {
  fake = subject.installStripeFake()
  const verifier = new Stripe('sk_test_unused', { apiVersion: '2023-10-16' })
  fake.reply('webhooks.constructEvent', (...args: unknown[]) =>
    verifier.webhooks.constructEvent(args[0] as string, args[1] as string, args[2] as string),
  )
  return fake
}

afterEach(() => fake?.restore())

/** A delivery signed the way the provider signs one. */
function signed(body: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

const BODY = JSON.stringify({ id: 'evt_1', type: 'payment_intent.created' })

describe("a delivery on a studio's own endpoint", () => {
  test("it verifies against that studio's own signing secret", async () => {
    const fake = install()
    fake.credentials(STUDIO_A, { accountId: 'acct_a', webhookSecret: SECRET_A })

    const delivery = await subject.verifyTenantDelivery(STUDIO_A, BODY, signed(BODY, SECRET_A))

    assert.equal(delivery?.event.id, 'evt_1')
    // Made on the studio's own account, not the platform's.
    assert.equal(fake.callsTo('webhooks.constructEvent')[0]?.account, 'acct_a')
  })

  /**
   * The account comes back **with** the event (#97), because here is where the
   * signature proved it: the secret that verified this body is this account's.
   * Every payment the delivery writes is stamped with it, so a Refund years
   * later is issued on the account the money came in on.
   */
  test('the account that signed it comes back with the event', async () => {
    const fake = install()
    fake.credentials(STUDIO_A, { accountId: 'acct_a', webhookSecret: SECRET_A })

    const delivery = await subject.verifyTenantDelivery(STUDIO_A, BODY, signed(BODY, SECRET_A))

    assert.equal(delivery?.accountId, 'acct_a')
  })

  test("another studio's secret cannot verify it — no second attempt", async () => {
    const fake = install()
    fake.credentials(STUDIO_A, { accountId: 'acct_a', webhookSecret: SECRET_A })
    fake.credentials(STUDIO_B, { accountId: 'acct_b', webhookSecret: SECRET_B })

    // Signed by studio B's account, delivered to studio A's endpoint.
    const event = await subject.verifyTenantDelivery(STUDIO_A, BODY, signed(BODY, SECRET_B))

    assert.equal(event, null)
    // Exactly one secret was tried. A fallback — to the platform's, or to a
    // sweep of every studio — would show up here as a second call.
    assert.equal(fake.callsTo('webhooks.constructEvent').length, 1)
  })

  test('the same delivery does verify at the endpoint it was signed for', async () => {
    const fake = install()
    fake.credentials(STUDIO_A, { accountId: 'acct_a', webhookSecret: SECRET_A })
    fake.credentials(STUDIO_B, { accountId: 'acct_b', webhookSecret: SECRET_B })

    const signature = signed(BODY, SECRET_B)
    assert.equal(await subject.verifyTenantDelivery(STUDIO_A, BODY, signature), null)
    assert.equal(
      (await subject.verifyTenantDelivery(STUDIO_B, BODY, signature))?.event.id,
      'evt_1',
    )
  })

  test('a studio with no account of its own accepts nothing here', async () => {
    const fake = install()

    // Its deliveries belong on the platform's shared endpoint. Falling back to
    // the platform's secret would be the second attempt this must never make.
    assert.equal(await subject.verifyTenantDelivery(STUDIO_A, BODY, signed(BODY, SECRET_A)), null)
    assert.equal(fake.callsTo('webhooks.constructEvent').length, 0)
  })

  test('a body with no signature at all is refused the same way', async () => {
    const fake = install()
    fake.credentials(STUDIO_A, { accountId: 'acct_a', webhookSecret: SECRET_A })

    assert.equal(await subject.verifyTenantDelivery(STUDIO_A, BODY, ''), null)
  })

  test('a tampered body is refused even under the right secret', async () => {
    const fake = install()
    fake.credentials(STUDIO_A, { accountId: 'acct_a', webhookSecret: SECRET_A })

    const signature = signed(BODY, SECRET_A)
    const tampered = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' })

    assert.equal(await subject.verifyTenantDelivery(STUDIO_A, tampered, signature), null)
  })
})
