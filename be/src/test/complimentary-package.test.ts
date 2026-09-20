import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, inTenantContext, SKIP_REASON, type TestApp } from './harness'

/**
 * The **Complimentary Package** (#176) — a catalogue package an admin gives at
 * no charge — against a real database, because everything that makes a comp a
 * comp lives where the pure tests cannot reach it: it goes through the same
 * grant a sale does (so it lands Dormant and the Family and one-trial rules
 * hold), Finance lists it without counting it, the Trial Funnel does not call
 * the member Converted, and removing it is refused the moment a class it paid
 * for has been held.
 */

const HOUR = 60 * 60 * 1000
const soon = (days: number) => new Date(Date.now() + days * 24 * HOUR)

describe('complimentary package', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let tenantId!: string

  let schema: typeof import('../db/schema')
  let classTypesSvc: typeof import('../services/catalog/class-types')
  let classesSvc: typeof import('../services/schedule/classes')
  let classPackagesSvc: typeof import('../services/packages/class-packages')
  let ptPackagesSvc: typeof import('../services/packages/pt-packages')
  let compSvc: typeof import('../services/packages/complimentary')
  let entitlementsSvc: typeof import('../services/packages/entitlements')
  let clientsSvc: typeof import('../services/clients/manage')
  let financeSvc: typeof import('../services/finance/list')
  let bookSvc: typeof import('../services/bookings/book')
  let checkInSvc: typeof import('../services/bookings/check-in')

  let locationId!: string
  let secondLocationId!: string
  let roomId!: string
  let classTypeId!: string
  let staffId!: string
  let bundleCatalogId!: string
  let trialCatalogId!: string
  let unlimitedCatalogId!: string
  let ptCatalogId!: string
  let boundPtCatalogId!: string

  const classIds: string[] = []
  const clientIds: string[] = []
  // Fixtures are named per run: a run that dies before its cleanup must not be
  // what stops the next one, and the catalogue's unique addresses are exactly
  // what a leftover row holds hostage.
  const run = Date.now().toString(36)
  const NAME_PREFIX = `comp-${run}`
  const DOMAIN = `comp-${run}.test`

  async function newClass(startsAt = soon(3 + classIds.length)): Promise<string> {
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
        email: `member-${n}@${DOMAIN}`,
        name: `Comp Member ${n}`,
        phone: '+6580000000',
        authUserId: `auth_${NAME_PREFIX}_member_${n}`,
      })
      .returning()
    clientIds.push(client!.id)
    return client!.id
  }

  const give = (clientId: string, over: Partial<Parameters<typeof compSvc.giveComplimentaryPackage>[1]> = {}) =>
    compSvc.giveComplimentaryPackage(tenantId, {
      clientId,
      packageKind: 'class',
      packageId: bundleCatalogId,
      reason: 'a class was cancelled at short notice',
      actedByStaffId: staffId,
      ...over,
    })

  const row = async (id: string) => {
    const [r] = await harness.db
      .select()
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, id))
    return r
  }

  before(async () => {
    harness = await startTestApp()
    tenantId = harness.tenants.one.id
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    classesSvc = inTenantContext(await import('../services/schedule/classes'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    compSvc = inTenantContext(await import('../services/packages/complimentary'))
    entitlementsSvc = inTenantContext(await import('../services/packages/entitlements'))
    clientsSvc = inTenantContext(await import('../services/clients/manage'))
    financeSvc = inTenantContext(await import('../services/finance/list'))
    bookSvc = inTenantContext(await import('../services/bookings/book'))
    checkInSvc = inTenantContext(await import('../services/bookings/check-in'))

    const locations = await harness.db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, tenantId))
    assert.ok(locations[0])
    locationId = locations[0].id
    secondLocationId = locations[1]?.id ?? locations[0].id
    // A room of this run's own. A shared one would put these classes in the
    // same place at the same hour as another suite's, and a room clash is a
    // real refusal — so two suites running side by side would fail each other
    // over a rule neither is testing.
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId, locationId, name: `${NAME_PREFIX} Room`, capacity: 20 })
      .returning()
    roomId = room!.id

    classTypeId = (
      await classTypesSvc.createClassType(tenantId, {
        name: `${NAME_PREFIX} Flow`,
        description: null,
      })
    ).id

    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({
        tenantId,
        email: `instructor@${DOMAIN}`,
        name: 'Comp Instructor',
        role: 'instructor',
        status: 'active',
        authUserId: `auth_${NAME_PREFIX}_instructor`,
      })
      .returning()
    staffId = staff!.id
    await harness.db
      .insert(schema.instructors)
      .values({ tenantId, staffUserId: staffId })
      .onConflictDoNothing()

    bundleCatalogId = (
      await classPackagesSvc.createClassPackage(tenantId, {
        name: `${NAME_PREFIX} Bundle`,
        kind: 'credit_bundle',
        credits: 2,
        validityDays: 30,
        priceSgd: '200.00',
      })
    ).id
    trialCatalogId = (
      await classPackagesSvc.createClassPackage(tenantId, {
        name: `${NAME_PREFIX} Trial`,
        kind: 'trial',
        credits: 1,
        validityDays: 7,
        priceSgd: '20.00',
      })
    ).id
    unlimitedCatalogId = (
      await classPackagesSvc.createClassPackage(tenantId, {
        name: `${NAME_PREFIX} Unlimited`,
        kind: 'unlimited',
        durationMonths: 1,
        priceSgd: '300.00',
      })
    ).id
    ptCatalogId = (
      await ptPackagesSvc.createPtPackage(tenantId, {
        name: `${NAME_PREFIX} PT`,
        sessionType: '1on1',
        numSessions: 2,
        validityDays: 60,
        priceSgd: '500.00',
      })
    ).id
    boundPtCatalogId = (
      await ptPackagesSvc.createPtPackage(tenantId, {
        name: `${NAME_PREFIX} PT bound`,
        sessionType: '1on1',
        numSessions: 2,
        validityDays: 60,
        priceSgd: '600.00',
        instructorBound: true,
      })
    ).id
  })

  after(async () => {
    if (!harness) return
    const clients = sql.join(clientIds.map(id => sql`${id}::uuid`), sql`, `)
    if (clientIds.length > 0) {
      await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (SELECT id FROM pt_requests WHERE client_id IN (${clients}))`)
      await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM check_ins WHERE booking_id IN (SELECT id FROM bookings WHERE client_id IN (${clients}))`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE id IN (${clients})`)
    }
    // The grant and the removal both write audit rows naming this run's staff
    // member, and `audit_log.actor_staff_id` is `restrict` — they go first or
    // the fixture staff member cannot.
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id = ${staffId}::uuid`)
    const catalogue = `${NAME_PREFIX} %`
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${catalogue}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${catalogue}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE class_type_id = ${classTypeId}::uuid`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE id = ${roomId}::uuid`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE id = ${classTypeId}::uuid`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id = ${staffId}::uuid`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}::uuid`)
    await harness.close()
  })

  test('a given package lands Dormant at zero against its List Price, and Activates on the first booking', async () => {
    const clientId = await newMember()
    const { clientPackageId } = await give(clientId)

    const given = await row(clientPackageId)
    assert.ok(given)
    assert.equal(given.amountPaidSgd, '0.00', 'nothing was paid')
    assert.equal(given.listPriceSgd, '200.00', 'the catalogue price is frozen as List Price')
    assert.equal(given.complimentary, true, 'the row says it was given, not sold')
    assert.equal(given.purchaseId, null, 'no sale bought it — it never reached the payment provider')
    assert.equal(given.expiresAt, null, 'Dormant, like every purchase')
    assert.equal(given.validityDays, 30, 'the catalogue length is frozen')

    const wallet = await entitlementsSvc.listClientPackages(tenantId, clientId)
    assert.equal(wallet.length, 1, 'it shows in the member’s packages')
    assert.equal(wallet[0]!.dormant, true)
    assert.equal(wallet[0]!.complimentary, true)

    await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })
    assert.ok((await row(clientPackageId))!.expiresAt, 'the first booking Activates it, losing none of its validity')
  })

  test('the reason is required, and lands on the ledger and the audit log', async () => {
    const clientId = await newMember()
    await assert.rejects(
      () => give(clientId, { reason: '   ' }),
      (err: { code?: string }) => err.code === 'reason_required',
      'a free package with no record of why it was free is refused',
    )

    const { clientPackageId } = await give(clientId, { reason: 'prize winner' })

    const adjustments = await clientsSvc.listRecentAdjustments(tenantId, clientId)
    const entry = adjustments.find(a => a.clientPackageId === clientPackageId)
    assert.ok(entry, 'the grant is on the member’s package adjustment ledger')
    assert.equal(entry.delta, 0, 'no credit moved — the package arrived with its balance')
    assert.match(entry.reason, /prize winner/)
    assert.equal(entry.actedByStaffId, staffId)

    const [audit] = await harness.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, clientPackageId))
    assert.ok(audit, 'and in the audit log with the acting admin')
    assert.equal(audit.action, 'complimentary_package_given')
    assert.equal(audit.actorStaffId, staffId)
    assert.equal((audit.payload as { reason?: string }).reason, 'prize winner')
  })

  test('the rules a sale obeys hold for free: one trial, a Home Location, a Bound Instructor', async () => {
    const clientId = await newMember()
    await give(clientId, { packageId: trialCatalogId })
    await assert.rejects(
      () => give(clientId, { packageId: trialCatalogId }),
      (err: { code?: string }) => err.code === 'trial_already_used',
      'a second trial is refused, comped or bought',
    )

    const planMember = await newMember()
    await assert.rejects(
      () => give(planMember, { packageId: unlimitedCatalogId }),
      (err: { code?: string }) => err.code === 'unlimited_requires_location',
      'an Unlimited Plan must name the one Location it covers',
    )
    const { clientPackageId } = await give(planMember, {
      packageId: unlimitedCatalogId,
      locationId,
      crossLocation: true,
    })
    const plan = await row(clientPackageId)
    assert.equal(plan!.locationId, locationId)
    assert.equal(plan!.crossLocationPaidSgd, '0.00', 'a comped Add-On is recorded at zero, not as absent')
    assert.equal(plan!.durationMonths, 1, 'the Duration is frozen')

    const ptMember = await newMember()
    await assert.rejects(
      () => give(ptMember, { packageKind: 'pt', packageId: boundPtCatalogId }),
      (err: { code?: string }) => err.code === 'pt_bound_requires_instructor',
      'an Instructor-Bound PT package must name its instructor',
    )
    const bound = await give(ptMember, {
      packageKind: 'pt',
      packageId: boundPtCatalogId,
      instructorId: staffId,
    })
    assert.equal((await row(bound.clientPackageId))!.boundInstructorId, staffId)
  })

  test('Finance lists it at 0 with its List Price, marked as given', async () => {
    const clientId = await newMember()
    const { clientPackageId } = await give(clientId)

    const finance = await financeSvc.getFinance(tenantId, {
      from: new Date(Date.now() - HOUR),
      to: new Date(Date.now() + HOUR),
    })

    const line = finance.rows.find(r => r.id === clientPackageId)
    assert.ok(line, 'the comp is a purchase event, visible in Finance')
    assert.equal(line.paid_sgd, 0)
    assert.equal(line.list_price_sgd, 200, 'at its catalogue price')
    assert.equal(
      line.complimentary,
      true,
      'and marked, which is what keeps it out of Gross — `finance/totals.test.ts` holds the arithmetic',
    )
  })

  test('a comp does not make the member Converted', async () => {
    const clientId = await newMember()
    await give(clientId, { packageId: trialCatalogId })
    await give(clientId)

    const directory = await clientsSvc.listClients(tenantId, {})
    const member = directory.find(c => c.id === clientId)
    assert.ok(member)
    assert.equal(member.converted, false, 'the Trial Funnel is not flattered by comps')
  })

  test('remove works while Untouched, cancelling the classes it paid for', async () => {
    const clientId = await newMember()
    const { clientPackageId } = await give(clientId)
    const { bookingId } = await bookSvc.bookClass(tenantId, { clientId, classId: await newClass() })

    const result = await compSvc.removeComplimentaryPackage(tenantId, {
      clientId,
      clientPackageId,
      reason: 'given to the wrong member',
      actedByStaffId: staffId,
    })
    assert.equal(result.cancelledBookings, 1)

    assert.equal(await row(clientPackageId), undefined, 'the row is gone')
    const [booking] = await harness.db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, bookingId))
    assert.equal(booking!.state, 'cancelled', 'the class it paid for is cancelled')
    assert.equal(booking!.clientPackageId, null, 'the booking survives with its link cleared')

    // Both the grant and the removal are filed against the package id, so the
    // removal is looked up by its action rather than by being the only row.
    const [audit] = await harness.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.targetId, clientPackageId),
          eq(schema.auditLog.action, 'complimentary_package_removed'),
        ),
      )
    assert.ok(audit, 'the removal is in the audit log')
    assert.equal((audit.payload as { reason?: string }).reason, 'given to the wrong member')
  })

  test('remove is refused once a class it paid for was attended, and on a package nobody comped', async () => {
    const clientId = await newMember()
    const { clientPackageId } = await give(clientId)
    const classId = await newClass()
    const { bookingId } = await bookSvc.bookClass(tenantId, { clientId, classId })
    // The class has to have started before anybody can be ticked off its
    // roster, and booking one that already has is refused — so it is booked
    // ahead and then moved back, which is what a class simply running does.
    await harness.db
      .update(schema.classes)
      .set({ startsAt: new Date(Date.now() - 2 * HOUR), endsAt: new Date(Date.now() - HOUR) })
      .where(eq(schema.classes.id, classId))
    await checkInSvc.markAttendance(tenantId, { bookingId, staffId, attended: true })

    await assert.rejects(
      () =>
        compSvc.removeComplimentaryPackage(tenantId, {
          clientId,
          clientPackageId,
          reason: 'too late',
          actedByStaffId: staffId,
        }),
      (err: { code?: string }) => err.code === 'package_touched',
      'a class that was attended is what removing would rewrite',
    )
    assert.ok(await row(clientPackageId), 'and the package stands')
  })

  test('a Location from another studio, and a member from another studio, are not givable to', async () => {
    const clientId = await newMember()
    await assert.rejects(
      () =>
        compSvc.giveComplimentaryPackage(harness.tenants.two.id, {
          clientId,
          packageKind: 'class',
          packageId: bundleCatalogId,
          reason: 'across the tenant line',
          actedByStaffId: staffId,
        }),
      (err: { code?: string }) => err.code === 'client_not_found',
      'the second studio cannot give the first studio’s member anything',
    )
  })
})
