import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.public-catalogue.test`
// Every name this file writes carries `run`, so a list is read for this file's
// rows only and another file's fixtures cannot make an assertion pass or fail.
const TAG = `Catalogue ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The member app's public surface over real HTTP (#226): the home page's
 * Locations and copy, the class list and its filters, and the packages page —
 * all read by a visitor who is signed in nowhere.
 *
 * Written from the CAT and LOC rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`). Both studios get the same shape of catalogue,
 * so every read is checked for the other studio's rows as well as its own.
 */
describe('public catalogue over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  type Studio = {
    id: string
    slug: string
    locationA: string
    locationB: string
    archivedLocation: string
    classTypeId: string
    otherClassTypeId: string
    teacher: string
    otherTeacher: string
    /** Class ids by what they are. */
    classes: { atA: string; atB: string; otherType: string; cancelled: string; nextMonth: string }
    packages: { active: string; archived: string; activePt: string; archivedPt: string }
  }

  let one!: Studio
  let two!: Studio

  /** Seven days that start a week from now, so every class this file makes is in the future. */
  const weekFrom = new Date(Date.now() + 7 * DAY)
  const weekTo = new Date(weekFrom.getTime() + 7 * DAY)
  const inWeek = (hours: number) => new Date(weekFrom.getTime() + DAY + hours * HOUR)

  /** What the member app on `tenant`'s hostname sends when nobody is signed in. */
  const visitor = (tenant: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('client', tenant),
    'X-Forwarded-For': harnessAddress(),
  })

  async function get(path: string, headers: Record<string, string>) {
    const res = await harness.app.request(path, { headers })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, text }
  }

  async function getOk(path: string, headers: Record<string, string>) {
    const res = await get(path, headers)
    assert.equal(res.status, 200, res.text)
    return res.body
  }

  async function staff(tenant: { id: string }, name: string): Promise<string> {
    const email = `${name}@${DOMAIN}`
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const authUserId = await ensureAuthUser(harness.db, 'staff', { email, name })
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: `${name} ${run}`, role: 'instructor', status: 'active', authUserId })
      .returning({ id: schema.staffUsers.id })
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    return row!.id
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const location = async (name: string, archived = false) => {
      const [row] = await harness.db
        .insert(schema.locations)
        .values({ tenantId: tenant.id, name: `${TAG} ${tenant.slug} ${name}`, archivedAt: archived ? new Date() : null })
        .returning({ id: schema.locations.id })
      const [room] = await harness.db
        .insert(schema.rooms)
        .values({ tenantId: tenant.id, locationId: row!.id, name: `${name} room`, capacity: 20 })
        .returning({ id: schema.rooms.id })
      return { id: row!.id, roomId: room!.id }
    }
    const a = await location('Harbour')
    const b = await location('Hillside')
    const archived = await location('Old hall', true)

    const classType = async (name: string, difficulty: 'general' | 'beginner' = 'general') => {
      const [row] = await harness.db
        .insert(schema.classTypes)
        .values({ tenantId: tenant.id, name: `${TAG} ${tenant.slug} ${name}`, difficulty })
        .returning({ id: schema.classTypes.id })
      return row!.id
    }
    // Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
    const classTypeId = await classType('Vinyasa')
    const otherClassTypeId = await classType('Yin', 'beginner')
    const teacher = await staff(tenant, `teacher-${tenant.slug}`)
    const otherTeacher = await staff(tenant, `other-teacher-${tenant.slug}`)

    const addClass = async (spec: { at: { id: string; roomId: string }; startsAt: Date; type?: string; by?: string; cancelled?: boolean }) => {
      const [row] = await harness.db
        .insert(schema.classes)
        .values({
          tenantId: tenant.id,
          classTypeId: spec.type ?? classTypeId,
          mainInstructorId: spec.by ?? teacher,
          locationId: spec.at.id,
          roomId: spec.at.roomId,
          startsAt: spec.startsAt,
          endsAt: new Date(spec.startsAt.getTime() + 75 * 60 * 1000),
          capacityOnline: 12,
          creditCost: 2,
          lifecycle: spec.cancelled ? 'cancelled' : 'active',
          createdByStaffId: teacher,
        })
        .returning({ id: schema.classes.id })
      return row!.id
    }

    const classPackage = async (name: string, status: 'active' | 'archived') => {
      const [row] = await harness.db
        .insert(schema.classPackages)
        .values({ tenantId: tenant.id, name: `${TAG} ${tenant.slug} ${name}`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status })
        .returning({ id: schema.classPackages.id })
      return row!.id
    }
    const ptPackage = async (name: string, status: 'active' | 'archived') => {
      const [row] = await harness.db
        .insert(schema.ptPackages)
        .values({ tenantId: tenant.id, name: `${TAG} ${tenant.slug} ${name}`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00', status })
        .returning({ id: schema.ptPackages.id })
      return row!.id
    }

    return {
      ...tenant,
      locationA: a.id,
      locationB: b.id,
      archivedLocation: archived.id,
      classTypeId,
      otherClassTypeId,
      teacher,
      otherTeacher,
      classes: {
        atA: await addClass({ at: a, startsAt: inWeek(9) }),
        atB: await addClass({ at: b, startsAt: inWeek(11), by: otherTeacher }),
        otherType: await addClass({ at: a, startsAt: inWeek(33), type: otherClassTypeId }),
        cancelled: await addClass({ at: a, startsAt: inWeek(57), cancelled: true }),
        nextMonth: await addClass({ at: a, startsAt: new Date(weekTo.getTime() + 20 * DAY) }),
      },
      packages: {
        active: await classPackage('Ten pack', 'active'),
        archived: await classPackage('Retired pack', 'archived'),
        activePt: await ptPackage('PT five', 'active'),
        archivedPt: await ptPackage('Retired PT', 'archived'),
      },
    }
  }

  const weekQuery = `from=${weekFrom.toISOString()}&to=${weekTo.toISOString()}`
  /** The week's classes at `at` that this file made — other files' classes may share the week. */
  const classesAt = async (at: Studio, filters = '') => {
    const body = await getOk(`/api/v1/public/classes?${weekQuery}${filters}`, visitor(at))
    return (body.classes as any[]).filter(c => (c.class_type.name as string).startsWith(TAG))
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)

    // One seat taken on the Harbour class, booked the way a member books it.
    const email = `booker@${DOMAIN}`
    const headers = await harness.signInAs('client', email, one)
    const [user] = await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: one.id, email, name: 'Booker', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    await harness.db.insert(schema.clientPackages).values({
      tenantId: one.id,
      clientId: client!.id,
      kind: 'credit_bundle',
      sourceClassPackageId: one.packages.active,
      validityDays: 90,
      creditsOrSessionsRemaining: 10,
      active: true,
      amountPaidSgd: '200.00',
      listPriceSgd: '200.00',
    })
    const booked = await harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_id: one.classes.atA }),
    })
    assert.equal(booked.status, 201, await booked.text())
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const tagged = `${TAG}%`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE target_id IN (SELECT id FROM client_packages WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${tagged}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${tagged}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE ${tagged}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (SELECT id FROM locations WHERE name LIKE ${tagged})`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name LIKE ${tagged}`)
    await harness.close()
  })

  test('CAT-01 an anonymous visitor gets the home page: the studio\'s own name, copy and Locations, and none of the other studio\'s', async () => {
    for (const [at, other] of [
      [one, two],
      [two, one],
    ] as const) {
      const home = await getOk(`/api/v1/public/tenants/by-slug/${at.slug}`, visitor(at))
      assert.equal(home.tenant.id, at.id)
      assert.equal(home.tenant.slug, at.slug)
      // The name and copy the home page renders are this studio's own rows.
      const [owned] = await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, at.id))
      const [settings] = await harness.db.select().from(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, at.id))
      assert.equal(home.tenant.name, owned!.name)
      assert.equal(home.settings.display_name, settings?.displayName ?? null)
      assert.equal(home.settings.tagline, settings?.tagline ?? null)
      assert.deepEqual(home.settings.copy, settings?.copy ?? {})
      const [theirs] = await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, other.id))
      assert.notEqual(home.tenant.name, theirs!.name, 'not the other studio\'s name')

      const { locations } = await getOk('/api/v1/public/locations', visitor(at))
      const ids = (locations as { id: string }[]).map(l => l.id)
      assert.ok(ids.includes(at.locationA) && ids.includes(at.locationB), 'both of the studio\'s own Locations are listed')
      assert.ok(!ids.includes(other.locationA) && !ids.includes(other.locationB), 'no Location of the other studio is listed')
    }
  })

  test('CAT-01 an unknown studio address is refused, on the home page lookup and on the catalogue', async () => {
    const nobody = { slug: `no-such-studio-${run}` }
    const lookup = await get(`/api/v1/public/tenants/by-slug/${nobody.slug}`, visitor(nobody))
    assert.equal(lookup.status, 404, lookup.text)
    assert.deepEqual(lookup.body, { error: 'not_found' })

    for (const path of ['/api/v1/public/locations', `/api/v1/public/classes?${weekQuery}`, '/api/v1/public/packages']) {
      const res = await get(path, visitor(nobody))
      assert.equal(res.status, 404, `${path}: ${res.text}`)
      assert.deepEqual(res.body, { error: 'not_found' }, `${path} leaked more than a refusal`)
    }
  })

  test('LOC-04 the member app lists exactly the studio\'s active Locations: archived ones and the other studio\'s are left out', async () => {
    for (const [at, other] of [
      [one, two],
      [two, one],
    ] as const) {
      const { locations } = await getOk('/api/v1/public/locations', visitor(at))
      const listed = locations as { id: string; name: string }[]

      // What the studio holds, counted without the app: active, not deleted.
      const [held] = await harness.db.execute<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM locations
        WHERE tenant_id = ${at.id} AND archived_at IS NULL AND deleted_at IS NULL`)
      const count = held!.count
      assert.equal(listed.length, count, 'no assumed count: every active Location, and only those')

      const ids = listed.map(l => l.id)
      assert.ok(!ids.includes(at.archivedLocation), 'an archived Location is not listed')
      assert.ok(!ids.includes(other.locationA) && !ids.includes(other.archivedLocation))
    }
  })

  test('CAT-03 the week\'s classes across all Locations, with title, instructor, start, duration, capacity and seats taken', async () => {
    const listed = await classesAt(one)
    const ids = listed.map(c => c.id)
    assert.deepEqual(
      new Set(ids),
      new Set([one.classes.atA, one.classes.atB, one.classes.otherType]),
      'that week\'s active classes at both Locations; not a cancelled one, not next month\'s',
    )

    const harbour = listed.find(c => c.id === one.classes.atA)!
    assert.equal(harbour.class_type.name, `${TAG} ${one.slug} Vinyasa`)
    assert.equal(harbour.instructor.id, one.teacher)
    assert.equal(harbour.instructor.name, `teacher-${one.slug} ${run}`)
    assert.equal(harbour.starts_at, inWeek(9).toISOString())
    assert.equal(new Date(harbour.ends_at).getTime() - new Date(harbour.starts_at).getTime(), 75 * 60 * 1000)
    assert.equal(harbour.capacity_online, 12)
    assert.equal(harbour.booked_count, 1, 'the seat the member booked is taken')
    assert.equal(harbour.spots_left, 11)
    assert.equal(harbour.location.id, one.locationA)

    const hillside = listed.find(c => c.id === one.classes.atB)!
    assert.equal(hillside.location.id, one.locationB)
    assert.equal(hillside.booked_count, 0)
  })

  test('CAT-03 the other studio\'s classes never appear, and its class ids are not found here', async () => {
    const atOne = (await classesAt(one)).map(c => c.id)
    for (const id of Object.values(two.classes)) assert.ok(!atOne.includes(id))
    const atTwo = (await classesAt(two)).map(c => c.id)
    for (const id of Object.values(one.classes)) assert.ok(!atTwo.includes(id))

    const detail = await get(`/api/v1/public/classes/${two.classes.atA}`, visitor(one))
    assert.equal(detail.status, 404, detail.text)
    const cancelled = await get(`/api/v1/public/classes/${one.classes.cancelled}`, visitor(one))
    assert.equal(cancelled.status, 404, 'a cancelled class has no public page')
  })

  test('CAT-04 filtering by one Location, one instructor or one class type lists only the matching classes', async () => {
    const byLocation = await classesAt(one, `&location_id=${one.locationB}`)
    assert.deepEqual(byLocation.map(c => c.id), [one.classes.atB])

    const byTeacher = await classesAt(one, `&instructor_id=${one.teacher}`)
    assert.deepEqual(new Set(byTeacher.map(c => c.id)), new Set([one.classes.atA, one.classes.otherType]))

    const byType = await classesAt(one, `&class_type_id=${one.otherClassTypeId}`)
    assert.deepEqual(byType.map(c => c.id), [one.classes.otherType])

    const combined = await classesAt(one, `&location_id=${one.locationA}&class_type_id=${one.classTypeId}`)
    assert.deepEqual(combined.map(c => c.id), [one.classes.atA])
  })

  // Fails today: the class list has no level filter, and ignores `level` (#238).
  test('CAT-04 filtering by level lists only that level\'s classes', async () => {
    const beginners = await classesAt(one, '&level=beginner')
    assert.deepEqual(beginners.map(c => c.id), [one.classes.otherType])
  })

  test('CAT-04 a filter naming the other studio\'s Location or instructor lists nothing of either studio', async () => {
    assert.deepEqual(await classesAt(one, `&location_id=${two.locationA}`), [])
    assert.deepEqual(await classesAt(one, `&instructor_id=${two.teacher}`), [])
  })

  test('CAT-04 the filter menus list only the studio\'s own active instructors and class types', async () => {
    const { instructors } = await getOk('/api/v1/public/instructors', visitor(one))
    const teacherIds = (instructors as { id: string }[]).map(i => i.id)
    assert.ok(teacherIds.includes(one.teacher) && teacherIds.includes(one.otherTeacher))
    assert.ok(!teacherIds.includes(two.teacher) && !teacherIds.includes(two.otherTeacher))

    const { class_types } = await getOk('/api/v1/public/class-types', visitor(one))
    const typeIds = (class_types as { id: string }[]).map(t => t.id)
    assert.ok(typeIds.includes(one.classTypeId) && typeIds.includes(one.otherClassTypeId))
    assert.ok(!typeIds.includes(two.classTypeId))
  })

  test('the packages page lists the studio\'s active packages only: none archived, none of the other studio\'s', async () => {
    for (const [at, other] of [
      [one, two],
      [two, one],
    ] as const) {
      const body = await getOk('/api/v1/public/packages', visitor(at))
      const classIds = (body.class_packages as { id: string }[]).map(p => p.id)
      const ptIds = (body.pt_packages as { id: string }[]).map(p => p.id)
      assert.ok(classIds.includes(at.packages.active))
      assert.ok(ptIds.includes(at.packages.activePt))
      assert.ok(!classIds.includes(at.packages.archived), 'an archived package is hidden')
      assert.ok(!ptIds.includes(at.packages.archivedPt), 'an archived PT package is hidden')
      assert.ok(!classIds.includes(other.packages.active) && !ptIds.includes(other.packages.activePt))
    }
  })
})
