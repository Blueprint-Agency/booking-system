import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, inTenantContext, SKIP_REASON, type TestApp } from './harness'

/**
 * Activation on first booking (ADR 0004), with several packages running per
 * Family (ADR 0010) — against a real database, because the half that the pure
 * tests in `services/packages/selection.test.ts` cannot reach is exactly the
 * half that matters here: the row lands Dormant, the booking stamps it, a
 * second one may run beside it, and the PT path applies the same rule.
 */

const HOUR = 60 * 60 * 1000
const soon = (days: number) => new Date(Date.now() + days * 24 * HOUR)

describe('package activation', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let tenantId!: string

  let schema: typeof import('../db/schema')
  let classTypesSvc: typeof import('../services/catalog/class-types')
  let classesSvc: typeof import('../services/schedule/classes')
  let classPackagesSvc: typeof import('../services/packages/class-packages')
  let ptPackagesSvc: typeof import('../services/packages/pt-packages')
  let purchaseSvc: typeof import('../services/packages/purchase')
  let adjustSvc: typeof import('../services/packages/adjust')
  let entitlementsSvc: typeof import('../services/packages/entitlements')
  let bookSvc: typeof import('../services/bookings/book')
  let cancelSvc: typeof import('../services/bookings/cancel')
  let ptRequestSvc: typeof import('../services/pt-sessions/request')
  let ptScheduleSvc: typeof import('../services/pt-sessions/schedule')

  let locationId!: string
  let roomId!: string
  let classTypeId!: string
  let staffId!: string
  let bundleCatalogId!: string
  let ptCatalogId!: string
  let pt2on1CatalogId!: string
  /** One class per test that books, so a member is never "already booked". */
  const classIds: string[] = []
  const clientIds: string[] = []

  async function newClass(): Promise<string> {
    const startsAt = soon(3 + classIds.length)
    const cls = await classesSvc.createClass(tenantId, {
      classTypeId,
      mainInstructorId: staffId,
      locationId,
      roomId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      capacityOnline: 10,
      capacityWaitlist: 0,
      capacityBuffer: 0,
      creditCost: 1,
      instructorPaySgd: 50,
      createdByStaffId: staffId,
    })
    classIds.push(cls.id)
    return cls.id
  }

  async function newMember(): Promise<string> {
    const n = clientIds.length + 1
    const [client] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId,
        email: `member-${n}@activation.test`,
        name: `Activation Member ${n}`,
        phone: '+6580000000',
        authUserId: `auth_activation_member_${n}`,
      })
      .returning()
    clientIds.push(client!.id)
    return client!.id
  }

  const grantBundle = (clientId: string) =>
    purchaseSvc.grantPackage(tenantId, {
      clientId,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: bundleCatalogId,
    })

  const grantPt = (clientId: string, packageId = ptCatalogId) =>
    purchaseSvc.grantPackage(tenantId, {
      clientId,
      purchaseId: null,
      amountSgd: '500.00',
      packageKind: 'pt',
      packageId,
    })

  const row = async (id: string) => {
    const [r] = await harness.db
      .select()
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, id))
    assert.ok(r)
    return r
  }

  const ptRequest = (clientId: string, clientPackageId: string, sessionType: '1on1' | '2on1' = '1on1') =>
    ptRequestSvc.submitPtRequest(tenantId, {
      clientId,
      classTypeId,
      locationId,
      sessionType,
      clientPackageId,
      slots: [{ proposedDate: soon(5).toISOString().slice(0, 10), startTime: '10:00', endTime: '11:00' }],
      ...(sessionType === '2on1'
        ? { partner: { kind: 'new' as const, name: 'Partner', email: 'partner@activation.test' } }
        : {}),
    })

  before(async () => {
    harness = await startTestApp()
    tenantId = harness.tenants.one.id
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classesSvc = inTenantContext(await import('../services/schedule/classes'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    adjustSvc = inTenantContext(await import('../services/packages/adjust'))
    entitlementsSvc = inTenantContext(await import('../services/packages/entitlements'))
    bookSvc = inTenantContext(await import('../services/bookings/book'))
    cancelSvc = inTenantContext(await import('../services/bookings/cancel'))
    ptRequestSvc = inTenantContext(await import('../services/pt-sessions/request'))
    ptScheduleSvc = inTenantContext(await import('../services/pt-sessions/schedule'))

    const [location] = await harness.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenantId))
      .limit(1)
    assert.ok(location)
    locationId = location.id
    const [room] = await harness.db
      .select()
      .from(schema.rooms)
      .where(eq(schema.rooms.locationId, locationId))
      .limit(1)
    assert.ok(room)
    roomId = room.id

    const classType = await classTypesSvc.createClassType(tenantId, {
      name: 'activation Flow',
      description: null,
    })
    classTypeId = classType.id

    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId,
        email: 'instructor@activation.test',
        name: 'Activation Instructor',
        role: 'instructor',
        status: 'active',
        authUserId: 'auth_activation_instructor',
      })
      .returning()
    staffId = staff!.id
    await harness.db
      .insert(schema.instructors)
      .values({ tenantId, staffUserId: staffId })
      .onConflictDoNothing()

    const bundle = await classPackagesSvc.createClassPackage(tenantId, {
      name: 'activation Bundle',
      kind: 'credit_bundle',
      credits: 2,
      validityDays: 30,
      priceSgd: '200.00',
    })
    bundleCatalogId = bundle.id
    const pt = await ptPackagesSvc.createPtPackage(tenantId, {
      name: 'activation PT',
      sessionType: '1on1',
      numSessions: 3,
      validityDays: 60,
      priceSgd: '500.00',
    })
    ptCatalogId = pt.id
    const pt2 = await ptPackagesSvc.createPtPackage(tenantId, {
      name: 'activation PT 2on1',
      sessionType: '2on1',
      numSessions: 4,
      validityDays: 60,
      priceSgd: '600.00',
    })
    pt2on1CatalogId = pt2.id
  })

  after(async () => {
    if (!harness) return
    const clients = sql.join(clientIds.map(id => sql`${id}::uuid`), sql`, `)
    if (clientIds.length > 0) {
      const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
      const sessions = sql`SELECT id FROM pt_sessions WHERE pt_request_id IN (${requests})`
      await harness.db.execute(sql`UPDATE pt_requests SET scheduled_pt_session_id = NULL WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM pt_session_clients WHERE pt_session_id IN (${sessions})`)
      await harness.db.execute(sql`DELETE FROM pt_sessions WHERE id IN (${sessions})`)
      await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (SELECT id FROM pt_requests WHERE client_id IN (${clients}))`)
      await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE id IN (${clients})`)
    }
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE 'activation %'`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE 'activation %'`)
    await harness.db.execute(sql`DELETE FROM classes WHERE class_type_id = ${classTypeId}::uuid`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE id = ${classTypeId}::uuid`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id = ${staffId}::uuid`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}::uuid`)
    await harness.close()
  })

  test('PKG-29 a purchase lands Dormant with its validity frozen, and the first booking stamps the expiry', async () => {
    const clientId = await newMember()
    const { clientPackageId } = await grantBundle(clientId)

    const bought = await row(clientPackageId)
    assert.equal(bought.expiresAt, null, 'Dormant at purchase')
    assert.equal(bought.validityDays, 30, 'the catalogue length is frozen on the purchase')
    assert.equal(bought.active, true, 'a Dormant package is live')

    const before = Date.now()
    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    const started = await row(clientPackageId)
    assert.ok(started.expiresAt, 'the first booking Activates it')
    const days = (started.expiresAt!.getTime() - before) / (24 * HOUR)
    assert.ok(days > 29.9 && days < 30.1, `expiry is validity_days from the booking moment, got ${days}`)
    assert.equal(started.creditsOrSessionsRemaining, 1)
  })

  test('two bundles: the second waits, and starts on the first booking after the first is spent', async () => {
    const clientId = await newMember()
    const first = (await grantBundle(clientId)).clientPackageId
    const second = (await grantBundle(clientId)).clientPackageId

    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    assert.ok((await row(first)).expiresAt, 'the earlier purchase starts first')
    assert.equal((await row(second)).expiresAt, null, 'the later one waits')

    const ent = await entitlementsSvc.getClientEntitlements(tenantId, clientId)
    assert.equal(ent.classFamilyRunning, true)

    // Spend the first to zero: it has ended, and the next booking starts the second.
    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    assert.equal((await row(first)).active, false, 'spent to zero is ended')
    assert.equal((await row(second)).expiresAt, null, 'still waiting — nothing booked on it yet')

    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    assert.ok((await row(second)).expiresAt, 'the third booking Activates the second bundle')
  })

  test('credits returning to a spent bundle while the next one runs land back on it with its expiry untouched', async () => {
    const clientId = await newMember()
    const first = (await grantBundle(clientId)).clientPackageId
    const second = (await grantBundle(clientId)).clientPackageId

    const { bookingId } = await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    const spent = await row(first)
    assert.equal(spent.active, false, 'first is spent')
    assert.ok(spent.expiresAt, 'and keeps the stamp its first booking gave it')
    assert.ok((await row(second)).expiresAt, 'second is running')

    // A member cancels the class the first bundle paid for: the credit comes
    // back onto the first bundle, which runs again beside the second with the
    // expiry it already had — no return to Dormant, no fresh clock.
    await cancelSvc.cancelBooking(tenantId, { bookingId, source: 'admin', actorStaffId: staffId, credit: 'return' })
    const refunded = await row(first)
    assert.equal(refunded.creditsOrSessionsRemaining, 1)
    assert.equal(refunded.active, true, 'the credit is spendable again')
    assert.equal(refunded.expiresAt?.getTime(), spent.expiresAt!.getTime(), 'its expiry is untouched')
    assert.ok((await row(second)).expiresAt, 'both run at once')

    // The first ends sooner, so the Default payer spends it first.
    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    const respent = await row(first)
    assert.equal(respent.active, false, 'the soonest-ending bundle paid, and is spent again')
    assert.equal(respent.expiresAt?.getTime(), spent.expiresAt!.getTime(), 'still on its original clock')
    assert.equal((await row(second)).creditsOrSessionsRemaining, 1, 'the second was not touched')

    // An admin top-up revives the package in place, whatever else is running.
    const revivedFirst = await adjustSvc.adjustBalance({
      tenantId,
      clientId,
      clientPackageId: first,
      delta: 2,
      reason: 'test: top-up',
      actedByStaffId: staffId,
    })
    assert.equal(revivedFirst.active, true)
    assert.equal(revivedFirst.expiresAt?.getTime(), spent.expiresAt!.getTime(), 'a top-up keeps the stamp too')
  })

  test('with the per-Family index gone, staff may date a Dormant package while another of its Family runs', async () => {
    const clientId = await newMember()
    const first = (await grantBundle(clientId)).clientPackageId
    const second = (await grantBundle(clientId)).clientPackageId
    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })

    const until = soon(30)
    await adjustSvc.setPackageExpiry({
      tenantId,
      clientId,
      clientPackageId: second,
      expiresAt: until,
      reason: 'activation probe',
      actedByStaffId: staffId,
    })
    assert.ok((await row(first)).expiresAt, 'the first still runs')
    assert.equal((await row(second)).expiresAt?.getTime(), until.getTime(), 'the second runs beside it')
    const [{ n }] = (await harness.db.execute(
      sql`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname IN ('client_packages_one_activated_class_per_client', 'client_packages_one_activated_pt_per_client')`,
    )) as unknown as [{ n: number }]
    assert.equal(n, 0, 'migration 0089 dropped both per-Family indexes')

    // Returning a running one to Dormant is still the admin's escape hatch.
    await adjustSvc.setPackageExpiry({
      tenantId,
      clientId,
      clientPackageId: first,
      expiresAt: null,
      reason: 'activation probe',
      actedByStaffId: staffId,
    })
    assert.equal((await row(first)).expiresAt, null)
  })

  test('an expired package still marked active is swept before the next one starts', async () => {
    const clientId = await newMember()
    const first = (await grantBundle(clientId)).clientPackageId
    const second = (await grantBundle(clientId)).clientPackageId
    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })

    // The nightly cron has not run: expired an hour ago, `active` still true.
    await harness.db
      .update(schema.clientPackages)
      .set({ expiresAt: new Date(Date.now() - HOUR) })
      .where(eq(schema.clientPackages.id, first))

    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    assert.equal((await row(first)).active, false, 'swept in the booking transaction')
    assert.ok((await row(second)).expiresAt, 'and the next package started')
  })

  test('PT-67, PT-70 a PT package Activates when its first session is scheduled, not when it is requested, and another waits beside it when picked', async () => {
    const clientId = await newMember()
    const first = (await grantPt(clientId)).clientPackageId
    const other = (await grantPt(clientId, pt2on1CatalogId)).clientPackageId
    assert.equal((await row(first)).expiresAt, null)
    assert.equal((await row(first)).validityDays, 60)

    const { ptRequestId } = await ptRequest(clientId, first)
    const requested = await row(first)
    assert.equal(requested.expiresAt, null, 'the request debits it and leaves it Dormant')
    assert.equal(requested.creditsOrSessionsRemaining, 2)

    const startsAt = soon(40)
    const scheduled = await ptScheduleSvc.schedulePtRequest(tenantId, {
      ptRequestId,
      instructorId: staffId,
      locationId,
      roomId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + HOUR),
      actorStaffId: staffId,
      actorIsAdmin: true,
    })
    assert.ok(scheduled.ok)
    const started = await row(first)
    assert.ok(started.expiresAt, 'scheduling its session Activates it')
    assert.equal(started.activatedByPtSessionId, scheduled.ptSessionId)
    assert.equal(started.creditsOrSessionsRemaining, 2)

    // The member picks the waiting 2-on-1 package while the 1-on-1 runs: it
    // pays, and waits Dormant beside the first until its own session is scheduled.
    await ptRequest(clientId, other, '2on1')
    assert.equal((await row(other)).creditsOrSessionsRemaining, 2)
    assert.equal((await row(other)).expiresAt, null, 'the 2-on-1 package is still Dormant')
    assert.ok((await row(first)).expiresAt, 'and the 1-on-1 keeps running')

    const ent = await entitlementsSvc.getClientEntitlements(tenantId, clientId)
    assert.equal(ent.ptFamilyRunning, true)
    assert.equal(ent.classFamilyRunning, false, 'PT and classes are separate families')

    // A class booking is a different family and is not blocked by the running PT.
    const bundle = (await grantBundle(clientId)).clientPackageId
    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    assert.ok((await row(bundle)).expiresAt)
  })
})
