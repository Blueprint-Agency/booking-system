import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.purchase-mail.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `Purchase-mail ${run}`

/**
 * The confirmation email a member is sent for what they buy (#226), read back
 * from the test mail capture: a paid purchase links the payment provider's
 * receipt, a free one the member's own account page, and an email that cannot
 * be sent never costs the member what they bought.
 *
 * Written from the NTF rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`). The payment provider is the one fake.
 */
describe('purchase confirmation email over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
  let fake!: StripeFake

  type Studio = { id: string; slug: string; paidPackageId: string; freeTrialId: string }
  type Member = { clientId: string; email: string; headers: Record<string, string> }
  let one!: Studio
  let two!: Studio

  let sessions = 0
  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? JSON.parse(text) : {}
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [paid] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} ten pack`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '150.00' })
      .returning({ id: schema.classPackages.id })
    const [trial] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} first class`, kind: 'trial', credits: 1, validityDays: 14, priceSgd: '0.00' })
      .returning({ id: schema.classPackages.id })
    return { ...tenant, paidPackageId: paid!.id, freeTrialId: trial!.id }
  }

  let members = 0
  async function member(at: Studio): Promise<Member> {
    const email = `member-${members++}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  const buy = (who: Member, packageId: string) =>
    harness.app.request('/api/v1/me/checkout/package', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({ package_kind: 'class', package_id: packageId }),
    })

  /** The provider's delivery for the last checkout session, paid in full. */
  async function deliverLastSession(intent: string): Promise<void> {
    const params = fake.callsTo('checkout.sessions.create').at(-1)!.args[0] as { metadata: Record<string, string>; line_items: any[] }
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_purchase_mail_${sessions}`,
          payment_intent: intent,
          payment_status: 'paid',
          amount_total: params.line_items.reduce((n, l) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0),
          metadata: params.metadata,
        },
      },
    }
    await expectStatus(
      // The studio's own endpoint: the one whose member the session was for.
      await harness.app.request(stripeWebhookPath(params.metadata.tenant_id === two.id ? two.slug : one.slug), {
        method: 'POST',
        headers: { ...json, 'stripe-signature': 't=1,v1=fake' },
        body: JSON.stringify(event),
      }),
      200,
    )
  }

  const mailTo = (email: string) => discardedMail.filter(m => m.to === email)
  const logged = (email: string) => harness.db.select().from(schema.emailLog).where(eq(schema.emailLog.recipientEmail, email))
  const packagesOf = (who: Member) => harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, who.clientId))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))

    fake = (await import('./stripe-fake')).installStripeFake()
    fake.reply('customers.create', () => ({ id: `cus_purchase_mail_${randomUUID().slice(0, 8)}` }))
    fake.reply('checkout.sessions.create', () => {
      sessions++
      return { id: `cs_purchase_mail_${sessions}`, url: `https://pay.example.test/cs_purchase_mail_${sessions}` }
    })
    fake.reply('webhooks.constructEvent', (body: unknown) => JSON.parse(String(body)))
    fake.reply('paymentIntents.retrieve', (id: unknown) => ({
      id,
      latest_charge: { id: `ch_${String(id)}`, receipt_url: `https://pay.example.test/receipts/${String(id)}` },
    }))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    // Each studio sells on an account of its own — the only way a studio sells
    // at all (#293) — and its deliveries arrive on its own endpoint.
    fake.ownAccount(one)
    fake.ownAccount(two)
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.close()
  })

  test('NTF-05, NTF-22 a paid purchase is confirmed once, linking the provider\'s receipt, logged under the buyer\'s studio', async () => {
    const mia = await member(one)
    const started = await expectStatus(await buy(mia, one.paidPackageId), 200)
    assert.match(started.url, /^https:\/\/pay\.example\.test\//)
    assert.equal(mailTo(mia.email).length, 0, 'nothing is confirmed before the money arrives')

    const intent = `pi_purchase_mail_${randomUUID().slice(0, 12)}`
    await deliverLastSession(intent)
    // The provider delivers again, as it may: still one email.
    await deliverLastSession(intent)

    const mail = mailTo(mia.email)
    assert.equal(mail.length, 1, 'exactly one confirmation')
    const links = [...mail[0]!.html.matchAll(/href="([^"]+)"/g)].map(m => m[1]!)
    assert.ok(links.includes(`https://pay.example.test/receipts/${intent}`), `the receipt is linked: ${links.join(', ')}`)
    assert.ok(!links.some(l => new URL(l).pathname === '/account'), 'not the account page')

    const rows = await logged(mia.email)
    assert.deepEqual(rows.map(r => [r.templateSlug, r.tenantId]), [['package_purchase_confirmed', one.id]])
    assert.equal((await packagesOf(mia)).length, 1)
  })

  test('NTF-05 a free purchase is confirmed once, linking the member\'s account page on their own studio', async () => {
    for (const at of [one, two]) {
      const leo = await member(at)
      const granted = await expectStatus(await buy(leo, at.freeTrialId), 201)
      assert.equal(granted.outcome, 'granted')

      const mail = mailTo(leo.email)
      assert.equal(mail.length, 1, 'exactly one confirmation')
      const links = [...mail[0]!.html.matchAll(/href="([^"]+)"/g)].map(m => m[1]!)
      const account = links.find(l => l.endsWith('/account'))
      assert.ok(account, `the account page is linked: ${links.join(', ')}`)
      assert.ok(new URL(account).hostname.startsWith(`${at.slug}.`), `on the buyer's own studio: ${account}`)
      assert.ok(!links.some(l => l.includes('/receipts/')), 'no receipt for a free purchase')

      const rows = await logged(leo.email)
      assert.deepEqual(rows.map(r => [r.templateSlug, r.tenantId]), [['trial_pass_purchase_confirmed', at.id]])
    }
  })

  test('NTF-07 when the confirmation cannot be sent, the purchase is still granted', async () => {
    // Take the studio's template away, so the send fails after the grant.
    const where = and(eq(schema.emailTemplates.tenantId, one.id), eq(schema.emailTemplates.slug, 'trial_pass_purchase_confirmed'))
    const [template] = await harness.db.select().from(schema.emailTemplates).where(where)
    assert.ok(template)
    await harness.db.delete(schema.emailTemplates).where(where)
    try {
      const ivy = await member(one)
      const granted = await expectStatus(await buy(ivy, one.freeTrialId), 201)
      assert.equal(granted.outcome, 'granted')
      assert.equal(mailTo(ivy.email).length, 0, 'the email did fail')

      const [held] = await packagesOf(ivy)
      assert.equal(held?.id, granted.client_package_id)
      assert.equal(held?.kind, 'trial')
      assert.equal(held?.creditsOrSessionsRemaining, 1)
      assert.equal(held?.active, true)
    } finally {
      await harness.db.insert(schema.emailTemplates).values(template)
    }
  })
})
