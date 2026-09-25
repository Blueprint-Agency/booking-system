import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.own-account.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const PAID_PACKAGE = `Own account pass ${run}`
const FREE_PACKAGE = `Own account free pass ${run}`

/**
 * Every studio takes payments on its own account, and only on it (#293).
 *
 * The platform's account is no longer anywhere to fall back to. A studio that
 * has supplied no credentials cannot take a card payment at all — its checkout
 * is refused before anything is opened, while a $0 purchase, which never
 * reaches the provider, still goes through. A payment recorded against the
 * platform account (a null account on the row) can no longer be returned from
 * here, and the refusal says where it can be.
 */
describe('payments on the studio’s own account only', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake
  let refundsSvc!: typeof import('../services/billing/refunds')
  let checkoutSvc!: typeof import('../services/billing/checkout-session')

  let tenantId!: string
  let staffId!: string
  let slug!: string
  let paidPackageId!: string
  let freePackageId!: string

  const emailFor = (name: string) => `${name}@${DOMAIN}`

  async function member(name: string): Promise<{ clientId: string; headers: Record<string, string> }> {
    const email = emailFor(name)
    const headers = await harness.signInAs('client', email, { slug })
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    assert.ok(user)
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId, email, name, phone: '+6580000000', authUserId: user.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  /** An open Purchase holding one succeeded card payment on `accountId`. */
  async function partPaid(clientId: string, intent: string, accountId: string | null): Promise<string> {
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({
        tenantId,
        clientId,
        kind: 'class_package',
        totalSgd: '200.00',
        amountPaidSgd: '50.00',
        status: 'open',
      })
      .returning({ id: schema.purchases.id })
    await harness.db.insert(schema.stripePayments).values({
      tenantId,
      paymentIntentId: intent,
      purchaseId: purchase!.id,
      amountSgd: '50.00',
      kind: 'class_package',
      clientId,
      status: 'succeeded',
      providerAccountId: accountId,
    })
    return purchase!.id
  }

  async function refusal(promise: Promise<unknown>): Promise<{ code: string; status: number; details: Record<string, unknown> }> {
    try {
      await promise
    } catch (err) {
      const e = err as { code?: string; status?: number; details?: Record<string, unknown> }
      return { code: e.code ?? String(err), status: e.status ?? 0, details: e.details ?? {} }
    }
    assert.fail('expected a refusal')
  }

  const purchasesOf = (clientId: string) =>
    harness.db.select().from(schema.purchases).where(and(eq(schema.purchases.tenantId, tenantId), eq(schema.purchases.clientId, clientId)))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    tenantId = harness.tenants.one.id
    slug = harness.tenants.one.slug
    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId,
        email: emailFor('admin'),
        name: 'Own Account Admin',
        role: 'admin',
        status: 'active',
        authUserId: `auth_own_account_${run}`,
      })
      .returning({ id: schema.staffUsers.id })
    staffId = staff!.id
    refundsSvc = inTenantContext(await import('../services/billing/refunds'))
    checkoutSvc = inTenantContext(await import('../services/billing/checkout-session'))
    const classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    const { installStripeFake } = await import('./stripe-fake')
    fake = installStripeFake()
    fake.reply('refunds.create', {})

    const paid = await classPackagesSvc.createClassPackage(tenantId, {
      name: PAID_PACKAGE,
      kind: 'credit_bundle',
      credits: 5,
      validityDays: 90,
      priceSgd: '200.00',
    })
    const free = await classPackagesSvc.createClassPackage(tenantId, {
      name: FREE_PACKAGE,
      kind: 'credit_bundle',
      credits: 1,
      validityDays: 30,
      priceSgd: '0.00',
    })
    paidPackageId = paid.id
    freePackageId = free.id
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (SELECT id FROM staff_users WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name IN (${PAID_PACKAGE}, ${FREE_PACKAGE})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  const checkoutPackage = (headers: Record<string, string>, packageId: string) =>
    harness.app.request('/api/v1/me/checkout/package', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ package_kind: 'class', package_id: packageId }),
    })

  const onlinePayments = async () => {
    const res = await harness.app.request('/api/v1/public/online-payments', {
      headers: { 'X-Tenant-Slug': slug },
    })
    assert.equal(res.status, 200, await res.clone().text())
    return (await res.json()) as { online_payments: boolean }
  }

  test('PAY-23 a studio with no credentials of its own refuses a paid checkout and opens nothing', async () => {
    const ana = await member('ana')
    fake.calls.length = 0

    const res = await checkoutPackage(ana.headers, paidPackageId)

    assert.equal(res.status, 409, await res.clone().text())
    assert.equal(((await res.json()) as { error: string }).error, 'payments_not_configured')
    assert.deepEqual(fake.calls, [], 'no provider was asked for anything — not the platform account, not any account')
    assert.deepEqual(await purchasesOf(ana.clientId), [], 'a refused checkout leaves no Purchase behind')
  })

  test('PAY-23 the refusal is the service’s, so no route can reach the platform account around it', async () => {
    const ben = await member('ben')
    fake.calls.length = 0

    const refused = await refusal(
      checkoutSvc.createCheckoutSession({
        tenantId,
        email: emailFor('ben'),
        lines: [{ name: 'Plan', description: 'Studio', amountCents: 20000 }],
        expiresAt: null,
        metadata: { kind: 'class_package', client_id: ben.clientId, package_id: paidPackageId },
        successUrl: 'https://example.test/ok',
        cancelUrl: 'https://example.test/no',
      }),
    )

    assert.equal(refused.code, 'payments_not_configured')
    assert.equal(refused.status, 409)
    assert.deepEqual(fake.calls, [])
    assert.deepEqual(await purchasesOf(ben.clientId), [])
  })

  test('PAY-24 a $0 purchase still goes through at a studio that takes no online payments', async () => {
    const cat = await member('cat')

    const res = await checkoutPackage(cat.headers, freePackageId)

    assert.equal(res.status, 201, await res.clone().text())
    assert.equal(((await res.json()) as { outcome: string }).outcome, 'granted')
  })

  test('PAY-25 the member app can read whether the studio takes online payments', async () => {
    assert.deepEqual(await onlinePayments(), { online_payments: false })

    fake.credentials(tenantId, { accountId: 'acct_own_account_only' })
    try {
      assert.deepEqual(await onlinePayments(), { online_payments: true })
    } finally {
      fake.restore()
      fake = (await import('./stripe-fake')).installStripeFake()
      fake.reply('refunds.create', {})
    }
  })

  test('PAY-26 the platform account’s shared webhook endpoint is gone', async () => {
    // Named as a request that does resolve a studio, so the answer is the
    // router's and not the tenant check's: nothing is mounted there any more.
    const res = await harness.app.request('/api/v1/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': 't=1,v1=00',
        'Content-Type': 'application/json',
        'X-Tenant-Slug': slug,
        Origin: frontendOrigin('client', { slug }),
      },
      body: '{}',
    })
    assert.equal(res.status, 404, await res.clone().text())
  })

  test('PAY-27 a payment recorded against the platform account is refused a Refund, and told where to issue it', async () => {
    const dee = await member('dee')
    fake.credentials(tenantId, { accountId: 'acct_own_account_only' })
    const purchaseId = await partPaid(dee.clientId, `pi_${run}_platform`, null)
    fake.calls.length = 0

    const refused = await refusal(
      refundsSvc.issueOpenPurchaseRefund({ tenantId, purchaseId, reason: 'member asked', actorStaffId: staffId }),
    )

    assert.equal(refused.code, 'payment_on_platform_account')
    assert.equal(refused.status, 409)
    assert.match(String(refused.details.message), /Stripe dashboard/)
    assert.deepEqual(fake.callsTo('refunds.create'), [], 'the provider is not asked at all')
  })

  test('PAY-27 a Purchase holding one platform-account payment returns none of them, not half', async () => {
    const eve = await member('eve')
    fake.credentials(tenantId, { accountId: 'acct_own_account_only' })
    const purchaseId = await partPaid(eve.clientId, `pi_${run}_own`, 'acct_own_account_only')
    await harness.db.insert(schema.stripePayments).values({
      tenantId,
      paymentIntentId: `pi_${run}_old`,
      purchaseId,
      amountSgd: '50.00',
      kind: 'class_package',
      clientId: eve.clientId,
      status: 'succeeded',
      providerAccountId: null,
    })
    fake.calls.length = 0

    const refused = await refusal(
      refundsSvc.issueOpenPurchaseRefund({ tenantId, purchaseId, reason: 'member asked', actorStaffId: staffId }),
    )

    assert.equal(refused.code, 'payment_on_platform_account')
    assert.deepEqual(fake.callsTo('refunds.create'), [])
  })

  test('PAY-28 a studio that has removed its credentials is refused a Refund in the same words as a checkout', async () => {
    const fay = await member('fay')
    fake.restore()
    fake = (await import('./stripe-fake')).installStripeFake()
    fake.reply('refunds.create', {})
    const purchaseId = await partPaid(fay.clientId, `pi_${run}_gone`, 'acct_own_account_only')

    const refused = await refusal(
      refundsSvc.issueOpenPurchaseRefund({ tenantId, purchaseId, reason: 'member asked', actorStaffId: staffId }),
    )

    assert.equal(refused.code, 'payments_not_configured')
    assert.deepEqual(fake.callsTo('refunds.create'), [])
  })

  test('PAY-29 a payment the confirmation page records is stamped with the studio’s own account', async () => {
    const gus = await member('gus')
    fake.credentials(tenantId, { accountId: 'acct_own_account_only' })
    const intent = `pi_${run}_synced`
    fake.reply('checkout.sessions.retrieve', (id: unknown) => ({
      id,
      payment_status: 'paid',
      payment_intent: intent,
      amount_total: 20000,
      metadata: {
        kind: 'class_package',
        tenant_id: tenantId,
        client_id: gus.clientId,
        package_id: paidPackageId,
        package_kind: 'class',
        amount_sgd: '200.00',
      },
    }))
    fake.reply('paymentIntents.retrieve', {})

    const res = await harness.app.request('/api/v1/me/checkout/sync-session', {
      method: 'POST',
      headers: { ...gus.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: `cs_${run}` }),
    })
    assert.equal(res.status, 200, await res.clone().text())

    const [payment] = await harness.db
      .select()
      .from(schema.stripePayments)
      .where(and(eq(schema.stripePayments.tenantId, tenantId), eq(schema.stripePayments.paymentIntentId, intent)))
    assert.ok(payment, 'the sync recorded the payment')
    assert.equal(
      payment.providerAccountId,
      'acct_own_account_only',
      'a null here would read as the platform account, and the payment could never be refunded from the app',
    )
  })
})
