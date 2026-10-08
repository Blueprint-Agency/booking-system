import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { receiptFixtures } from './receipt-fixtures'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'
import type { OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.receipt-resend.test`
// Not ending in "Flow" / "Bundle" / "Retreat": isolation.test.ts purges by those suffixes.
const NAME = `Receipt resend ${run}`
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
 * A studio admin resends a Receipt (#390): `POST /portal/admin/receipts/:id/resend`
 * sends the member the same email their purchase sent, the receipt block and
 * the PDF with it, to the address the member has now, and the audit trail
 * records which admin sent it to whom.
 *
 * Asked over HTTP: a checkout, the provider's delivery to the studio's webhook
 * (the Stripe fake stands in for the provider) or a free checkout granted on
 * the spot, then the Admin's resend, the email read back from the test mail
 * capture. Instructors are refused the route by the authorization matrix
 * (`authorization-matrix.test.ts`).
 *
 * Written from the INV rows of the Scenario Inventory (`docs/md/test-scenarios.md`).
 */
describe('an admin resends a Receipt', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
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
      .values({ tenantId: tenant.id, email, name: `${name} ${run}`, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    return { id: row!.id, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `Receipt resend hall ${run}` })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `Receipt resend room ${run}`, capacity: 30 })
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
    return {
      ...tenant,
      locationId: location!.id,
      roomId: room!.id,
      admin,
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
      bundleId: bundle!.id,
      freeTrialId: trial!.id,
      corporateId: corporate!.id,
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
      name: `Receipt resend workshop ${run} ${slot}`,
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

  const post = (headers: Record<string, string>, path: string, body?: unknown) =>
    harness.app.request(path, {
      method: 'POST',
      headers: { ...headers, ...json },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

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

  /** Check out and have the provider say it was paid. */
  async function pay(who: Member, path: string, body: Record<string, unknown>): Promise<void> {
    await expectStatus(await post(who.headers, path, body), 200)
    await deliver(`pi_${randomUUID()}`)
  }

  /** A checkout with nothing to pay, granted on the spot. */
  async function take(who: Member, path: string, body: Record<string, unknown>): Promise<void> {
    const granted = await expectStatus(await post(who.headers, path, body), 201)
    assert.equal(granted.outcome, 'granted')
  }

  /** The member's one Receipt, as their account shows it. */
  async function onlyReceipt(who: Member): Promise<Record<string, any>> {
    const listed = await expectStatus(await harness.app.request('/api/v1/me/receipts', { headers: who.headers }), 200)
    assert.equal(listed.receipts.length, 1, 'exactly one Receipt')
    return expectStatus(await harness.app.request(`/api/v1/me/receipts/${listed.receipts[0].id}`, { headers: who.headers }), 200)
  }

  const resend = (at: Studio, receiptId: string, headers = at.admin.headers) =>
    post(headers, `/api/v1/portal/admin/receipts/${receiptId}/resend`)

  /* ── state ──────────────────────────────────────────────────────────── */

  const mailTo = (email: string) => mailer.discardedMail.filter(m => m.to === email)
  const templateOf = (m: OutboundMessage) => m.tags.find(t => t.name === 'template')?.value
  const linksOf = (m: OutboundMessage) => [...m.html.matchAll(/href="([^"]+)"/g)].map(match => match[1]!.replace(/&amp;/g, '&'))

  /**
   * `mail` is the purchase's email carrying `receipt`: the number, each line
   * and the total in the block, the member's Receipt linked, and its PDF
   * attached under the receipt number.
   */
  async function carries(mail: OutboundMessage, receipt: Record<string, any>): Promise<void> {
    const total = `S$${receipt.total_sgd}`
    for (const body of [mail.html, mail.text ?? '']) {
      assert.ok(body.includes(receipt.number), `the receipt number ${receipt.number} is in the email: ${body}`)
      for (const line of receipt.lines) assert.ok(body.includes(line.description), `the line ${line.description} is listed`)
      assert.ok(body.includes('Total paid') && body.includes(total), `the total ${total} is in the block`)
    }
    assert.ok(
      linksOf(mail).some(l => new URL(l).pathname === `/account/receipts/${receipt.id}`),
      `the member's Receipt is linked: ${linksOf(mail).join(', ')}`,
    )
    assert.equal(mail.attachments?.length, 1, 'one file attached')
    const [pdf] = mail.attachments!
    assert.equal(pdf!.filename, `${receipt.number}.pdf`)
    assert.equal(pdf!.contentType, 'application/pdf')
    const text = await pdfText(pdf!.content)
    assert.ok(text.includes(receipt.number) && text.includes(total), `the PDF is the Receipt: ${text}`)
  }

  /** The resend audit rows written for one Receipt. */
  const resendTrail = async (at: Studio, receiptId: string) => [
    ...(await harness.db.execute<Record<string, any>>(
      sql`SELECT * FROM audit_log WHERE tenant_id = ${at.id} AND action = 'receipt_resent' AND payload->>'receipt_id' = ${receiptId} ORDER BY created_at`,
    )),
  ]

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
      const locations = sql`SELECT id FROM locations WHERE name = ${`Receipt resend hall ${run}`}`
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      // What a permanently deleted member's sales left behind, no longer naming them.
      const orphaned = sql`SELECT id FROM purchases WHERE client_id IS NULL AND lines::text LIKE ${`%${NAME}%`}`
      await harness.db.execute(sql`DELETE FROM receipts WHERE purchase_id IN (${orphaned})`)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE purchase_id IN (${orphaned})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE purchase_id IN (${orphaned})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE id IN (${orphaned})`)
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

  test("INV-70 a resend sends the purchase's own email, with the Receipt and its PDF, to the member's current email", async () => {
    const mia = await member(one)
    await pay(mia, PACKAGE, { package_kind: 'class', package_id: one.bundleId })
    const receipt = await onlyReceipt(mia)
    const [confirmation] = mailTo(mia.email)
    assert.equal(templateOf(confirmation!), 'package_purchase_confirmed')

    // The member has since moved address; the Receipt still names the old one.
    const moved = `moved-${mia.email}`
    await expectStatus(await post(one.admin.headers, `/api/v1/portal/admin/clients/${mia.clientId}/email`, { email: moved }), 200)

    const sent = await expectStatus(await resend(one, receipt.id), 200)
    assert.deepEqual(sent, { sent_to: moved })

    assert.equal(mailTo(mia.email).length, 1, 'nothing more to the address on the Receipt')
    const resent = mailTo(moved)
    assert.equal(resent.length, 1, 'one email to the address the member has now')
    const [mail] = resent
    assert.equal(templateOf(mail!), 'package_purchase_confirmed', 'the email the purchase sent')
    assert.equal(mail!.subject, confirmation!.subject)
    assert.ok(mail!.text!.includes('Your package is confirmed'), `the studio's own copy: ${mail!.text}`)
    await carries(mail!, receipt)
  })

  test('INV-71 each resend files one audit row naming the admin who sent it, the Receipt and the address it went to', async () => {
    const leo = await member(one)
    await pay(leo, PACKAGE, { package_kind: 'class', package_id: one.bundleId })
    const receipt = await onlyReceipt(leo)
    const second = await staffAt(one, `admin-${randomUUID().slice(0, 6)}`, 'admin')

    assert.deepEqual(await resendTrail(one, receipt.id), [], 'the purchase itself files no resend')
    await expectStatus(await resend(one, receipt.id), 200)
    await expectStatus(await resend(one, receipt.id, second.headers), 200)

    const trail = await resendTrail(one, receipt.id)
    assert.equal(trail.length, 2, 'one row per resend')
    assert.deepEqual(
      trail.map(r => [r.actor_type, r.actor_staff_id, r.target_table, r.target_id, r.payload]),
      [one.admin.id, second.id].map(staffId => [
        'staff',
        staffId,
        'clients',
        leo.clientId,
        { receipt_id: receipt.id, receipt_number: receipt.number, sent_to: leo.email },
      ]),
    )
    assert.equal(mailTo(leo.email).length, 3, 'the confirmation and both resends')
  })

  test('INV-72 a free Trial Pass, a workshop place paid or free, and a corporate package each resend their own confirmation', async () => {
    const cases: Array<{ slug: string; buy: (who: Member) => Promise<void> }> = [
      { slug: 'trial_pass_purchase_confirmed', buy: who => take(who, PACKAGE, { package_kind: 'class', package_id: one.freeTrialId }) },
      {
        slug: 'workshop_purchase_confirmed',
        buy: async who => {
          const w = await workshop(one, '85.50')
          await pay(who, WORKSHOP, { workshop_id: w.id, workshop_tier_id: w.tierId })
        },
      },
      {
        slug: 'workshop_purchase_confirmed',
        buy: async who => {
          const w = await workshop(one, '0.00')
          await take(who, WORKSHOP, { workshop_id: w.id, workshop_tier_id: w.tierId })
        },
      },
      { slug: 'corporate_purchase_confirmed', buy: who => pay(who, PACKAGE, { package_kind: 'corporate', package_id: one.corporateId }) },
    ]
    for (const { slug, buy } of cases) {
      const who = await member(one)
      await buy(who)
      const receipt = await onlyReceipt(who)
      const [confirmation] = mailTo(who.email)
      assert.equal(templateOf(confirmation!), slug)

      await expectStatus(await resend(one, receipt.id), 200)
      const sent = mailTo(who.email)
      assert.equal(sent.length, 2, `the confirmation and the resend of ${slug}`)
      const mail = sent[1]!
      assert.equal(templateOf(mail), slug, 'the email the purchase sent')
      assert.equal(mail.subject, confirmation!.subject)
      await carries(mail, receipt)
    }
  })

  test('INV-73 once the member is permanently deleted a resend is 409 receipt_member_deleted and sends nothing, and the earlier resend no longer says to whom', async () => {
    const ada = await member(one)
    await pay(ada, PACKAGE, { package_kind: 'class', package_id: one.bundleId })
    const receipt = await onlyReceipt(ada)
    await expectStatus(await resend(one, receipt.id), 200)
    const [before] = await resendTrail(one, receipt.id)
    assert.ok(before, 'the resend is on record')

    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${ada.clientId}/permanently`, { method: 'DELETE', headers: one.admin.headers }),
      200,
    )
    const sentBefore = mailer.discardedMail.length
    const refused = await expectStatus(await resend(one, receipt.id), 409)
    assert.equal(refused.error, 'receipt_member_deleted')
    assert.equal(mailer.discardedMail.length, sentBefore, 'nothing was sent to anyone')

    const after = await resendTrail(one, receipt.id)
    assert.equal(after.length, 1, 'the refusal files no resend, and the earlier one is kept')
    assert.equal(after[0]!.actor_staff_id, one.admin.id, 'still naming the admin who sent it')
    const kept = JSON.stringify(after[0]).toLowerCase()
    for (const value of [ada.email, ada.clientId]) assert.ok(!kept.includes(value.toLowerCase()), `the row still holds ${value}: ${kept}`)
  })

  test("INV-74 another studio's Receipt is 404 receipt_not_found to resend, and nothing is sent", async () => {
    const ivy = await member(two)
    await take(ivy, PACKAGE, { package_kind: 'class', package_id: two.freeTrialId })
    const theirs = await onlyReceipt(ivy)

    for (const id of [theirs.id, randomUUID()]) {
      const refused = await expectStatus(await resend(one, id), 404)
      assert.equal(refused.error, 'receipt_not_found')
    }
    assert.equal(mailTo(ivy.email).length, 1, 'only their own confirmation')
    assert.deepEqual(await resendTrail(two, theirs.id), [])
  })

  test('INV-75 a Merch or standalone Cross-Location Add-On Receipt, whose purchase sent no email, is 409 receipt_email_unavailable to resend', async () => {
    const made = receiptFixtures(harness)
    try {
      for (const kind of ['merch', 'cross_location_add_on'] as const) {
        const kim = await member(one)
        const receipt = await made.issueFor(one.id, kim.clientId, { kind, item: `${NAME} ${kind}` })
        const refused = await expectStatus(await resend(one, receipt.id), 409)
        assert.equal(refused.error, 'receipt_email_unavailable')
        assert.equal(mailTo(kim.email).length, 0, 'nothing was sent')
        assert.deepEqual(await resendTrail(one, receipt.id), [], 'no resend is on record')
      }
    } finally {
      await made.cleanup()
    }
  })
})
