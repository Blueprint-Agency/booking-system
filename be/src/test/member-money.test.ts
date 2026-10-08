import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { StripeFake } from './stripe-fake'

const run = Date.now().toString(36)
const DOMAIN = `${run}.member-money.test`
// Not ending in "Flow" / "Bundle" / "Retreat" / "Mat": isolation.test.ts purges by those suffixes.
const NAME = `Money ${run}`
const CLASS_TYPE_NAME = `Money class type ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * A member is charged exactly what the studio promises, and never charged or
 * granted by mistake (#366): a class's credit cost, a checkout the member walked
 * away from, a Promo Code worth more than the package, and the catalogues a
 * member buys from (corporate and PT).
 *
 * Written from the SCH, PAY, PRM and CORP rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`). Every test acts through a route and then reads
 * the rows it left. The payment provider is the one fake (`stripe-fake.ts`).
 */
describe('member money over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let fake!: StripeFake

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    admin: Staff
    instructor: Staff
    bundleId: string
  }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio

  const json = { 'Content-Type': 'application/json' }
  const emailFor = (name: string) => `${name}@${DOMAIN}`

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${name}-${tenant.slug}`)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, tenant.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    return { id: row!.id, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location.id)).limit(1)
    assert.ok(room, `expected a seeded room for ${tenant.slug}`)
    const classType = await classTypesSvc.createClassType(tenant.id, { name: CLASS_TYPE_NAME })
    const admin = await staffAt(tenant, 'admin', 'admin')
    const instructor = await staffAt(tenant, 'instructor', 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: instructor.id })
    const [bundle] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} credits`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '150.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    return { ...tenant, locationId: location.id, roomId: room.id, classTypeId: classType.id, admin, instructor, bundleId: bundle!.id }
  }

  let members = 0
  async function member(at: Studio): Promise<Member> {
    const email = emailFor(`member-${members++}-${at.slug}`)
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

  /** A Credit Bundle the member already holds, as an earlier purchase would have left it. */
  async function holdsBundle(at: Studio, who: Member, credits: number): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'credit_bundle',
        sourceClassPackageId: at.bundleId,
        validityDays: 90,
        creditsOrSessionsRemaining: credits,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /**
   * `who`'s token presented on `at`'s hostname of the member app (or the
   * portal): another studio's session, or a session from the wrong pool.
   */
  const sentTo = (who: { headers: Record<string, string> }, at: Studio, app: 'client' | 'staff' = 'client') => ({
    Authorization: who.headers.Authorization!,
    'X-Tenant-Slug': at.slug,
    Origin: frontendOrigin(app, at),
    'X-Forwarded-For': harnessAddress(),
  })
  /** No session at all, on `at`'s member hostname. */
  const anonymousAt = (at: Studio) => ({
    'X-Tenant-Slug': at.slug,
    Origin: frontendOrigin('client', at),
    'X-Forwarded-For': harnessAddress(),
  })

  const send = (method: string, headers: Record<string, string>, path: string, body?: unknown) =>
    harness.app.request(path, {
      method,
      headers: body === undefined ? headers : { ...headers, ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  /* ── state ──────────────────────────────────────────────────────────── */

  const packagesOf = (clientId: string) =>
    harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, clientId)).orderBy(schema.clientPackages.purchasedAt)
  const purchasesOf = (clientId: string) => harness.db.select().from(schema.purchases).where(eq(schema.purchases.clientId, clientId))
  const paymentsOf = (clientId: string) => harness.db.select().from(schema.stripePayments).where(eq(schema.stripePayments.clientId, clientId))
  const bookingsOf = (clientId: string) => harness.db.select().from(schema.bookings).where(eq(schema.bookings.clientId, clientId))
  const balanceOf = async (clientPackageId: string) => {
    const [row] = await harness.db
      .select({ n: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, clientPackageId))
    return row?.n
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    fake = (await import('./stripe-fake')).installStripeFake()
    fake.ownAccount(harness.tenants.one)
    fake.ownAccount(harness.tenants.two)
    fake.reply('customers.create', () => ({ id: `cus_${randomUUID().slice(0, 8)}` }))
    fake.reply('checkout.sessions.create', () => {
      const id = `cs_${randomUUID()}`
      return { id, url: `https://pay.example.test/${id}` }
    })

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    try {
      fake?.restore()
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM promo_code_redemptions WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM promo_code_products WHERE promo_code_id IN (SELECT id FROM promo_codes WHERE created_by_staff_id IN (${staff}))`)
      await harness.db.execute(sql`DELETE FROM promo_codes WHERE created_by_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM corporate_packages WHERE created_by_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM class_supporting_instructors WHERE class_id IN (SELECT id FROM classes WHERE created_by_staff_id IN (${staff}))`)
      await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  /* ── SCH-03: a class's credit cost is what a booking debits ─────────── */

  let classSlots = 0
  function classBody(at: Studio, creditCost: number) {
    const startsAt = new Date(Date.now() + 3 * DAY + classSlots++ * 2 * HOUR)
    return {
      class_type_id: at.classTypeId,
      main_instructor_id: at.instructor.id,
      location_id: at.locationId,
      room_id: at.roomId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
      capacity_online: 10,
      credit_cost: creditCost,
    }
  }
  const createClass = (headers: Record<string, string>, at: Studio, creditCost: number) =>
    send('POST', headers, '/api/v1/portal/admin/schedule/classes', classBody(at, creditCost))
  const book = (headers: Record<string, string>, classId: string) =>
    send('POST', headers, '/api/v1/me/bookings/class', { class_id: classId })

  test('SCH-03 a class instance an Admin creates with credit cost 2 debits exactly 2 credits from the bundle that books it', async () => {
    const created = await expectStatus(await createClass(one.admin.headers, one, 2), 201)
    const classId = created.id as string
    assert.equal(created.credit_cost, 2, 'the class keeps the cost it was created with')
    const [stored] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, classId))
    assert.equal(stored!.creditCost, 2)

    const mia = await member(one)
    const bundle = await holdsBundle(one, mia, 5)
    const booked = await expectStatus(await book(mia.headers, classId), 201)

    const [booking, ...more] = await bookingsOf(mia.clientId)
    assert.equal(more.length, 0, 'one booking')
    assert.equal(booking!.id, booked.booking_id)
    assert.equal(booking!.classId, classId)
    assert.equal(booking!.state, 'confirmed')
    assert.equal(booking!.clientPackageId, bundle, 'paid by the bundle the member holds')
    assert.equal(booking!.creditsOrSessionsUsed, 2, 'the booking records the 2 credits it cost')
    assert.equal(await balanceOf(bundle), 3, 'exactly 2 of 5 credits debited')

    // The member's own ledger for the bundle shows the one debit of 2.
    const history = await expectStatus(await send('GET', mia.headers, `/api/v1/me/packages/${bundle}/credit-history`), 200)
    assert.deepEqual(
      history.movements.map((m: any) => [m.delta, m.balance_after, m.booking?.id]),
      [[-2, 3, booked.booking_id]],
      JSON.stringify(history),
    )
    const listed = await expectStatus(await send('GET', mia.headers, '/api/v1/me/packages'), 200)
    assert.deepEqual(
      listed.client_packages.map((p: any) => [p.id, p.credits_or_sessions_remaining]),
      [[bundle, 3]],
    )
  })

  test('SCH-03 creating a class is refused to an Instructor, a member and another studio’s Admin, and writes no class', async () => {
    const classesAt = async () => (await harness.db.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.tenantId, one.id))).length
    const before = await classesAt()
    const mia = await member(one)
    await expectStatus(await createClass(one.instructor.headers, one, 2), 403, 'forbidden_role')
    await expectStatus(await createClass(sentTo(mia, one, 'staff'), one, 2), 401, 'invalid_token')
    await expectStatus(await createClass(sentTo(two.admin, one, 'staff'), one, 2), 401, 'invalid_token')
    assert.equal(await classesAt(), before, 'a refused caller wrote a class')
  })

  test('SCH-03 booking a class is refused to another studio’s member and to a staff session, with no booking and no credit moved', async () => {
    const classId = (await expectStatus(await createClass(one.admin.headers, one, 2), 201)).id as string
    const outsider = await member(two)
    const theirs = await holdsBundle(two, outsider, 5)
    await expectStatus(await book(sentTo(outsider, one), classId), 401, 'invalid_token')
    await expectStatus(await book(sentTo(one.admin, one), classId), 401, 'invalid_token')
    await expectStatus(await book(anonymousAt(one), classId), 401, 'missing_bearer_token')
    const [{ n }] = (await harness.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM bookings WHERE class_id = ${classId}`)) as unknown as [{ n: number }]
    assert.equal(n, 0, 'a refused caller booked the class')
    assert.equal(await balanceOf(theirs), 5)
  })

  /* ── PAY-18: walking away from the payment page grants and takes nothing */

  const checkout = (headers: Record<string, string>, body: Record<string, unknown>) =>
    send('POST', headers, '/api/v1/me/checkout/package', body)
  const sessionsAsked = () => fake.callsTo('checkout.sessions.create').length

  test('PAY-18 a member who reached the payment page and went back without paying is granted nothing, and the packages they hold are unchanged', async () => {
    const mia = await member(one)
    const held = await holdsBundle(one, mia, 4)
    const packagesBefore = await packagesOf(mia.clientId)

    const asked = sessionsAsked()
    const started = await expectStatus(await checkout(mia.headers, { package_kind: 'class', package_id: one.bundleId }), 200)
    assert.match(started.url, /^https:\/\/pay\.example\.test\//, 'the member is sent to the payment page')
    assert.equal(sessionsAsked(), asked + 1)
    const session = fake.callsTo('checkout.sessions.create').at(-1)!.args[0] as Record<string, any>
    // "Back" on the provider's page lands here: the studio's own checkout page, told it was cancelled.
    assert.match(String(session.cancel_url), new RegExp(`/checkout\\?package=${one.bundleId}&kind=class&cancelled=1$`))

    // The member goes back. No payment ever confirms, so no webhook arrives.
    assert.deepEqual(await packagesOf(mia.clientId), packagesBefore, 'the packages they hold changed')
    assert.equal((await paymentsOf(mia.clientId)).length, 0, 'a payment was recorded')
    const [sale, ...more] = await purchasesOf(mia.clientId)
    assert.equal(more.length, 0)
    assert.equal(sale!.status, 'open', 'the sale stays open, owing its whole price')
    assert.equal(sale!.totalSgd, '150.00')
    assert.equal(sale!.amountPaidSgd, '0.00')

    const listed = await expectStatus(await send('GET', mia.headers, '/api/v1/me/packages'), 200)
    assert.deepEqual(
      listed.client_packages.map((p: any) => [p.id, p.credits_or_sessions_remaining]),
      [[held, 4]],
      'the account shows only what they held before',
    )
  })

  test('PAY-18 a package checkout is refused to another studio’s member and to a staff session, with no session asked and no sale opened', async () => {
    const outsider = await member(two)
    const salesAt = async (tenantId: string) =>
      (await harness.db.select({ id: schema.purchases.id }).from(schema.purchases).where(eq(schema.purchases.tenantId, tenantId))).length
    const [salesOne, salesTwo] = [await salesAt(one.id), await salesAt(two.id)]
    const asked = sessionsAsked()
    const body = { package_kind: 'class', package_id: one.bundleId }
    await expectStatus(await checkout(sentTo(outsider, one), body), 401, 'invalid_token')
    await expectStatus(await checkout(sentTo(one.admin, one), body), 401, 'invalid_token')
    assert.equal(sessionsAsked(), asked, 'the provider was asked for a session')
    assert.equal(await salesAt(one.id), salesOne, 'a sale was opened')
    assert.equal(await salesAt(two.id), salesTwo, 'a sale was opened')
  })

  /* ── PRM-17: a Promo Code worth more than the package ───────────────── */

  test('PRM-17 a Promo Code worth more than the package floors the total at 0: no payment step, and the sale records the List Price, a full discount and the code', async () => {
    const code = `OVER-${run.slice(-6).toUpperCase()}`
    const [promo] = await harness.db
      .insert(schema.promoCodes)
      .values({ tenantId: one.id, code, label: 'More than the price', kind: 'amount', amountOffSgd: '500.00', appliesToAll: true, createdByStaffId: one.admin.id })
      .returning({ id: schema.promoCodes.id })
    const val = await member(one)

    const asked = sessionsAsked()
    const granted = await expectStatus(await checkout(val.headers, { package_kind: 'class', package_id: one.bundleId, promo_code: code }), 201)
    assert.equal(granted.outcome, 'granted')
    assert.equal(sessionsAsked(), asked, 'the member was sent to a payment step')
    assert.equal((await paymentsOf(val.clientId)).length, 0, 'money moved')

    const [held, ...morePackages] = await packagesOf(val.clientId)
    assert.equal(morePackages.length, 0)
    assert.equal(held!.id, granted.client_package_id)
    assert.equal(held!.sourceClassPackageId, one.bundleId)
    assert.equal(held!.creditsOrSessionsRemaining, 10)
    assert.equal(held!.listPriceSgd, '150.00', 'the List Price is recorded')
    assert.equal(held!.amountPaidSgd, '0.00', 'nothing paid, never below zero')
    assert.equal(held!.appliedPromoCodeId, promo!.id, 'the code is recorded')

    const [sale, ...moreSales] = await purchasesOf(val.clientId)
    assert.equal(moreSales.length, 0)
    assert.equal(sale!.totalSgd, '0.00', 'the total floors at 0')
    assert.equal(sale!.amountPaidSgd, '0.00')
    assert.notEqual(sale!.status, 'open', 'the sale completed')

    // The discount actually given is the List Price, not the code's 500.
    const redemptions = await harness.db.select().from(schema.promoCodeRedemptions).where(eq(schema.promoCodeRedemptions.clientId, val.clientId))
    assert.deepEqual(
      redemptions.map(r => [r.promoCodeId, r.status, r.discountSgd, r.stripePaymentIntentId]),
      [[promo!.id, 'consumed', '150.00', null]],
    )

    // What staff read on the member's profile: list price, paid, and the code typed.
    const profile = await expectStatus(await send('GET', one.admin.headers, `/api/v1/portal/admin/clients/${val.clientId}`), 200)
    assert.deepEqual(
      profile.packages.map((p: any) => [p.id, p.list_price_sgd, p.amount_paid_sgd, p.promo_code]),
      [[held!.id, '150.00', '0.00', code]],
    )
  })

  /* ── CORP-01 and the PT listing: what a member can choose from ──────── */

  const corporate = (at: Studio, body: Record<string, unknown>) =>
    send('POST', at.admin.headers, '/api/v1/portal/admin/corporate-packages', body)
  async function corporatePackage(at: Studio, suffix: string, description: string | null, priceSgd: string): Promise<string> {
    const created = await expectStatus(await corporate(at, { name: `${NAME} corporate ${suffix}`, description, price_sgd: priceSgd }), 201)
    return created.corporatePackage.id as string
  }

  /** What the studio's catalogue holds that a member can buy: active and not deleted. */
  async function purchasableCorporate(at: Studio): Promise<string[]> {
    const rows = await harness.db
      .select({ id: schema.corporatePackages.id })
      .from(schema.corporatePackages)
      .where(and(eq(schema.corporatePackages.tenantId, at.id), eq(schema.corporatePackages.status, 'active'), sql`${schema.corporatePackages.deletedAt} IS NULL`))
    return rows.map(r => r.id).sort()
  }
  async function purchasablePt(at: Studio): Promise<string[]> {
    const rows = await harness.db
      .select({ id: schema.ptPackages.id })
      .from(schema.ptPackages)
      .where(and(eq(schema.ptPackages.tenantId, at.id), eq(schema.ptPackages.status, 'active'), sql`${schema.ptPackages.deletedAt} IS NULL`))
    return rows.map(r => r.id).sort()
  }
  const ids = (rows: Array<{ id: string }>) => rows.map(r => r.id).sort()

  test('CORP-01 an anonymous visitor sees the studio’s corporate packages with name, description and price, and the member listing returns the same', async () => {
    const team = await corporatePackage(one, 'team', 'Four sessions on site for up to twenty staff', '1200.00')
    const plain = await corporatePackage(one, 'plain', null, '800.50')
    const retired = await corporatePackage(one, 'retired', 'No longer sold', '500.00')
    await expectStatus(await send('PATCH', one.admin.headers, `/api/v1/portal/admin/corporate-packages/${retired}`, { status: 'archived' }), 200)
    const removed = await corporatePackage(one, 'removed', 'Deleted', '400.00')
    // A package is archived before it can be deleted.
    await expectStatus(await send('PATCH', one.admin.headers, `/api/v1/portal/admin/corporate-packages/${removed}`, { status: 'archived' }), 200)
    await expectStatus(await send('DELETE', one.admin.headers, `/api/v1/portal/admin/corporate-packages/${removed}`), 204)
    const elsewhere = await corporatePackage(two, 'elsewhere', 'Another studio’s', '999.00')

    const shown = await expectStatus(await send('GET', anonymousAt(one), '/api/v1/public/corporate-packages'), 200)
    const listed = shown.corporate_packages as Array<Record<string, unknown> & { id: string }>
    assert.deepEqual(ids(listed), await purchasableCorporate(one), "exactly the studio's packages on sale")
    const byId = new Map(listed.map(p => [p.id, p]))
    assert.deepEqual(
      [byId.get(team), byId.get(plain)].map(p => p && [p.name, p.description, p.price_sgd]),
      [
        [`${NAME} corporate team`, 'Four sessions on site for up to twenty staff', '1200.00'],
        [`${NAME} corporate plain`, null, '800.50'],
      ],
    )
    for (const hidden of [retired, removed, elsewhere]) assert.ok(!byId.has(hidden), `${hidden} is listed`)

    const mia = await member(one)
    const signedIn = await expectStatus(await send('GET', mia.headers, '/api/v1/me/corporate-packages'), 200)
    assert.deepEqual(
      [...signedIn.corporate_packages].sort((a: any, b: any) => a.id.localeCompare(b.id)),
      [...listed].sort((a, b) => a.id.localeCompare(b.id)),
      'the member sees what an anonymous visitor sees',
    )

    // Studio two's hostname shows studio two's catalogue, not studio one's.
    const there = await expectStatus(await send('GET', anonymousAt(two), '/api/v1/public/corporate-packages'), 200)
    assert.deepEqual(ids(there.corporate_packages), await purchasableCorporate(two))
    assert.ok(ids(there.corporate_packages).includes(elsewhere))
    assert.ok(!ids(there.corporate_packages).includes(team))
  })

  test('CORP-01 the member corporate listing is refused to another studio’s member, a staff session and an anonymous caller; a staff token on the public listing sees nothing extra', async () => {
    await corporatePackage(one, 'guarded', 'Behind the gate', '100.00')
    const outsider = await member(two)
    await expectStatus(await send('GET', sentTo(outsider, one), '/api/v1/me/corporate-packages'), 401, 'invalid_token')
    await expectStatus(await send('GET', sentTo(one.admin, one), '/api/v1/me/corporate-packages'), 401, 'invalid_token')
    await expectStatus(await send('GET', anonymousAt(one), '/api/v1/me/corporate-packages'), 401, 'missing_bearer_token')

    const anonymous = await expectStatus(await send('GET', anonymousAt(one), '/api/v1/public/corporate-packages'), 200)
    const asStaff = await expectStatus(await send('GET', sentTo(one.admin, one), '/api/v1/public/corporate-packages'), 200)
    assert.deepEqual(asStaff, anonymous)
  })

  test('the member PT package listing returns the studio’s purchasable PT packages, and only that studio’s', async () => {
    const insertPt = async (at: Studio, suffix: string, values: Partial<typeof schema.ptPackages.$inferInsert> = {}) => {
      const [row] = await harness.db
        .insert(schema.ptPackages)
        .values({ tenantId: at.id, name: `${NAME} pt ${suffix}`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00', ...values })
        .returning({ id: schema.ptPackages.id })
      return row!.id
    }
    const five = await insertPt(one, 'five', { description: 'Five one-to-one sessions' })
    const pair = await insertPt(one, 'pair', { sessionType: '2on1', numSessions: 8, validityDays: 120, priceSgd: '720.00' })
    const retired = await insertPt(one, 'retired', { status: 'archived' })
    const removed = await insertPt(one, 'removed', { deletedAt: new Date() })
    const elsewhere = await insertPt(two, 'elsewhere')

    const mia = await member(one)
    const res = await expectStatus(await send('GET', mia.headers, '/api/v1/me/pt-packages'), 200)
    const listed = res.pt_packages as Array<Record<string, unknown> & { id: string }>
    assert.deepEqual(ids(listed), await purchasablePt(one), "exactly the studio's PT packages on sale")
    const byId = new Map(listed.map(p => [p.id, p]))
    assert.deepEqual(
      [byId.get(five), byId.get(pair)].map(p => p && [p.name, p.description, p.session_type, p.num_sessions, p.validity_days, p.price_sgd]),
      [
        [`${NAME} pt five`, 'Five one-to-one sessions', '1on1', 5, 90, '400.00'],
        [`${NAME} pt pair`, null, '2on1', 8, 120, '720.00'],
      ],
    )
    for (const hidden of [retired, removed, elsewhere]) assert.ok(!byId.has(hidden), `${hidden} is listed`)

    const outsider = await member(two)
    const theirs = await expectStatus(await send('GET', outsider.headers, '/api/v1/me/pt-packages'), 200)
    assert.deepEqual(ids(theirs.pt_packages), await purchasablePt(two))
    assert.ok(ids(theirs.pt_packages).includes(elsewhere))

    await expectStatus(await send('GET', sentTo(outsider, one), '/api/v1/me/pt-packages'), 401, 'invalid_token')
    await expectStatus(await send('GET', sentTo(one.admin, one), '/api/v1/me/pt-packages'), 401, 'invalid_token')
  })
})
