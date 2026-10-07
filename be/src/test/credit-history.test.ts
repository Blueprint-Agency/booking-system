import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.credit-history.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `History class type ${run}`
const PACKAGE_NAME = `History pass ${run}`
const PT_PACKAGE_NAME = `History PT pack ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * Credit history (#353), over real HTTP: every movement of a member's credits
 * is recorded against the booking that caused it, and the member (My packages)
 * and staff (the profile's per-package history) read it back newest first,
 * each row carrying the balance after it.
 */
describe('credit history over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    classPackageId: string
    ptPackageId: string
    admin: Staff
    instructor: Staff
  }
  type Member = { clientId: string; headers: Record<string, string> }
  type Movement = {
    id: string
    at: string
    cause: string
    delta: number
    balance_after: number | null
    actor: 'member' | 'staff' | 'system'
    booking: { id: string; kind: string; title: string | null; starts_at: string | null; cancelled_late: boolean | null } | null
    staff_name?: string | null
    note?: string | null
  }
  type History = { history_from: string; movements: Movement[] }

  let one!: Studio
  let two!: Studio

  const emailFor = (name: string) => `${name}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }

  async function expectStatus(res: Response, status: number): Promise<Record<string, unknown>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${role}-${tenant.slug}`)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    return { id: row!.id, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    assert.ok(location, `expected a seeded location for ${tenant.slug}`)
    const [room] = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.locationId, location.id)).limit(1)
    assert.ok(room, `expected a seeded room for ${tenant.slug}`)
    const [classType] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: CLASS_TYPE_NAME })
      .returning({ id: schema.classTypes.id })
    const admin = await staffAt(tenant, 'Avery Admin', 'admin')
    const instructor = await staffAt(tenant, 'Ira Instructor', 'instructor')
    await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: instructor.id })
    const [classPackage] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: PACKAGE_NAME, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const [ptPackage] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: PT_PACKAGE_NAME, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00' })
      .returning({ id: schema.ptPackages.id })
    return {
      ...tenant,
      locationId: location.id,
      roomId: room.id,
      classTypeId: classType!.id,
      classPackageId: classPackage!.id,
      ptPackageId: ptPackage!.id,
      admin,
      instructor,
    }
  }

  let classSlots = 0
  async function addClass(at: Studio, startsIn = 3 * DAY + classSlots++ * 2 * HOUR): Promise<string> {
    const startsAt = new Date(Date.now() + startsIn)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.instructor.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        capacityBuffer: 0,
        creditCost: 1,
        createdByStaffId: at.instructor.id,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  async function member(at: Studio, name: string): Promise<Member> {
    const email = emailFor(`${name}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  /** A Credit Bundle (or PT package) the member holds, running for a month. */
  async function give(at: Studio, who: Member, credits: number, kind: 'credit_bundle' | 'pt' = 'credit_bundle'): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind,
        sourceClassPackageId: kind === 'credit_bundle' ? at.classPackageId : null,
        sourcePtPackageId: kind === 'pt' ? at.ptPackageId : null,
        validityDays: 90,
        creditsOrSessionsRemaining: credits,
        expiresAt: new Date(Date.now() + 30 * DAY),
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  async function book(who: Member, classId: string): Promise<string> {
    const res = await harness.app.request('/api/v1/me/bookings/class', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({ class_id: classId }),
    })
    return (await expectStatus(res, 201)).booking_id as string
  }

  async function cancel(who: Member, bookingId: string): Promise<Record<string, unknown>> {
    return expectStatus(await harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers: who.headers }), 200)
  }

  const memberHistory = (who: Member, packageId: string) =>
    harness.app.request(`/api/v1/me/packages/${packageId}/credit-history`, { headers: who.headers })

  const staffHistory = (as: Staff, who: Member, packageId: string) =>
    harness.app.request(`/api/v1/portal/admin/clients/${who.clientId}/packages/${packageId}/credit-history`, { headers: as.headers })

  async function historyOf(who: Member, packageId: string): Promise<History> {
    return (await expectStatus(await memberHistory(who, packageId), 200)) as unknown as History
  }

  async function staffHistoryOf(as: Staff, who: Member, packageId: string): Promise<History> {
    return (await expectStatus(await staffHistory(as, who, packageId), 200)) as unknown as History
  }

  async function balanceOf(packageId: string): Promise<number | null> {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, packageId))
    return row!.creditsOrSessionsRemaining
  }

  /** Oldest first: each row's balance is the one before it plus its delta, and the last is the package's own. */
  async function assertReconciles(packageId: string, history: History, opening: number): Promise<void> {
    const oldestFirst = [...history.movements].reverse()
    let balance = opening
    for (const m of oldestFirst) {
      balance += m.delta
      assert.equal(m.balance_after, balance, `balance after ${m.cause} does not follow from the row before it`)
    }
    assert.equal(balance, await balanceOf(packageId), 'the newest balance is not the package balance')
  }

  const summary = (h: History) => h.movements.map(m => [m.cause, m.delta])

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    harness.clock.reset()
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (SELECT id FROM pt_requests WHERE client_id IN (${clients}))`)
    await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name = ${PT_PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  test('CRD-20 a class booked then late-cancelled shows two movements on that booking: -1 booked, 0 kept', async () => {
    const who = await member(one, 'late')
    const pkg = await give(one, who, 5)
    // Two hours out: inside the studio's Cancellation Window, so a Late cancel.
    const classId = await addClass(one, 2 * HOUR)
    const bookingId = await book(who, classId)
    assert.equal((await cancel(who, bookingId)).refund_outcome, 'forfeited')

    const history = await historyOf(who, pkg)
    assert.deepEqual(summary(history), [['kept', 0], ['booked', -1]], 'newest first')
    for (const m of history.movements) {
      assert.equal(m.booking?.id, bookingId)
      assert.equal(m.booking?.kind, 'class')
      assert.equal(m.booking?.title, CLASS_TYPE_NAME)
      assert.equal(m.actor, 'member')
      assert.equal(m.balance_after, 4)
    }
    // The kept row says why: it was a Late cancel.
    assert.equal(history.movements[0]!.booking?.cancelled_late, true)
    // The member is never shown a staff member's name or note.
    assert.ok(history.movements.every(m => !('staff_name' in m) && !('note' in m)))
  })

  test('CRD-21 a class booked then cancelled in time shows -1 booked, +1 returned, both on that booking', async () => {
    const who = await member(one, 'intime')
    const pkg = await give(one, who, 5)
    const bookingId = await book(who, await addClass(one))
    assert.equal((await cancel(who, bookingId)).refund_outcome, 'credit_returned')

    const history = await historyOf(who, pkg)
    assert.deepEqual(summary(history), [['returned', 1], ['booked', -1]])
    assert.deepEqual(history.movements.map(m => m.balance_after), [5, 4])
    assert.ok(history.movements.every(m => m.booking?.id === bookingId))
    await assertReconciles(pkg, history, 5)
  })

  test('CRD-22 balance after each movement reconciles with the package over book, cancel, adjust and expire; staff see who adjusted it', async () => {
    const who = await member(one, 'sequence')
    const pkg = await give(one, who, 5)

    const first = await book(who, await addClass(one))
    await cancel(who, first)
    await book(who, await addClass(one))
    await book(who, await addClass(one))
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/clients/${who.clientId}/packages/${pkg}/adjust`, {
        method: 'POST',
        headers: { ...one.admin.headers, ...json },
        body: JSON.stringify({ delta: 2, reason: 'Goodwill after a noisy class' }),
      }),
      200,
    )
    // The package's end passes, and the nightly sweep ends it.
    await harness.db.update(schema.clientPackages).set({ expiresAt: new Date(Date.now() - HOUR) }).where(eq(schema.clientPackages.id, pkg))
    const { withTenant } = await import('../db')
    const { expirePackages } = await import('../services/packages/expire')
    await withTenant(one.id, () => expirePackages())

    const history = await staffHistoryOf(one.admin, who, pkg)
    assert.deepEqual(summary(history), [
      ['expired', 0],
      ['adjusted', 2],
      ['booked', -1],
      ['booked', -1],
      ['returned', 1],
      ['booked', -1],
    ])
    await assertReconciles(pkg, history, 5)
    const adjusted = history.movements.find(m => m.cause === 'adjusted')!
    assert.equal(adjusted.actor, 'staff')
    assert.equal(adjusted.staff_name, 'Avery Admin')
    assert.equal(adjusted.note, 'Goodwill after a noisy class')
    assert.equal(adjusted.booking, null)
    const expired = history.movements[0]!
    assert.equal(expired.actor, 'system')
    assert.equal(expired.balance_after, 5, 'expiry ends the package; the stored balance stays as it was')

    // The member reads the same rows.
    assert.deepEqual(summary(await historyOf(who, pkg)), summary(history))
  })

  test('CRD-23 a No-show is recorded on its booking as credit kept, with the staff member who marked it', async () => {
    const who = await member(one, 'noshow')
    const pkg = await give(one, who, 3)
    const classId = await addClass(one)
    const bookingId = await book(who, classId)
    // The class has started.
    const startsAt = new Date(Date.now() - HOUR / 2)
    await harness.db.update(schema.classes).set({ startsAt, endsAt: new Date(startsAt.getTime() + HOUR) }).where(eq(schema.classes.id, classId))
    await expectStatus(
      await harness.app.request(`/api/v1/portal/admin/bookings/${bookingId}/no-show`, { method: 'POST', headers: one.admin.headers }),
      200,
    )

    const history = await staffHistoryOf(one.admin, who, pkg)
    assert.deepEqual(summary(history), [['no_show', 0], ['booked', -1]])
    assert.equal(history.movements[0]!.booking?.id, bookingId)
    assert.equal(history.movements[0]!.staff_name, 'Avery Admin')
    await assertReconciles(pkg, history, 3)
  })

  test('CRD-24 a PT request debit and the sessions its cancel returned are recorded, by the member', async () => {
    const who = await member(one, 'pt')
    const pkg = await give(one, who, 3, 'pt')
    const res = await harness.app.request('/api/v1/me/pt-sessions/request', {
      method: 'POST',
      headers: { ...who.headers, ...json },
      body: JSON.stringify({
        classTypeId: one.classTypeId,
        locationId: one.locationId,
        sessionType: '1on1',
        clientPackageId: pkg,
        slots: [{ proposedDate: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10), startTime: '09:00', endTime: '10:00' }],
      }),
    })
    const requestId = (await expectStatus(res, 201)).pt_request_id as string
    await expectStatus(await harness.app.request(`/api/v1/me/pt-sessions/${requestId}/cancel`, { method: 'POST', headers: who.headers }), 200)

    const history = await historyOf(who, pkg)
    assert.deepEqual(summary(history), [['pt_returned', 1], ['pt_requested', -1]])
    assert.ok(history.movements.every(m => m.actor === 'member'))
    await assertReconciles(pkg, history, 3)
  })

  test('CRD-25 history starts where it was first recorded, and nothing before it is invented', async () => {
    const who = await member(one, 'from')
    const pkg = await give(one, who, 4)
    const [bought] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, pkg))
    // A package bought since the ledger began: its history runs from the purchase.
    const fresh = await historyOf(who, pkg)
    assert.deepEqual(fresh.movements, [])
    assert.equal(new Date(fresh.history_from).getTime(), bought!.purchasedAt.getTime())

    // A package held when the migration ran carries its `opening` row: the
    // history runs from there, and the row itself is not a movement.
    const openedAt = new Date(Date.now() - DAY)
    await harness.db.insert(schema.creditMovements).values({
      tenantId: one.id,
      clientId: who.clientId,
      clientPackageId: pkg,
      cause: 'opening',
      delta: 0,
      balanceAfter: 4,
      actor: 'system',
      createdAt: openedAt,
    })
    await book(who, await addClass(one))
    const held = await historyOf(who, pkg)
    assert.equal(new Date(held.history_from).getTime(), openedAt.getTime())
    assert.deepEqual(summary(held), [['booked', -1]])
    await assertReconciles(pkg, held, 4)
  })

  test("CRD-26, TEN-32 one studio cannot read another's credit movements, nor a member another member's", async () => {
    const atTwo = await member(two, 'elsewhere')
    const pkgTwo = await give(two, atTwo, 5)
    await book(atTwo, await addClass(two))
    assert.equal((await historyOf(atTwo, pkgTwo)).movements.length, 1)

    // Staff of studio one, naming studio two's member and package.
    await expectStatus(await staffHistory(one.admin, atTwo, pkgTwo), 404)
    // A member of studio one, naming studio two's package.
    const atOne = await member(one, 'nosy')
    await expectStatus(await memberHistory(atOne, pkgTwo), 404)
    // Another member of the same studio.
    const neighbour = await member(two, 'neighbour')
    await expectStatus(await memberHistory(neighbour, pkgTwo), 404)

    // Row-Level Security: in studio one's context, studio two's rows do not exist.
    const { withTenant, db } = await import('../db')
    const seen = await withTenant(one.id, () =>
      db.select().from(schema.creditMovements).where(eq(schema.creditMovements.clientPackageId, pkgTwo)),
    )
    assert.deepEqual(seen, [])
  })
})
