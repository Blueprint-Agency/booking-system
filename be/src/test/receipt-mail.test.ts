import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'
import type { MailTransport, OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.receipt-mail.test`
// Not ending in "Flow" / "Bundle" / "Retreat": isolation.test.ts purges by those suffixes.
const NAME = `Receipt mail ${run}`
const GOOD_SIGNATURE = 't=1,v1=good'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** The words a PDF shows, as a reader copying them out of it would get them. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })
  return text
}

/**
 * The purchase confirmations carry the member's Receipt (#387): the four
 * confirmation emails a member already gets show the Receipt itemised under
 * the studio's own copy, attach it as a PDF named after its number, and link
 * the Receipt in the member's account, for a paid purchase and a free one.
 *
 * Asked over HTTP: a checkout, the provider's delivery to the studio's own
 * webhook (the Stripe fake stands in for the provider), then the email read
 * back from the test mail capture and the Receipt from `/me/receipts`.
 *
 * Written from the INV rows of the Scenario Inventory (`docs/md/test-scenarios.md`).
 */
describe('the purchase confirmations carry the Receipt', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let mailer!: typeof import('../lib/mailer')
  let fake!: StripeFake

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    admin: Staff
    instructor: Staff
    bundleId: string
    freeTrialId: string
    corporateId: string
    freeCorporateId: string
  }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio

  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as Record<string, any>) : {}
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = `${name}-${tenant.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, tenant.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    return { id: row!.id, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `Receipt mail hall ${run}` })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `Receipt mail room ${run}`, capacity: 30 })
      .returning({ id: schema.rooms.id })
    const [bundle] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} ten pack`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '150.00' })
      .returning({ id: schema.classPackages.id })
    const [trial] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} first class`, kind: 'trial', credits: 1, validityDays: 14, priceSgd: '0.00' })
      .returning({ id: schema.classPackages.id })
    const admin = await staffAt(tenant, 'admin', 'admin')
    const [corporate] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: tenant.id, name: `${NAME} corporate`, priceSgd: '480.00', status: 'active', createdByStaffId: admin.id })
      .returning({ id: schema.corporatePackages.id })
    const [freeCorporate] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: tenant.id, name: `${NAME} corporate free`, priceSgd: '0.00', status: 'active', createdByStaffId: admin.id })
      .returning({ id: schema.corporatePackages.id })
    return {
      ...tenant,
      locationId: location!.id,
      roomId: room!.id,
      admin,
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
      bundleId: bundle!.id,
      freeTrialId: trial!.id,
      corporateId: corporate!.id,
      freeCorporateId: freeCorporate!.id,
    }
  }

  let members = 0
  async function member(at: { id: string; slug: string }): Promise<Member> {
    const email = `member-${members++}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  let slot = 0
  /** A one-day workshop with one tier, built through the admin editor's own routes. */
  async function workshop(at: Studio, price: string): Promise<{ id: string; tierId: string }> {
    const call = async (path: string, body: unknown) => expectStatus(await post(at.admin.headers, path, body), 201)
    const created = await call('/api/v1/portal/admin/workshops', {
      name: `Receipt mail workshop ${run} ${slot}`,
      location_id: at.locationId,
      main_instructor_id: at.instructor.id,
      main_instructor_pay_sgd: 100,
    })
    const startsAt = new Date(Date.now() + 40 * DAY + slot++ * 3 * HOUR)
    const day = await call(`/api/v1/portal/admin/workshops/${created.id}/days`, {
      ord: 1,
      room_id: at.roomId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 2 * HOUR).toISOString(),
      capacity_online: 10,
    })
    const tier = await call(`/api/v1/portal/admin/workshops/${created.id}/tiers`, {
      name: 'Full',
      regular_price_sgd: price,
      ord: 1,
      day_ids: [day.id],
    })
    return { id: created.id, tierId: tier.id }
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  const post = (headers: Record<string, string>, path: string, body: unknown) =>
    harness.app.request(path, { method: 'POST', headers: { ...headers, ...json }, body: JSON.stringify(body) })

  const PACKAGE = '/api/v1/me/checkout/package'
  const WORKSHOP = '/api/v1/me/checkout/workshop'

  /** The provider's checkout-completed delivery for the last session, paid in full, at the buyer's studio. */
  async function deliver(intent: string): Promise<void> {
    const call = fake.callsTo('checkout.sessions.create').at(-1)
    assert.ok(call, 'no checkout session was created')
    const params = call.args[0] as { metadata: Record<string, string>; line_items: any[] }
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${randomUUID()}`,
          payment_intent: intent,
          payment_status: 'paid',
          amount_total: params.line_items.reduce((n: number, l: any) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0),
          metadata: params.metadata,
        },
      },
    }
    await expectStatus(
      await harness.app.request(stripeWebhookPath(params.metadata.tenant_id === two.id ? two.slug : one.slug), {
        method: 'POST',
        headers: { ...json, 'stripe-signature': GOOD_SIGNATURE },
        body: JSON.stringify(event),
      }),
      200,
    )
  }

  /** Check out and have the provider say it was paid, twice over, as it may. */
  async function pay(who: Member, path: string, body: Record<string, unknown>): Promise<void> {
    await expectStatus(await post(who.headers, path, body), 200)
    const intent = `pi_${randomUUID()}`
    await deliver(intent)
    await deliver(intent)
  }

  /** A checkout with nothing to pay, granted on the spot. */
  async function take(who: Member, path: string, body: Record<string, unknown>): Promise<void> {
    const granted = await expectStatus(await post(who.headers, path, body), 201)
    assert.equal(granted.outcome, 'granted')
  }

  /* ── state ──────────────────────────────────────────────────────────── */

  const mailTo = (email: string) => mailer.discardedMail.filter(m => m.to === email)
  const templateOf = (m: OutboundMessage) => m.tags.find(t => t.name === 'template')?.value
  const linksOf = (m: OutboundMessage) => [...m.html.matchAll(/href="([^"]+)"/g)].map(match => match[1]!.replace(/&amp;/g, '&'))

  /** The member's one Receipt, as their account shows it. */
  async function onlyReceipt(who: Member): Promise<Record<string, any>> {
    const listed = await expectStatus(await harness.app.request('/api/v1/me/receipts', { headers: who.headers }), 200)
    assert.equal(listed.receipts.length, 1, 'exactly one Receipt')
    return expectStatus(await harness.app.request(`/api/v1/me/receipts/${listed.receipts[0].id}`, { headers: who.headers }), 200)
  }

  /**
   * Exactly one email reached the member, on `slug`, carrying their Receipt:
   * its number, each line and the total in the block under the studio's copy,
   * in the HTML and the plain text alike; the PDF attached under the receipt
   * number; and a link to the Receipt in the member's account at their own
   * studio, in place of the provider's page or the account page.
   */
  async function carriesReceipt(who: Member, at: Studio, slug: string): Promise<{ mail: OutboundMessage; receipt: Record<string, any> }> {
    const receipt = await onlyReceipt(who)
    const sent = mailTo(who.email)
    assert.equal(sent.length, 1, `exactly one email: ${sent.map(m => m.subject).join(' | ')}`)
    const mail = sent[0]!
    assert.equal(templateOf(mail), slug)

    const total = `S$${receipt.total_sgd}`
    for (const body of [mail.html, mail.text ?? '']) {
      assert.ok(body.includes(receipt.number), `the receipt number ${receipt.number} is in the email: ${body}`)
      for (const line of receipt.lines) assert.ok(body.includes(line.description), `the line ${line.description} is listed`)
      assert.ok(body.includes(`Total paid`) && body.includes(total), `the total ${total} is in the block`)
    }

    const links = linksOf(mail)
    const link = links.find(l => new URL(l).pathname === `/account/receipts/${receipt.id}`)
    assert.ok(link, `the member's Receipt is linked: ${links.join(', ')}`)
    assert.ok(new URL(link).hostname.startsWith(`${at.slug}.`), `on the buyer's own studio: ${link}`)
    assert.ok(!links.some(l => l.includes('pay.example.test')), 'not the provider\'s receipt page')

    assert.equal(mail.attachments?.length, 1, 'one file attached')
    const [pdf] = mail.attachments!
    assert.equal(pdf!.filename, `${receipt.number}.pdf`)
    assert.equal(pdf!.contentType, 'application/pdf')
    const text = await pdfText(pdf!.content)
    assert.ok(text.includes(receipt.number), `the PDF is the Receipt: ${text}`)
    assert.ok(text.includes(total), `with its total: ${text}`)
    return { mail, receipt }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    mailer = await import('../lib/mailer')

    fake = (await import('./stripe-fake')).installStripeFake()
    fake.ownAccount(harness.tenants.one)
    fake.ownAccount(harness.tenants.two)
    fake.reply('customers.create', () => ({ id: `cus_${randomUUID().slice(0, 8)}` }))
    fake.reply('checkout.sessions.create', () => {
      const id = `cs_${randomUUID()}`
      return { id, url: `https://pay.example.test/${id}` }
    })
    fake.reply('webhooks.constructEvent', (body: unknown, signature: unknown) => {
      if (signature !== GOOD_SIGNATURE) throw new Error('No signatures found matching the expected signature for payload')
      return JSON.parse(String(body))
    })
    fake.reply('paymentIntents.retrieve', (id: unknown) => ({
      id,
      latest_charge: {
        id: `ch_${String(id)}`,
        receipt_url: `https://pay.example.test/receipts/${String(id)}`,
        payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', wallet: null } },
      },
    }))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    try {
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      const workshops = sql`SELECT id FROM workshops WHERE created_by_staff_id IN (${staffIds})`
      const locations = sql`SELECT id FROM locations WHERE name = ${`Receipt mail hall ${run}`}`
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM corporate_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE workshop_id IN (${workshops}) OR client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${workshops}))`)
      await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshops WHERE id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM corporate_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (${locations})`)
      await harness.db.execute(sql`DELETE FROM locations WHERE id IN (${locations})`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test('INV-56 a paid class package\'s confirmation carries its Receipt, under the studio\'s own copy', async () => {
    const mia = await member(one)
    await pay(mia, PACKAGE, { package_kind: 'class', package_id: one.bundleId })

    const { mail } = await carriesReceipt(mia, one, 'package_purchase_confirmed')
    // The studio's copy is as it was, above the block: no template was edited for it.
    const copy = mail.text!.indexOf('Your package is confirmed')
    assert.ok(copy >= 0, `the studio's copy is there: ${mail.text}`)
    assert.ok(mail.text!.indexOf('Total paid') > copy, 'the Receipt comes under it')
  })

  test('INV-57 a free Trial Pass\'s confirmation carries its S$0.00 Receipt, linked in the member\'s account', async () => {
    for (const at of [one, two]) {
      const ivy = await member(at)
      await take(ivy, PACKAGE, { package_kind: 'class', package_id: at.freeTrialId })

      const { mail, receipt } = await carriesReceipt(ivy, at, 'trial_pass_purchase_confirmed')
      assert.equal(receipt.total_sgd, '0.00')
      assert.ok(mail.text!.includes('No payment: nothing was due.'), `it says nothing was paid: ${mail.text}`)
    }
  })

  test('INV-58 a workshop place\'s confirmation carries its Receipt beside the QR code, paid or free', async () => {
    const paid = await workshop(one, '85.50')
    const zoe = await member(one)
    await pay(zoe, WORKSHOP, { workshop_id: paid.id, workshop_tier_id: paid.tierId })
    const { mail, receipt } = await carriesReceipt(zoe, one, 'workshop_purchase_confirmed')
    assert.equal(receipt.total_sgd, '85.50')
    assert.ok(mail.text!.includes('Paid by Visa •••• 4242'), `it says how it was paid: ${mail.text}`)
    assert.ok(linksOf(mail).some(l => new URL(l).pathname === '/account/workshops'), 'the QR code is still linked')

    const free = await workshop(two, '0.00')
    const sam = await member(two)
    await take(sam, WORKSHOP, { workshop_id: free.id, workshop_tier_id: free.tierId })
    const taken = await carriesReceipt(sam, two, 'workshop_purchase_confirmed')
    assert.equal(taken.receipt.total_sgd, '0.00')
  })

  test('INV-59 a corporate package\'s confirmation carries its Receipt, paid or free', async () => {
    const eve = await member(one)
    await pay(eve, PACKAGE, { package_kind: 'corporate', package_id: one.corporateId })
    const { receipt } = await carriesReceipt(eve, one, 'corporate_purchase_confirmed')
    assert.equal(receipt.total_sgd, '480.00')

    const ana = await member(two)
    await take(ana, PACKAGE, { package_kind: 'corporate', package_id: two.freeCorporateId })
    const taken = await carriesReceipt(ana, two, 'corporate_purchase_confirmed')
    assert.equal(taken.receipt.total_sgd, '0.00')
  })

  test('INV-60 a studio\'s own copy may name the receipt number', async () => {
    const where = and(eq(schema.emailTemplates.tenantId, two.id), eq(schema.emailTemplates.slug, 'package_purchase_confirmed'))
    const [template] = await harness.db.select().from(schema.emailTemplates).where(where)
    assert.ok(template)
    await harness.db.update(schema.emailTemplates).set({ subject: 'Your receipt {{receipt_number}}' }).where(where)
    try {
      const kai = await member(two)
      await pay(kai, PACKAGE, { package_kind: 'class', package_id: two.bundleId })
      const { mail, receipt } = await carriesReceipt(kai, two, 'package_purchase_confirmed')
      assert.equal(mail.subject, `Your receipt ${receipt.number}`)
    } finally {
      await harness.db.update(schema.emailTemplates).set({ subject: template.subject }).where(where)
    }
  })

  test('INV-61 when the mail transport fails, the purchase is still granted and its Receipt still issued', async () => {
    const restore = mailer.useTransport({
      name: 'null',
      send: async () => {
        throw new Error('mail provider unavailable')
      },
    } satisfies MailTransport)
    const ben = await member(one)
    try {
      await pay(ben, PACKAGE, { package_kind: 'class', package_id: one.bundleId })
    } finally {
      restore()
    }

    assert.equal(mailTo(ben.email).length, 0, 'nothing was sent')
    const held = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, ben.clientId))
    assert.equal(held.length, 1, 'the package is granted')
    assert.equal(held[0]?.creditsOrSessionsRemaining, 10)
    const receipt = await onlyReceipt(ben)
    assert.equal(receipt.total_sgd, '150.00', 'the Receipt is issued')
    const [log] = await harness.db.select().from(schema.emailLog).where(eq(schema.emailLog.recipientEmail, ben.email))
    assert.equal(log?.status, 'failed', 'the failed send is on record')
  })
})
