import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'
import type { OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.billing-required.test`
// Not ending in "Flow" / "Bundle" / "Retreat": isolation.test.ts purges by those suffixes.
const NAME = `Billed ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** The studio's Cross-Location Add-On rate in this file. */
const ADD_ON_RATE = '20.00'

/** The words a PDF shows, as a reader copying them out of it would get them. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })
  return text
}

/** A company the member bills, in Malaysia, so the country prints by its name. */
const COMPANY = {
  name: 'Harbour Analytics Sdn Bhd',
  line1: '12 Jalan Ampang',
  line2: 'Level 8',
  city: 'Kuala Lumpur',
  state: 'Wilayah Persekutuan',
  postcode: '50450',
  country: 'MY',
}
/** The same set as a Receipt prints it under Bill to, one line each. */
const COMPANY_LINES = ['Harbour Analytics Sdn Bhd', '12 Jalan Ampang', 'Level 8', 'Kuala Lumpur Wilayah Persekutuan 50450', 'Malaysia']

/** The member's own name and home, in Singapore. */
const HOME = { name: 'Mia Tan', line1: '8 Orchard Road', city: 'Singapore', postcode: '238823' }

/**
 * Every member purchase needs Billing details (#402): a free trial, a S$0
 * package or workshop place, Merch, a corporate package and a Cross-Location
 * Add-On alike. A purchase sent without them is refused before anything is
 * opened, and a free purchase sent with them is billed to the chosen set, its
 * S$0.00 Receipt showing Bill to as a paid one does. A sale with no member
 * checkout behind it (the legacy webhook fallback, the Receipt backfill) still
 * issues a Receipt with no Bill to.
 *
 * Asked over HTTP: the member's own Billing details routes, a checkout, the
 * provider's delivery to the studio's own webhook (the Stripe fake stands in
 * for the provider), then the Receipt read back from `/me/receipts` and the
 * email from the test mail capture.
 *
 * Written from the INV rows of the Scenario Inventory (`docs/md/test-scenarios.md`).
 */
describe('every member purchase is billed to Billing details', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let mailer!: typeof import('../lib/mailer')
  let fake!: StripeFake

  type Staff = { id: string; headers: Record<string, string> }
  type Member = { clientId: string; email: string; headers: Record<string, string> }
  let studio!: {
    id: string
    slug: string
    locationId: string
    roomId: string
    admin: Staff
    instructor: Staff
  }
  let policyBefore!: { crossLocationRateSgd: string; partPaymentEnabled: boolean }
  /** Studios this file made of its own, deleted after. */
  const ownStudios: { id: string; slug: string }[] = []

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

  let members = 0
  async function member(at: { id: string; slug: string } = studio): Promise<Member> {
    const email = `member-${members++}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia Tan', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  let products = 0
  async function classPackage(
    values: Partial<typeof schema.classPackages.$inferInsert> & { kind: 'credit_bundle' | 'unlimited' | 'trial'; priceSgd: string },
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: studio.id, name: `${NAME} ${values.kind} ${products++}`, status: 'active', credits: 5, validityDays: 30, ...values })
      .returning({ id: schema.classPackages.id })
    return row!.id
  }

  async function merchItem(priceSgd: string): Promise<string> {
    const [row] = await harness.db
      .insert(schema.merch)
      .values({ tenantId: studio.id, title: `${NAME} mat ${products++}`, priceSgd })
      .returning({ id: schema.merch.id })
    return row!.id
  }

  async function corporatePackage(priceSgd: string): Promise<string> {
    const [row] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: studio.id, name: `${NAME} corporate ${products++}`, priceSgd, status: 'active', createdByStaffId: studio.admin.id })
      .returning({ id: schema.corporatePackages.id })
    return row!.id
  }

  let slot = 0
  /** A one-day workshop with one tier, built through the admin editor's own routes. */
  async function workshop(price: string): Promise<{ id: string; tierId: string }> {
    const call = async (path: string, body: unknown) => expectStatus(await post(studio.admin.headers, path, body), 201)
    const created = await call('/api/v1/portal/admin/workshops', {
      name: `${NAME} workshop ${slot}`,
      location_id: studio.locationId,
      main_instructor_id: studio.instructor.id,
      main_instructor_pay_sgd: 100,
    })
    const startsAt = new Date(Date.now() + 40 * DAY + slot++ * 3 * HOUR)
    const day = await call(`/api/v1/portal/admin/workshops/${created.id}/days`, {
      ord: 1,
      room_id: studio.roomId,
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

  /** An Unlimited Plan the member already holds, live, with no Add-On yet. */
  async function holdsUnlimited(who: Member): Promise<string> {
    const plan = await classPackage({ kind: 'unlimited', durationMonths: 3, priceSgd: '300.00', credits: null, validityDays: null })
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: studio.id,
        clientId: who.clientId,
        kind: 'unlimited',
        sourceClassPackageId: plan,
        locationId: studio.locationId,
        durationMonths: 3,
        active: true,
        amountPaidSgd: '300.00',
        listPriceSgd: '300.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  const post = (headers: Record<string, string>, path: string, body: unknown) =>
    harness.app.request(path, { method: 'POST', headers: { ...headers, ...json }, body: JSON.stringify(body) })

  const PACKAGE = '/api/v1/me/checkout/package'
  const WORKSHOP = '/api/v1/me/checkout/workshop'
  const MERCH = '/api/v1/me/checkout/merch'
  const CROSS_LOCATION = '/api/v1/me/checkout/cross-location'

  /** A set of Billing details saved through the member's own route. */
  async function saves(who: Member, set: Record<string, string>): Promise<string> {
    const added = await expectStatus(await post(who.headers, '/api/v1/me/billing-details', set), 201)
    return added.billing_details.id as string
  }

  /** The provider's checkout-completed delivery, carrying `metadata` and charging `amount` cents. */
  async function deliverPaid(at: { slug: string }, metadata: Record<string, string>, amount: number): Promise<void> {
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${randomUUID()}`,
          payment_intent: `pi_${randomUUID()}`,
          payment_status: 'paid',
          amount_total: amount,
          metadata,
        },
      },
    }
    await expectStatus(
      await harness.app.request(stripeWebhookPath(at.slug), {
        method: 'POST',
        headers: { ...json, 'stripe-signature': 't=1,v1=fake' },
        body: JSON.stringify(event),
      }),
      200,
    )
  }

  /** The provider's delivery for the last session: the whole of what it charged. */
  async function deliver(): Promise<void> {
    const call = fake.callsTo('checkout.sessions.create').at(-1)
    assert.ok(call, 'no checkout session was created')
    const params = call.args[0] as { metadata: Record<string, string>; line_items: any[] }
    const amount = params.line_items.reduce((n: number, l: any) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0)
    await deliverPaid(studio, params.metadata, amount)
  }

  /** Check out to the provider's page, and have the provider say it was paid. */
  async function pay(who: Member, path: string, body: Record<string, unknown>): Promise<void> {
    await expectStatus(await post(who.headers, path, body), 200)
    await deliver()
  }

  /** A free checkout, granted on the spot with no payment page. */
  async function takeFree(who: Member, path: string, body: Record<string, unknown>): Promise<void> {
    const sessions = fake.callsTo('checkout.sessions.create').length
    const granted = await expectStatus(await post(who.headers, path, body), 201)
    assert.equal(granted.outcome, 'granted')
    assert.equal(fake.callsTo('checkout.sessions.create').length, sessions, 'no payment page')
  }

  /* ── what the member can read ───────────────────────────────────────── */

  const mailTo = (email: string) => mailer.discardedMail.filter(m => m.to === email)

  const receiptsOf = async (who: Member) =>
    (await expectStatus(await harness.app.request('/api/v1/me/receipts', { headers: who.headers }), 200)).receipts as any[]

  /** The member's one Receipt, as their account shows it. */
  async function onlyReceipt(who: Member): Promise<Record<string, any>> {
    const listed = await receiptsOf(who)
    assert.equal(listed.length, 1, `exactly one Receipt: ${JSON.stringify(listed)}`)
    return expectStatus(await harness.app.request(`/api/v1/me/receipts/${listed[0].id}`, { headers: who.headers }), 200)
  }

  /** The Receipt's PDF, as the member downloads it. */
  async function receiptPdfText(who: Member, receipt: Record<string, any>): Promise<string> {
    const res = await harness.app.request(`/api/v1/me/receipts/${receipt.id}/pdf`, { headers: who.headers })
    assert.equal(res.status, 200)
    return pdfText(new Uint8Array(await res.arrayBuffer()))
  }

  /** The emails to the member that carry this Receipt. */
  const carrying = (who: Member, receipt: Record<string, any>): OutboundMessage[] =>
    mailTo(who.email).filter(m => (m.text ?? '').includes(receipt.number))

  /** `text` reads Bill to, then each of `lines` in order, then the member's email. */
  function readsBillTo(text: string, lines: string[], email: string, where: string): void {
    // The PDF sets its labels in spaced capitals, which a reader copies out as "B I L L TO".
    let at = text.search(/b\s*i\s*l\s*l\s*t\s*o/i)
    assert.ok(at >= 0, `${where} says Bill to: ${text}`)
    for (const line of [...lines, email]) {
      const next = text.indexOf(line, at)
      assert.ok(next >= at, `${where} has "${line}" under Bill to, in order: ${text}`)
      at = next + line.length
    }
  }

  /** The member's one Receipt bills COMPANY in its JSON, `html`, PDF and the email that carried it, for `totalSgd`. */
  async function billsCompany(who: Member, totalSgd: string): Promise<void> {
    const receipt = await onlyReceipt(who)
    assert.equal(receipt.total_sgd, totalSgd)
    assert.deepEqual(receipt.bill_to, { ...COMPANY })
    readsBillTo(receipt.html, COMPANY_LINES, who.email, 'the html')
    readsBillTo(await receiptPdfText(who, receipt), COMPANY_LINES, who.email, 'the PDF')
    const sent = carrying(who, receipt)
    assert.equal(sent.length, 1, `exactly one email carries the Receipt: ${mailTo(who.email).map(m => m.subject).join(' | ')}`)
    readsBillTo(sent[0]!.text ?? '', COMPANY_LINES, who.email, "the email's plain text")
  }

  /** The member's one Receipt has no Bill to: issued to their name and email, in its JSON and its `html`. */
  async function issuedToMember(who: Member): Promise<void> {
    const receipt = await onlyReceipt(who)
    assert.equal(receipt.bill_to, null)
    assert.deepEqual(receipt.buyer, { name: 'Mia Tan', email: who.email })
    const html = receipt.html as string
    const issuedTo = html.search(/i\s*s\s*s\s*u\s*e\s*d\s*t\s*o/i)
    assert.ok(issuedTo >= 0, `the html says Issued to: ${html}`)
    assert.ok(html.indexOf('Mia Tan', issuedTo) > issuedTo && html.indexOf(who.email, issuedTo) > issuedTo, 'the html names the member and their email')
    assert.ok(!/b\s*i\s*l\s*l\s*t\s*o/i.test(html), `the html has no Bill to: ${html}`)
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    mailer = await import('../lib/mailer')

    fake = (await import('./stripe-fake')).installStripeFake()
    fake.ownAccount(harness.tenants.one)
    fake.reply('customers.create', () => ({ id: `cus_${randomUUID().slice(0, 8)}` }))
    fake.reply('checkout.sessions.create', () => {
      const id = `cs_${randomUUID()}`
      return { id, url: `https://pay.example.test/${id}` }
    })
    fake.reply('webhooks.constructEvent', (body: unknown) => JSON.parse(String(body)))
    fake.reply('paymentIntents.retrieve', (id: unknown) => ({
      id,
      latest_charge: {
        id: `ch_${String(id)}`,
        receipt_url: `https://pay.example.test/receipts/${String(id)}`,
        payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', wallet: null } },
      },
    }))

    const tenant = harness.tenants.one
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `${NAME} hall` })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `${NAME} room`, capacity: 30 })
      .returning({ id: schema.rooms.id })
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, tenant.id))
    assert.ok(policy, 'a seeded policy')
    policyBefore = { crossLocationRateSgd: policy.crossLocationRateSgd, partPaymentEnabled: policy.partPaymentEnabled }
    await harness.db
      .update(schema.globalPolicy)
      .set({ crossLocationRateSgd: ADD_ON_RATE })
      .where(eq(schema.globalPolicy.tenantId, tenant.id))
    studio = {
      ...tenant,
      locationId: location!.id,
      roomId: room!.id,
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
    }
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    try {
      if (studio && policyBefore) {
        await harness.db.update(schema.globalPolicy).set(policyBefore).where(eq(schema.globalPolicy.tenantId, studio.id))
      }
      const { deleteTenant } = await import('../services/tenants/delete')
      for (const own of ownStudios) {
        await harness.db.execute(sql`UPDATE tenants SET status = 'suspended' WHERE id = ${own.id}`)
        await deleteTenant({ tenantId: own.id, confirmSlug: own.slug })
      }
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      const workshops = sql`SELECT id FROM workshops WHERE created_by_staff_id IN (${staffIds})`
      const locations = sql`SELECT id FROM locations WHERE name = ${`${NAME} hall`}`
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM corporate_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM merch_orders WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE workshop_id IN (${workshops}) OR client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_billing_details WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${workshops}))`)
      await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshops WHERE id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM corporate_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM merch WHERE title LIKE ${`${NAME}%`}`)
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

  test('INV-104 every member purchase sent without Billing details, paid or free, is refused 400 billing_details_required: no payment page, no Purchase, no Receipt', async () => {
    const ivy = await member()
    // She has a set saved: the refusal is for naming none, not for having none.
    await saves(ivy, HOME)
    const paidPlace = await workshop('80.00')
    const freePlace = await workshop('0.00')
    const plan = await holdsUnlimited(ivy)

    const purchases: [string, string, Record<string, unknown>][] = [
      ['a paid class package', PACKAGE, { package_kind: 'class', package_id: await classPackage({ kind: 'credit_bundle', priceSgd: '150.00' }) }],
      ['a S$0 Trial Pass', PACKAGE, { package_kind: 'class', package_id: await classPackage({ kind: 'trial', credits: 1, validityDays: 14, priceSgd: '0.00' }) }],
      ['a S$0 class package', PACKAGE, { package_kind: 'class', package_id: await classPackage({ kind: 'credit_bundle', priceSgd: '0.00' }) }],
      ['a paid workshop place', WORKSHOP, { workshop_id: paidPlace.id, workshop_tier_id: paidPlace.tierId }],
      ['a S$0 workshop place', WORKSHOP, { workshop_id: freePlace.id, workshop_tier_id: freePlace.tierId }],
      ['paid Merch', MERCH, { merch_id: await merchItem('35.00') }],
      ['free Merch', MERCH, { merch_id: await merchItem('0.00') }],
      ['a paid corporate package', PACKAGE, { package_kind: 'corporate', package_id: await corporatePackage('480.00') }],
      ['a S$0 corporate package', PACKAGE, { package_kind: 'corporate', package_id: await corporatePackage('0.00') }],
      ['a Cross-Location Add-On', CROSS_LOCATION, { client_package_id: plan }],
    ]
    for (const [what, path, body] of purchases) {
      const sessions = fake.callsTo('checkout.sessions.create').length
      const refused = await expectStatus(await post(ivy.headers, path, body), 400)
      assert.equal(refused.error, 'billing_details_required', `${what}: ${JSON.stringify(refused)}`)
      assert.equal(fake.callsTo('checkout.sessions.create').length, sessions, `${what} reached no payment page`)
    }
    const open = (await expectStatus(await harness.app.request('/api/v1/me/purchases/open', { headers: ivy.headers }), 200)).purchases
    assert.deepEqual(open, [], 'no Purchase was opened')
    assert.deepEqual(await receiptsOf(ivy), [], 'no Purchase was settled: there is no Receipt')
    const merch = (await expectStatus(await harness.app.request('/api/v1/me/merch-orders', { headers: ivy.headers }), 200)).orders
    assert.deepEqual(merch, [], 'no Merch was ordered')
  })

  test('INV-105 a S$0 Trial Pass taken with Billing details gives a S$0.00 Receipt whose Bill to is the chosen set, in its JSON, html, PDF and email', async () => {
    const ivy = await member()
    await saves(ivy, HOME)
    const company = await saves(ivy, COMPANY)
    const trial = await classPackage({ kind: 'trial', credits: 1, validityDays: 14, priceSgd: '0.00' })

    await takeFree(ivy, PACKAGE, { package_kind: 'class', package_id: trial, billing_details_id: company })

    await billsCompany(ivy, '0.00')
  })

  test('INV-106 Merch bought with Billing details, paid or free, carries them to its Receipt', async () => {
    const kai = await member()
    const paidFor = await saves(kai, COMPANY)
    await pay(kai, MERCH, { merch_id: await merchItem('35.00'), billing_details_id: paidFor })
    await billsCompany(kai, '35.00')

    const lou = await member()
    const free = await saves(lou, COMPANY)
    await takeFree(lou, MERCH, { merch_id: await merchItem('0.00'), billing_details_id: free })
    await billsCompany(lou, '0.00')
  })

  test('INV-107 a S$0 class package, a S$0 workshop place and a corporate package, paid or S$0, each bill the set chosen at checkout', async () => {
    const pack = await member()
    await takeFree(pack, PACKAGE, {
      package_kind: 'class',
      package_id: await classPackage({ kind: 'credit_bundle', priceSgd: '0.00' }),
      billing_details_id: await saves(pack, COMPANY),
    })
    await billsCompany(pack, '0.00')

    const sam = await member()
    const place = await workshop('0.00')
    await takeFree(sam, WORKSHOP, { workshop_id: place.id, workshop_tier_id: place.tierId, billing_details_id: await saves(sam, COMPANY) })
    await billsCompany(sam, '0.00')

    const eve = await member()
    await pay(eve, PACKAGE, { package_kind: 'corporate', package_id: await corporatePackage('480.00'), billing_details_id: await saves(eve, COMPANY) })
    await billsCompany(eve, '480.00')

    const ada = await member()
    await takeFree(ada, PACKAGE, { package_kind: 'corporate', package_id: await corporatePackage('0.00'), billing_details_id: await saves(ada, COMPANY) })
    await billsCompany(ada, '0.00')
  })

  test('INV-108 a sale with no member checkout behind it, a payment from before Purchases or a sale the Receipt backfill reaches, issues a Receipt with no Bill to, issued to the member\'s name and email', async () => {
    // The provider delivers a payment for a session from before Purchases
    // existed: its metadata names no Purchase, and the webhook opens one for it.
    const lee = await member()
    await saves(lee, COMPANY)
    const bundle = await classPackage({ kind: 'credit_bundle', priceSgd: '150.00' })
    await deliverPaid(studio, { kind: 'class_package', package_id: bundle, client_id: lee.clientId, amount_sgd: '150.00' }, 15000)
    await issuedToMember(lee)

    // A sale recorded before Receipts, in a studio of its own, reached by the backfill.
    const slug = `billing-required-${run}`
    const [row] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO tenants (slug, name, timezone, status)
      VALUES (${slug}, ${`Billing required ${run}`}, 'Asia/Singapore', 'active')
      RETURNING id`)
    const own = { id: row!.id, slug }
    ownStudios.push(own)
    const mia = await member(own)
    await saves(mia, COMPANY)
    const [sale] = await harness.db.execute<{ id: string }>(sql`
      INSERT INTO purchases (tenant_id, client_id, kind, total_sgd, amount_paid_sgd, status, metadata, created_at, settled_at)
      VALUES (${own.id}, ${mia.clientId}, 'class_package', '80.00', '80.00', 'paid',
              ${JSON.stringify({ item_name: 'Five pack' })}::jsonb, '2025-03-05T02:00:00Z', '2025-03-06T02:00:00Z')
      RETURNING id`)
    await harness.db.execute(sql`
      INSERT INTO stripe_payments (tenant_id, purchase_id, client_id, payment_intent_id, amount_sgd, kind, status, method, card_brand, card_last4, created_at)
      VALUES (${own.id}, ${sale!.id}, ${mia.clientId}, ${`pi_${randomUUID().slice(0, 12)}`}, '80.00', 'class_package', 'succeeded',
              'card', 'visa', '4242', '2025-03-06T02:00:00Z')`)
    const { backfillReceipts } = await import('../services/receipts/backfill-cli')
    await backfillReceipts(slug)
    await issuedToMember(mia)
  })
})
