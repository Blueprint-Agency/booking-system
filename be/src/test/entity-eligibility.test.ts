import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  inTenantContext,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.entity-eligibility.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `Entity pay ${run}`
const YOGA = `Entity yoga ${run}`
const PILATES = `Entity pilates ${run}`
const LOCATION_NAME = `Entity premises ${run}`
const FLAG = 'waitlist_enabled'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * A package pays only for classes whose Class Type is in its own Entity
 * (be/CONTEXT.md § Entity), over real HTTP: wherever a payer is chosen — the
 * member's booking with or without a pick, the Book sheet, staff booking, the
 * waitlist join, the waitlist panel, automatic Promotion and staff Add to class
 * — a package of another Entity is not a candidate at all, the way another
 * studio's package is not. Named from the Scenario Inventory
 * (`docs/md/test-scenarios.md`); the Package rule suite is `package-rules.test.ts`.
 */
describe('a package pays only for classes in its own Entity', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let entitiesSvc!: typeof import('../services/catalog/entities')

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    yogaEntityId: string
    pilatesEntityId: string
    yogaTypeId: string
    pilatesTypeId: string
    /** Credit Bundles: two of Yoga, one of Pilates. */
    yogaMat: string
    yogaPromo: string
    pilatesBundle: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  let one!: Studio

  const json = { 'Content-Type': 'application/json' }
  const emailFor = (name: string) => `${name}@${DOMAIN}`
  /** A fresh hour for every class this file makes, so no two ever clash for a room or an instructor. */
  let slots = 0
  const nextStart = () => new Date(Date.now() + 20 * DAY + slots++ * 2 * HOUR)

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
    const [user] = await harness.db.select({ id: schema.staffAuthUsers.id }).from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
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
      .values({ tenantId: tenant.id, name: LOCATION_NAME })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `Entity room ${run}`, capacity: 20 })
      .returning({ id: schema.rooms.id })

    const yoga = await entitiesSvc.createEntity(tenant.id, { name: YOGA })
    const pilates = await entitiesSvc.createEntity(tenant.id, { name: PILATES })
    const yogaType = await classTypesSvc.createClassType(tenant.id, { name: `${YOGA} class`, entity_id: yoga.id })
    const pilatesType = await classTypesSvc.createClassType(tenant.id, { name: `${PILATES} class`, entity_id: pilates.id })

    const bundle = async (label: string, entityId: string) => {
      const [row] = await harness.db
        .insert(schema.classPackages)
        .values({ tenantId: tenant.id, name: `${NAME} ${label}`, kind: 'credit_bundle', credits: 10, validityDays: 30, priceSgd: '150.00', status: 'active', entityId })
        .returning({ id: schema.classPackages.id })
      return row!.id
    }

    return {
      ...tenant,
      locationId: location!.id,
      roomId: room!.id,
      yogaEntityId: yoga.id,
      pilatesEntityId: pilates.id,
      yogaTypeId: yogaType.id,
      pilatesTypeId: pilatesType.id,
      yogaMat: await bundle('yoga mat', yoga.id),
      yogaPromo: await bundle('yoga promo', yoga.id),
      pilatesBundle: await bundle('pilates bundle', pilates.id),
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
    }
  }

  let members = 0
  async function member(at: Studio): Promise<Member> {
    const email = emailFor(`member-${members++}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Ria', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  /**
   * A class package the member holds, bought as `catalogueId` (null: no catalogue
   * source, as an imported one has). It ends in `endsInDays`, so a test can make
   * the other Entity's package the one default order would pick.
   */
  let purchases = 0
  async function holds(at: Studio, who: Member, catalogueId: string | null, options: { credits?: number; endsInDays?: number } = {}): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: 'credit_bundle',
        sourceClassPackageId: catalogueId,
        validityDays: 60,
        creditsOrSessionsRemaining: options.credits ?? 5,
        expiresAt: new Date(Date.now() + (options.endsInDays ?? 60) * DAY),
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
        purchasedAt: new Date(Date.now() - 30 * DAY + purchases++ * 1000),
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  const send = (method: string, headers: Record<string, string>, path: string, body?: unknown) =>
    harness.app.request(path, {
      method,
      headers: { ...headers, ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  async function addClass(at: Studio, classTypeId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const startsAt = nextStart()
    const res = await send('POST', at.admin.headers, '/api/v1/portal/admin/schedule/classes', {
      class_type_id: classTypeId,
      main_instructor_id: at.instructor.id,
      location_id: at.locationId,
      room_id: at.roomId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
      capacity_online: 10,
      credit_cost: 1,
      ...extra,
    })
    return (await expectStatus(res, 201)).id
  }

  const book = (who: Member, classId: string, extra: Record<string, unknown> = {}) =>
    send('POST', who.headers, '/api/v1/me/bookings/class', { class_id: classId, ...extra })

  /* ── state ──────────────────────────────────────────────────────────── */

  async function remaining(id: string): Promise<number | null> {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, id))
    assert.ok(row, `no package ${id}`)
    return row.creditsOrSessionsRemaining
  }

  async function paidWith(bookingId: string): Promise<string | null> {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.ok(row, `no booking ${bookingId}`)
    return row.clientPackageId
  }

  const bookingsOn = (who: Member, classId: string) =>
    harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.clientId, who.clientId), eq(schema.bookings.classId, classId)))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    entitiesSvc = inTenantContext(await import('../services/catalog/entities'))
    one = await studio(harness.tenants.one)
  })

  after(async () => {
    if (!harness) return
    if (one) await send('PATCH', one.admin.headers, `/api/v1/portal/admin/feature-flags/${FLAG}`, { enabled: false })
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM feature_flags WHERE key = ${FLAG} AND updated_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM waitlist_entries WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_rule_packages WHERE class_id IN (SELECT id FROM classes WHERE created_by_staff_id IN (${staff}))`)
    await harness.db.execute(sql`DELETE FROM class_supporting_instructors WHERE class_id IN (SELECT id FROM classes WHERE created_by_staff_id IN (${staff}))`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (SELECT id FROM locations WHERE name = ${LOCATION_NAME})`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name = ${LOCATION_NAME}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE ${`${YOGA}%`} OR name LIKE ${`${PILATES}%`}`)
    await harness.db.execute(sql`DELETE FROM entities WHERE name IN (${YOGA}, ${PILATES})`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── the member's booking ───────────────────────────────────────────── */

  test('PKR-17 a member booking a Yoga class with no pick is paid for by the Yoga package, though a Pilates one would end sooner', async () => {
    const classId = await addClass(one, one.yogaTypeId)
    const ria = await member(one)
    const pilates = await holds(one, ria, one.pilatesBundle, { endsInDays: 40 })
    const yoga = await holds(one, ria, one.yogaMat, { endsInDays: 90 })

    const res = await expectStatus(await book(ria, classId), 201)
    assert.equal(await paidWith(res.booking_id), yoga)
    assert.equal(await remaining(yoga), 4)
    assert.equal(await remaining(pilates), 5, 'the Pilates package is untouched')
  })

  test('PKR-18 a member picking a package of another Entity is told client_package_not_found, as for another member’s package', async () => {
    const classId = await addClass(one, one.yogaTypeId)
    const sue = await member(one)
    const pilates = await holds(one, sue, one.pilatesBundle)
    await holds(one, sue, one.yogaMat)

    await expectStatus(await book(sue, classId, { client_package_id: pilates }), 404, 'client_package_not_found')
    const other = await member(one)
    const others = await holds(one, other, one.yogaMat)
    await expectStatus(await book(sue, classId, { client_package_id: others }), 404, 'client_package_not_found')
    assert.equal((await bookingsOn(sue, classId)).length, 0)
    assert.equal(await remaining(pilates), 5, 'nothing is debited')
  })

  test('PKR-19 a member holding only packages of another Entity is refused insufficient_credits, picked or not', async () => {
    const classId = await addClass(one, one.yogaTypeId)
    const tom = await member(one)
    const pilates = await holds(one, tom, one.pilatesBundle)

    await expectStatus(await book(tom, classId), 409, 'insufficient_credits')
    await expectStatus(await book(tom, classId, { client_package_id: pilates }), 404, 'client_package_not_found')
    assert.equal((await bookingsOn(tom, classId)).length, 0)
    assert.equal(await remaining(pilates), 5)
  })

  /* ── what members and staff read ────────────────────────────────────── */

  test('PKR-20 the Book sheet lists only the member’s packages of the class’s Entity, and never offers another’s as the Default payer', async () => {
    const yogaClass = await addClass(one, one.yogaTypeId)
    const pilatesClass = await addClass(one, one.pilatesTypeId)
    const una = await member(one)
    const pilates = await holds(one, una, one.pilatesBundle, { endsInDays: 40 })
    const yoga = await holds(one, una, one.yogaMat, { endsInDays: 90 })
    const only = await member(one)
    const onlyPilates = await holds(one, only, one.pilatesBundle)

    const onYoga = await expectStatus(await send('GET', una.headers, `/api/v1/me/classes/${yogaClass}`), 200)
    assert.deepEqual(onYoga.my_packages.map((p: any) => [p.id, p.eligible, p.reason]), [[yoga, true, null]])
    assert.equal(onYoga.default_client_package_id, yoga)

    const onPilates = await expectStatus(await send('GET', una.headers, `/api/v1/me/classes/${pilatesClass}`), 200)
    assert.deepEqual(onPilates.my_packages.map((p: any) => [p.id, p.eligible, p.reason]), [[pilates, true, null]])
    assert.equal(onPilates.default_client_package_id, pilates)

    // Holding only the other Entity's package: nothing listed, no reason given.
    const empty = await expectStatus(await send('GET', only.headers, `/api/v1/me/classes/${yogaClass}`), 200)
    assert.deepEqual(empty.my_packages, [])
    assert.equal(empty.default_client_package_id, null)
    const own = await expectStatus(await send('GET', only.headers, `/api/v1/me/classes/${pilatesClass}`), 200)
    assert.deepEqual(own.my_packages.map((p: any) => p.id), [onlyPilates])
  })

  test('PKR-26 a class the member app reads names its Entity, for the Book sheet’s link to that Entity’s packages', async () => {
    const classId = await addClass(one, one.pilatesTypeId)
    const ann = await member(one)
    const expected = { id: one.pilatesEntityId, name: PILATES, slug: `entity-pilates-${run}` }

    const detail = await expectStatus(await send('GET', ann.headers, `/api/v1/me/classes/${classId}`), 200)
    assert.deepEqual(detail.entity, expected)
    const publicDetail = await expectStatus(await send('GET', { 'X-Tenant-Slug': one.slug, Origin: frontendOrigin('client', one), 'X-Forwarded-For': harnessAddress() }, `/api/v1/public/classes/${classId}`), 200)
    assert.deepEqual(publicDetail.entity, expected)

    const from = new Date(Date.now() + 19 * DAY).toISOString()
    const to = new Date(Date.now() + 80 * DAY).toISOString()
    const list = await expectStatus(await send('GET', ann.headers, `/api/v1/me/classes?from=${from}&to=${to}&location_id=${one.locationId}`), 200)
    assert.deepEqual(list.classes.find((c: any) => c.id === classId).entity, expected)
  })

  /* ── the Package rule, and what keeps paying as before ──────────────── */

  test('PKR-21 a class’s Package rule still narrows inside the Entity, and naming another Entity’s package is allowed but never makes it Eligible', async () => {
    // Naming a Pilates package on a Yoga class is valid; only the Yoga one pays.
    const named = await addClass(one, one.yogaTypeId, { package_rule: { mode: 'only', package_ids: [one.yogaMat, one.pilatesBundle] } })
    const vic = await member(one)
    const promo = await holds(one, vic, one.yogaPromo, { endsInDays: 40 })
    const pilates = await holds(one, vic, one.pilatesBundle, { endsInDays: 41 })
    const mat = await holds(one, vic, one.yogaMat, { endsInDays: 90 })

    const sheet = await expectStatus(await send('GET', vic.headers, `/api/v1/me/classes/${named}`), 200)
    assert.deepEqual(
      sheet.my_packages.map((p: any) => [p.id, p.eligible, p.reason]),
      [
        [promo, false, 'not_accepted'],
        [mat, true, null],
      ],
      'the rule narrows the Yoga packages; the Pilates one is not listed though the rule names it',
    )
    const res = await expectStatus(await book(vic, named), 201)
    assert.equal(await paidWith(res.booking_id), mat)
    assert.equal(await remaining(pilates), 5)

    // Excluding a Yoga package leaves the other Yoga package and never lets Pilates in.
    const except = await addClass(one, one.yogaTypeId, { package_rule: { mode: 'except', package_ids: [one.yogaMat] } })
    const wes = await member(one)
    await holds(one, wes, one.pilatesBundle)
    await holds(one, wes, one.yogaMat)
    await expectStatus(await book(wes, except), 409, 'not_accepted')
  })

  test('PKR-22 a held package with no catalogue source, and a Class Type with no Entity, keep paying as they did', async () => {
    const yogaClass = await addClass(one, one.yogaTypeId)
    const kim = await member(one)
    const sourceless = await holds(one, kim, null)
    const res = await expectStatus(await book(kim, yogaClass), 201)
    assert.equal(await paidWith(res.booking_id), sourceless, 'a package bought as nothing in the catalogue pays any class')

    // A Class Type with no Entity (made before Entities) takes any package.
    const [legacy] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: one.id, name: `${PILATES} legacy ${run}` })
      .returning({ id: schema.classTypes.id })
    const legacyClass = await addClass(one, legacy!.id)
    const lou = await member(one)
    const pilates = await holds(one, lou, one.pilatesBundle)
    const paid = await expectStatus(await book(lou, legacyClass), 201)
    assert.equal(await paidWith(paid.booking_id), pilates)
  })

  /* ── staff booking a member ─────────────────────────────────────────── */

  const staffBook = (staff: Staff, role: 'admin' | 'instructor', classId: string, who: Member, extra: Record<string, unknown> = {}) =>
    send('POST', staff.headers, `/api/v1/portal/${role}/schedule/classes/${classId}/bookings`, { client_id: who.clientId, ...extra })
  const staffPackages = (staff: Staff, role: 'admin' | 'instructor', classId: string, who: Member) =>
    send('GET', staff.headers, `/api/v1/portal/${role}/schedule/classes/${classId}/packages?client_id=${who.clientId}`)

  test('BKG-51 staff booking a member onto a Yoga class, with or without a pick, is paid for by a Yoga package, and the select lists no other', async () => {
    const classId = await addClass(one, one.yogaTypeId)
    const ora = await member(one)
    const pilates = await holds(one, ora, one.pilatesBundle, { endsInDays: 40 })
    const yoga = await holds(one, ora, one.yogaMat, { endsInDays: 90 })

    for (const role of ['admin', 'instructor'] as const) {
      const staff = role === 'admin' ? one.admin : one.instructor
      const sheet = await expectStatus(await staffPackages(staff, role, classId, ora), 200)
      assert.deepEqual(sheet.packages.map((p: any) => p.id), [yoga], `${role}: only the Yoga package is listed`)
      assert.equal(sheet.default_client_package_id, yoga)
    }

    const byDefault = await expectStatus(await staffBook(one.admin, 'admin', classId, ora), 201)
    assert.equal(await paidWith(byDefault.booking_id), yoga)

    const other = await addClass(one, one.yogaTypeId)
    const picked = await expectStatus(await staffBook(one.instructor, 'instructor', other, ora, { client_package_id: yoga }), 201)
    assert.equal(await paidWith(picked.booking_id), yoga)
    assert.equal(await remaining(yoga), 3)
    assert.equal(await remaining(pilates), 5)
  })

  test('BKG-52 staff picking a member’s package of another Entity is told client_package_not_found, and a member holding only those is insufficient_credits', async () => {
    const classId = await addClass(one, one.yogaTypeId)
    const pia = await member(one)
    const pilates = await holds(one, pia, one.pilatesBundle)

    await expectStatus(await staffBook(one.admin, 'admin', classId, pia, { client_package_id: pilates }), 404, 'client_package_not_found')
    await expectStatus(await staffBook(one.admin, 'admin', classId, pia), 409, 'insufficient_credits')
    await expectStatus(await staffBook(one.instructor, 'instructor', classId, pia), 409, 'insufficient_credits')
    const sheet = await expectStatus(await staffPackages(one.admin, 'admin', classId, pia), 200)
    assert.deepEqual(sheet.packages, [])
    assert.equal(sheet.default_client_package_id, null)
    assert.equal((await bookingsOn(pia, classId)).length, 0)
    assert.equal(await remaining(pilates), 5)
  })

  /* ── the waitlist ───────────────────────────────────────────────────── */

  const setFlag = (enabled: boolean) =>
    send('PATCH', one.admin.headers, `/api/v1/portal/admin/feature-flags/${FLAG}`, { enabled })
  const join = (who: Member, classId: string) => send('POST', who.headers, `/api/v1/me/waitlist/classes/${classId}`)
  const waiting = async (who: Member, classId: string) => {
    const [row] = await harness.db
      .select({ status: schema.waitlistEntries.status })
      .from(schema.waitlistEntries)
      .where(and(eq(schema.waitlistEntries.clientId, who.clientId), eq(schema.waitlistEntries.classId, classId)))
    return row?.status
  }
  /** A Yoga class with one online seat, taken by someone else. */
  async function fullYogaClass(extra: Record<string, unknown> = {}) {
    const classId = await addClass(one, one.yogaTypeId, { capacity_online: 1, capacity_waitlist: 4, ...extra })
    const seated = await member(one)
    await holds(one, seated, one.yogaMat)
    const booked = await expectStatus(await book(seated, classId), 201)
    return { classId, seated, seatedBooking: booked.booking_id as string }
  }

  test('WTL-48 a member holding only packages of another Entity is refused the waitlist join insufficient_credits; one holding a Yoga package joins', async () => {
    assert.equal((await setFlag(true)).status, 200)
    const { classId } = await fullYogaClass()
    const ned = await member(one)
    await holds(one, ned, one.pilatesBundle)
    await expectStatus(await join(ned, classId), 409, 'insufficient_credits')
    assert.equal(await waiting(ned, classId), undefined)

    const ona = await member(one)
    await holds(one, ona, one.yogaPromo)
    await expectStatus(await join(ona, classId), 201)
    assert.equal(await waiting(ona, classId), 'waiting')
  })

  test('WTL-49 an automatic Promotion pays with a Yoga package and passes over a waiting member who now holds only another Entity’s, who keeps their place', async () => {
    assert.equal((await setFlag(true)).status, 200)
    const { classId, seated, seatedBooking } = await fullYogaClass()
    const head = await member(one)
    const headsYoga = await holds(one, head, one.yogaMat)
    await expectStatus(await join(head, classId), 201)
    const next = await member(one)
    const nextsYoga = await holds(one, next, one.yogaPromo)
    await expectStatus(await join(next, classId), 201)
    // The head's package is now sold under Pilates, so it no longer pays for Yoga.
    await harness.db.update(schema.classPackages).set({ entityId: one.pilatesEntityId }).where(eq(schema.classPackages.id, one.yogaMat))
    try {
      await expectStatus(await send('DELETE', seated.headers, `/api/v1/me/bookings/${seatedBooking}`), 200)
    } finally {
      await harness.db.update(schema.classPackages).set({ entityId: one.yogaEntityId }).where(eq(schema.classPackages.id, one.yogaMat))
    }

    assert.equal((await bookingsOn(head, classId)).length, 0, 'the head of the line holds only another Entity’s package')
    assert.equal(await waiting(head, classId), 'waiting')
    assert.equal(await remaining(headsYoga), 5)
    const [promoted] = await bookingsOn(next, classId)
    assert.ok(promoted, 'the next member in line is booked')
    assert.equal(promoted.state, 'confirmed')
    assert.equal(promoted.clientPackageId, nextsYoga)
  })

  test('WTL-50 the waitlist panel says who could pay and with what, and staff Add to class pays only with a Yoga package', async () => {
    assert.equal((await setFlag(true)).status, 200)
    const { classId } = await fullYogaClass({ capacity_buffer: 2 })
    const head = await member(one)
    const headsPackage = await holds(one, head, one.yogaMat)
    await expectStatus(await join(head, classId), 201)
    const next = await member(one)
    const nextsYoga = await holds(one, next, one.yogaPromo)
    await expectStatus(await join(next, classId), 201)
    // The head's package moves to Pilates after they joined; it carries the held package with it.
    await harness.db.update(schema.clientPackages).set({ sourceClassPackageId: one.pilatesBundle }).where(eq(schema.clientPackages.id, headsPackage))

    const detail = await expectStatus(await send('GET', one.admin.headers, `/api/v1/portal/admin/schedule/classes/${classId}`), 200)
    assert.deepEqual(detail.waitlist.map((w: any) => w.payment_status), [
      { status: 'cannot_pay', reason: 'insufficient_credits' },
      { status: 'pending', package_name: `${NAME} yoga promo` },
    ])

    const entries = detail.waitlist.map((w: any) => w.entry_id ?? w.id)
    const promote = (entryId: string) =>
      send('POST', one.admin.headers, `/api/v1/portal/admin/schedule/classes/${classId}/waitlist/${entryId}/promote`, {})
    await expectStatus(await promote(entries[0]), 409, 'insufficient_credits')
    assert.equal(await waiting(head, classId), 'waiting', 'the member keeps their place')
    assert.equal((await bookingsOn(head, classId)).length, 0)
    await expectStatus(await promote(entries[1]), 201)
    const [added] = await bookingsOn(next, classId)
    assert.equal(added?.clientPackageId, nextsYoga)
    assert.equal(await remaining(headsPackage), 5)
  })

  test('PKR-23 within one Entity nothing changed: a class is paid for by a package of its Entity, picked or by default', async () => {
    // Two Yoga packages for a Yoga class: pick one, then leave it to the Default payer.
    const classId = await addClass(one, one.yogaTypeId)
    const dee = await member(one)
    const first = await holds(one, dee, one.yogaMat, { endsInDays: 50 })
    const second = await holds(one, dee, one.yogaPromo, { endsInDays: 90 })
    const picked = await expectStatus(await book(dee, classId, { client_package_id: second }), 201)
    assert.equal(await paidWith(picked.booking_id), second)
    const other = await addClass(one, one.yogaTypeId)
    const byDefault = await expectStatus(await book(dee, other), 201)
    assert.equal(await paidWith(byDefault.booking_id), first)
  })
})
