import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from './harness'

/**
 * Tenant isolation across the identity, policy, catalog and schedule surfaces.
 *
 * Two halves, for one reason:
 *
 * - **Reads go through `app.request()`.** The public catalogue is the whole of
 *   these surfaces that a request can reach without a Clerk token, and it is a
 *   real end-to-end proof: hostname → `X-Tenant-Slug` → middleware → service →
 *   SQL. Tenant `acme` asking for classes, locations, instructors, class types
 *   or merch must never see Yoga Sadhana's.
 *
 * - **Writes go through the services.** Every portal route is behind a verified
 *   Clerk JWT, and this harness has no way to mint one — the backend-resolution
 *   ticket (#65) is what brings an auth seam a test can drive. Until then the
 *   refusals are asserted one layer below the HTTP boundary, on exactly the
 *   functions those routes call, with the tenant the route would have passed.
 */

const SOON = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
const HOUR = 60 * 60 * 1000

type Fixture = {
  tenantId: string
  slug: string
  locationId: string
  roomId: string
  classTypeId: string
  instructorId: string
  classId: string
  merchId: string
  clientId: string
}

describe('tenant isolation', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let one!: Fixture
  let two!: Fixture

  let schema: typeof import('../db/schema')
  let catalogSvc: typeof import('../services/catalog/locations')
  let classTypesSvc: typeof import('../services/catalog/class-types')
  let roomsSvc: typeof import('../services/catalog/rooms')
  let merchSvc: typeof import('../services/catalog/merch')
  let classesSvc: typeof import('../services/schedule/classes')
  let policySvc: typeof import('../services/policy/update')
  let clientsSvc: typeof import('../services/clients/manage')
  let staffSvc: typeof import('../services/auth/staff-archive')
  let invitesSvc: typeof import('../services/auth/invitations')

  /** One studio's worth of rows: a class type, an instructor, a class, an item, a member. */
  async function provision(tenantId: string, slug: string): Promise<Fixture> {
    const [location] = await harness.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenantId))
      .limit(1)
    assert.ok(location, `expected a seeded location for ${slug}`)
    const [room] = await harness.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.locationId, location.id))
      .limit(1)
    assert.ok(room, `expected a seeded room for ${slug}`)

    const classType = await classTypesSvc.createClassType(tenantId, {
      name: `${slug} Flow`,
      description: `${slug} only`,
    })

    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId,
        email: `instructor-${slug}@isolation.test`,
        name: `${slug} Instructor`,
        role: 'instructor',
        status: 'active',
        clerkUserId: `clerk_${slug}_instructor`,
      })
      .returning()
    assert.ok(staff)
    await harness.db
      .insert(schema.instructors)
      .values({ tenantId, staffUserId: staff.id })
      .onConflictDoNothing()

    const startsAt = SOON()
    const cls = await classesSvc.createClass(tenantId, {
      classTypeId: classType.id,
      mainInstructorId: staff.id,
      locationId: location.id,
      roomId: room.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      capacityOnline: 10,
      capacityWaitlist: 0,
      capacityBuffer: 0,
      creditCost: 1,
      instructorPaySgd: 50,
      createdByStaffId: staff.id,
    })

    const item = await merchSvc.createMerch(tenantId, {
      title: `${slug} Mat`,
      description: null,
      priceSgd: '40.00',
    })

    const [client] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId,
        email: `member-${slug}@isolation.test`,
        name: `${slug} Member`,
        phone: '+6580000000',
        clerkUserId: `clerk_${slug}_member`,
      })
      .returning()
    assert.ok(client)

    return {
      tenantId,
      slug,
      locationId: location.id,
      roomId: room.id,
      classTypeId: classType.id,
      instructorId: staff.id,
      classId: cls.id,
      merchId: item.id,
      clientId: client.id,
    }
  }

  /**
   * Remove every row this file creates, in foreign-key order. Everything it
   * writes is stamped `@isolation.test` or named after a tenant slug, so the
   * purge can be exact without tracking ids.
   */
  async function purgeFixtures() {
    const { sql } = await import('drizzle-orm')
    await harness.db.execute(sql`
      DELETE FROM class_supporting_instructors WHERE class_id IN (
        SELECT c.id FROM classes c
        JOIN class_types t ON t.id = c.class_type_id
        WHERE t.name LIKE '% Flow'
      )
    `)
    await harness.db.execute(sql`
      DELETE FROM classes WHERE class_type_id IN (
        SELECT id FROM class_types WHERE name LIKE '% Flow'
      )
    `)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE '% Flow'`)
    await harness.db.execute(sql`DELETE FROM merch WHERE title LIKE '% Mat'`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE '%@isolation.test'`)
    await harness.db.execute(sql`
      DELETE FROM leave_conflicts WHERE instructor_a_id IN (
        SELECT id FROM staff_users WHERE email LIKE '%@isolation.test'
      ) OR instructor_b_id IN (
        SELECT id FROM staff_users WHERE email LIKE '%@isolation.test'
      )
    `)
    await harness.db.execute(sql`
      DELETE FROM instructors WHERE staff_user_id IN (
        SELECT id FROM staff_users WHERE email LIKE '%@isolation.test'
      )
    `)
    // The policy save records who made it, and that FK is `on delete restrict`.
    await harness.db.execute(sql`
      UPDATE global_policy SET updated_by_staff_id = NULL WHERE updated_by_staff_id IN (
        SELECT id FROM staff_users WHERE email LIKE '%@isolation.test'
      )
    `)
    await harness.db.execute(sql`
      UPDATE pt_booking_config SET updated_by_staff_id = NULL WHERE updated_by_staff_id IN (
        SELECT id FROM staff_users WHERE email LIKE '%@isolation.test'
      )
    `)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE '%@isolation.test'`)
  }

  /** A public GET as one tenant, exactly as the frontend proxy would send it. */
  async function getAs(slug: string, path: string) {
    const res = await harness.app.request(path, { headers: { 'X-Tenant-Slug': slug } })
    // Text, not `.json()`: a refusal body is what several of these assertions
    // compare, and it is not always JSON.
    const text = await res.text()
    return {
      status: res.status,
      text,
      get body(): Record<string, any> {
        return JSON.parse(text)
      },
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    catalogSvc = await import('../services/catalog/locations')
    classTypesSvc = await import('../services/catalog/class-types')
    roomsSvc = await import('../services/catalog/rooms')
    merchSvc = await import('../services/catalog/merch')
    classesSvc = await import('../services/schedule/classes')
    policySvc = await import('../services/policy/update')
    clientsSvc = await import('../services/clients/manage')
    staffSvc = await import('../services/auth/staff-archive')
    invitesSvc = await import('../services/auth/invitations')

    // A run killed mid-flight leaves its fixtures behind, and their emails and
    // Clerk ids are unique — so clear anything this file wrote before writing
    // it again, rather than failing on the leftovers.
    await purgeFixtures()

    one = await provision(harness.tenants.one.id, harness.tenants.one.slug)
    two = await provision(harness.tenants.two.id, harness.tenants.two.slug)
  })

  after(async () => {
    // `before` may have thrown — don't mask the real failure with a teardown one.
    if (!harness) return
    await purgeFixtures().catch(() => {})
    await harness.close()
  })

  // ── the request seam ──────────────────────────────────────────────────────

  test('the header decides which tenant a public request is about', async () => {
    const asOne = await getAs(one.slug, '/api/v1/public/class-types')
    const asTwo = await getAs(two.slug, '/api/v1/public/class-types')

    const oneNames = asOne.body.class_types.map((t: any) => t.name)
    const twoNames = asTwo.body.class_types.map((t: any) => t.name)
    assert.ok(oneNames.includes(`${one.slug} Flow`))
    assert.ok(twoNames.includes(`${two.slug} Flow`))
    assert.ok(!twoNames.includes(`${one.slug} Flow`), "acme can read Yoga Sadhana's class types")
    assert.ok(!oneNames.includes(`${two.slug} Flow`))
  })

  test('locations, instructors and merch are each tenant-scoped', async () => {
    const locations = await getAs(two.slug, '/api/v1/public/locations')
    const ids = locations.body.locations.map((l: any) => l.id)
    assert.ok(ids.includes(two.locationId))
    assert.ok(!ids.includes(one.locationId))

    const instructors = await getAs(two.slug, '/api/v1/public/instructors')
    const instructorIds = instructors.body.instructors.map((i: any) => i.id)
    assert.ok(instructorIds.includes(two.instructorId))
    assert.ok(!instructorIds.includes(one.instructorId))

    const merch = await getAs(two.slug, '/api/v1/public/merch')
    const merchIds = merch.body.merch.map((m: any) => m.id)
    assert.ok(merchIds.includes(two.merchId))
    assert.ok(!merchIds.includes(one.merchId))
  })

  test("a class list never carries another tenant's class", async () => {
    const asTwo = await getAs(two.slug, '/api/v1/public/classes')
    const ids = asTwo.body.classes.map((r: any) => r.id)
    assert.ok(ids.includes(two.classId))
    assert.ok(!ids.includes(one.classId), "acme can read Yoga Sadhana's schedule")
  })

  test("asking for another tenant's class by id is a 404, not a 403", async () => {
    const borrowed = await getAs(two.slug, `/api/v1/public/classes/${one.classId}`)
    assert.equal(borrowed.status, 404)
    // Byte-identical to a class that simply does not exist: the response cannot
    // be used to learn that the id is real somewhere else.
    const missing = await getAs(
      two.slug,
      '/api/v1/public/classes/00000000-0000-0000-0000-0000000000ff',
    )
    assert.equal(borrowed.text, missing.text)

    const own = await getAs(two.slug, `/api/v1/public/classes/${two.classId}`)
    assert.equal(own.status, 200)
  })

  test('an unknown tenant slug is refused before any query runs', async () => {
    const res = await harness.app.request('/api/v1/public/locations', {
      headers: { 'X-Tenant-Slug': 'no-such-studio' },
    })
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'not_found' })
  })

  test('no header still answers as tenant #1 — every existing client sends none', async () => {
    const res = await harness.app.request('/api/v1/public/class-types')
    assert.equal(res.status, 200)
    const body = (await res.json()) as { class_types: { name: string }[] }
    const names = body.class_types.map(t => t.name)
    assert.ok(names.includes(`${one.slug} Flow`))
    assert.ok(!names.includes(`${two.slug} Flow`))
  })

  test('a write from a service this batch has not scoped still lands on tenant #1', async () => {
    // The load-bearing property of the expand phase. Reads on `bookings`,
    // `cancellations`, `leave_requests` and friends are filtered now, but the
    // inserts feeding them live in services scoped later (#61, #62) and name no
    // tenant. Without the column default those rows would land NULL and vanish
    // from the read beside them — a class that fills while every surface reports
    // it empty. This is that default, asserted rather than assumed.
    const [booking] = await harness.db
      .insert(schema.bookings)
      .values({
        clientId: one.clientId,
        kind: 'class',
        classId: one.classId,
        state: 'confirmed',
        code: 'ISO-DEFAULT',
        qrToken: 'iso-default-token',
      })
      .returning()
    assert.ok(booking)
    try {
      assert.equal(
        booking.tenantId,
        harness.tenants.one.id,
        'an insert that names no tenant must still land on tenant #1',
      )
      // …and is therefore visible to the tenant-filtered read beside it.
      const seen = await getAs(one.slug, '/api/v1/public/classes')
      const card = seen.body.classes.find((r: any) => r.id === one.classId)
      assert.equal(card?.booked_count, 1)
    } finally {
      await harness.db.delete(schema.bookings).where(eq(schema.bookings.id, booking.id))
    }
  })

  // ── catalog and schedule writes ───────────────────────────────────────────

  test("a tenant cannot read or write another tenant's location", async () => {
    await assert.rejects(
      () => catalogSvc.getLocation(two.tenantId, one.locationId),
      (err: { code?: string }) => err.code === 'location_not_found',
    )
    await assert.rejects(
      () => catalogSvc.updateLocation(two.tenantId, one.locationId, { name: 'Stolen' }),
      (err: { code?: string }) => err.code === 'location_not_found',
    )
    const [untouched] = await harness.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, one.locationId))
    assert.notEqual(untouched?.name, 'Stolen')
  })

  test("a room cannot be hung off another tenant's location", async () => {
    await assert.rejects(
      () =>
        roomsSvc.createRoom(two.tenantId, {
          location_id: one.locationId,
          name: 'Trespass',
          capacity: 5,
        }),
      (err: { code?: string }) => err.code === 'location_not_found',
    )
  })

  test("a class cannot borrow another tenant's room, class type or instructor", async () => {
    // A day clear of the fixture classes, so a room clash can't stand in for the
    // refusal being asserted.
    const startsAt = new Date(SOON().getTime() + 2 * 24 * HOUR)
    const base = {
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      capacityOnline: 5,
      capacityWaitlist: 0,
      capacityBuffer: 0,
      creditCost: 1,
      instructorPaySgd: 10,
      createdByStaffId: two.instructorId,
    }

    await assert.rejects(
      () =>
        classesSvc.createClass(two.tenantId, {
          ...base,
          classTypeId: two.classTypeId,
          mainInstructorId: two.instructorId,
          locationId: one.locationId,
          roomId: one.roomId,
        }),
      (err: { code?: string }) => err.code === 'room_not_found',
    )

    await assert.rejects(
      () =>
        classesSvc.createClass(two.tenantId, {
          ...base,
          classTypeId: two.classTypeId,
          mainInstructorId: one.instructorId,
          locationId: two.locationId,
          roomId: two.roomId,
        }),
      (err: { code?: string }) => err.code === 'invalid_instructor_id',
    )
  })

  test("a tenant cannot edit another tenant's class", async () => {
    await assert.rejects(
      () => classesSvc.updateClass(two.tenantId, one.classId, { capacityOnline: 1 }),
      (err: { code?: string }) => err.code === 'class_not_found',
    )
    const [untouched] = await harness.db
      .select()
      .from(schema.classes)
      .where(eq(schema.classes.id, one.classId))
    assert.equal(untouched?.capacityOnline, 10)
  })

  test("merch reads and writes stop at the tenant's own catalogue", async () => {
    await assert.rejects(
      () => merchSvc.getMerch(two.tenantId, one.merchId),
      (err: { code?: string }) => err.code === 'merch_not_found',
    )
    await assert.rejects(
      () => merchSvc.deleteMerch(two.tenantId, one.merchId),
      (err: { code?: string }) => err.code === 'merch_not_found',
    )
    const rows = await harness.db
      .select()
      .from(schema.merch)
      .where(eq(schema.merch.id, one.merchId))
    assert.equal(rows.length, 1)
  })

  // ── policy ────────────────────────────────────────────────────────────────

  test('each tenant has its own policy row, and saving one leaves the other alone', async () => {
    const before1 = await policySvc.readPolicy(one.tenantId)
    const before2 = await policySvc.readPolicy(two.tenantId)
    assert.notEqual(before1.global_policy.id, before2.global_policy.id)
    assert.notEqual(before1.pt_booking_config.id, before2.pt_booking_config.id)

    await policySvc.updateGlobalPolicy(two.tenantId, { cancelCapCount: 9 }, two.instructorId)

    const after2 = await policySvc.readPolicy(two.tenantId)
    const after1 = await policySvc.readPolicy(one.tenantId)
    assert.equal(after2.global_policy.cancelCapCount, 9)
    assert.equal(after1.global_policy.cancelCapCount, before1.global_policy.cancelCapCount)
  })

  test('declared leave conflicts belong to the tenant that declared them', async () => {
    // Two instructors of tenant #2, so there is a pair to declare at all.
    const [second] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId: two.tenantId,
        email: `partner-${two.slug}@isolation.test`,
        name: 'Partner',
        role: 'instructor',
        status: 'active',
        clerkUserId: `clerk_${two.slug}_partner`,
      })
      .returning()
    assert.ok(second)
    await harness.db
      .insert(schema.instructors)
      .values({ tenantId: two.tenantId, staffUserId: second.id })
      .onConflictDoNothing()

    try {
      await policySvc.updateGlobalPolicy(
        two.tenantId,
        {
          leaveConflictPairs: [
            { instructorAId: two.instructorId, instructorBId: second.id },
          ],
        },
        two.instructorId,
      )
      assert.equal((await policySvc.readLeaveConflicts(two.tenantId)).length, 1)
      assert.equal((await policySvc.readLeaveConflicts(one.tenantId)).length, 0)

      // A pair naming somebody else's instructor is refused outright.
      await assert.rejects(
        () =>
          policySvc.updateGlobalPolicy(
            two.tenantId,
            {
              leaveConflictPairs: [
                { instructorAId: two.instructorId, instructorBId: one.instructorId },
              ],
            },
            two.instructorId,
          ),
        (err: { code?: string }) => err.code === 'leave_conflict_instructor_not_active',
      )
    } finally {
      await policySvc.updateGlobalPolicy(two.tenantId, { leaveConflictPairs: [] }, two.instructorId)
      await harness.db.delete(schema.instructors).where(eq(schema.instructors.staffUserId, second.id))
      await harness.db.delete(schema.staffUsers).where(eq(schema.staffUsers.id, second.id))
    }
  })

  // ── identity ──────────────────────────────────────────────────────────────

  test("the member directory never shows another tenant's members", async () => {
    const forTwo = await clientsSvc.listClients(two.tenantId, {})
    const ids = forTwo.map(r => r.id)
    assert.ok(ids.includes(two.clientId))
    assert.ok(!ids.includes(one.clientId))

    await assert.rejects(
      () => clientsSvc.getClientById(two.tenantId, one.clientId),
      (err: { code?: string }) => err.code === 'client_not_found',
    )
    await assert.rejects(
      () =>
        clientsSvc.softDeleteClient({
          tenantId: two.tenantId,
          targetClientId: one.clientId,
          actorStaffId: two.instructorId,
        }),
      (err: { code?: string }) => err.code === 'client_not_found',
    )
    const [untouched] = await harness.db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, one.clientId))
    assert.equal(untouched?.deletedAt, null)
  })

  test("the staff list, and archiving, stop at the tenant's own people", async () => {
    const { staff } = await invitesSvc.listStaffAndInvitations(two.tenantId)
    const ids = staff.map(s => s.id)
    assert.ok(ids.includes(two.instructorId))
    assert.ok(!ids.includes(one.instructorId))

    await assert.rejects(
      () =>
        staffSvc.archiveStaff({
          tenantId: two.tenantId,
          targetStaffId: one.instructorId,
          actorStaffId: two.instructorId,
        }),
      (err: { code?: string }) => err.code === 'staff_not_found',
    )
    const [untouched] = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(eq(schema.staffUsers.id, one.instructorId))
    assert.equal(untouched?.status, 'active')
  })
})
