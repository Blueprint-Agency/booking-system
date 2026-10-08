import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.purchase-lines.test`
// Not ending in "Flow" / "Bundle" / "Retreat": isolation.test.ts purges by those suffixes.
const NAME = `Lines ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** The studio's Cross-Location Add-On rate for this file: a figure of its own, so the Add-On lines are known. */
const RATE = '20.00'

/**
 * A Purchase freezes what was in it, line by line, the moment it opens (#382):
 * the lines a Receipt will be built from. Every kind of sale is bought over
 * HTTP — the paid ones as far as the provider's page, the free ones to the
 * grant — and the Purchase it left is read back.
 *
 * Nothing a member or admin sees reads these lines yet, so the Purchase row is
 * the one place to see them, as `package-purchase.test.ts` reads it too. The
 * payment provider is the one fake.
 */
describe('a Purchase freezes its lines at checkout', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fake!: StripeFake

  type Staff = { id: string; headers: Record<string, string> }
  type Member = { clientId: string; headers: Record<string, string> }
  let studio!: {
    id: string
    slug: string
    locationId: string
    roomId: string
    admin: Staff
    instructor: Staff
    rateBefore: string
  }

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

  let products = 0
  /** A class package in the catalogue. */
  async function classPackage(
    values: Partial<typeof schema.classPackages.$inferInsert> & { kind: 'credit_bundle' | 'unlimited' | 'trial'; priceSgd: string },
  ): Promise<{ id: string; name: string }> {
    const name = `${NAME} ${values.kind} ${products++}`
    const [row] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: studio.id, name, status: 'active', credits: 5, validityDays: 30, ...values })
      .returning({ id: schema.classPackages.id })
    return { id: row!.id, name }
  }

  async function ptPackage(priceSgd: string): Promise<{ id: string; name: string }> {
    const name = `${NAME} pt ${products++}`
    const [row] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: studio.id, name, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd })
      .returning({ id: schema.ptPackages.id })
    return { id: row!.id, name }
  }

  async function merchItem(priceSgd: string): Promise<{ id: string; name: string }> {
    const name = `${NAME} mat ${products++}`
    const [row] = await harness.db
      .insert(schema.merch)
      .values({ tenantId: studio.id, title: name, priceSgd })
      .returning({ id: schema.merch.id })
    return { id: row!.id, name }
  }

  async function corporatePackage(priceSgd: string): Promise<{ id: string; name: string }> {
    const name = `${NAME} corporate ${products++}`
    const [row] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: studio.id, name, priceSgd, status: 'active', createdByStaffId: studio.admin.id })
      .returning({ id: schema.corporatePackages.id })
    return { id: row!.id, name }
  }

  /** A Promotion live now on one product. */
  async function promotion(
    parentType: 'class_package' | 'pt_package' | 'workshop',
    parentId: string,
    values: { label: string; percentOff?: number; specialPriceSgd?: string },
  ): Promise<string> {
    const now = harness.clock.now().getTime()
    const [row] = await harness.db
      .insert(schema.promotions)
      .values({
        tenantId: studio.id,
        parentType,
        parentId,
        label: values.label,
        kind: values.percentOff != null ? 'percent' : 'special_price',
        percentOff: values.percentOff ?? null,
        specialPriceSgd: values.specialPriceSgd ?? null,
        startsAt: new Date(now - DAY),
        endsAt: new Date(now + 30 * DAY),
        createdByStaffId: studio.admin.id,
      })
      .returning({ id: schema.promotions.id })
    return row!.id
  }

  let codes = 0
  /** A Promo Code taking `amountOffSgd` off anything. */
  async function promoCode(amountOffSgd: string): Promise<{ id: string; code: string }> {
    const code = `LN${run.toUpperCase()}${codes++}`.slice(0, 24)
    const [row] = await harness.db
      .insert(schema.promoCodes)
      .values({ tenantId: studio.id, code, label: `${amountOffSgd} off`, kind: 'amount', amountOffSgd, appliesToAll: true, createdByStaffId: studio.admin.id })
      .returning({ id: schema.promoCodes.id })
    return { id: row!.id, code }
  }

  let slot = 0
  /** A one-day workshop with one tier, built through the admin editor's own routes. */
  async function workshop(
    tier: { regular_price_sgd: string; early_bird_price_sgd?: string; early_bird_cutoff_at?: string },
  ): Promise<{ id: string; tierId: string; name: string }> {
    const call = async (path: string, body: unknown) => expectStatus(await post(studio.admin.headers, path, body), 201)
    const name = `${NAME} workshop ${slot}`
    const created = await call('/api/v1/portal/admin/workshops', {
      name,
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
    const made = await call(`/api/v1/portal/admin/workshops/${created.id}/tiers`, { name: 'Full', ord: 1, day_ids: [day.id], ...tier })
    return { id: created.id, tierId: made.id, name: `${name} — Full` }
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
      .values({ tenantId: studio.id, email, name: 'Mia', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  /** An Unlimited Plan the member already holds, Dormant with its whole Duration ahead. */
  async function holdsUnlimited(who: Member, durationMonths: number): Promise<string> {
    const plan = await classPackage({ kind: 'unlimited', durationMonths, priceSgd: '300.00', credits: null, validityDays: null })
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: studio.id,
        clientId: who.clientId,
        kind: 'unlimited',
        sourceClassPackageId: plan.id,
        locationId: studio.locationId,
        durationMonths,
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

  const buyPackage = (who: Member, body: Record<string, unknown>) => post(who.headers, '/api/v1/me/checkout/package', body)

  /** The one Purchase the member's sale opened. */
  async function purchaseOf(who: Member) {
    const rows = await harness.db.select().from(schema.purchases).where(eq(schema.purchases.clientId, who.clientId))
    assert.equal(rows.length, 1, 'one Purchase')
    return rows[0]!
  }

  /** What the lines add up to, in cents, read the way a Receipt will add them. */
  const linesTotalCents = (lines: Array<{ amountSgd: string }>) =>
    lines.reduce((n, l) => n + Math.round(Number(l.amountSgd) * 100), 0)

  /** A line nothing was taken off. */
  const plain = (description: string, listPriceSgd: string, quantity = 1, amountSgd = listPriceSgd) => ({
    description,
    quantity,
    listPriceSgd,
    discountSgd: '0.00',
    discounts: [],
    amountSgd,
  })

  /**
   * A paid sale got as far as the provider's page, and its Purchase holds these
   * lines, adding up to its frozen total, which is what the provider was asked
   * to charge.
   */
  async function assertPaidSale(who: Member, res: Response, kind: string, lines: unknown[], totalSgd: string) {
    const started = await expectStatus(res, 200)
    assert.match(started.url, /^https:\/\/pay\.example\.test\//)
    const sale = await purchaseOf(who)
    assert.equal(sale.kind, kind)
    assert.equal(sale.status, 'open')
    assert.equal(sale.totalSgd, totalSgd)
    assert.deepEqual(sale.lines, lines)
    assert.equal(linesTotalCents(sale.lines), Math.round(Number(totalSgd) * 100), 'the lines add up to the total')
    const charged = (fake.callsTo('checkout.sessions.create').at(-1)!.args[0] as { line_items: any[] }).line_items
      .reduce((n: number, l: any) => n + l.price_data.unit_amount * (l.quantity ?? 1), 0)
    assert.equal(charged, Math.round(Number(totalSgd) * 100), 'the provider charges the same total')
  }

  /** A free sale was granted on the spot, and its settled Purchase holds these lines, at S$0.00. */
  async function assertFreeSale(who: Member, res: Response, kind: string, lines: unknown[]) {
    const before = fake.callsTo('checkout.sessions.create').length
    const granted = await expectStatus(res, 201)
    assert.equal(granted.outcome, 'granted')
    assert.equal(fake.callsTo('checkout.sessions.create').length, before, 'no payment step')
    const sale = await purchaseOf(who)
    assert.equal(sale.kind, kind)
    assert.equal(sale.status, 'paid')
    assert.equal(sale.totalSgd, '0.00')
    assert.deepEqual(sale.lines, lines)
    assert.equal(linesTotalCents(sale.lines), 0, 'the lines add up to S$0.00')
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')

    fake = (await import('./stripe-fake')).installStripeFake()
    fake.ownAccount(harness.tenants.one)
    fake.reply('customers.create', () => ({ id: `cus_${randomUUID().slice(0, 8)}` }))
    fake.reply('checkout.sessions.create', () => {
      const id = `cs_${randomUUID()}`
      return { id, url: `https://pay.example.test/${id}` }
    })

    const tenant = harness.tenants.one
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `Lines hall ${run}` })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `Lines room ${run}`, capacity: 30 })
      .returning({ id: schema.rooms.id })
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, tenant.id))
    assert.ok(policy, 'a seeded policy')
    await harness.db.update(schema.globalPolicy).set({ crossLocationRateSgd: RATE }).where(eq(schema.globalPolicy.tenantId, tenant.id))
    studio = {
      ...tenant,
      locationId: location!.id,
      roomId: room!.id,
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
      rateBefore: policy.crossLocationRateSgd,
    }
  })

  after(async () => {
    if (!harness) return
    fake?.restore()
    try {
      if (studio) {
        await harness.db
          .update(schema.globalPolicy)
          .set({ crossLocationRateSgd: studio.rateBefore })
          .where(eq(schema.globalPolicy.tenantId, studio.id))
      }
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      const workshops = sql`SELECT id FROM workshops WHERE created_by_staff_id IN (${staffIds})`
      const locations = sql`SELECT id FROM locations WHERE name = ${`Lines hall ${run}`}`
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM promo_code_redemptions WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM corporate_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM merch_orders WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE workshop_id IN (${workshops}) OR client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM promo_codes WHERE created_by_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM promotions WHERE created_by_staff_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${workshops}))`)
      await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM workshops WHERE id IN (${workshops})`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM corporate_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM merch WHERE title LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (${locations})`)
      await harness.db.execute(sql`DELETE FROM locations WHERE id IN (${locations})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  /* ── paid sales ─────────────────────────────────────────────────────── */

  test('PAY-52 a paid Credit Bundle, Unlimited Plan, Trial Pass and PT package each open a Purchase whose one line is its total', async () => {
    const bundle = await classPackage({ kind: 'credit_bundle', priceSgd: '150.00' })
    const mia = await member()
    await assertPaidSale(mia, await buyPackage(mia, { package_kind: 'class', package_id: bundle.id }), 'class_package', [plain(bundle.name, '150.00')], '150.00')

    const plan = await classPackage({ kind: 'unlimited', durationMonths: 3, priceSgd: '300.00', credits: null, validityDays: null })
    const leo = await member()
    await assertPaidSale(
      leo,
      await buyPackage(leo, { package_kind: 'class', package_id: plan.id, location_id: studio.locationId }),
      'class_package',
      [plain(plan.name, '300.00')],
      '300.00',
    )

    const trial = await classPackage({ kind: 'trial', credits: 1, validityDays: 14, priceSgd: '25.00' })
    const ivy = await member()
    await assertPaidSale(ivy, await buyPackage(ivy, { package_kind: 'class', package_id: trial.id }), 'class_package', [plain(trial.name, '25.00')], '25.00')

    const pt = await ptPackage('400.00')
    const ana = await member()
    await assertPaidSale(ana, await buyPackage(ana, { package_kind: 'pt', package_id: pt.id }), 'pt_package', [plain(pt.name, '400.00')], '400.00')
  })

  test('PAY-52 a paid workshop place, Merch, standalone Cross-Location Add-On and corporate package each open a Purchase whose lines are its total', async () => {
    const w = await workshop({ regular_price_sgd: '85.50' })
    const zoe = await member()
    await assertPaidSale(
      zoe,
      await post(zoe.headers, '/api/v1/me/checkout/workshop', { workshop_id: w.id, workshop_tier_id: w.tierId }),
      'workshop',
      [plain(w.name, '85.50')],
      '85.50',
    )

    const mat = await merchItem('42.00')
    const kai = await member()
    await assertPaidSale(kai, await post(kai.headers, '/api/v1/me/checkout/merch', { merch_id: mat.id }), 'merch', [plain(mat.name, '42.00')], '42.00')

    // A Dormant plan of 3 months: the Add-On is 3 months at the studio's rate.
    const eli = await member()
    const held = await holdsUnlimited(eli, 3)
    // The plan the member already holds was bought before this file: only the Add-On is a sale here.
    await assertPaidSale(
      eli,
      await post(eli.headers, '/api/v1/me/checkout/cross-location', { client_package_id: held }),
      'cross_location_add_on',
      [plain('Cross-Location Add-On', RATE, 3, '60.00')],
      '60.00',
    )

    const offsite = await corporatePackage('480.00')
    const eve = await member()
    await assertPaidSale(
      eve,
      await buyPackage(eve, { package_kind: 'corporate', package_id: offsite.id }),
      'corporate_package',
      [plain(offsite.name, '480.00')],
      '480.00',
    )
  })

  test('PAY-53 a plan bought with a Cross-Location Add-On opens one Purchase with two lines, the plan and the Add-On', async () => {
    const plan = await classPackage({ kind: 'unlimited', durationMonths: 6, priceSgd: '540.00', credits: null, validityDays: null })
    const leo = await member()
    await assertPaidSale(
      leo,
      await buyPackage(leo, { package_kind: 'class', package_id: plan.id, location_id: studio.locationId, cross_location_add_on: true }),
      'class_package',
      [plain(plan.name, '540.00'), plain('Cross-Location Add-On', RATE, 6, '120.00')],
      '660.00',
    )
  })

  /* ── discounts ──────────────────────────────────────────────────────── */

  test('PAY-54 a sale with a Promotion and a Promo Code records the List Price, each discount with its source, and the amount', async () => {
    const bundle = await classPackage({ kind: 'credit_bundle', priceSgd: '150.00' })
    const promotionId = await promotion('class_package', bundle.id, { label: 'Spring 20%', percentOff: 20 })
    const code = await promoCode('30.00')
    const mia = await member()
    await assertPaidSale(
      mia,
      await buyPackage(mia, { package_kind: 'class', package_id: bundle.id, promo_code: code.code }),
      'class_package',
      [
        {
          description: bundle.name,
          quantity: 1,
          listPriceSgd: '150.00',
          discountSgd: '60.00',
          discounts: [
            { source: 'promotion', id: promotionId, label: 'Spring 20%', amountSgd: '30.00' },
            { source: 'promo_code', id: code.id, label: code.code, amountSgd: '30.00' },
          ],
          amountSgd: '90.00',
        },
      ],
      '90.00',
    )
  })

  test('PAY-54 a discounted plan bought with an Add-On discounts the plan line only', async () => {
    const plan = await classPackage({ kind: 'unlimited', durationMonths: 3, priceSgd: '300.00', credits: null, validityDays: null })
    const code = await promoCode('50.00')
    const leo = await member()
    await assertPaidSale(
      leo,
      await buyPackage(leo, {
        package_kind: 'class',
        package_id: plan.id,
        location_id: studio.locationId,
        cross_location_add_on: true,
        promo_code: code.code,
      }),
      'class_package',
      [
        {
          description: plan.name,
          quantity: 1,
          listPriceSgd: '300.00',
          discountSgd: '50.00',
          discounts: [{ source: 'promo_code', id: code.id, label: code.code, amountSgd: '50.00' }],
          amountSgd: '250.00',
        },
        plain('Cross-Location Add-On', RATE, 3, '60.00'),
      ],
      '310.00',
    )
  })

  test('PAY-54 a workshop place under a Promotion, and one at its early-bird price, record the List Price and what came off', async () => {
    const w = await workshop({ regular_price_sgd: '100.00' })
    const promotionId = await promotion('workshop', w.id, { label: 'Members week', specialPriceSgd: '70.00' })
    const zoe = await member()
    await assertPaidSale(
      zoe,
      await post(zoe.headers, '/api/v1/me/checkout/workshop', { workshop_id: w.id, workshop_tier_id: w.tierId }),
      'workshop',
      [
        {
          description: w.name,
          quantity: 1,
          listPriceSgd: '100.00',
          discountSgd: '30.00',
          discounts: [{ source: 'promotion', id: promotionId, label: 'Members week', amountSgd: '30.00' }],
          amountSgd: '70.00',
        },
      ],
      '70.00',
    )

    const early = await workshop({
      regular_price_sgd: '100.00',
      early_bird_price_sgd: '80.00',
      early_bird_cutoff_at: new Date(Date.now() + 10 * DAY).toISOString(),
    })
    const sam = await member()
    await assertPaidSale(
      sam,
      await post(sam.headers, '/api/v1/me/checkout/workshop', { workshop_id: early.id, workshop_tier_id: early.tierId }),
      'workshop',
      [
        {
          description: early.name,
          quantity: 1,
          listPriceSgd: '100.00',
          discountSgd: '20.00',
          discounts: [{ source: 'early_bird', id: null, label: 'Early bird', amountSgd: '20.00' }],
          amountSgd: '80.00',
        },
      ],
      '80.00',
    )
  })

  /* ── free sales ─────────────────────────────────────────────────────── */

  test('PAY-55 a package a Promo Code took to zero, and a free Trial Pass, settle with their lines at S$0.00', async () => {
    const bundle = await classPackage({ kind: 'credit_bundle', priceSgd: '150.00' })
    const code = await promoCode('150.00')
    const mia = await member()
    await assertFreeSale(mia, await buyPackage(mia, { package_kind: 'class', package_id: bundle.id, promo_code: code.code }), 'class_package', [
      {
        description: bundle.name,
        quantity: 1,
        listPriceSgd: '150.00',
        discountSgd: '150.00',
        discounts: [{ source: 'promo_code', id: code.id, label: code.code, amountSgd: '150.00' }],
        amountSgd: '0.00',
      },
    ])

    const trial = await classPackage({ kind: 'trial', credits: 1, validityDays: 14, priceSgd: '0.00' })
    const ivy = await member()
    await assertFreeSale(ivy, await buyPackage(ivy, { package_kind: 'class', package_id: trial.id }), 'class_package', [plain(trial.name, '0.00')])

    // A priced trial a Promotion makes free is free the same way, and says what came off.
    const offered = await classPackage({ kind: 'trial', credits: 1, validityDays: 14, priceSgd: '25.00' })
    const promotionId = await promotion('class_package', offered.id, { label: 'First class free', specialPriceSgd: '0.00' })
    const uma = await member()
    await assertFreeSale(uma, await buyPackage(uma, { package_kind: 'class', package_id: offered.id }), 'class_package', [
      {
        description: offered.name,
        quantity: 1,
        listPriceSgd: '25.00',
        discountSgd: '25.00',
        discounts: [{ source: 'promotion', id: promotionId, label: 'First class free', amountSgd: '25.00' }],
        amountSgd: '0.00',
      },
    ])
  })

  test('PAY-55 free Merch, a free corporate package and a free workshop place settle with their lines at S$0.00', async () => {
    const sticker = await merchItem('0.00')
    const kai = await member()
    await assertFreeSale(kai, await post(kai.headers, '/api/v1/me/checkout/merch', { merch_id: sticker.id }), 'merch', [plain(sticker.name, '0.00')])

    const offsite = await corporatePackage('0.00')
    const eve = await member()
    await assertFreeSale(eve, await buyPackage(eve, { package_kind: 'corporate', package_id: offsite.id }), 'corporate_package', [plain(offsite.name, '0.00')])

    const w = await workshop({ regular_price_sgd: '0.00' })
    const sam = await member()
    await assertFreeSale(
      sam,
      await post(sam.headers, '/api/v1/me/checkout/workshop', { workshop_id: w.id, workshop_tier_id: w.tierId }),
      'workshop',
      [plain(w.name, '0.00')],
    )
  })

  test('PAY-55 a workshop place a Promo Code took to zero settles with its line at S$0.00, and the place points at that Purchase', async () => {
    const w = await workshop({ regular_price_sgd: '60.00' })
    const code = await promoCode('60.00')
    const lea = await member()
    await assertFreeSale(
      lea,
      await post(lea.headers, '/api/v1/me/checkout/workshop', { workshop_id: w.id, workshop_tier_id: w.tierId, promo_code: code.code }),
      'workshop',
      [
        {
          description: w.name,
          quantity: 1,
          listPriceSgd: '60.00',
          discountSgd: '60.00',
          discounts: [{ source: 'promo_code', id: code.id, label: code.code, amountSgd: '60.00' }],
          amountSgd: '0.00',
        },
      ],
    )
    const sale = await purchaseOf(lea)
    const places = await harness.db
      .select({ purchaseId: schema.bookings.purchaseId })
      .from(schema.bookings)
      .where(eq(schema.bookings.clientId, lea.clientId))
    assert.deepEqual(places, [{ purchaseId: sale.id }])
  })

  /* ── before the column ──────────────────────────────────────────────── */

  test('PAY-56 a Purchase written without lines, as every one opened before them was, reads as having none', async () => {
    const old = await member()
    const [row] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId: studio.id, clientId: old.clientId, kind: 'class_package', totalSgd: '150.00', amountPaidSgd: '150.00', status: 'paid' })
      .returning()
    assert.deepEqual(row!.lines, [])
  })
})
