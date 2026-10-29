import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'
import type { OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.receipt-bill-to.test`
// Not ending in "Flow" / "Bundle" / "Retreat": isolation.test.ts purges by those suffixes.
const NAME = `Payer ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** The studio's Cross-Location Add-On rate in this file: 3 months of it is S$60.00. */
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
const HOME_LINES = ['Mia Tan', '8 Orchard Road', 'Singapore 238823', 'Singapore']

/**
 * A paid checkout bills the member's chosen Billing details: the set is
 * copied onto the Purchase when it opens and from it onto the Receipt, which
 * shows it as **Bill to**, with the member's email, in its JSON, its `html`,
 * its PDF and the confirmation email alike. Editing or deleting the set later
 * changes nothing issued; resuming a part-paid Purchase bills the set it was
 * opened with.
 *
 * Asked over HTTP: the member's own Billing details routes, a checkout, the
 * provider's delivery to the studio's own webhook (the Stripe fake stands in
 * for the provider), then the Receipt read back from `/me/receipts` and the
 * email from the test mail capture.
 *
 * Written from the INV rows of the Scenario Inventory (`docs/md/test-scenarios.md`).
 */
describe('a Receipt bills the Billing details chosen at checkout', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
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
    bundleId: string
    unlimitedId: string
  }
  let policyBefore!: { crossLocationRateSgd: string; partPaymentEnabled: boolean }

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
  async function member(): Promise<Member> {
    const email = `member-${members++}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, studio)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, studio.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name: 'Mia Tan', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
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
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: studio.id,
        clientId: who.clientId,
        kind: 'unlimited',
        sourceClassPackageId: studio.unlimitedId,
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
  const patch = (headers: Record<string, string>, path: string, body: unknown) =>
    harness.app.request(path, { method: 'PATCH', headers: { ...headers, ...json }, body: JSON.stringify(body) })

  const PACKAGE = '/api/v1/me/checkout/package'
  const WORKSHOP = '/api/v1/me/checkout/workshop'
  const CROSS_LOCATION = '/api/v1/me/checkout/cross-location'

  /** A set of Billing details saved through the member's own route. */
  async function saves(who: Member, set: Record<string, string>): Promise<string> {
    const added = await expectStatus(await post(who.headers, '/api/v1/me/billing-details', set), 201)
    return added.billing_details.id as string
  }

  /** The provider's checkout-completed delivery for the last session: the whole of what it charged, on a fresh intent. */
  async function deliver(): Promise<void> {
    const call = fake.callsTo('checkout.sessions.create').at(-1)
    assert.ok(call, 'no checkout session was created')
    const params = call.args[0] as { metadata: Record<string, string>; line_items: any[] }
    const amount = params.line_items.reduce((n: number, l: any) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0)
    const event = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${randomUUID()}`,
          payment_intent: `pi_${randomUUID()}`,
          payment_status: 'paid',
          amount_total: amount,
          metadata: params.metadata,
        },
      },
    }
    await expectStatus(
      await harness.app.request(stripeWebhookPath(studio.slug), {
        method: 'POST',
        headers: { ...json, 'stripe-signature': 't=1,v1=fake' },
        body: JSON.stringify(event),
      }),
      200,
    )
  }

  /** Check out to the provider's page, and have the provider say it was paid. */
  async function pay(who: Member, path: string, body: Record<string, unknown>): Promise<void> {
    await expectStatus(await post(who.headers, path, body), 200)
    await deliver()
  }

  /* ── what the member can read ───────────────────────────────────────── */

  const mailTo = (email: string) => mailer.discardedMail.filter(m => m.to === email)

  /** The member's one Receipt, as their account shows it. */
  async function onlyReceipt(who: Member): Promise<Record<string, any>> {
    const listed = await expectStatus(await harness.app.request('/api/v1/me/receipts', { headers: who.headers }), 200)
    assert.equal(listed.receipts.length, 1, 'exactly one Receipt')
    return expectStatus(await harness.app.request(`/api/v1/me/receipts/${listed.receipts[0].id}`, { headers: who.headers }), 200)
  }

  /** The Receipt's PDF, as the member downloads it. */
  async function receiptPdfText(who: Member, receipt: Record<string, any>): Promise<string> {
    const res = await harness.app.request(`/api/v1/me/receipts/${receipt.id}/pdf`, { headers: who.headers })
    assert.equal(res.status, 200)
    return pdfText(new Uint8Array(await res.arrayBuffer()))
  }

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

  /** The Receipt's JSON, `html`, PDF and the email that carried it all bill `lines`, with the member's email. */
  async function billsTo(who: Member, lines: string[], set: Record<string, string | undefined>): Promise<Record<string, any>> {
    const receipt = await onlyReceipt(who)
    assert.deepEqual(receipt.bill_to, {
      name: set.name,
      line1: set.line1,
      line2: set.line2 ?? null,
      city: set.city,
      state: set.state ?? null,
      postcode: set.postcode,
      country: set.country ?? 'SG',
    })
    readsBillTo(receipt.html, lines, who.email, 'the html')
    readsBillTo(await receiptPdfText(who, receipt), lines, who.email, 'the PDF')
    const sent = carrying(who, receipt)
    assert.equal(sent.length, 1, `exactly one email carries the Receipt: ${mailTo(who.email).map(m => m.subject).join(' | ')}`)
    readsBillTo(sent[0]!.text ?? '', lines, who.email, "the email's plain text")
    return receipt
  }

  /** The emails to the member that carry this Receipt. */
  const carrying = (who: Member, receipt: Record<string, any>): OutboundMessage[] =>
    mailTo(who.email).filter(m => (m.text ?? '').includes(receipt.number))

  /** The Receipt reads the same, field for field, in its JSON, `html` and PDF, as it did when first read. */
  async function unchanged(who: Member, before: Record<string, any>, beforePdf: string): Promise<void> {
    const now = await onlyReceipt(who)
    assert.deepEqual(now, before)
    assert.equal(await receiptPdfText(who, now), beforePdf)
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
    const [bundle, unlimited] = await harness.db
      .insert(schema.classPackages)
      .values([
        { tenantId: tenant.id, name: `${NAME} ten pack`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '150.00' },
        { tenantId: tenant.id, name: `${NAME} unlimited`, kind: 'unlimited', durationMonths: 3, credits: null, validityDays: null, priceSgd: '300.00' },
      ])
      .returning({ id: schema.classPackages.id })
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, tenant.id))
    assert.ok(policy, 'a seeded policy')
    policyBefore = { crossLocationRateSgd: policy.crossLocationRateSgd, partPaymentEnabled: policy.partPaymentEnabled }
    await harness.db
      .update(schema.globalPolicy)
      .set({ crossLocationRateSgd: ADD_ON_RATE, partPaymentEnabled: true })
      .where(eq(schema.globalPolicy.tenantId, tenant.id))
    studio = {
      ...tenant,
      locationId: location!.id,
      roomId: room!.id,
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
      bundleId: bundle!.id,
      unlimitedId: unlimited!.id,
    }
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    try {
      if (studio && policyBefore) {
        await harness.db.update(schema.globalPolicy).set(policyBefore).where(eq(schema.globalPolicy.tenantId, studio.id))
      }
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      const workshops = sql`SELECT id FROM workshops WHERE created_by_staff_id IN (${staffIds})`
      const locations = sql`SELECT id FROM locations WHERE name = ${`${NAME} hall`}`
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
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

  test('INV-90 a paid class package checked out with a set of Billing details bills it: the Receipt shows Bill to, the set and the member\'s email', async () => {
    const mia = await member()
    await saves(mia, HOME)
    const company = await saves(mia, COMPANY)
    await pay(mia, PACKAGE, { package_kind: 'class', package_id: studio.bundleId, billing_details_id: company })

    await billsTo(mia, COMPANY_LINES, COMPANY)
  })

  test('INV-91 a paid workshop place and a Cross-Location Add-On bought for a plan held bill the set chosen at their checkouts', async () => {
    const wren = await member()
    const company = await saves(wren, COMPANY)
    const place = await workshop('80.00')
    await pay(wren, WORKSHOP, { workshop_id: place.id, workshop_tier_id: place.tierId, billing_details_id: company })
    await billsTo(wren, COMPANY_LINES, COMPANY)

    const eli = await member()
    await saves(eli, COMPANY)
    const home = await saves(eli, HOME)
    const plan = await holdsUnlimited(eli)
    await pay(eli, CROSS_LOCATION, { client_package_id: plan, billing_details_id: home })
    await billsTo(eli, HOME_LINES, HOME)
  })

  test('INV-92 editing the set a Receipt billed, then deleting it, leaves the issued Receipt\'s Bill to as it was', async () => {
    const ada = await member()
    const company = await saves(ada, COMPANY)
    await pay(ada, PACKAGE, { package_kind: 'class', package_id: studio.bundleId, billing_details_id: company })
    const issued = await billsTo(ada, COMPANY_LINES, COMPANY)
    const issuedPdf = await receiptPdfText(ada, issued)

    await expectStatus(
      await patch(ada.headers, `/api/v1/me/billing-details/${company}`, { name: 'Harbour Holdings Sdn Bhd', line1: '1 Jalan Baru', country: 'SG' }),
      200,
    )
    await unchanged(ada, issued, issuedPdf)

    await expectStatus(await harness.app.request(`/api/v1/me/billing-details/${company}`, { method: 'DELETE', headers: ada.headers }), 200)
    await unchanged(ada, issued, issuedPdf)
  })

  test('INV-93 a part-paid Purchase resumed with no Billing details bills the set it was opened with, though that set was since edited and deleted', async () => {
    const pia = await member()
    const company = await saves(pia, COMPANY)
    const home = await saves(pia, HOME)
    await expectStatus(
      await post(pia.headers, PACKAGE, { package_kind: 'class', package_id: studio.bundleId, part_payment_sgd: 50, billing_details_id: company }),
      200,
    )
    await deliver()
    const open = (await expectStatus(await harness.app.request('/api/v1/me/purchases/open', { headers: pia.headers }), 200)).purchases as any[]
    assert.equal(open.length, 1, 'the Purchase is left open')

    await expectStatus(await post(pia.headers, `/api/v1/me/billing-details/${home}/default`, {}), 200)
    await expectStatus(await patch(pia.headers, `/api/v1/me/billing-details/${company}`, { name: 'Harbour Holdings Sdn Bhd' }), 200)
    await expectStatus(await harness.app.request(`/api/v1/me/billing-details/${company}`, { method: 'DELETE', headers: pia.headers }), 200)

    await expectStatus(await post(pia.headers, `/api/v1/me/purchases/${open[0].id}/resume`, {}), 200)
    await deliver()
    await billsTo(pia, COMPANY_LINES, COMPANY)
  })

  test('INV-94 a checkout naming another member\'s Billing details, or a set that is none, is refused 404 billing_details_not_found and opens nothing', async () => {
    const owner = await member()
    const theirs = await saves(owner, COMPANY)
    const ivy = await member()
    await saves(ivy, HOME)
    const place = await workshop('80.00')
    const plan = await holdsUnlimited(ivy)

    for (const billing_details_id of [theirs, randomUUID()]) {
      for (const [path, body] of [
        [PACKAGE, { package_kind: 'class', package_id: studio.bundleId }],
        [WORKSHOP, { workshop_id: place.id, workshop_tier_id: place.tierId }],
        [CROSS_LOCATION, { client_package_id: plan }],
      ] as const) {
        const sessions = fake.callsTo('checkout.sessions.create').length
        const refused = await expectStatus(await post(ivy.headers, path, { ...body, billing_details_id }), 404)
        assert.equal(refused.error, 'billing_details_not_found', `${path}: ${JSON.stringify(refused)}`)
        assert.equal(fake.callsTo('checkout.sessions.create').length, sessions, `${path} reached no payment page`)
      }
    }
    const open = (await expectStatus(await harness.app.request('/api/v1/me/purchases/open', { headers: ivy.headers }), 200)).purchases
    assert.deepEqual(open, [], 'no Purchase was opened')
  })
})
