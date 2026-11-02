import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.edit-times.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const TAG = `Edit times ${run}`
const CLASS_TYPE_NAME = `${TAG} class type`
const PACKAGE_NAME = `${TAG} pass`
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const YEAR = 365 * DAY

/**
 * An Admin's edit of a class's times over HTTP.
 *
 * Once a class has started it can no longer be edited or cancelled, its
 * bookings are spent and its Instructor Pay is owed. So an edit that gives an
 * upcoming class a start that has already passed would turn a class that never
 * ran into one that did, with nothing left to undo it: it is refused, and so is
 * an end at or before the start.
 *
 * Fixtures — the class, a member's bundle, staff rows — are written directly;
 * every rule under test runs behind a route.
 */
describe('editing a class’s times over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Staff = { id: string; headers: Headers }

  let tenant!: { id: string; slug: string }
  let admin!: Staff
  let instructor!: Staff
  let locationId!: string
  let roomId!: string
  let classTypeId!: string
  let classPackageId!: string

  const emailFor = (name: string) => `${name}-${tenant.slug}@${DOMAIN}`

  async function reply(res: Response): Promise<Reply> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const send = async (method: string, path: string, headers: Headers, body?: unknown) =>
    reply(
      await harness.app.request(`/api/v1${path}`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )

  async function staff(name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(name)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, tenant.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { id: row!.id, headers }
  }

  /** An hour-long class a week out, two credits a seat, Instructor Pay S$40. */
  async function addClass(): Promise<{ id: string; startsAt: Date; endsAt: Date }> {
    const startsAt = new Date(Math.floor((Date.now() + 7 * DAY) / MINUTE) * MINUTE)
    const endsAt = new Date(startsAt.getTime() + HOUR)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: tenant.id,
        classTypeId,
        mainInstructorId: instructor.id,
        locationId,
        roomId,
        startsAt,
        endsAt,
        capacityOnline: 10,
        creditCost: 2,
        instructorPaySgd: '40.00',
        createdByStaffId: admin.id,
      })
      .returning({ id: schema.classes.id })
    return { id: row!.id, startsAt, endsAt }
  }

  let memberSeq = 0
  /** A member signed in at the studio, holding a five-credit bundle. */
  async function member(): Promise<{ clientId: string; headers: Headers }> {
    const name = `member${++memberSeq}`
    const email = emailFor(name)
    const headers = await harness.signInAs('client', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: tenant.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    await purchaseSvc.grantPackage(tenant.id, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '100.00',
      packageKind: 'class',
      packageId: classPackageId,
    })
    return { clientId: client!.id, headers }
  }

  const editClass = (classId: string, body: Record<string, unknown>) =>
    send('PATCH', `/portal/admin/schedule/classes/${classId}`, admin.headers, body)

  async function classRow(classId: string) {
    const [row] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, classId))
    return row!
  }

  async function creditsLeft(clientId: string): Promise<number> {
    const [row] = await harness.db
      .select({ left: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.clientId, clientId))
    return row!.left!
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    tenant = harness.tenants.one
    const [location] = await harness.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenant.id))
      .limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    locationId = location.id
    // A room of its own, so no other file's class can clash with a reschedule here.
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId, name: `${TAG} room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    roomId = room!.id
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: CLASS_TYPE_NAME })
      .returning({ id: schema.classTypes.id })
    classTypeId = type!.id
    classPackageId = (
      await classPackagesSvc.createClassPackage(tenant.id, {
        name: PACKAGE_NAME,
        kind: 'credit_bundle',
        credits: 5,
        validityDays: 90,
        priceSgd: '100.00',
      })
    ).id
    admin = await staff('admin', 'admin')
    instructor = await staff('instructor', 'instructor')
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE class_type_id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE id = ${roomId}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('SCH-29 an admin moving a booked upcoming class’s start into the past is refused, and the class stays upcoming, editable and cancellable', async () => {
    const cls = await addClass()
    const holder = await member()
    const booked = await send('POST', '/me/bookings/class', holder.headers, { class_id: cls.id })
    assert.equal(booked.status, 201, JSON.stringify(booked.body))
    assert.equal(await creditsLeft(holder.clientId), 3)

    // The same day a year earlier: a mistyped year.
    const yearEarlier = await editClass(cls.id, {
      starts_at: new Date(cls.startsAt.getTime() - YEAR).toISOString(),
      ends_at: new Date(cls.endsAt.getTime() - YEAR).toISOString(),
    })
    assert.equal(yearEarlier.status, 400, JSON.stringify(yearEarlier.body))
    assert.equal(yearEarlier.body.error, 'starts_at_in_past')

    // A start a minute ago is as past as one a year ago, even with the end left in the future.
    const minuteAgo = await editClass(cls.id, { starts_at: new Date(Date.now() - MINUTE).toISOString() })
    assert.equal(minuteAgo.status, 400, JSON.stringify(minuteAgo.body))
    assert.equal(minuteAgo.body.error, 'starts_at_in_past')

    // Nothing moved: the class is where it was, and the booking still holds its seat.
    const row = await classRow(cls.id)
    assert.equal(row.startsAt.getTime(), cls.startsAt.getTime())
    assert.equal(row.endsAt.getTime(), cls.endsAt.getTime())
    assert.equal(row.lifecycle, 'active')
    const [booking] = await harness.db
      .select({ state: schema.bookings.state })
      .from(schema.bookings)
      .where(eq(schema.bookings.id, booked.body.booking_id))
    assert.equal(booking!.state, 'confirmed')

    // Still editable: a move to a later upcoming time saves.
    const later = new Date(cls.startsAt.getTime() + DAY)
    const moved = await editClass(cls.id, {
      starts_at: later.toISOString(),
      ends_at: new Date(later.getTime() + HOUR).toISOString(),
    })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.equal(moved.body.starts_at, later.toISOString())

    // Still cancellable, and cancelling it gives the member's credits back.
    const cancelled = await send('POST', `/portal/admin/schedule/classes/${cls.id}/cancel`, admin.headers)
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
    assert.equal(cancelled.body.refunded_count, 1)
    assert.equal(await creditsLeft(holder.clientId), 5)
  })

  test('SCH-29 a class nobody has booked cannot be moved into the past either', async () => {
    const cls = await addClass()
    const res = await editClass(cls.id, {
      starts_at: new Date(Date.now() - DAY).toISOString(),
      ends_at: new Date(Date.now() - DAY + HOUR).toISOString(),
    })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.error, 'starts_at_in_past')
    assert.equal((await classRow(cls.id)).startsAt.getTime(), cls.startsAt.getTime())
  })

  test('SCH-30 an admin editing a class so it ends at or before it starts is refused with a 400, and the class is unchanged', async () => {
    const cls = await addClass()
    const refusals: Record<string, unknown>[] = [
      // The end alone, moved before the start.
      { ends_at: new Date(cls.startsAt.getTime() - HOUR).toISOString() },
      // The end alone, on the start.
      { ends_at: cls.startsAt.toISOString() },
      // The start alone, moved past the end.
      { starts_at: new Date(cls.endsAt.getTime() + HOUR).toISOString() },
      // Both, inverted.
      {
        starts_at: new Date(cls.startsAt.getTime() + HOUR).toISOString(),
        ends_at: cls.startsAt.toISOString(),
      },
    ]
    for (const body of refusals) {
      const res = await editClass(cls.id, body)
      assert.equal(res.status, 400, `${JSON.stringify(body)} → ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, 'ends_at_must_be_after_starts_at', JSON.stringify(body))
    }
    const row = await classRow(cls.id)
    assert.equal(row.startsAt.getTime(), cls.startsAt.getTime())
    assert.equal(row.endsAt.getTime(), cls.endsAt.getTime())
  })
})
