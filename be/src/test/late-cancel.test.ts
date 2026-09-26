import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.late-cancel.test`
const TAG = `late-${run}`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const CLASS_TYPE_NAME = `${TAG} class type`
const PACKAGE_NAME = `${TAG} pass`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** The studio's class window for the whole file, set in `before` and put back in `after`. */
const WINDOW_HOURS = 24

/**
 * Member late cancellation and the Cancellation Cap switch (#318,
 * be/CONTEXT.md § Late cancel, § Cancellation Cap).
 *
 * A member can cancel a class until it starts. Inside the class's window the
 * cancel is a **Late cancel**: it goes through, the credit is kept, and it
 * counts toward the cap. In time, the credit comes back while the member is
 * under the cap — or always, with the cap switched off. Once the class has
 * started the cancel is refused.
 *
 * Each rule runs behind the member's own routes; the classes and packages it
 * runs against are written directly.
 */
describe('member late cancellation and the Cancellation Cap', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Member = { clientId: string; headers: Headers }

  let one!: { id: string; slug: string }
  let admin!: { id: string; headers: Headers }
  let teacherId!: string
  let locationId!: string
  let roomId!: string
  let classTypeId!: string
  let classPackageId!: string
  /** The studio's policy row as this file found it, put back in `after`. */
  let savedPolicy: typeof import('../db/schema')['globalPolicy']['$inferSelect'] | undefined

  const emailFor = (name: string) => `${name}@${DOMAIN}`

  const send = async (method: string, path: string, headers: Headers, body?: unknown): Promise<Reply> => {
    const res = await harness.app.request(`/api/v1${path}`, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const setPolicy = async (patch: Record<string, unknown>) => {
    const res = await send('PATCH', '/portal/admin/policy/global', admin.headers, patch)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body
  }

  let memberSeq = 0
  /** A signed-in member holding a 10-credit bundle, or an Unlimited Plan. */
  async function member(plan: 'credits' | 'unlimited' = 'credits'): Promise<Member> {
    const email = emailFor(`member${++memberSeq}`)
    const headers = await harness.signInAs('client', email, one)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: one.id, email, name: `Late ${memberSeq}`, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    if (plan === 'credits') {
      await purchaseSvc.grantPackage(one.id, {
        clientId: client!.id,
        purchaseId: null,
        amountSgd: '200.00',
        packageKind: 'class',
        packageId: classPackageId,
      })
    } else {
      await harness.db.insert(schema.clientPackages).values({
        tenantId: one.id,
        clientId: client!.id,
        kind: 'unlimited',
        locationId,
        durationMonths: 1,
        creditsOrSessionsRemaining: null,
        expiresAt: new Date(Date.now() + 60 * DAY),
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
    }
    return { clientId: client!.id, headers }
  }

  /** A one-credit class starting `startsIn` from now, on the studio's window. */
  async function addClass(startsIn: number): Promise<{ id: string; startsAt: Date }> {
    const startsAt = new Date(Date.now() + startsIn)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: one.id,
        classTypeId,
        mainInstructorId: teacherId,
        locationId,
        roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: admin.id,
      })
      .returning({ id: schema.classes.id })
    return { id: row!.id, startsAt }
  }

  /** Book a class the member's way, returning the booking id. */
  async function booked(who: Member, classId: string): Promise<string> {
    const res = await send('POST', '/me/bookings/class', who.headers, { class_id: classId })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.booking_id as string
  }

  /** A class `startsIn` from now, booked by `who`. */
  const bookedIn = async (who: Member, startsIn: number) => booked(who, (await addClass(startsIn)).id)

  const cancel = (who: Member, bookingId: string) => send('DELETE', `/me/bookings/${bookingId}`, who.headers)

  async function detail(who: Member, bookingId: string) {
    const res = await send('GET', `/me/bookings/${bookingId}`, who.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    return res.body
  }

  async function creditsLeft(who: Member): Promise<number> {
    const rows = await harness.db
      .select({ left: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.clientId, who.clientId))
    return rows.reduce((sum, r) => sum + (r.left ?? 0), 0)
  }

  async function bookingOf(bookingId: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId))
    assert.ok(row)
    return row
  }

  async function cancellationOf(bookingId: string) {
    const [row] = await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))
    return row
  }

  /** In time (days out) and inside the window (hours out). */
  const IN_TIME = 5 * DAY
  const LATE = 2 * HOUR

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    one = harness.tenants.one

    const staff = async (name: string, role: 'admin' | 'instructor') => {
      const email = emailFor(name)
      const headers = await harness.signInAs('staff', email, one)
      const [user] = await harness.db
        .select({ id: schema.staffAuthUsers.id })
        .from(schema.staffAuthUsers)
        .where(and(eq(schema.staffAuthUsers.tenantId, one.id), eq(schema.staffAuthUsers.email, email)))
      const [row] = await harness.db
        .insert(schema.staffUsers)
        .values({ tenantId: one.id, email, name, role, status: 'active', authUserId: user!.id })
        .returning({ id: schema.staffUsers.id })
      return { id: row!.id, headers }
    }
    admin = await staff('admin', 'admin')
    teacherId = (await staff('teacher', 'instructor')).id
    await harness.db.insert(schema.instructors).values({ tenantId: one.id, staffUserId: teacherId })

    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, one.id))
      .limit(1)
    assert.ok(location, 'the fixture studio has a seeded location')
    locationId = location.id
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: one.id, locationId, name: `${TAG} Room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    roomId = room!.id
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: one.id, name: CLASS_TYPE_NAME })
      .returning({ id: schema.classTypes.id })
    classTypeId = type!.id
    classPackageId = (
      await classPackagesSvc.createClassPackage(one.id, {
        name: PACKAGE_NAME,
        kind: 'credit_bundle',
        credits: 10,
        validityDays: 90,
        priceSgd: '200.00',
      })
    ).id

    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, one.id))
    assert.ok(policy, 'the fixture studio has a policy row')
    savedPolicy = policy
    await setPolicy({ class_window_hours: WINDOW_HOURS, cancel_cap_enabled: true, cancel_cap_count: 10, cancel_cap_cycle_days: 30 })
  })

  after(async () => {
    if (!harness) return
    // Written directly: a save through the route would leave this file's admin
    // as the row's last editor, and that admin is deleted below.
    if (savedPolicy) {
      const { id: _id, tenantId: _tenant, ...columns } = savedPolicy
      await harness.db.update(schema.globalPolicy).set(columns).where(eq(schema.globalPolicy.tenantId, one.id))
    }
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM clients WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM classes WHERE class_type_id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE id = ${classTypeId}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE id = ${roomId}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.close()
  })

  /* ── Late cancel ─────────────────────────────────────────────────── */

  test('CXL-39 a cancel inside the window goes through as a late cancel: credit kept, recorded late, and it counts toward the cap', async () => {
    await setPolicy({ cancel_cap_count: 1 })
    try {
      const who = await member()
      const late = await bookedIn(who, LATE)
      assert.equal(await creditsLeft(who), 9)

      const res = await cancel(who, late)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.refund_outcome, 'forfeited')
      assert.equal(res.body.refund_fired, false)
      assert.equal((await bookingOf(late)).state, 'cancelled')
      assert.equal(await creditsLeft(who), 9, 'a late cancel keeps the credit')
      const record = await cancellationOf(late)
      assert.ok(record, 'a late cancel is recorded')
      assert.equal(record.source, 'client')
      assert.equal(record.wasWithinWindow, false)
      assert.equal(record.refundFired, false)

      // The late cancel used the member's one refunded cancellation this cycle.
      const inTime = await bookedIn(who, IN_TIME)
      const next = await cancel(who, inTime)
      assert.equal(next.status, 200, JSON.stringify(next.body))
      assert.equal(next.body.refund_outcome, 'forfeited', 'the late cancel counted toward the cap')
      assert.equal((await cancellationOf(inTime))?.wasWithinCap, false)
      assert.equal(await creditsLeft(who), 8)
    } finally {
      await setPolicy({ cancel_cap_count: 10 })
    }
  })

  test('CXL-40 once the class has started a member cannot cancel it: refused, booking and credit untouched', async () => {
    const who = await member()
    const cls = await addClass(10 * 60 * 1000)
    const bookingId = await booked(who, cls.id)
    await harness.db
      .update(schema.classes)
      .set({ startsAt: new Date(Date.now() - 60 * 1000), endsAt: new Date(Date.now() + HOUR) })
      .where(eq(schema.classes.id, cls.id))

    const res = await cancel(who, bookingId)
    assert.equal(res.status, 422, JSON.stringify(res.body))
    assert.equal(res.body.error, 'class_started')
    assert.equal((await bookingOf(bookingId)).state, 'confirmed')
    assert.equal(await cancellationOf(bookingId), undefined)
    assert.equal(await creditsLeft(who), 9)
  })

  test('CXL-41 an Unlimited Plan member can late-cancel: nothing was spent, so n_a, and it is recorded as late', async () => {
    const who = await member('unlimited')
    const late = await bookedIn(who, LATE)

    const res = await cancel(who, late)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.refund_outcome, 'n_a')
    assert.equal(res.body.refund_fired, false)
    const record = await cancellationOf(late)
    assert.ok(record)
    assert.equal(record.source, 'client')
    assert.equal(record.wasWithinWindow, false)
  })

  /* ── The cap switch ──────────────────────────────────────────────── */

  test('CXL-42 with the cap off every in-time cancel returns the credit, a late one still does not, and switching it back on counts the cycle', async () => {
    await setPolicy({ cancel_cap_count: 1 })
    try {
      const who = await member()
      await setPolicy({ cancel_cap_enabled: false })
      for (let i = 0; i < 3; i++) {
        const res = await cancel(who, await bookedIn(who, IN_TIME + i * HOUR))
        assert.equal(res.status, 200, JSON.stringify(res.body))
        assert.equal(res.body.refund_outcome, 'credit_returned', `in-time cancel ${i + 1} with the cap off`)
      }
      assert.equal(await creditsLeft(who), 10)
      const late = await cancel(who, await bookedIn(who, LATE))
      assert.equal(late.body.refund_outcome, 'forfeited', 'the window still applies with the cap off')
      assert.equal(await creditsLeft(who), 9)
      const recorded = await harness.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.cancellations)
        .where(and(eq(schema.cancellations.clientId, who.clientId), eq(schema.cancellations.source, 'client')))
      assert.equal(recorded[0]!.n, 4, 'cancels are still recorded with the cap off')

      await setPolicy({ cancel_cap_enabled: true })
      const res = await cancel(who, await bookedIn(who, IN_TIME))
      assert.equal(res.body.refund_outcome, 'forfeited', 'the cancels made while it was off count once it is on')
    } finally {
      await setPolicy({ cancel_cap_enabled: true, cancel_cap_count: 10 })
    }
  })

  test('CXL-43 a member’s booking says when the late window opens and previews exactly what its cancel will do', async () => {
    await setPolicy({ cancel_cap_count: 1 })
    try {
      const who = await member()

      // In time, under the cap.
      const cls = await addClass(IN_TIME)
      const inTime = await booked(who, cls.id)
      const upcoming = await send('GET', '/me/bookings/upcoming', who.headers)
      const row = upcoming.body.bookings.find((b: { booking_id: string }) => b.booking_id === inTime)
      assert.equal(row.cancel_deadline, new Date(cls.startsAt.getTime() - WINDOW_HOURS * HOUR).toISOString())
      assert.deepEqual((await detail(who, inTime)).cancel_preview, { late: false, credit_back: true, credits: 1, unlimited: false })
      assert.equal((await cancel(who, inTime)).body.refund_outcome, 'credit_returned')

      // In time, now at the cap.
      const overCap = await bookedIn(who, IN_TIME)
      assert.deepEqual((await detail(who, overCap)).cancel_preview, { late: false, credit_back: false, credits: 1, unlimited: false })
      assert.equal((await cancel(who, overCap)).body.refund_outcome, 'forfeited')

      // With the cap off the same member is back to in time = credit back.
      await setPolicy({ cancel_cap_enabled: false })
      const capOff = await bookedIn(who, IN_TIME)
      assert.deepEqual((await detail(who, capOff)).cancel_preview, { late: false, credit_back: true, credits: 1, unlimited: false })
      assert.equal((await cancel(who, capOff)).body.refund_outcome, 'credit_returned')

      // Late.
      const late = await bookedIn(who, LATE)
      assert.deepEqual((await detail(who, late)).cancel_preview, { late: true, credit_back: false, credits: 1, unlimited: false })
      assert.equal((await cancel(who, late)).body.refund_outcome, 'forfeited')

      // An Unlimited Plan spent nothing.
      const unlimited = await member('unlimited')
      const free = await bookedIn(unlimited, LATE)
      assert.deepEqual((await detail(unlimited, free)).cancel_preview, { late: true, credit_back: false, credits: 0, unlimited: true })
      assert.equal((await cancel(unlimited, free)).body.refund_outcome, 'n_a')

      // A cancelled booking has nothing left to preview, and previewing wrote nothing.
      assert.equal((await detail(who, late)).cancel_preview, null)
      const previewOnly = await bookedIn(who, IN_TIME)
      await detail(who, previewOnly)
      assert.equal(await cancellationOf(previewOnly), undefined)
      assert.equal((await bookingOf(previewOnly)).state, 'confirmed')
    } finally {
      await setPolicy({ cancel_cap_enabled: true, cancel_cap_count: 10 })
    }
  })

  test('CXL-44 the cap switch round-trips through the Policy page and reaches the member’s policy read', async () => {
    const off = await setPolicy({ cancel_cap_enabled: false })
    try {
      assert.equal(off.cancel_cap_enabled, false)
      const read = await send('GET', '/portal/admin/policy', admin.headers)
      assert.equal(read.status, 200, JSON.stringify(read.body))
      assert.equal(read.body.global_policy.cancel_cap_enabled, false)
      const pub = await harness.app.request('/api/v1/public/cancellation-policy', { headers: { 'X-Tenant-Slug': one.slug } })
      assert.equal(((await pub.json()) as { cancel_cap_enabled: boolean }).cancel_cap_enabled, false)

      const refused = await send('PATCH', '/portal/admin/policy/global', admin.headers, { cancel_cap_enabled: 'no' })
      assert.equal(refused.status, 400, JSON.stringify(refused.body))
    } finally {
      assert.equal((await setPolicy({ cancel_cap_enabled: true })).cancel_cap_enabled, true)
    }
  })

  /* ── Every new studio has a policy ───────────────────────────────── */

  test('SUP-11 a studio provisioned with a first admin starts with a policy: cap on, 10 per 30 days, 24-hour windows', async () => {
    const provision = await import('../services/tenants/provision')
    const { tenant } = await provision.provisionTenant({
      slug: `late-prov-${run}`,
      name: 'Policy Studio',
      adminEmail: `owner@prov.${DOMAIN}`,
    })
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, tenant.id))
    assert.ok(policy, 'a new studio has a policy row')
    assert.equal(policy.cancelCapEnabled, true)
    assert.equal(policy.cancelCapCount, 10)
    assert.equal(policy.cancelCapCycleDays, 30)
    assert.equal(policy.classWindowHours, 24)
    assert.equal(policy.ptWindowHours, 24)
    const [pt] = await harness.db.select().from(schema.ptBookingConfig).where(eq(schema.ptBookingConfig.tenantId, tenant.id))
    assert.ok(pt, 'a new studio has a PT booking config')

    // A studio opened empty waits for an archive, which brings its own policy —
    // and the import refuses a studio holding rows. Its first admin is the moment
    // it stops waiting, and that is when it gets the default one.
    const waiting = await provision.provisionTenant({ slug: `late-wait-${run}`, name: 'Waiting Policy Studio' })
    const none = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, waiting.tenant.id))
    assert.equal(none.length, 0, 'a studio waiting for an archive holds no policy')
    await provision.inviteFirstAdmin(waiting.tenant.id, { email: `owner@wait.${DOMAIN}` })
    const [invited] = await harness.db
      .select()
      .from(schema.globalPolicy)
      .where(eq(schema.globalPolicy.tenantId, waiting.tenant.id))
    assert.equal(invited?.cancelCapCount, 10)
  })

  test('SUP-12 an archive taken before the cap switch existed restores with the cap on', async () => {
    const transfer = await import('../services/tenants/transfer')
    const emptyTenant = async (slug: string) => {
      const [row] = await harness.db.execute<{ id: string }>(sql`
        INSERT INTO tenants (slug, name, timezone, status)
        VALUES (${slug}, ${`Restored ${slug}`}, 'Asia/Singapore', 'active')
        RETURNING id
      `)
      return row!.id
    }
    const source = await emptyTenant(`late-src-${run}`)
    await harness.db.execute(sql`
      INSERT INTO clients (tenant_id, auth_user_id, email, name, phone)
      VALUES (${source}, ${randomUUID()}, 'member@late-src.test', 'Archived Member', '+6580000001')
    `)
    await harness.db.insert(schema.globalPolicy).values({
      tenantId: source,
      cancelCapEnabled: false,
      cancelCapCount: 3,
      cancelCapCycleDays: 30,
      classWindowHours: 12,
      ptWindowHours: 12,
    })
    const archive = await transfer.exportTenant(source)
    assert.equal(archive.rows.global_policy?.[0]?.cancel_cap_enabled, false)

    // As it stands: the switch travels.
    const kept = await emptyTenant(`late-kept-${run}`)
    await transfer.importTenant(kept, archive)
    const [keptPolicy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, kept))
    assert.equal(keptPolicy?.cancelCapEnabled, false)

    // Taken before the column existed: the cap is on, the count is the studio's.
    for (const row of archive.rows.global_policy!) delete row.cancel_cap_enabled
    const older = await emptyTenant(`late-old-${run}`)
    await transfer.importTenant(older, archive)
    const [olderPolicy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, older))
    assert.equal(olderPolicy?.cancelCapEnabled, true)
    assert.equal(olderPolicy?.cancelCapCount, 3)
  })
})
