import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures, type Staff } from './member-fixtures'

/**
 * The portal's Customers page (`/admin/customers`) over the admin clients API:
 * the paged directory and the customer detail read.
 *
 * Paging is tested through the route because that is where it can go wrong
 * for a studio with thousands of imported members — a filter applied to the
 * page instead of the studio, a total that counts the page, a funnel that
 * counts the page. The detail read is tested with a member holding the shapes
 * an import leaves behind: packages with no Purchase, one long expired, a class
 * attended in the past and one still to come.
 *
 * Both are tested from the second studio as well: its admin must page through
 * none of the first studio's members and read none of their details.
 */
describe('customers directory and detail', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let fixtures!: ReturnType<typeof memberFixtures>
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }
  let adminOne!: Staff
  let adminTwo!: Staff

  const run = Date.now().toString(36)
  const PREFIX = `Cust${run}`
  const DOMAIN = `customers-${run}.test`
  const DAY = 24 * 60 * 60 * 1000

  const memberIds: string[] = []
  let elsewhereId!: string
  let detailId!: string
  let instructorId!: string
  let classTypeId!: string
  let roomId!: string
  let bundleCatalogId!: string
  let trialCatalogId!: string

  const get = async <T>(path: string, headers: Record<string, string>) => {
    const res = await harness.app.request(`/api/v1/portal/admin/clients${path}`, { headers })
    return { status: res.status, body: (await res.json()) as T }
  }

  type ListBody = {
    clients: { id: string; name: string; phone: string; deleted_at: string | null; converted: boolean }[]
    total: number
    page: number
    page_size: number
    funnel: { trials: number; attended: number; converted: number } | null
  }

  const member = async (tenantId: string, n: number, over: Record<string, unknown> = {}) => {
    const [row] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId,
        email: `m${n}-${tenantId.slice(0, 4)}@${DOMAIN}`,
        name: `${PREFIX} Member ${String(n).padStart(2, '0')}`,
        phone: `+65 8${run.slice(-3)} ${String(n).padStart(4, '0')}`,
        authUserId: `auth_${run}_${tenantId.slice(0, 4)}_${n}`,
        joinedAt: new Date(Date.now() - n * DAY),
        ...over,
      })
      .returning()
    memberIds.push(row!.id)
    return row!.id
  }

  const pkg = (clientId: string, over: Record<string, unknown>) =>
    harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: one.id,
        clientId,
        kind: 'credit_bundle',
        sourceClassPackageId: bundleCatalogId,
        validityDays: 30,
        creditsOrSessionsRemaining: 5,
        amountPaidSgd: '100.00',
        listPriceSgd: '200.00',
        // No Purchase — as every package a migration brings over arrives.
        purchaseId: null,
        ...over,
      })
      .returning()
      .then(r => r[0]!.id)

  const klass = (startsAt: Date) =>
    harness.db
      .insert(schema.classes)
      .values({
        tenantId: one.id,
        classTypeId,
        mainInstructorId: instructorId,
        locationId: fixturesLocationId,
        roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: instructorId,
      })
      .returning()
      .then(r => r[0]!.id)

  const booking = (clientId: string, classId: string, clientPackageId: string, over: Record<string, unknown> = {}) =>
    harness.db
      .insert(schema.bookings)
      .values({
        tenantId: one.id,
        clientId,
        kind: 'class',
        classId,
        clientPackageId,
        creditsOrSessionsUsed: 1,
        qrToken: randomUUID(),
        code: `C${randomUUID().slice(0, 8)}`,
        ...over,
      })
      .returning()
      .then(r => r[0]!.id)

  let fixturesLocationId!: string

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    fixtures = memberFixtures(harness, schema, DOMAIN)
    ;({ one, two } = harness.tenants)
    adminOne = await fixtures.staffAt(one, fixtures.at('admin-one'), 'admin')
    adminTwo = await fixtures.staffAt(two, fixtures.at('admin-two'), 'admin')

    const classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    const classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))

    const [location] = await harness.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, one.id))
    fixturesLocationId = location!.id
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: one.id, locationId: fixturesLocationId, name: `${PREFIX} Room`, capacity: 20 })
      .returning()
    roomId = room!.id
    classTypeId = (await classTypesSvc.createClassType(one.id, { name: `${PREFIX} Flow`, description: null })).id
    const [instructor] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId: one.id,
        email: fixtures.at('instructor'),
        name: `${PREFIX} Teacher`,
        role: 'instructor',
        status: 'active',
        authUserId: `auth_${run}_instructor`,
      })
      .returning()
    instructorId = instructor!.id
    await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: instructorId })
    bundleCatalogId = (
      await classPackagesSvc.createClassPackage(one.id, {
        name: `${PREFIX} Bundle`,
        kind: 'credit_bundle',
        credits: 10,
        validityDays: 30,
        priceSgd: '200.00',
      })
    ).id
    trialCatalogId = (
      await classPackagesSvc.createClassPackage(one.id, {
        name: `${PREFIX} Trial`,
        kind: 'trial',
        credits: 1,
        validityDays: 7,
        priceSgd: '20.00',
      })
    ).id

    // Seven members at the first studio, one of them blocked; two bought a
    // trial, one of those two went on to pay for a bundle.
    for (let n = 1; n <= 7; n++) {
      await member(one.id, n, n === 7 ? { deletedAt: new Date() } : {})
    }
    const trialOnly = memberIds[0]!
    const converted = memberIds[1]!
    for (const id of [trialOnly, converted]) {
      await pkg(id, {
        kind: 'trial',
        sourceClassPackageId: trialCatalogId,
        validityDays: 7,
        creditsOrSessionsRemaining: 0,
        amountPaidSgd: '0.00',
        listPriceSgd: '20.00',
        active: false,
        expiresAt: new Date(Date.now() - 30 * DAY),
      })
    }
    await pkg(converted, {})

    // The same name prefix at the second studio, which the first must never page to.
    elsewhereId = await member(two.id, 50)

    // The detail fixture: a member with a current package, an old one, a class
    // attended last week and one booked for next week.
    detailId = await member(one.id, 60, { gender: 'female' })
    const current = await pkg(detailId, { expiresAt: new Date(Date.now() + 20 * DAY) })
    await pkg(detailId, {
      creditsOrSessionsRemaining: 2,
      active: false,
      expiresAt: new Date(Date.now() - 90 * DAY),
      purchasedAt: new Date(Date.now() - 200 * DAY),
    })
    const pastClass = await klass(new Date(Date.now() - 7 * DAY))
    const nextClass = await klass(new Date(Date.now() + 7 * DAY))
    await booking(detailId, pastClass, current, { checkInState: 'attended' })
    await booking(detailId, nextClass, current)
  })

  after(async () => {
    if (!harness) return
    if (memberIds.length > 0) {
      const ids = sql.join(memberIds.map(id => sql`${id}::uuid`), sql`, `)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${ids})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${ids})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE id IN (${ids})`)
    }
    if (classTypeId) await harness.db.execute(sql`DELETE FROM classes WHERE class_type_id = ${classTypeId}::uuid`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${PREFIX} %`}`)
    if (roomId) await harness.db.execute(sql`DELETE FROM rooms WHERE id = ${roomId}::uuid`)
    if (classTypeId) await harness.db.execute(sql`DELETE FROM class_types WHERE id = ${classTypeId}::uuid`)
    if (instructorId) await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id = ${instructorId}::uuid`)
    await fixtures?.cleanup()
    await harness.close()
  })

  // ── the directory, paged ──────────────────────────────────────────────────

  test('pages through the matching members with a total across every page', async () => {
    const seen: string[] = []
    for (const page of [1, 2, 3]) {
      const { status, body } = await get<ListBody>(
        `?q=${PREFIX}&include_deleted=true&sort=name&page=${page}&page_size=3`,
        adminOne.headers,
      )
      assert.equal(status, 200)
      assert.equal(body.total, 8, 'seven members plus the detail fixture, blocked one included')
      assert.equal(body.page, page)
      assert.equal(body.page_size, 3)
      seen.push(...body.clients.map(c => c.name))
    }
    assert.equal(seen.length, 8, 'the pages together hold every member once')
    assert.equal(new Set(seen).size, 8, 'no member on two pages')
    assert.deepEqual(seen, [...seen].sort(), 'sorted by name across pages, not within one')
  })

  test('a page beyond the end is empty and still knows the total', async () => {
    const { body } = await get<ListBody>(`?q=${PREFIX}&include_deleted=true&page=9&page_size=3`, adminOne.headers)
    assert.equal(body.clients.length, 0)
    assert.equal(body.total, 8)
  })

  test('filters apply to the studio, not to the page', async () => {
    const blocked = await get<ListBody>(`?q=${PREFIX}&filter=blocked&page_size=1`, adminOne.headers)
    assert.equal(blocked.body.total, 1)
    assert.ok(blocked.body.clients[0]!.deleted_at)

    const active = await get<ListBody>(`?q=${PREFIX}&filter=active&include_deleted=true&page_size=2`, adminOne.headers)
    assert.equal(active.body.total, 7, 'the blocked member is not active')
    assert.equal(active.body.clients.length, 2)

    const hidden = await get<ListBody>(`?q=${PREFIX}`, adminOne.headers)
    assert.equal(hidden.body.total, 7, 'blocked members stay hidden unless asked for')
  })

  test('the trial funnel counts every trial member, whatever the page size', async () => {
    const { body } = await get<ListBody>(`?q=${PREFIX}&filter=trials&page_size=1`, adminOne.headers)
    assert.equal(body.total, 2)
    assert.equal(body.clients.length, 1)
    assert.deepEqual(body.funnel, { trials: 2, attended: 0, converted: 1 })

    const other = await get<ListBody>(`?q=${PREFIX}`, adminOne.headers)
    assert.equal(other.body.funnel, null, 'no funnel outside the Trials filter')
  })

  test('search finds a member by phone as well as name and email', async () => {
    const { body } = await get<ListBody>(`?q=${encodeURIComponent(`8${run.slice(-3)} 0003`)}`, adminOne.headers)
    assert.equal(body.total, 1)
    assert.equal(body.clients[0]!.name, `${PREFIX} Member 03`)
  })

  test('refuses a page size past the cap', async () => {
    const { status } = await get<unknown>(`?page_size=500`, adminOne.headers)
    assert.equal(status, 400)
  })

  test("pages through none of another studio's members", async () => {
    const mine = await get<ListBody>(`?q=${PREFIX}&include_deleted=true&page_size=200`, adminTwo.headers)
    assert.equal(mine.body.total, 1)
    assert.deepEqual(
      mine.body.clients.map(c => c.id),
      [elsewhereId],
    )
    const theirs = await get<ListBody>(`?q=${PREFIX}&include_deleted=true&page_size=200`, adminOne.headers)
    assert.ok(!theirs.body.clients.some(c => c.id === elsewhereId))
  })

  // ── the detail read ───────────────────────────────────────────────────────

  type DetailBody = {
    id: string
    gender: string | null
    waiver_signed_at: string | null
    packages: { id: string; standing: string; paid_online: boolean; credits_or_sessions_remaining: number; package_name: string }[]
    past_packages: { standing: string; paid_online: boolean }[]
    upcoming_bookings: { title: string; kind: string; instructor: string; location: string | null; package_name: string; state: string }[]
    past_bookings: { title: string; check_in_state: string }[]
    attendance: { attended: number; no_shows: number; late_cancels: number; last_attended_at: string | null }
    payments: unknown[]
  }

  test('shows current and past packages, upcoming and past bookings, attendance and payments', async () => {
    const { status, body } = await get<DetailBody>(`/${detailId}`, adminOne.headers)
    assert.equal(status, 200, JSON.stringify(body))
    assert.equal(body.gender, 'female')
    assert.equal(body.waiver_signed_at, null)

    assert.equal(body.packages.length, 1)
    assert.equal(body.packages[0]!.standing, 'running')
    assert.equal(body.packages[0]!.package_name, `${PREFIX} Bundle`)
    assert.equal(body.packages[0]!.paid_online, false, 'no Purchase behind an imported package')

    assert.equal(body.past_packages.length, 1)
    assert.equal(body.past_packages[0]!.standing, 'expired')

    assert.equal(body.upcoming_bookings.length, 1)
    const next = body.upcoming_bookings[0]!
    assert.equal(next.kind, 'class')
    assert.equal(next.title, `${PREFIX} Flow`)
    assert.equal(next.instructor, `${PREFIX} Teacher`)
    assert.equal(next.package_name, `${PREFIX} Bundle`)
    assert.ok(next.location)

    assert.equal(body.past_bookings.length, 1)
    assert.equal(body.past_bookings[0]!.check_in_state, 'attended')
    assert.equal(body.attendance.attended, 1)
    assert.equal(body.attendance.no_shows, 0)
    assert.ok(body.attendance.last_attended_at)

    assert.deepEqual(body.payments, [], 'nothing went through the payment provider')
  })

  test("another studio's admin cannot read the member, and neither way round", async () => {
    const theirs = await get<{ error: string }>(`/${detailId}`, adminTwo.headers)
    assert.equal(theirs.status, 404)
    assert.equal(theirs.body.error, 'client_not_found')

    const mine = await get<{ error: string }>(`/${elsewhereId}`, adminOne.headers)
    assert.equal(mine.status, 404)
  })
})
