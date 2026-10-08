import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'
import type { OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.purchase-confirmation.test`
// Not ending in "Flow" / "Bundle" / "Retreat": isolation.test.ts purges by those suffixes.
const NAME = `Receipt ${run}`
const GOOD_SIGNATURE = 't=1,v1=good'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * A member's purchase confirmation is their receipt (#370): every purchase kind
 * sends exactly one, on the template for its kind, carrying the amount the
 * member actually paid (NTF-03); and what it says about validity is true of the
 * package it confirms (NTF-04).
 *
 * Written from the NTF rows of the Scenario Inventory (`docs/md/test-scenarios.md`)
 * and fe-client-features §7, admin-restructure §16b, prd §7.2. The payment
 * provider is the one fake; the mail is read back from the test capture and
 * the email log.
 */
describe('purchase confirmation carries the amount paid', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail
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
    unlimitedId: string
    freeTrialId: string
    ptId: string
    corporateId: string
  }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio

  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
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

  async function catalogue(
    tenantId: string,
    values: Partial<typeof schema.classPackages.$inferInsert> & { kind: 'credit_bundle' | 'unlimited' | 'trial' },
  ): Promise<string> {
    const [row] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId, name: `${NAME} ${values.kind}`, priceSgd: '150.00', status: 'active', ...values })
      .returning({ id: schema.classPackages.id })
    return row!.id
  }

  /** The studio's own premises (so no other file's class shares a workshop's room) and catalogue. */
  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `Receipt hall ${run}` })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `Receipt room ${run}`, capacity: 30 })
      .returning({ id: schema.rooms.id })
    const [pt] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: `${NAME} pt`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00' })
      .returning({ id: schema.ptPackages.id })
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
      bundleId: await catalogue(tenant.id, { kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '150.00' }),
      unlimitedId: await catalogue(tenant.id, { kind: 'unlimited', durationMonths: 3, priceSgd: '300.00' }),
      freeTrialId: await catalogue(tenant.id, { kind: 'trial', credits: 1, validityDays: 14, priceSgd: '0.00' }),
      ptId: pt!.id,
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

  /* ── requests ───────────────────────────────────────────────────────── */

  const post = (headers: Record<string, string>, path: string, body: unknown) =>
    harness.app.request(path, { method: 'POST', headers: { ...headers, ...json }, body: JSON.stringify(body) })

  const checkout = (who: { headers: Record<string, string> }, body: Record<string, unknown>) =>
    post(who.headers, '/api/v1/me/checkout/package', body)

  function lastSession(): { metadata: Record<string, string>; line_items: any[] } {
    const call = fake.callsTo('checkout.sessions.create').at(-1)
    assert.ok(call, 'no checkout session was created')
    return call.args[0] as any
  }

  /** The provider's checkout-completed delivery for the last session, paid in full, at the buyer's studio. */
  async function deliver(intent = `pi_${randomUUID()}`, endpoint?: string): Promise<Response> {
    const params = lastSession()
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
    return harness.app.request(endpoint ?? stripeWebhookPath(params.metadata.tenant_id === two.id ? two.slug : one.slug), {
      method: 'POST',
      headers: { ...json, 'stripe-signature': GOOD_SIGNATURE },
      body: JSON.stringify(event),
    })
  }

  /** Check out and pay: the checkout answers with the provider's page, then the provider delivers. */
  async function pay(who: Member, body: Record<string, unknown>, path = '/api/v1/me/checkout/package'): Promise<void> {
    const started = await expectStatus(await post(who.headers, path, body), 200)
    assert.match(started.url, /^https:\/\/pay\.example\.test\//)
    assert.equal(mailTo(who.email).length, 0, 'nothing is confirmed before the money arrives')
    await expectStatus(await deliver(), 200)
  }

  /* ── state ──────────────────────────────────────────────────────────── */

  const mailTo = (email: string) => discardedMail.filter(m => m.to === email)
  const templateOf = (m: OutboundMessage) => m.tags.find(t => t.name === 'template')?.value
  const textOf = (m: OutboundMessage) => m.text ?? ''
  const logged = (email: string) => harness.db.select().from(schema.emailLog).where(eq(schema.emailLog.recipientEmail, email))
  const packagesOf = (who: Member) =>
    harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, who.clientId))

  /**
   * Exactly one confirmation reached the member, on `slug`, logged under their
   * studio, saying `amount` — in the email they read and in the studio's log.
   */
  async function oneConfirmation(who: Member, at: { id: string }, slug: string, amount: string): Promise<OutboundMessage> {
    const mail = mailTo(who.email)
    assert.equal(mail.length, 1, `exactly one confirmation: ${mail.map(m => m.subject).join(' | ')}`)
    const sent = mail[0]!
    assert.equal(templateOf(sent), slug)
    assert.ok(textOf(sent).includes(amount), `the amount paid ${amount} is in the email: ${textOf(sent)}`)
    assert.ok(sent.html.includes(amount), `the amount paid ${amount} is in the html`)

    const rows = await logged(who.email)
    assert.deepEqual(rows.map(r => [r.templateSlug, r.tenantId, r.status]), [[slug, at.id, 'sent']])
    assert.ok(rows[0]!.bodyRendered?.includes(amount), 'the logged body carries the amount paid')
    return sent
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))

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
      latest_charge: { id: `ch_${String(id)}`, receipt_url: `https://pay.example.test/receipts/${String(id)}` },
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
      const locations = sql`SELECT id FROM locations WHERE name = ${`Receipt hall ${run}`}`
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM promo_code_redemptions WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM corporate_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE workshop_id IN (${workshops}) OR client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM promo_codes WHERE created_by_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${workshops}))`)
      await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshops WHERE id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${`${NAME}%`}`)
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

  /* ── NTF-03 ─────────────────────────────────────────────────────────── */

  test('NTF-03 a paid Credit Bundle is confirmed once with the amount the member paid, not its list price', async () => {
    // A Promo Code takes S$30 off the S$150 bundle, so the amount paid is not
    // the catalogue's figure: the email has to read it off the sale.
    const code = `RCPT${run.toUpperCase()}`.slice(0, 24)
    await harness.db.insert(schema.promoCodes).values({
      tenantId: one.id,
      code,
      label: 'Thirty off',
      kind: 'amount',
      amountOffSgd: '30.00',
      appliesToAll: true,
      createdByStaffId: one.admin.id,
    })
    const mia = await member(one)
    await pay(mia, { package_kind: 'class', package_id: one.bundleId, promo_code: code })

    const [held] = await packagesOf(mia)
    assert.equal(held?.kind, 'credit_bundle')
    assert.equal(held?.amountPaidSgd, '120.00')
    assert.equal(held?.listPriceSgd, '150.00')

    const sent = await oneConfirmation(mia, one, 'package_purchase_confirmed', 'S$120.00')
    assert.ok(!textOf(sent).includes('150.00'), 'the list price is not what the receipt says was paid')
  })

  test('NTF-03 a paid Unlimited Plan bought with its Cross-Location Add-On is confirmed once with the whole charge', async () => {
    const leo = await member(one)
    await pay(leo, { package_kind: 'class', package_id: one.unlimitedId, location_id: one.locationId, cross_location_add_on: true })
    // What the provider was asked to charge: the plan's line and the Add-On's.
    const params = lastSession()
    assert.equal(params.line_items.length, 2, 'the plan and its Add-On are one session')
    const chargedCents = params.line_items.reduce((n: number, l: any) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0)
    assert.ok(chargedCents > 30000, 'the Add-On costs something on top of the plan')

    const [plan] = await packagesOf(leo)
    assert.equal(plan?.kind, 'unlimited')
    assert.equal(plan?.amountPaidSgd, '300.00')
    assert.ok(plan?.crossLocationPaidSgd, 'the Add-On was bought with the plan')

    const whole = `S$${(chargedCents / 100).toFixed(2)}`
    await oneConfirmation(leo, one, 'package_purchase_confirmed', whole)
  })

  test('NTF-03 a paid PT package is confirmed once with the amount paid', async () => {
    const ana = await member(two)
    await pay(ana, { package_kind: 'pt', package_id: two.ptId })
    const [held] = await packagesOf(ana)
    assert.equal(held?.kind, 'pt')
    assert.equal(held?.tenantId, two.id)
    assert.equal(held?.amountPaidSgd, '400.00')

    const sent = await oneConfirmation(ana, two, 'package_purchase_confirmed', 'S$400.00')
    assert.ok(textOf(sent).includes('5 private sessions'), 'it confirms what was bought')
  })

  test('NTF-03 a free Trial Pass is confirmed once on the trial template, with the zero amount', async () => {
    for (const at of [one, two]) {
      const ivy = await member(at)
      const before = fake.callsTo('checkout.sessions.create').length
      const granted = await expectStatus(await checkout(ivy, { package_kind: 'class', package_id: at.freeTrialId }), 201)
      assert.equal(granted.outcome, 'granted')
      assert.equal(fake.callsTo('checkout.sessions.create').length, before, 'no payment step')

      const [held] = await packagesOf(ivy)
      assert.equal(held?.id, granted.client_package_id)
      assert.equal(held?.kind, 'trial')
      assert.equal(held?.amountPaidSgd, '0.00')

      await oneConfirmation(ivy, at, 'trial_pass_purchase_confirmed', 'S$0.00')
    }
  })

  /* ── workshops ──────────────────────────────────────────────────────── */

  let slot = 0
  /** A one-day workshop with one tier, built through the admin editor's own routes. */
  async function workshop(at: Studio, price: string): Promise<{ id: string; tierId: string }> {
    const call = async (path: string, body: unknown) => expectStatus(await post(at.admin.headers, path, body), 201)
    const created = await call('/api/v1/portal/admin/workshops', {
      name: `Receipt workshop ${run} ${slot}`,
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

  const workshopPlacesOf = (who: Member) =>
    harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.clientId, who.clientId), eq(schema.bookings.kind, 'workshop')))

  test('NTF-03 a paid workshop place is confirmed once with the amount paid', async () => {
    const w = await workshop(one, '85.50')
    const zoe = await member(one)
    await pay(zoe, { workshop_id: w.id, workshop_tier_id: w.tierId }, '/api/v1/me/checkout/workshop')

    const [place] = await workshopPlacesOf(zoe)
    assert.equal(place?.workshopId, w.id)
    assert.equal(place?.state, 'confirmed')
    assert.equal(place?.amountPaidSgd, '85.50')

    const sent = await oneConfirmation(zoe, one, 'workshop_purchase_confirmed', 'S$85.50')
    assert.ok(textOf(sent).includes(place!.code!), 'it carries the check-in code')
  })

  test('NTF-03 a free workshop tier is confirmed once with the zero amount', async () => {
    const w = await workshop(two, '0.00')
    const sam = await member(two)
    const before = fake.callsTo('checkout.sessions.create').length
    const granted = await expectStatus(
      await post(sam.headers, '/api/v1/me/checkout/workshop', { workshop_id: w.id, workshop_tier_id: w.tierId }),
      201,
    )
    assert.equal(granted.outcome, 'granted')
    assert.equal(fake.callsTo('checkout.sessions.create').length, before, 'no payment step')

    const [place] = await workshopPlacesOf(sam)
    assert.equal(place?.id, granted.booking_id)
    assert.equal(place?.amountPaidSgd, '0.00')

    await oneConfirmation(sam, two, 'workshop_purchase_confirmed', 'S$0.00')
  })

  /* ── corporate ──────────────────────────────────────────────────────── */

  const corporateRequestsOf = (who: Member) =>
    harness.db.select().from(schema.corporateRequests).where(eq(schema.corporateRequests.clientId, who.clientId))

  test('NTF-03 a paid corporate package is confirmed once with the amount paid, however often its payment is delivered', async () => {
    const eve = await member(one)
    const intent = `pi_${randomUUID()}`
    await expectStatus(await checkout(eve, { package_kind: 'corporate', package_id: one.corporateId }), 200)
    assert.equal(mailTo(eve.email).length, 0, 'nothing is confirmed before the money arrives')

    await expectStatus(await deliver(intent), 200)
    // The provider retries, and the confirmation page's fallback reads the same session.
    await expectStatus(await deliver(intent), 200)

    const requests = await corporateRequestsOf(eve)
    assert.equal(requests.length, 1, 'one Corporate Request')
    assert.equal(requests[0]?.status, 'pending')

    const sent = await oneConfirmation(eve, one, 'corporate_purchase_confirmed', 'S$480.00')
    assert.ok(textOf(sent).includes(`${NAME} corporate`), `it names the package: ${textOf(sent)}`)
    assert.ok(sent.html.includes(`https://pay.example.test/receipts/${intent}`), 'it links the provider receipt')
  })

  test('NTF-03 a corporate delivery that fails to commit mails no one, and the provider\'s retry sends the one confirmation', async () => {
    const kim = await member(one)
    const intent = `pi_${randomUUID()}`
    await expectStatus(await checkout(kim, { package_kind: 'corporate', package_id: one.corporateId }), 200)

    // A check Postgres runs at COMMIT, refusing this member's Corporate Request:
    // the delivery does all its work, then its transaction fails at the end.
    const fn = sql.identifier(`refuse_corporate_${run}`)
    await harness.db.execute(sql`
      CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.client_id = ${sql.raw(`'${kim.clientId}'`)}::uuid THEN RAISE EXCEPTION 'refused at commit'; END IF;
        RETURN NEW;
      END $$`)
    try {
      await harness.db.execute(sql`
        CREATE CONSTRAINT TRIGGER refuse_corporate AFTER INSERT ON corporate_requests
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fn}()`)
      const failed = await deliver(intent)
      assert.equal(failed.status, 500, await failed.text())
      assert.equal((await corporateRequestsOf(kim)).length, 0, 'the request was rolled back')
      assert.equal(mailTo(kim.email).length, 0, 'nobody was told about a request that does not exist')
      assert.equal((await logged(kim.email)).length, 0)
    } finally {
      await harness.db.execute(sql`DROP TRIGGER IF EXISTS refuse_corporate ON corporate_requests`)
      await harness.db.execute(sql`DROP FUNCTION IF EXISTS ${fn}()`)
    }

    await expectStatus(await deliver(intent), 200)
    assert.equal((await corporateRequestsOf(kim)).length, 1)
    await oneConfirmation(kim, one, 'corporate_purchase_confirmed', 'S$480.00')
  })

  test('NTF-03, NTF-07 when the corporate confirmation cannot be sent, the request stands and the failure is logged', async () => {
    // Take studio two's template away, so the send fails after the commit.
    const where = and(eq(schema.emailTemplates.tenantId, two.id), eq(schema.emailTemplates.slug, 'corporate_purchase_confirmed'))
    const [template] = await harness.db.select().from(schema.emailTemplates).where(where)
    assert.ok(template, 'a studio has the corporate confirmation')
    await harness.db.delete(schema.emailTemplates).where(where)
    try {
      const ada = await member(two)
      harness.logs.clear()
      await pay(ada, { package_kind: 'corporate', package_id: two.corporateId })

      const requests = await corporateRequestsOf(ada)
      assert.equal(requests.length, 1, 'the request stands')
      assert.equal(requests[0]?.tenantId, two.id)
      const [payment] = await harness.db.select().from(schema.stripePayments).where(eq(schema.stripePayments.clientId, ada.clientId))
      assert.equal(payment?.status, 'succeeded', 'the payment is banked')
      assert.equal(mailTo(ada.email).length, 0, 'the email did fail')
      assert.ok(
        harness.logs.lines().some(l => l.msg === 'corporate purchase confirmation email failed' && l.tenantId === two.id),
        `the failure is logged: ${JSON.stringify(harness.logs.lines().map(l => l.msg))}`,
      )
    } finally {
      await harness.db.insert(schema.emailTemplates).values(template)
    }
  })

  /* ── NTF-04 ─────────────────────────────────────────────────────────── */

  const DORMANT_PLAN = 'Valid 3 months from your first class — your package activates when you make your first booking.'

  test('NTF-04 an Unlimited Plan is bought Dormant and its email says it activates at the first booking', async () => {
    const kai = await member(one)
    await pay(kai, { package_kind: 'class', package_id: one.unlimitedId, location_id: one.locationId })

    const [plan] = await packagesOf(kai)
    assert.equal(plan?.kind, 'unlimited')
    assert.equal(plan?.expiresAt, null, 'Dormant: no end date until the first booking')
    assert.equal(plan?.durationMonths, 3)

    const sent = await oneConfirmation(kai, one, 'package_purchase_confirmed', 'S$300.00')
    assert.ok(textOf(sent).includes(DORMANT_PLAN), `it promises Activation at the first booking: ${textOf(sent)}`)
    assert.ok(!/Expires/.test(textOf(sent)), 'and names no end date it does not have')
  })

  test('NTF-04 an Unlimited Plan bought while the member holds a live plan is Dormant too, and says so', async () => {
    const lia = await member(one)
    // A plan already running: Activated, with an end date a month out.
    await harness.db.insert(schema.clientPackages).values({
      tenantId: one.id,
      clientId: lia.clientId,
      kind: 'unlimited',
      sourceClassPackageId: one.unlimitedId,
      locationId: one.locationId,
      durationMonths: 3,
      creditsOrSessionsRemaining: null,
      expiresAt: new Date(Date.now() + 30 * DAY),
      active: true,
      amountPaidSgd: '300.00',
      listPriceSgd: '300.00',
    })
    await pay(lia, { package_kind: 'class', package_id: one.unlimitedId, location_id: one.locationId })

    const plans = await packagesOf(lia)
    assert.equal(plans.length, 2)
    const bought = plans.find(p => p.purchaseId !== null)
    assert.equal(bought?.expiresAt, null, 'the new plan waits for its own first booking (be/docs/adr/0004, 0010)')

    const sent = await oneConfirmation(lia, one, 'package_purchase_confirmed', 'S$300.00')
    assert.ok(textOf(sent).includes(DORMANT_PLAN), `it promises Activation at the first booking: ${textOf(sent)}`)
  })

  test('NTF-04 a package that already carries an expiry is confirmed with its real end date', async () => {
    const max = await member(one)
    await pay(max, { package_kind: 'class', package_id: one.bundleId })
    const [held] = await packagesOf(max)
    assert.ok(held)
    // It has since Activated: the first booking stamped its end date.
    await harness.db
      .update(schema.clientPackages)
      .set({ expiresAt: new Date('2027-02-14T04:00:00Z') })
      .where(eq(schema.clientPackages.id, held.id))

    // No route resends a confirmation, so the sender is called as the webhook calls it.
    const send = inTenantContext(await import('../services/notifications/send-purchase-email'))
    await send.sendPackagePurchaseEmail(one.id, held.id)

    const mail = mailTo(max.email)
    assert.equal(mail.length, 2, 'the purchase confirmation, then this one')
    const resent = textOf(mail[1]!)
    assert.ok(resent.includes('Expires 14 Feb 2027'), `it prints the end date the package carries: ${resent}`)
    assert.ok(!/activat/i.test(resent), 'and does not promise an Activation that already happened')
    assert.ok(resent.includes('S$150.00'), 'the amount paid is unchanged')
  })

  /* ── refusals ───────────────────────────────────────────────────────── */

  test('NTF-03 a checkout refused to another studio\'s member or to staff sends no confirmation and sells nothing', async () => {
    const w = await workshop(one, '0.00')
    const outsider = await member(two)
    const sessionsBefore = fake.callsTo('checkout.sessions.create').length

    // Studio one's catalogue is not for sale at studio two.
    await expectStatus(await checkout(outsider, { package_kind: 'class', package_id: one.freeTrialId }), 404, 'class_package_not_found')
    // The tier is looked up first, and studio two has no such tier.
    await expectStatus(
      await post(outsider.headers, '/api/v1/me/checkout/workshop', { workshop_id: w.id, workshop_tier_id: w.tierId }),
      404,
      'workshop_tier_not_found',
    )

    // An Admin's session is not a member's.
    await expectStatus(await checkout(one.admin, { package_kind: 'class', package_id: one.freeTrialId }), 401, 'invalid_token')
    await expectStatus(
      await post(one.admin.headers, '/api/v1/me/checkout/workshop', { workshop_id: w.id, workshop_tier_id: w.tierId }),
      401,
      'invalid_token',
    )

    assert.equal(fake.callsTo('checkout.sessions.create').length, sessionsBefore, 'no payment was asked for')
    assert.equal((await packagesOf(outsider)).length, 0)
    assert.equal((await workshopPlacesOf(outsider)).length, 0)
    const placesAtW = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.workshopId, w.id))
    assert.equal(placesAtW.length, 0, 'nobody holds a place')
    assert.equal(mailTo(outsider.email).length, 0)
    assert.equal((await logged(outsider.email)).length, 0)
    const adminEmail = `admin-${one.slug}@${DOMAIN}`
    assert.equal(mailTo(adminEmail).length, 0)
  })

  test('NTF-03 a delivery at another studio\'s endpoint, or unsigned, confirms nothing and grants nothing', async () => {
    const ned = await member(one)
    await expectStatus(await checkout(ned, { package_kind: 'class', package_id: one.bundleId }), 200)

    const elsewhere = await deliver(`pi_${randomUUID()}`, stripeWebhookPath(two.slug))
    assert.notEqual(elsewhere.status, 200, `another studio's endpoint accepted it: ${await elsewhere.text()}`)

    const params = lastSession()
    const unsigned = await harness.app.request(stripeWebhookPath(one.slug), {
      method: 'POST',
      headers: { ...json, 'stripe-signature': 't=1,v1=forged' },
      body: JSON.stringify({
        id: `evt_${randomUUID()}`,
        type: 'checkout.session.completed',
        data: { object: { id: `cs_${randomUUID()}`, payment_intent: `pi_${randomUUID()}`, payment_status: 'paid', amount_total: 15000, metadata: params.metadata } },
      }),
    })
    await expectStatus(unsigned, 400, 'invalid_webhook_signature')

    assert.equal((await packagesOf(ned)).length, 0, 'nothing was granted')
    assert.equal(mailTo(ned.email).length, 0, 'nothing was confirmed')
    assert.equal((await logged(ned.email)).length, 0)
  })
})
