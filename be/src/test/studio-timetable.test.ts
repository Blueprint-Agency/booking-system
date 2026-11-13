import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.studio-timetable.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `Studio timetable class type ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * An Instructor's Full studio schedule over HTTP (admin-restructure §7g):
 * `GET /portal/instructor/schedule/studio` is the studio's whole timetable —
 * every instructor's entries with their booked counts — where
 * `GET /portal/instructor/schedule` stays the caller's own; and
 * `GET /portal/instructor/catalog/instructors` names the studio's instructors
 * and nothing more about them.
 *
 * Fixtures are written directly; every rule under test runs behind a route.
 */
describe('an instructor reads the full studio schedule', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')

  type Headers = Record<string, string>
  type Staff = { id: string; headers: Headers }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    admin: Staff
    instructor: Staff
    otherInstructor: Staff
  }

  let one!: Studio
  let two!: Studio

  const emailFor = (name: string, at: { slug: string }) => `${name}-${at.slug}@${DOMAIN}`

  async function get(path: string, headers: Headers): Promise<{ status: number; body: any }> {
    const res = await harness.app.request(`/api/v1${path}`, { headers })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(name, tenant)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, tenant.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id, phone: '+6580000001' })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { id: row!.id, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenant.id))
      .limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location.id)).limit(1)
    assert.ok(room, `expected a seeded room for ${tenant.slug}`)
    const classType = await classTypesSvc.createClassType(tenant.id, { name: CLASS_TYPE_NAME })
    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      classTypeId: classType.id,
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
      otherInstructor: await staffAt(tenant, 'other-instructor', 'instructor'),
    }
  }

  /** A class `teacher` leads at `at`, `daysOut` days from now. */
  async function addClass(at: Studio, teacher: Staff, daysOut: number): Promise<string> {
    const startsAt = new Date(Date.now() + daysOut * DAY)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: teacher.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 12,
        capacityBuffer: 0,
        capacityWaitlist: 0,
        creditCost: 1,
        createdByStaffId: at.admin.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('SCH-49 the full studio schedule holds every instructor’s classes with their booked counts, My schedule only the caller’s, and no other studio’s', async () => {
    const mine = await addClass(one, one.instructor, 2)
    const theirs = await addClass(one, one.otherInstructor, 3)
    const elsewhere = await addClass(two, two.instructor, 3)

    const from = new Date(Date.now()).toISOString()
    const to = new Date(Date.now() + 6 * DAY).toISOString()
    const window = `from=${from}&to=${to}&type=class`

    const full = await get(`/portal/instructor/schedule/studio?${window}`, one.instructor.headers)
    assert.equal(full.status, 200, JSON.stringify(full.body))
    const ids = (full.body.entries as Array<{ id: string }>).map(e => e.id)
    assert.ok(ids.includes(mine), 'their own class')
    assert.ok(ids.includes(theirs), 'another instructor’s class')
    assert.ok(!ids.includes(elsewhere), 'never another studio’s')
    const other = (full.body.entries as any[]).find(e => e.id === theirs)
    assert.equal(other.main_instructor_id, one.otherInstructor.id)
    assert.equal(other.capacity, 12)
    assert.equal(other.booked_count, 0)
    assert.ok(!('series_id' in other), 'the Class Series id stays the Admin’s')

    const own = await get(`/portal/instructor/schedule?${window}`, one.instructor.headers)
    assert.equal(own.status, 200, JSON.stringify(own.body))
    const ownIds = (own.body.entries as Array<{ id: string }>).map(e => e.id)
    assert.ok(ownIds.includes(mine))
    assert.ok(!ownIds.includes(theirs), 'My schedule stays the caller’s own')

    const narrowed = await get(
      `/portal/instructor/schedule/studio?${window}&instructor_id=${one.otherInstructor.id}`,
      one.instructor.headers,
    )
    assert.equal(narrowed.status, 200, JSON.stringify(narrowed.body))
    const narrowedIds = (narrowed.body.entries as Array<{ id: string }>).map(e => e.id)
    assert.ok(narrowedIds.includes(theirs))
    assert.ok(!narrowedIds.includes(mine), 'the Instructor filter narrows it')
  })

  test('SCH-49 the instructor names an Instructor reads are names only, and only their own studio’s', async () => {
    const res = await get('/portal/instructor/catalog/instructors', one.instructor.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const rows = res.body.instructors as Array<Record<string, unknown>>
    const other = rows.find(r => r.id === one.otherInstructor.id)
    assert.ok(other, 'another instructor of the studio')
    assert.equal(other.name, 'other-instructor')
    assert.deepEqual(Object.keys(other).sort(), ['archived_at', 'id', 'name', 'status'])
    assert.ok(!rows.some(r => r.id === two.instructor.id), 'never another studio’s')
  })
})
