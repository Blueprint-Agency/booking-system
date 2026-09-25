import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
const DOMAIN = `${run}.pt-prefs.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `PT preference ${run}`
const PT_PACKAGE_NAME = `PT-prefs sessions ${run}`
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

/**
 * What a member states when requesting a private session: a preferred class
 * type — "any" unless they pick one — and proposed start times, with no end.
 * Over real HTTP through `/api/v1/me/pt-sessions`, read back from the member's
 * list and the admin's queue, and followed into payroll, where a session for
 * "any" class type is still paid.
 */
describe('PT request preferences over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')
  let ptPackagesSvc!: typeof import('../services/packages/pt-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  let tenantId!: string
  let locationId!: string
  let roomId!: string
  let classTypeId!: string
  let ptPackageId!: string
  let admin!: { staffId: string; headers: Record<string, string> }
  let coach!: { staffId: string; headers: Record<string, string> }

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const proposedDate = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10)

  const expectStatus = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as any) : null
  }

  async function staff(handle: string, role: 'admin' | 'instructor') {
    const email = emailFor(handle)
    const headers = await harness.signInAs('staff', email, harness.tenants.one)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId, email, name: `${handle} ${run}`, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId, staffUserId: row!.id })
    }
    return { staffId: row!.id, headers }
  }

  /** A member holding a 1on1 PT package with sessions left. */
  async function member(handle: string) {
    const email = emailFor(handle)
    const headers = await harness.signInAs('client', email, harness.tenants.one)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId, email, name: `${handle} ${run}`, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    const { clientPackageId } = await purchaseSvc.grantPackage(tenantId, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '900.00',
      packageKind: 'pt',
      packageId: ptPackageId,
    })
    return { clientId: client!.id, headers, clientPackageId }
  }

  const submit = (who: Awaited<ReturnType<typeof member>>, body: Record<string, unknown>) =>
    harness.app.request('/api/v1/me/pt-sessions/request', {
      method: 'POST',
      headers: { ...who.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        sessionType: '1on1',
        clientPackageId: who.clientPackageId,
        ...body,
      }),
    })

  async function myRequest(who: Awaited<ReturnType<typeof member>>, id: string) {
    const res = await expectStatus(await harness.app.request('/api/v1/me/pt-sessions', { headers: who.headers }), 200)
    const found = res.pt_requests.find((r: any) => r.id === id)
    assert.ok(found, `request ${id} missing from the member's list`)
    return found
  }

  async function adminQueued(id: string) {
    const res = await expectStatus(
      await harness.app.request('/api/v1/portal/admin/pt-sessions?status=all', { headers: admin.headers }),
      200,
    )
    const found = res.pt_requests.find((r: any) => r.id === id)
    assert.ok(found, `request ${id} missing from the admin queue`)
    return found
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))

    tenantId = harness.tenants.one.id
    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenantId))
      .limit(1)
    assert.ok(location, 'expected a seeded location')
    locationId = location.id
    const [room] = await harness.db
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      .where(eq(schema.rooms.locationId, locationId))
      .limit(1)
    assert.ok(room, 'expected a seeded room')
    roomId = room.id
    classTypeId = (await classTypesSvc.createClassType(tenantId, { name: CLASS_TYPE_NAME })).id
    ptPackageId = (
      await ptPackagesSvc.createPtPackage(tenantId, {
        name: PT_PACKAGE_NAME,
        sessionType: '1on1',
        numSessions: 10,
        validityDays: 90,
        priceSgd: '900.00',
      })
    ).id
    admin = await staff('admin', 'admin')
    coach = await staff('coach', 'instructor')
  })

  after(async () => {
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
    const run = (q: ReturnType<typeof sql>) => harness.db.execute(q)
    await run(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await run(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await run(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE id IN (${requests})`)
    await run(sql`DELETE FROM pt_sessions WHERE pt_request_id IN (${requests})`)
    await run(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
    await run(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await run(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await run(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await run(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await run(sql`DELETE FROM pt_packages WHERE name = ${PT_PACKAGE_NAME}`)
    await run(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await run(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await run(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await run(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await run(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await run(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('PT-68 a request for any class type with start-only slots is pending, and reads back with no class type and no end time', async () => {
    const who = await member('any-class')
    const res = await expectStatus(
      await submit(who, {
        slots: [
          { proposedDate, startTime: '09:00' },
          { proposedDate, startTime: '17:30' },
        ],
      }),
      201,
    )
    const id = res.pt_request_id as string

    const [row] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, id))
    assert.equal(row!.status, 'pending')
    assert.equal(row!.classTypeId, null)

    const mine = await myRequest(who, id)
    assert.equal(mine.class_type_id, null)
    assert.equal(mine.class_name, null)
    assert.deepEqual(
      mine.slots.map((s: any) => [s.start_time.slice(0, 5), s.end_time]),
      [
        ['09:00', null],
        ['17:30', null],
      ],
    )

    const queued = await adminQueued(id)
    assert.equal(queued.class_type, null)
    assert.equal(queued.slots[0].end_time, null)
  })

  test('PT-69 a request naming a preferred class type keeps it, with a start-only slot', async () => {
    const who = await member('picked-class')
    const res = await expectStatus(
      await submit(who, { classTypeId, slots: [{ proposedDate, startTime: '10:30' }] }),
      201,
    )
    const id = res.pt_request_id as string

    const mine = await myRequest(who, id)
    assert.equal(mine.class_type_id, classTypeId)
    assert.equal(mine.class_name, CLASS_TYPE_NAME)
    assert.equal(mine.slots[0].end_time, null)

    const queued = await adminQueued(id)
    assert.deepEqual(queued.class_type, { id: classTypeId, name: CLASS_TYPE_NAME })
  })

  test('PAYR-17 a held PT session for any class type is in its instructor\'s teaching log, labelled as a private session', async () => {
    const who = await member('any-class-paid')
    const startsAt = new Date(Date.now() - 3 * DAY)
    const [request] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId,
        clientId: who.clientId,
        classTypeId: null,
        locationId,
        sessionType: '1on1',
        status: 'scheduled',
        expiresAt: startsAt,
      })
      .returning({ id: schema.ptRequests.id })
    const [session] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId,
        ptRequestId: request!.id,
        instructorId: coach.staffId,
        locationId,
        roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * MINUTE),
        sessionType: '1on1',
        instructorPaySgd: '45.00',
        capacityOnline: 1,
        scheduledAt: new Date(startsAt.getTime() - DAY),
        scheduledByStaffId: admin.staffId,
      })
      .returning({ id: schema.ptSessions.id })

    const qs = new URLSearchParams({
      from: new Date(startsAt.getTime() - DAY).toISOString(),
      to: new Date(startsAt.getTime() + DAY).toISOString(),
    })
    const log = await expectStatus(
      await harness.app.request(`/api/v1/portal/instructor/payroll?${qs}`, { headers: coach.headers }),
      200,
    )
    const line = log.rows.find((r: any) => r.id === session!.id)
    assert.ok(line, 'the session for any class type is missing from payroll')
    assert.equal(line.kind, 'pt')
    assert.equal(line.label, 'Private session')
    assert.equal(line.instructor_pay_sgd, 45)
  })
})
