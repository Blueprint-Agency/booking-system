import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from './harness'

/**
 * Tenant isolation across every migrated surface — identity, policy, catalog and
 * schedule (#60), and the transactional core: bookings, check-ins, packages, the
 * credit ledger, finance and billing (#61).
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

/** `YYYY-MM-DD`, which is what leave dates are — calendar days, not instants. */
const plainDate = (d: Date) => d.toISOString().slice(0, 10)

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
  /** The studio's own credit bundle in its catalogue. */
  classPackageId: string
  /** The member's granted bundle — the credits a booking spends. */
  clientPackageId: string
  /** That member's confirmed booking on that class, paid for by that bundle. */
  bookingId: string
  /** The studio's own workshop, and the day and tier that make it bookable. */
  workshopId: string
  workshopDayId: string
  workshopTierId: string
  /** A pending leave request filed by that studio's instructor. */
  leaveRequestId: string
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
  let classPackagesSvc: typeof import('../services/packages/class-packages')
  let purchaseSvc: typeof import('../services/packages/purchase')
  let entitlementsSvc: typeof import('../services/packages/entitlements')
  let adjustSvc: typeof import('../services/packages/adjust')
  let bookSvc: typeof import('../services/bookings/book')
  let cancelSvc: typeof import('../services/bookings/cancel')
  let checkInSvc: typeof import('../services/bookings/check-in')
  let noShowSvc: typeof import('../services/bookings/no-show')
  let bookingListSvc: typeof import('../services/bookings/list')
  let promoAdminSvc: typeof import('../services/packages/promo-code-admin')
  let redemptionSvc: typeof import('../services/packages/promo-redemption')
  let financeSvc: typeof import('../services/finance/list')
  let financeCsvSvc: typeof import('../services/finance/csv')
  let refundsSvc: typeof import('../services/billing/refunds')
  let workshopPublishSvc: typeof import('../services/workshops/publish')
  let workshopDaysSvc: typeof import('../services/workshops/days')
  let workshopTiersSvc: typeof import('../services/workshops/tiers')
  let workshopCancelSvc: typeof import('../services/workshops/cancel')
  let ptRequestSvc: typeof import('../services/pt-sessions/request')
  let ptListSvc: typeof import('../services/pt-sessions/list')
  let ptCancelSvc: typeof import('../services/pt-sessions/cancel')
  let leaveSvc: typeof import('../services/leave/requests')
  let inboxSvc: typeof import('../services/inbox')
  let flagsSvc: typeof import('../services/feature-flags')

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

    // The transactional half: a bundle in the catalogue, the member holding one,
    // and a seat booked with it. Everything money and credits touch hangs off
    // these three.
    const classPackage = await classPackagesSvc.createClassPackage(tenantId, {
      name: `${slug} Bundle`,
      kind: 'credit_bundle',
      credits: 10,
      validityDays: 90,
      priceSgd: '200.00',
    })
    const granted = await purchaseSvc.grantPackage(tenantId, {
      clientId: client.id,
      paymentIntentId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: classPackage.id,
    })
    const booking = await bookSvc.bookClass(tenantId, {
      clientId: client.id,
      classId: cls.id,
    })

    // The remaining-surfaces batch (#62): a workshop with one day and one tier,
    // and one pending leave request. Both are far enough out that the fixture
    // class cannot clash with them — a room conflict or a leave clash would
    // stand in for the tenant refusal these tests are about.
    const workshop = await workshopPublishSvc.createWorkshop(tenantId, {
      name: `${slug} Retreat`,
      locationId: location.id,
      mainInstructorId: staff.id,
      mainInstructorPaySgd: 100,
      createdByStaffId: staff.id,
    })
    const dayStartsAt = new Date(startsAt.getTime() + 30 * 24 * HOUR)
    const day = await workshopDaysSvc.createDay(tenantId, workshop.id, {
      ord: 1,
      roomId: room.id,
      startsAt: dayStartsAt,
      endsAt: new Date(dayStartsAt.getTime() + HOUR),
      basePriceSgd: '120.00',
      capacityOnline: 10,
    })
    const tier = await workshopTiersSvc.createTier(tenantId, workshop.id, {
      name: `${slug} Full Pass`,
      regularPriceSgd: '120.00',
      ord: 1,
      dayIds: [day.id],
    })

    const leaveStart = plainDate(new Date(Date.now() + 200 * 24 * HOUR))
    const leave = await leaveSvc.submitLeaveRequest(tenantId, {
      instructorId: staff.id,
      type: 'annual',
      startDate: leaveStart,
      endDate: leaveStart,
      reason: `${slug} isolation leave`,
    })

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
      classPackageId: classPackage.id,
      clientPackageId: granted.clientPackageId,
      bookingId: booking.bookingId,
      workshopId: workshop.id,
      workshopDayId: day.id,
      workshopTierId: tier.id,
      leaveRequestId: leave.id,
    }
  }

  /**
   * Remove every row this file creates, in foreign-key order. Everything it
   * writes is stamped `@isolation.test` or named after a tenant slug, so the
   * purge can be exact without tracking ids.
   */
  async function purgeFixtures() {
    const { sql } = await import('drizzle-orm')

    // The transactional rows first, innermost outwards: every one of these has
    // an `on delete restrict` FK onto a client, a booking or a package that the
    // catalogue purge below removes.
    const isolationClients = sql`SELECT id FROM clients WHERE email LIKE '%@isolation.test'`
    await harness.db.execute(sql`
      DELETE FROM check_ins WHERE booking_id IN (
        SELECT id FROM bookings WHERE client_id IN (${isolationClients})
      )
    `)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${isolationClients})`)
    await harness.db.execute(
      sql`DELETE FROM manual_adjustments WHERE client_id IN (${isolationClients})`,
    )
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${isolationClients})`)
    await harness.db.execute(sql`DELETE FROM merch_orders WHERE client_id IN (${isolationClients})`)
    await harness.db.execute(
      sql`DELETE FROM promo_code_redemptions WHERE client_id IN (${isolationClients})`,
    )
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${isolationClients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${isolationClients})`)
    await harness.db.execute(sql`
      DELETE FROM promo_code_products WHERE promo_code_id IN (
        SELECT id FROM promo_codes WHERE label LIKE 'isolation %'
      )
    `)
    await harness.db.execute(sql`DELETE FROM promo_codes WHERE label LIKE 'isolation %'`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE '% Bundle'`)

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

    // The remaining-surfaces fixtures, innermost outwards.
    const isolationWorkshops = sql`SELECT id FROM workshops WHERE name LIKE '% Retreat'`
    await harness.db.execute(sql`
      DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (
        SELECT id FROM workshop_tiers WHERE workshop_id IN (${isolationWorkshops})
      )
    `)
    await harness.db.execute(
      sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${isolationWorkshops})`,
    )
    await harness.db.execute(
      sql`DELETE FROM workshop_days WHERE workshop_id IN (${isolationWorkshops})`,
    )
    await harness.db.execute(
      sql`DELETE FROM workshop_images WHERE workshop_id IN (${isolationWorkshops})`,
    )
    await harness.db.execute(
      sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${isolationWorkshops})`,
    )
    // Before the workshops themselves — a cancellation files an inbox item that
    // names the workshop it cancelled, and that is how it is found again.
    await harness.db.execute(sql`
      DELETE FROM inbox_items
      WHERE payload ? 'isolation'
         OR payload->>'workshopId' IN (SELECT id::text FROM (${isolationWorkshops}) w)
    `)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name LIKE '% Retreat'`)
    await harness.db.execute(sql`
      DELETE FROM leave_requests WHERE instructor_id IN (
        SELECT id FROM staff_users WHERE email LIKE '%@isolation.test'
      )
    `)
    await harness.db.execute(sql`
      DELETE FROM leave_pools WHERE instructor_id IN (
        SELECT id FROM staff_users WHERE email LIKE '%@isolation.test'
      )
    `)
    await harness.db.execute(sql`DELETE FROM feature_flags WHERE key LIKE 'isolation_%'`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE '%@isolation.test'`)
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
    classPackagesSvc = await import('../services/packages/class-packages')
    purchaseSvc = await import('../services/packages/purchase')
    entitlementsSvc = await import('../services/packages/entitlements')
    adjustSvc = await import('../services/packages/adjust')
    bookSvc = await import('../services/bookings/book')
    cancelSvc = await import('../services/bookings/cancel')
    checkInSvc = await import('../services/bookings/check-in')
    noShowSvc = await import('../services/bookings/no-show')
    bookingListSvc = await import('../services/bookings/list')
    promoAdminSvc = await import('../services/packages/promo-code-admin')
    redemptionSvc = await import('../services/packages/promo-redemption')
    financeSvc = await import('../services/finance/list')
    financeCsvSvc = await import('../services/finance/csv')
    refundsSvc = await import('../services/billing/refunds')
    workshopPublishSvc = await import('../services/workshops/publish')
    workshopDaysSvc = await import('../services/workshops/days')
    workshopTiersSvc = await import('../services/workshops/tiers')
    workshopCancelSvc = await import('../services/workshops/cancel')
    ptRequestSvc = await import('../services/pt-sessions/request')
    ptListSvc = await import('../services/pt-sessions/list')
    ptCancelSvc = await import('../services/pt-sessions/cancel')
    leaveSvc = await import('../services/leave/requests')
    inboxSvc = await import('../services/inbox')
    flagsSvc = await import('../services/feature-flags')

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

  test('a write from a service no batch has scoped yet still lands on tenant #1', async () => {
    // The load-bearing property of the expand phase. Every service is scoped
    // now, but the column stays nullable until #63 contracts it, so a writer
    // that names no tenant — a seed, a migration backfill, a job written before
    // #67 — still relies on the default. Without it those rows would land NULL
    // and vanish from the read beside them — a class that fills while every
    // surface reports it empty. This is that default, asserted rather than
    // assumed, on the table where the consequence is easiest to see.
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
      // The fixture's own booking plus this one.
      assert.equal(card?.booked_count, 2)
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

  // ── the package catalogue ─────────────────────────────────────────────────

  test("the package catalogue a member is shown is their own studio's", async () => {
    const publicPackages = await getAs(two.slug, '/api/v1/public/packages')
    const names = publicPackages.body.class_packages.map((p: any) => p.name)
    assert.ok(names.includes(`${two.slug} Bundle`))
    assert.ok(!names.includes(`${one.slug} Bundle`), "acme can read Yoga Sadhana's price list")

    await assert.rejects(
      () => classPackagesSvc.getClassPackage(two.tenantId, one.classPackageId),
      (err: { code?: string }) => err.code === 'class_package_not_found',
    )
    await assert.rejects(
      () => classPackagesSvc.archiveClassPackage(two.tenantId, one.classPackageId),
      (err: { code?: string }) => err.code === 'class_package_not_found',
    )
    const [untouched] = await harness.db
      .select()
      .from(schema.classPackages)
      .where(eq(schema.classPackages.id, one.classPackageId))
    assert.equal(untouched?.status, 'active')
  })

  test("a purchase cannot be granted from another tenant's catalogue", async () => {
    await assert.rejects(
      () =>
        purchaseSvc.grantPackage(two.tenantId, {
          clientId: two.clientId,
          paymentIntentId: null,
          amountSgd: '200.00',
          packageKind: 'class',
          packageId: one.classPackageId,
        }),
      (err: { code?: string }) => err.code === 'class_package_not_found',
    )
  })

  // ── credits and plans ─────────────────────────────────────────────────────

  test('a balance cannot be read across tenants', async () => {
    const own = await entitlementsSvc.getClientEntitlements(one.tenantId, one.clientId)
    assert.equal(own.hasActiveBundleCredits, true)

    // The same member, asked about by the other studio: they hold nothing there,
    // and the trial gate agrees — a wallet read that leaked would say otherwise.
    const borrowed = await entitlementsSvc.getClientEntitlements(two.tenantId, one.clientId)
    assert.equal(borrowed.hasActiveBundleCredits, false)
    assert.equal(borrowed.trialEligible, true)

    assert.equal((await entitlementsSvc.listClientPackages(one.tenantId, one.clientId)).length, 1)
    assert.equal((await entitlementsSvc.listClientPackages(two.tenantId, one.clientId)).length, 0)
  })

  test('a balance cannot be consumed across tenants', async () => {
    const before = await harness.db
      .select({ remaining: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, one.clientPackageId))

    await assert.rejects(
      () =>
        adjustSvc.adjustBalance({
          tenantId: two.tenantId,
          clientId: one.clientId,
          clientPackageId: one.clientPackageId,
          delta: -5,
          reason: 'isolation probe',
          actedByStaffId: two.instructorId,
        }),
      (err: { code?: string }) => err.code === 'client_package_not_found',
    )
    await assert.rejects(
      () =>
        adjustSvc.setPackageExpiry({
          tenantId: two.tenantId,
          clientId: one.clientId,
          clientPackageId: one.clientPackageId,
          expiresAt: new Date(),
          reason: 'isolation probe',
          actedByStaffId: two.instructorId,
        }),
      (err: { code?: string }) => err.code === 'client_package_not_found',
    )

    const after = await harness.db
      .select({ remaining: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, one.clientPackageId))
    assert.equal(after[0]?.remaining, before[0]?.remaining)
  })

  // ── bookings and check-in ─────────────────────────────────────────────────

  test("a member cannot book another tenant's class", async () => {
    await assert.rejects(
      () => bookSvc.bookClass(two.tenantId, { clientId: two.clientId, classId: one.classId }),
      (err: { code?: string }) => err.code === 'class_not_found',
    )
  })

  test("a booking list never carries another tenant's booking", async () => {
    const own = await bookingListSvc.listClassBookings(one.tenantId, one.clientId, 'upcoming')
    assert.deepEqual(
      own.map(r => r.bookingId),
      [one.bookingId],
    )
    assert.equal(
      (await bookingListSvc.listClassBookings(two.tenantId, one.clientId, 'upcoming')).length,
      0,
    )
    await assert.rejects(
      () => bookingListSvc.getClassBookingDetail(two.tenantId, one.clientId, one.bookingId),
      (err: { code?: string }) => err.code === 'booking_not_found',
    )
  })

  test("a tenant cannot cancel, tick or no-show another tenant's booking", async () => {
    for (const attempt of [
      () => cancelSvc.cancelBooking(two.tenantId, { bookingId: one.bookingId, source: 'admin' }),
      () =>
        checkInSvc.markAttendance(two.tenantId, {
          bookingId: one.bookingId,
          staffId: two.instructorId,
          attended: true,
        }),
      () =>
        noShowSvc.markNoShow(two.tenantId, {
          bookingId: one.bookingId,
          actorStaffId: two.instructorId,
        }),
    ]) {
      await assert.rejects(attempt, (err: { code?: string }) => err.code === 'booking_not_found')
    }

    const [untouched] = await harness.db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, one.bookingId))
    assert.equal(untouched?.state, 'confirmed')
    assert.equal(untouched?.checkInState, 'pending')
  })

  // ── promo codes ───────────────────────────────────────────────────────────

  test('two tenants can run the same code, and each redeems its own', async () => {
    const shared = 'ISOSHARED'
    const forOne = await promoAdminSvc.createPromoCode(
      one.tenantId,
      {
        code: shared,
        label: 'isolation one',
        kind: 'percent',
        percentOff: 10,
        appliesToAll: true,
        products: [],
      },
      one.instructorId,
    )
    // The same text again, for the other studio. A platform-wide unique index
    // would refuse this and tell acme the word was taken somewhere it cannot see.
    const forTwo = await promoAdminSvc.createPromoCode(
      two.tenantId,
      {
        code: shared,
        label: 'isolation two',
        kind: 'percent',
        percentOff: 50,
        appliesToAll: true,
        products: [],
      },
      two.instructorId,
    )
    assert.notEqual(forOne.code.id, forTwo.code.id)

    // A member typing it gets their own studio's terms, not the other's.
    const applied = await redemptionSvc.previewPromoCode({
      tenantId: two.tenantId,
      codeText: shared,
      clientId: two.clientId,
      product: { productType: 'class_package', productId: two.classPackageId },
      productName: `${two.slug} Bundle`,
      basePriceSgd: '200.00',
    })
    assert.equal(applied.promoCodeId, forTwo.code.id)
    assert.equal(applied.effectivePriceSgd, '100.00')

    // And the admin list stops at the studio's own.
    const listedForTwo = await promoAdminSvc.listPromoCodes(two.tenantId)
    assert.deepEqual(
      listedForTwo.map(r => r.code.label),
      ['isolation two'],
    )
    await assert.rejects(
      () => promoAdminSvc.getPromoCode(two.tenantId, forOne.code.id),
      (err: { code?: string }) => err.code === 'promo_code_not_found',
    )

    // A code may only be scoped to its own studio's products.
    await assert.rejects(
      () =>
        promoAdminSvc.updatePromoCode(two.tenantId, forTwo.code.id, {
          appliesToAll: false,
          products: [{ productType: 'class_package', productId: one.classPackageId }],
        }),
      (err: { code?: string }) => err.code === 'promo_code_product_not_found',
    )
  })

  // ── finance ───────────────────────────────────────────────────────────────

  test("finance totals and the CSV export cover one studio's money only", async () => {
    const forOne = await financeSvc.getFinance(one.tenantId, {})
    const forTwo = await financeSvc.getFinance(two.tenantId, {})

    const variants = (s: typeof forOne) => s.rows.map(r => r.variant)
    assert.ok(variants(forOne).includes(`${one.slug} Bundle`))
    assert.ok(variants(forTwo).includes(`${two.slug} Bundle`))
    assert.ok(
      !variants(forTwo).includes(`${one.slug} Bundle`),
      "acme's ledger carries Yoga Sadhana's sales",
    )

    // The tiles are a sum over exactly those rows, so a leak would show up here
    // as somebody else's revenue.
    assert.equal(forTwo.totals.gross_sgd, 200)
    assert.ok(!financeCsvSvc.financeCsv(forTwo).includes(`${one.slug} Bundle`))
  })

  // ── billing ───────────────────────────────────────────────────────────────

  test("a refund cannot be issued against another tenant's purchase", async () => {
    await assert.rejects(
      () =>
        refundsSvc.issueRefund({
          tenantId: two.tenantId,
          clientId: one.clientId,
          clientPackageId: one.clientPackageId,
          reason: 'isolation probe',
          actorStaffId: two.instructorId,
        }),
      (err: { code?: string }) => err.code === 'client_package_not_found',
    )
    assert.deepEqual(await refundsSvc.refundStatesFor(two.tenantId, one.clientId), {})
  })

  test('a payment record carries its tenant, and the unwind reads it off there', async () => {
    // The provider's event names an intent and nothing else, so the payment row
    // is where the tenant has to come from. Both studios hold a purchase of the
    // same shape; refunding one must not touch the other.
    const intent = 'pi_isolation_refund'
    await harness.db
      .update(schema.clientPackages)
      .set({ stripePaymentIntentId: intent })
      .where(eq(schema.clientPackages.id, two.clientPackageId))
    await harness.db.insert(schema.stripePayments).values({
      tenantId: two.tenantId,
      paymentIntentId: intent,
      amountSgd: '200.00',
      kind: 'class_package',
      clientId: two.clientId,
      clientPackageId: two.clientPackageId,
      status: 'succeeded',
    })

    try {
      await refundsSvc.unwindRefund(intent)

      const [voided] = await harness.db
        .select()
        .from(schema.clientPackages)
        .where(eq(schema.clientPackages.id, two.clientPackageId))
      assert.equal(voided?.active, false)
      const [cancelled] = await harness.db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, two.bookingId))
      assert.equal(cancelled?.state, 'cancelled')

      // The other studio's identically-shaped purchase is untouched.
      const [otherPackage] = await harness.db
        .select()
        .from(schema.clientPackages)
        .where(eq(schema.clientPackages.id, one.clientPackageId))
      assert.equal(otherPackage?.active, true)
      const [otherBooking] = await harness.db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, one.bookingId))
      assert.equal(otherBooking?.state, 'confirmed')
    } finally {
      await harness.db
        .update(schema.clientPackages)
        .set({ stripePaymentIntentId: null })
        .where(eq(schema.clientPackages.id, two.clientPackageId))
    }
  })

  // ── workshops (#62) ───────────────────────────────────────────────────────

  test("the public workshop list never carries another tenant's workshop", async () => {
    const asTwo = await getAs(two.slug, '/api/v1/public/workshops')
    const ids = asTwo.body.workshops.map((w: any) => w.id)
    assert.ok(ids.includes(two.workshopId))
    assert.ok(!ids.includes(one.workshopId), "acme can read Yoga Sadhana's workshops")
  })

  test("asking for another tenant's workshop by id is the same 404 as a missing one", async () => {
    const borrowed = await getAs(two.slug, `/api/v1/public/workshops/${one.workshopId}`)
    assert.equal(borrowed.status, 404)
    const missing = await getAs(
      two.slug,
      '/api/v1/public/workshops/00000000-0000-0000-0000-0000000000ff',
    )
    assert.equal(borrowed.text, missing.text)

    const own = await getAs(two.slug, `/api/v1/public/workshops/${two.workshopId}`)
    assert.equal(own.status, 200)
  })

  test("a tenant cannot read, edit or cancel another tenant's workshop", async () => {
    await assert.rejects(
      () => workshopPublishSvc.getWorkshopDetail(two.tenantId, one.workshopId),
      (err: { code?: string }) => err.code === 'workshop_not_found',
    )
    await assert.rejects(
      () => workshopPublishSvc.updateWorkshop(two.tenantId, one.workshopId, { name: 'Stolen' }),
      (err: { code?: string }) => err.code === 'workshop_not_found',
    )
    await assert.rejects(
      () =>
        workshopCancelSvc.cancelWorkshop(
          two.tenantId,
          one.workshopId,
          two.instructorId,
          'superadmin',
        ),
      (err: { code?: string }) => err.code === 'workshop_not_found',
    )
    const [untouched] = await harness.db
      .select()
      .from(schema.workshops)
      .where(eq(schema.workshops.id, one.workshopId))
    assert.equal(untouched?.name, `${one.slug} Retreat`)
    assert.equal(untouched?.lifecycle, 'active')
  })

  test("workshop days and tiers stop at their own studio's workshop", async () => {
    // Listing is scoped through the same gate as the writes: an id from the
    // other studio names no workshop, so there is nothing to enumerate.
    await assert.rejects(
      () => workshopDaysSvc.listDays(two.tenantId, one.workshopId),
      (err: { code?: string }) => err.code === 'workshop_not_found',
    )
    await assert.rejects(
      () => workshopTiersSvc.listTiers(two.tenantId, one.workshopId),
      (err: { code?: string }) => err.code === 'workshop_not_found',
    )
    await assert.rejects(
      () => workshopDaysSvc.deleteDay(two.tenantId, one.workshopId, one.workshopDayId),
      (err: { code?: string }) => err.code === 'workshop_not_found',
    )
    await assert.rejects(
      () => workshopTiersSvc.deleteTier(two.tenantId, one.workshopId, one.workshopTierId),
      (err: { code?: string }) => err.code === 'workshop_not_found',
    )

    // A tier of one's own workshop cannot be made to cover another studio's day.
    await assert.rejects(
      () =>
        workshopTiersSvc.createTier(two.tenantId, two.workshopId, {
          name: 'Trespass',
          regularPriceSgd: '10.00',
          ord: 9,
          dayIds: [one.workshopDayId],
        }),
      (err: { code?: string }) => err.code === 'invalid_workshop_day_ids',
    )

    const [day] = await harness.db
      .select()
      .from(schema.workshopDays)
      .where(eq(schema.workshopDays.id, one.workshopDayId))
    assert.ok(day, "Yoga Sadhana's workshop day was deleted from acme")
  })

  // ── PT (#62) ──────────────────────────────────────────────────────────────

  test("a PT request cannot be filed against another tenant's package", async () => {
    await assert.rejects(
      () =>
        ptRequestSvc.submitPtRequest(two.tenantId, {
          clientId: one.clientId,
          classTypeId: one.classTypeId,
          locationId: one.locationId,
          sessionType: '1on1',
          clientPackageId: one.clientPackageId,
          slots: [{ proposedDate: '2027-01-04', startTime: '10:00', endTime: '11:00' }],
        }),
      (err: { code?: string }) => err.code === 'client_package_not_found',
    )
  })

  test("the PT queue, and every action on it, stops at the tenant's own requests", async () => {
    const [req] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: one.tenantId,
        clientId: one.clientId,
        classTypeId: one.classTypeId,
        locationId: one.locationId,
        sessionType: '1on1',
        expiresAt: new Date(Date.now() + 7 * 24 * HOUR),
      })
      .returning()
    assert.ok(req)

    try {
      const forOne = await ptListSvc.listPtRequestsForAdmin(one.tenantId)
      assert.ok(forOne.some(r => r.id === req.id))
      const forTwo = await ptListSvc.listPtRequestsForAdmin(two.tenantId)
      assert.ok(!forTwo.some(r => r.id === req.id), "acme can triage Yoga Sadhana's PT requests")

      assert.equal(await ptListSvc.getPtRequestForAdmin(two.tenantId, req.id), null)
      assert.ok(await ptListSvc.getPtRequestForAdmin(one.tenantId, req.id))

      await assert.rejects(
        () => ptCancelSvc.cancelPtRequest(two.tenantId, { ptRequestId: req.id, source: 'admin' }),
        (err: { code?: string }) => err.code === 'pt_request_not_found',
      )
      const [untouched] = await harness.db
        .select()
        .from(schema.ptRequests)
        .where(eq(schema.ptRequests.id, req.id))
      assert.equal(untouched?.status, 'pending')
    } finally {
      await harness.db.delete(schema.ptRequests).where(eq(schema.ptRequests.id, req.id))
    }
  })

  test('a 2on1 partner is looked up inside the studio, never across it', async () => {
    const [member] = await harness.db
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, one.clientId))
    assert.ok(member)

    // The same address, asked for by each studio. Answering it platform-wide
    // would turn this endpoint into a directory of everyone on it.
    const found = await ptListSvc.lookupPartnerByEmail(one.tenantId, member.email, two.clientId)
    assert.equal(found.found, true)
    const notFound = await ptListSvc.lookupPartnerByEmail(two.tenantId, member.email, two.clientId)
    assert.equal(notFound.found, false)
  })

  // ── leave (#62) ───────────────────────────────────────────────────────────

  test("leave pools and requests belong to the instructor's own studio", async () => {
    // A Pool is materialised under the instructor's lock, so a cross-tenant read
    // would not merely leak — it would write a Pool for somebody else's staff.
    await assert.rejects(
      () => leaveSvc.getOwnLeave(two.tenantId, one.instructorId),
      (err: { code?: string }) => err.code === 'not_an_instructor',
    )
    await assert.rejects(
      () =>
        leaveSvc.submitLeaveRequest(two.tenantId, {
          instructorId: one.instructorId,
          type: 'annual',
          startDate: plainDate(new Date(Date.now() + 250 * 24 * HOUR)),
          endDate: plainDate(new Date(Date.now() + 250 * 24 * HOUR)),
          reason: 'trespass',
        }),
      (err: { code?: string }) => err.code === 'not_an_instructor',
    )
    await assert.rejects(
      () => leaveSvc.adjustRemainingDays(two.tenantId, { instructorId: one.instructorId, annual: 1 }),
      (err: { code?: string }) => err.code === 'not_an_instructor',
    )

    // Now the same read from the instructor's OWN studio, which is what actually
    // freezes the year's Pool — only the current Leave Year is materialised, so
    // this is the call that must produce rows for the assertion below to mean
    // anything. Every row it wrote has to carry tenant #1.
    await leaveSvc.getOwnLeave(one.tenantId, one.instructorId)

    const pools = await harness.db
      .select()
      .from(schema.leavePools)
      .where(eq(schema.leavePools.instructorId, one.instructorId))
    assert.ok(pools.length > 0, 'the instructor’s own read did not materialise a Pool')
    assert.ok(
      pools.every(p => p.tenantId === one.tenantId),
      "a Pool was materialised under acme for Yoga Sadhana's instructor",
    )
  })

  test("the admin leave queue, and deciding on it, stop at the tenant's own rows", async () => {
    const forOne = await leaveSvc.listLeaveRequestsForAdmin(one.tenantId)
    assert.ok(forOne.some(r => r.row.id === one.leaveRequestId))
    assert.ok(
      !forOne.some(r => r.row.id === two.leaveRequestId),
      "Yoga Sadhana's queue carries acme's leave",
    )

    await assert.rejects(
      () =>
        leaveSvc.decideLeaveRequest(two.tenantId, {
          action: 'approve',
          id: one.leaveRequestId,
          actorStaffId: two.instructorId,
        }),
      (err: { code?: string }) => err.code === 'leave_request_not_found',
    )
    await assert.rejects(
      () =>
        leaveSvc.transitionOwnLeaveRequest(
          two.tenantId,
          'withdraw',
          one.instructorId,
          one.leaveRequestId,
        ),
      (err: { code?: string }) => err.code === 'leave_request_not_found',
    )

    const [untouched] = await harness.db
      .select()
      .from(schema.leaveRequests)
      .where(eq(schema.leaveRequests.id, one.leaveRequestId))
    assert.equal(untouched?.status, 'pending')
  })

  test('the all-staff leave calendar shows one studio at a time', async () => {
    const from = plainDate(new Date(Date.now() + 190 * 24 * HOUR))
    const to = plainDate(new Date(Date.now() + 210 * 24 * HOUR))
    const viewer = {
      staffUserId: two.instructorId,
      role: 'admin' as const,
      tenantId: two.tenantId,
    }
    const entries = await leaveSvc.listLeaveCalendar(viewer, from, to)
    assert.ok(entries.some(e => e.id === two.leaveRequestId))
    assert.ok(
      !entries.some(e => e.id === one.leaveRequestId),
      "acme's calendar shows who is away at Yoga Sadhana",
    )
  })

  // ── content, inbox and the switchboard (#62) ──────────────────────────────

  test('every tenant owns its own email templates, waiver and home page', async () => {
    for (const table of [schema.emailTemplates, schema.waiver, schema.marketingContent]) {
      const rows = await harness.db.select().from(table as any)
      const tenants = new Set(rows.map((r: any) => r.tenantId))
      assert.ok(tenants.has(one.tenantId))
      assert.ok(tenants.has(two.tenantId), 'the second tenant has no content of its own')
    }

    // The pair, not the slug, is what a template is found by: editing one
    // studio's `welcome` must leave the other studio's alone.
    await harness.db
      .update(schema.emailTemplates)
      .set({ subject: 'isolation probe' })
      .where(
        and(
          eq(schema.emailTemplates.tenantId, two.tenantId),
          eq(schema.emailTemplates.slug, 'welcome'),
        ),
      )
    try {
      const [theirs] = await harness.db
        .select()
        .from(schema.emailTemplates)
        .where(
          and(
            eq(schema.emailTemplates.tenantId, one.tenantId),
            eq(schema.emailTemplates.slug, 'welcome'),
          ),
        )
      assert.notEqual(theirs?.subject, 'isolation probe')
    } finally {
      const { seedEmailTemplates } = await import('../db/seed/email-templates')
      await seedEmailTemplates(harness.db, {
        id: two.tenantId,
        slug: two.slug,
        name: 'Acme Yoga',
        timezone: 'Australia/Sydney',
      })
    }
  })

  test("an inbox item is filed under, and marked read by, its own tenant", async () => {
    const { id } = await inboxSvc.insertInbox(one.tenantId, {
      type: 'admin_cancel_workshop',
      payload: { isolation: true, workshopId: one.workshopId },
    })
    try {
      const [filed] = await harness.db
        .select()
        .from(schema.inboxItems)
        .where(eq(schema.inboxItems.id, id))
      assert.equal(filed?.tenantId, one.tenantId)

      await inboxSvc.markRead(two.tenantId, id, two.instructorId)
      const [afterForeign] = await harness.db
        .select()
        .from(schema.inboxItems)
        .where(eq(schema.inboxItems.id, id))
      assert.equal(afterForeign?.readAt, null, "acme marked Yoga Sadhana's notification read")

      await inboxSvc.markRead(one.tenantId, id, one.instructorId)
      const [afterOwn] = await harness.db
        .select()
        .from(schema.inboxItems)
        .where(eq(schema.inboxItems.id, id))
      assert.ok(afterOwn?.readAt)
    } finally {
      await harness.db.delete(schema.inboxItems).where(eq(schema.inboxItems.id, id))
    }
  })

  test('two tenants can run the same feature flag, each with its own answer', async () => {
    const key = 'isolation_probe'
    await flagsSvc.setFlag(one.tenantId, key, true, one.instructorId)
    await flagsSvc.setFlag(two.tenantId, key, false, two.instructorId)

    // The pair is the primary key, so both rows exist — the second write is not
    // an upsert over the first.
    const rows = await harness.db
      .select()
      .from(schema.featureFlags)
      .where(eq(schema.featureFlags.key, key))
    assert.equal(rows.length, 2)

    await flagsSvc.loadFeatureFlags()
    assert.equal(flagsSvc.isEnabled(one.tenantId, key), true)
    assert.equal(flagsSvc.isEnabled(two.tenantId, key), false)
  })
})
