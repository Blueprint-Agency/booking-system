import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { StripeFake } from './stripe-fake'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `webhook-setup-${run}.test`
const OPERATOR = `operator@${DOMAIN}`
const SEALING_KEY = randomBytes(32).toString('base64')

/**
 * A studio pastes only its secret key; the platform creates its webhook
 * endpoint (#294).
 *
 * Through the super portal's route, with the credentials store left on the real
 * database and the provider replaced by the fake, whose webhook endpoints are
 * kept per account. So "exactly one endpoint" is counted on the account the
 * studio's key opens, and "a delivery verifies" is a delivery signed with the
 * secret that account handed out, arriving at the studio's own URL and checked
 * by the provider's own library against what was stored.
 */
describe('a studio’s webhook endpoint is created from its secret key', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PAYMENT_CREDENTIALS_KEY: SEALING_KEY, PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fakes!: typeof import('./stripe-fake')
  let credentialsStore!: typeof import('../services/billing/provider-credentials')
  let fake!: StripeFake
  let operator!: Record<string, string>
  let studio!: { id: string; slug: string }
  let studioCount = 0

  const url = (slug: string) => `http://localhost:4000/api/v1/webhooks/stripe/${slug}`

  const put = (tenantId: string, body: unknown) =>
    harness.app.request(`/api/v1/platform/tenants/${tenantId}/payment-credentials`, {
      method: 'PUT',
      headers: { ...operator, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const remove = (tenantId: string) =>
    harness.app.request(`/api/v1/platform/tenants/${tenantId}/payment-credentials`, {
      method: 'DELETE',
      headers: operator,
    })

  /** A delivery signed the way the provider signs one. */
  function signed(body: string, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
    return `t=${timestamp},v1=${signature}`
  }

  const deliver = (slug: string, secret: string) => {
    const body = JSON.stringify({ id: `evt_${run}`, type: 'payment_intent.created', data: { object: {} } })
    return harness.app.request(`/api/v1/webhooks/stripe/${slug}`, {
      method: 'POST',
      headers: { 'stripe-signature': signed(body, secret), 'Content-Type': 'application/json' },
      body,
    })
  }

  async function storedRow(tenantId: string) {
    const [row] = await harness.db
      .select()
      .from(schema.tenantPaymentCredentials)
      .where(eq(schema.tenantPaymentCredentials.tenantId, tenantId))
    return row
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    fakes = await import('./stripe-fake')
    credentialsStore = await import('../services/billing/provider-credentials')
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  beforeEach(async () => {
    fake = fakes.installStripeFake({ credentials: 'database' })
    // The provider's own library checks the signature: a recorded
    // `constructEvent` would verify whatever secret the code reached for.
    const verifier = new Stripe('sk_test_unused', { apiVersion: '2023-10-16' })
    fake.reply('webhooks.constructEvent', (...args: unknown[]) =>
      verifier.webhooks.constructEvent(args[0] as string, args[1] as string, args[2] as string),
    )
    // A fresh studio per test, so no test inherits another's endpoint.
    const provision = await import('../services/tenants/provision')
    studioCount += 1
    const { tenant } = await provision.provisionTenant({
      slug: `hook-${run}-${studioCount}`,
      name: 'Webhook Setup',
      adminEmail: `owner-${studioCount}@${DOMAIN}`,
    })
    studio = { id: tenant.id, slug: tenant.slug }
  })

  afterEach(async () => {
    process.env.PAYMENT_CREDENTIALS_KEY = SEALING_KEY
    await credentialsStore.clearProviderCredentials(studio.id)
    fake.restore()
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.close()
  })

  test('PAY-31 saving a key creates one endpoint at the studio’s URL for the two events, and a delivery verifies against it', async () => {
    fake.issueKey('sk_test_first', 'acct_first')

    const res = await put(studio.id, { secret_key: 'sk_test_first' })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { tenant: { payments: { configured: boolean; account_id: string } }; webhook: unknown }
    assert.equal(body.tenant.payments.configured, true)
    assert.equal(body.tenant.payments.account_id, 'acct_first')

    const endpoints = fake.webhookEndpoints('acct_first')
    assert.equal(endpoints.length, 1)
    assert.equal(endpoints[0]!.url, url(studio.slug))
    assert.deepEqual([...endpoints[0]!.enabled_events].sort(), ['charge.refunded', 'checkout.session.completed'])

    // The endpoint is remembered, so it can be managed later…
    const row = await storedRow(studio.id)
    assert.equal(row?.webhookEndpointId, endpoints[0]!.id)

    // …and nothing the route answered carries either secret.
    const text = JSON.stringify(body)
    assert.ok(!text.includes('sk_test_first'))
    assert.ok(!text.includes(endpoints[0]!.secret))
    assert.ok(!text.includes('whsec_'))

    // The secret the account handed out is the one a delivery is checked against.
    assert.equal((await deliver(studio.slug, endpoints[0]!.secret)).status, 200)
    assert.equal((await deliver(studio.slug, 'whsec_some_other_secret')).status, 400)
  })

  test('PAY-32 replacing a key leaves exactly one endpoint, the new one', async () => {
    fake.issueKey('sk_test_old', 'acct_old')
    fake.issueKey('sk_test_new', 'acct_new')
    assert.equal((await put(studio.id, { secret_key: 'sk_test_old' })).status, 200)

    // What is stored at the moment the old endpoint is deleted.
    let storedWhenOldDeleted: string | null | undefined
    fake.reply('webhookEndpoints.del', async (id: unknown) => {
      storedWhenOldDeleted = (await storedRow(studio.id))?.webhookEndpointId
      const old = fake.webhookEndpoints('acct_old')
      old.splice(old.findIndex(endpoint => endpoint.id === id), 1)
      return { id, deleted: true }
    })

    assert.equal((await put(studio.id, { secret_key: 'sk_test_new' })).status, 200)

    assert.deepEqual(fake.webhookEndpoints('acct_old'), [], 'the old account’s endpoint is deleted')
    const endpoints = fake.webhookEndpoints('acct_new')
    assert.equal(endpoints.length, 1)
    assert.equal((await storedRow(studio.id))?.webhookEndpointId, endpoints[0]!.id)
    assert.equal((await deliver(studio.slug, endpoints[0]!.secret)).status, 200)

    // The new endpoint was working before the old one was taken away.
    const order = fake.calls
      .filter(call => call.method === 'webhookEndpoints.create' || call.method === 'webhookEndpoints.del')
      .map(call => `${call.method}@${call.account}`)
    assert.deepEqual(order.slice(-2), ['webhookEndpoints.create@acct_new', 'webhookEndpoints.del@acct_old'])
    assert.equal(storedWhenOldDeleted, endpoints[0]!.id, 'the new endpoint was stored before the old one went')
  })

  test('PAY-32 a new key on the same account replaces the endpoint rather than adding a second', async () => {
    fake.issueKey('sk_test_same_a', 'acct_same')
    fake.issueKey('sk_test_same_b', 'acct_same')
    assert.equal((await put(studio.id, { secret_key: 'sk_test_same_a' })).status, 200)
    assert.equal((await put(studio.id, { secret_key: 'sk_test_same_b' })).status, 200)

    const endpoints = fake.webhookEndpoints('acct_same')
    assert.equal(endpoints.length, 1)
    assert.equal((await storedRow(studio.id))?.webhookEndpointId, endpoints[0]!.id)
  })

  test('PAY-33 removing credentials deletes the endpoint', async () => {
    fake.issueKey('sk_test_gone', 'acct_gone')
    assert.equal((await put(studio.id, { secret_key: 'sk_test_gone' })).status, 200)
    assert.equal(fake.webhookEndpoints('acct_gone').length, 1)

    assert.equal((await remove(studio.id)).status, 200)

    assert.deepEqual(fake.webhookEndpoints('acct_gone'), [])
    assert.equal(await storedRow(studio.id), undefined)
  })

  test('PAY-33 credentials are removed even when the provider cannot delete the endpoint, and the ids are logged', async () => {
    fake.issueKey('sk_test_unreachable', 'acct_unreachable')
    assert.equal((await put(studio.id, { secret_key: 'sk_test_unreachable' })).status, 200)
    const [endpoint] = fake.webhookEndpoints('acct_unreachable')
    fake.reply('webhookEndpoints.del', new Error('connect ETIMEDOUT'))
    harness.logs.clear()

    assert.equal((await remove(studio.id)).status, 200)

    assert.equal(await storedRow(studio.id), undefined)
    const line = harness.logs
      .lines()
      .find(l => l.webhookEndpointId === endpoint!.id && l.accountId === 'acct_unreachable')
    assert.ok(line, 'the log names the account and endpoint to delete by hand')
  })

  test('PAY-34 a save that fails after the endpoint is created leaves no endpoint behind', async () => {
    fake.issueKey('sk_test_doomed', 'acct_doomed')
    // The endpoint is created, and then the sealing key goes bad before the
    // credentials can be sealed: the save fails with the endpoint already live.
    fake.reply('webhookEndpoints.create', (params: unknown) => {
      process.env.PAYMENT_CREDENTIALS_KEY = 'not-a-key'
      return fake.createWebhookEndpoint('acct_doomed', params as { url: string; enabled_events: string[] })
    })

    const res = await put(studio.id, { secret_key: 'sk_test_doomed' })
    assert.ok(res.status >= 500, `expected a server error, got ${res.status}`)

    assert.deepEqual(fake.webhookEndpoints('acct_doomed'), [])
    assert.equal(await storedRow(studio.id), undefined)

    // A retry then leaves exactly one.
    process.env.PAYMENT_CREDENTIALS_KEY = SEALING_KEY
    fake.reply('webhookEndpoints.create', (params: unknown) =>
      fake.createWebhookEndpoint('acct_doomed', params as { url: string; enabled_events: string[] }),
    )
    assert.equal((await put(studio.id, { secret_key: 'sk_test_doomed' })).status, 200)
    assert.equal(fake.webhookEndpoints('acct_doomed').length, 1)
  })

  test('PAY-35 a restricted key without webhook permission is refused, naming the permission', async () => {
    fake.issueKey('rk_test_restricted', 'acct_restricted')
    fake.reply(
      'webhookEndpoints.create',
      new Stripe.errors.StripePermissionError({
        type: 'invalid_request_error',
        message: 'The provided key does not have the required permissions for this endpoint.',
      }),
    )

    const res = await put(studio.id, { secret_key: 'rk_test_restricted' })
    assert.equal(res.status, 400)
    const body = (await res.json()) as { error: string; required_permission: string }
    assert.equal(body.error, 'provider_key_lacks_webhook_permission')
    assert.match(body.required_permission, /Webhook Endpoints/)
    assert.match(body.required_permission, /Write/)

    assert.deepEqual(fake.webhookEndpoints('acct_restricted'), [])
    assert.equal(await storedRow(studio.id), undefined)
  })

  test('PAY-35 a key that may not even list webhook endpoints is refused the same way, before anything is created', async () => {
    fake.issueKey('rk_test_no_read', 'acct_no_read')
    fake.reply(
      'webhookEndpoints.list',
      new Stripe.errors.StripePermissionError({ type: 'invalid_request_error', message: 'insufficient permissions' }),
    )

    const res = await put(studio.id, { secret_key: 'rk_test_no_read' })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, 'provider_key_lacks_webhook_permission')
    assert.equal(fake.callsTo('webhookEndpoints.create').length, 0)
    assert.equal(await storedRow(studio.id), undefined)
  })

  test('PAY-37 an endpoint the provider will not create is a refusal on the form, and nothing is stored', async () => {
    fake.issueKey('sk_test_unreachable_url', 'acct_unreachable_url')
    fake.reply(
      'webhookEndpoints.create',
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        message: 'Invalid URL: URL must be publicly accessible.',
        statusCode: 400,
      } as ConstructorParameters<typeof Stripe.errors.StripeInvalidRequestError>[0]),
    )

    const res = await put(studio.id, { secret_key: 'sk_test_unreachable_url' })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, 'provider_webhook_refused')
    assert.equal(await storedRow(studio.id), undefined)
  })

  test('PAY-36 an endpoint made by hand at the same URL is replaced, not duplicated', async () => {
    fake.issueKey('sk_test_by_hand', 'acct_by_hand')
    fake.createWebhookEndpoint('acct_by_hand', { url: url(studio.slug), enabled_events: ['*'] })
    // One for somewhere else on the same account, which is not ours to touch.
    fake.createWebhookEndpoint('acct_by_hand', { url: 'https://elsewhere.test/hook', enabled_events: ['*'] })

    assert.equal((await put(studio.id, { secret_key: 'sk_test_by_hand' })).status, 200)

    const ours = fake.webhookEndpoints('acct_by_hand').filter(e => e.url === url(studio.slug))
    assert.equal(ours.length, 1)
    assert.equal((await storedRow(studio.id))?.webhookEndpointId, ours[0]!.id)
    assert.deepEqual([...ours[0]!.enabled_events].sort(), ['charge.refunded', 'checkout.session.completed'])
    assert.equal(
      fake.webhookEndpoints('acct_by_hand').filter(e => e.url === 'https://elsewhere.test/hook').length,
      1,
    )
  })

  test('PAY-31 the route takes the secret key alone', async () => {
    fake.issueKey('sk_test_only_key', 'acct_only_key')
    // A signing secret is not something the operator supplies any more.
    const res = await put(studio.id, { secret_key: 'sk_test_only_key', webhook_secret: 'whsec_typed_by_hand' })
    assert.equal(res.status, 200)
    const [endpoint] = fake.webhookEndpoints('acct_only_key')
    assert.equal((await deliver(studio.slug, 'whsec_typed_by_hand')).status, 400)
    assert.equal((await deliver(studio.slug, endpoint!.secret)).status, 200)
  })
})
