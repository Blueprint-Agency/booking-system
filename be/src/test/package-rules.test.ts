import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  inTenantContext,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.package-rules.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const NAME = `Rules ${run}`
const CLASS_TYPE_NAME = `Rules class type ${run}`
const LOCATION_NAME = `Rules premises ${run}`
const FLAG = 'waitlist_enabled'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * A class's Package rule (be/CONTEXT.md § Package rule), over real HTTP: set on
 * a class and a series by staff, refused when it names nothing or names what a
 * class cannot take, previewed and saved on a class with bookings (cancelling
 * exactly the bookings it no longer accepts, refunding and emailing them and
 * back-filling the seat), copied by a series onto every class it makes, refusing
 * `not_accepted` wherever a payer is chosen, read by members on the class
 * detail, carried through a studio's export and import, and kept to its Tenant
 * by Row-Level Security. Named from the Scenario Inventory (`docs/md/test-scenarios.md`).
 */
describe('package rules on a class and a series', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let classTypesSvc!: typeof import('../services/catalog/class-types')

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    seriesRoomId: string
    classTypeId: string
    admin: Staff
    instructor: Staff
    seriesInstructor: Staff
    /** Credit Bundles: `mat` stays accepted, `promo` is the one rules refuse. */
    mat: string
    promo: string
    unlimited: string
    archived: string
    pt: string
    corporate: string
  }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio

  const json = { 'Content-Type': 'application/json' }
  const emailFor = (name: string) => `${name}@${DOMAIN}`
  /** A fresh hour for every class this file makes, so no two ever clash for a room or an instructor. */
  let slots = 0
  const nextStart = () => new Date(Date.now() + 20 * DAY + slots++ * 2 * HOUR)
  const plainDate = (d: Date) => d.toISOString().slice(0, 10)

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${name}-${tenant.slug}`)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select({ id: schema.staffAuthUsers.id }).from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    return { id: row!.id, headers }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    // Premises of this file's own, so its classes never clash with another file's.
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: LOCATION_NAME })
      .returning({ id: schema.locations.id })
    const room = async (name: string) => {
      const [row] = await harness.db
        .insert(schema.rooms)
        .values({ tenantId: tenant.id, locationId: location!.id, name, capacity: 20 })
        .returning({ id: schema.rooms.id })
      return row!.id
    }
    const classType = await classTypesSvc.createClassType(tenant.id, { name: CLASS_TYPE_NAME })
    const admin = await staffAt(tenant, 'admin', 'admin')

    const catalogue = async (
      label: string,
      values: Partial<typeof schema.classPackages.$inferInsert> & { kind: 'credit_bundle' | 'unlimited' | 'trial' },
    ) => {
      const [row] = await harness.db
        .insert(schema.classPackages)
        .values({ tenantId: tenant.id, name: `${NAME} ${label}`, priceSgd: '150.00', status: 'active', ...values })
        .returning({ id: schema.classPackages.id })
      return row!.id
    }
    const [pt] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: `${NAME} pt`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00' })
      .returning({ id: schema.ptPackages.id })
    const [corporate] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: tenant.id, name: `${NAME} corporate`, priceSgd: '900.00', createdByStaffId: admin.id })
      .returning({ id: schema.corporatePackages.id })

    return {
      ...tenant,
      locationId: location!.id,
      roomId: await room(`Rules room ${run}`),
      seriesRoomId: await room(`Rules series room ${run}`),
      classTypeId: classType.id,
      admin,
      instructor: await staffAt(tenant, 'instructor', 'instructor'),
      seriesInstructor: await staffAt(tenant, 'series-instructor', 'instructor'),
      mat: await catalogue('mat', { kind: 'credit_bundle', credits: 10, validityDays: 30 }),
      promo: await catalogue('promo', { kind: 'credit_bundle', credits: 10, validityDays: 30 }),
      unlimited: await catalogue('unlimited', { kind: 'unlimited', durationMonths: 1 }),
      archived: await catalogue('archived', { kind: 'trial', credits: 1, validityDays: 14, status: 'archived', archivedAt: new Date() }),
      pt: pt!.id,
      corporate: corporate!.id,
    }
  }

  let members = 0
  async function member(at: Studio): Promise<Member> {
    const email = emailFor(`member-${members++}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Ria', phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  /** A class package the member holds, bought as `catalogueId`: Dormant unless `running`. */
  let purchases = 0
  async function holds(
    at: Studio,
    who: Member,
    catalogueId: string,
    options: { kind?: 'credit_bundle' | 'unlimited'; credits?: number; running?: boolean } = {},
  ): Promise<string> {
    const unlimited = options.kind === 'unlimited'
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId: who.clientId,
        kind: options.kind ?? 'credit_bundle',
        sourceClassPackageId: catalogueId,
        locationId: unlimited ? at.locationId : null,
        durationMonths: unlimited ? 1 : null,
        validityDays: unlimited ? null : 60,
        creditsOrSessionsRemaining: unlimited ? null : (options.credits ?? 5),
        expiresAt: options.running ? new Date(Date.now() + 60 * DAY) : null,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
        purchasedAt: new Date(Date.now() - 30 * DAY + purchases++ * 1000),
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /* ── requests ───────────────────────────────────────────────────────── */

  const send = (method: string, headers: Record<string, string>, path: string, body?: unknown) =>
    harness.app.request(path, {
      method,
      headers: { ...headers, ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  /** What the member app sends when nobody is signed in. */
  const visitor = (at: Studio): Record<string, string> => ({
    'X-Tenant-Slug': at.slug,
    Origin: frontendOrigin('client', at),
    'X-Forwarded-For': harnessAddress(),
  })

  const rule = (mode: 'all' | 'only' | 'except', packageIds: string[] = []) => ({ mode, package_ids: packageIds })

  function classBody(at: Studio, extra: Record<string, unknown> = {}) {
    const startsAt = nextStart()
    return {
      class_type_id: at.classTypeId,
      main_instructor_id: at.instructor.id,
      location_id: at.locationId,
      room_id: at.roomId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
      capacity_online: 10,
      credit_cost: 1,
      ...extra,
    }
  }

  const createClass = (at: Studio, extra: Record<string, unknown> = {}) =>
    send('POST', at.admin.headers, '/api/v1/portal/admin/schedule/classes', classBody(at, extra))

  async function addClass(at: Studio, extra: Record<string, unknown> = {}): Promise<string> {
    return (await expectStatus(await createClass(at, extra), 201)).id
  }

  const editClass = (at: Studio, classId: string, body: Record<string, unknown>) =>
    send('PATCH', at.admin.headers, `/api/v1/portal/admin/schedule/classes/${classId}`, body)

  const book = (who: Member, classId: string, extra: Record<string, unknown> = {}) =>
    send('POST', who.headers, '/api/v1/me/bookings/class', { class_id: classId, ...extra })

  const setFlag = (at: Studio, enabled: boolean) =>
    send('PATCH', at.admin.headers, `/api/v1/portal/admin/feature-flags/${FLAG}`, { enabled })

  /* ── state ──────────────────────────────────────────────────────────── */

  async function pkg(id: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, id))
    assert.ok(row, `no package ${id}`)
    return row
  }

  async function bookingRow(id: string) {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, id))
    assert.ok(row, `no booking ${id}`)
    return row
  }

  const bookingsOn = (who: Member, classId: string) =>
    harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.clientId, who.clientId), eq(schema.bookings.classId, classId)))

  /** A class's stored rule: its mode and the catalogue packages it names. */
  async function storedRule(classId: string) {
    const [cls] = await harness.db
      .select({ mode: schema.classes.packageRuleMode })
      .from(schema.classes)
      .where(eq(schema.classes.id, classId))
    const rows = await harness.db
      .select({ id: schema.classRulePackages.classPackageId })
      .from(schema.classRulePackages)
      .where(eq(schema.classRulePackages.classId, classId))
    return { mode: cls?.mode, packageIds: rows.map(r => r.id).sort() }
  }

  const emailsTo = (who: Member, slug: string) =>
    harness.db
      .select({ subject: schema.emailLog.subjectRendered, body: schema.emailLog.bodyRendered })
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.recipientEmail, who.email), eq(schema.emailLog.templateSlug, slug)))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    classTypesSvc = inTenantContext(await import('../services/catalog/class-types'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    if (one) await setFlag(one, false)
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const classes = sql`SELECT id FROM classes WHERE created_by_staff_id IN (${staff})`
    await harness.db.execute(sql`DELETE FROM inbox_items WHERE payload->>'clientId' IN (SELECT id::text FROM (${clients}) c)`)
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM feature_flags WHERE key = ${FLAG} AND updated_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM waitlist_entries WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM class_rule_packages WHERE class_id IN (${classes})`)
    await harness.db.execute(sql`DELETE FROM class_supporting_instructors WHERE class_id IN (${classes})`)
    await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_series_rule_packages WHERE series_id IN (SELECT id FROM class_series WHERE created_by_staff_id IN (${staff}))`)
    await harness.db.execute(sql`DELETE FROM class_series WHERE created_by_staff_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.db.execute(sql`DELETE FROM corporate_packages WHERE name LIKE ${`${NAME}%`}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (SELECT id FROM locations WHERE name = ${LOCATION_NAME})`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name = ${LOCATION_NAME}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name = ${CLASS_TYPE_NAME}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── setting a rule ─────────────────────────────────────────────────── */

  test('PKR-01 an admin schedules a class that takes only some packages, an archived one included, and its detail names them', async () => {
    const created = await expectStatus(await createClass(one, { package_rule: rule('only', [one.unlimited, one.archived, one.mat]) }), 201)
    const named = [
      { id: one.unlimited, name: `${NAME} unlimited`, kind: 'unlimited', archived: false },
      { id: one.mat, name: `${NAME} mat`, kind: 'credit_bundle', archived: false },
      { id: one.archived, name: `${NAME} archived`, kind: 'trial', archived: true },
    ]
    assert.deepEqual(created.package_rule, { mode: 'only', packages: named }, 'by kind, Unlimited Plans first')

    const detail = await expectStatus(await send('GET', one.admin.headers, `/api/v1/portal/admin/schedule/classes/${created.id}`), 200)
    assert.deepEqual(detail.package_rule, { mode: 'only', packages: named })

    // A class scheduled with no rule accepts everything, and says so.
    const plain = await expectStatus(await createClass(one), 201)
    assert.deepEqual(plain.package_rule, { mode: 'all', packages: [] })
    assert.deepEqual(await storedRule(plain.id), { mode: 'all', packageIds: [] })
  })

  test('PKR-02 an instructor schedules a class that takes all but one package, and their session page shows it', async () => {
    const startsAt = nextStart()
    const created = await expectStatus(
      await send('POST', one.instructor.headers, '/api/v1/portal/instructor/schedule/classes', {
        class_type_id: one.classTypeId,
        location_id: one.locationId,
        room_id: one.roomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        capacity_online: 8,
        credit_cost: 1,
        package_rule: rule('except', [one.promo]),
      }),
      201,
    )
    assert.deepEqual(created.package_rule, {
      mode: 'except',
      packages: [{ id: one.promo, name: `${NAME} promo`, kind: 'credit_bundle', archived: false }],
    })
    const page = await expectStatus(
      await send('GET', one.instructor.headers, `/api/v1/portal/instructor/sessions/class/${created.id}/roster`),
      200,
    )
    assert.equal(page.package_rule.mode, 'except')
    assert.deepEqual(page.package_rule.packages.map((p: any) => p.id), [one.promo])

    // The picker's list: every class package, archived ones included, no prices.
    const list = await expectStatus(await send('GET', one.instructor.headers, '/api/v1/portal/instructor/catalog/class-packages'), 200)
    const ours = list.class_packages.filter((p: any) => p.name.startsWith(NAME))
    assert.deepEqual(
      ours.map((p: any) => [p.name, p.kind, p.status]).sort(),
      [
        [`${NAME} archived`, 'trial', 'archived'],
        [`${NAME} mat`, 'credit_bundle', 'active'],
        [`${NAME} promo`, 'credit_bundle', 'active'],
        [`${NAME} unlimited`, 'unlimited', 'active'],
      ],
    )
    assert.ok(ours.every((p: any) => !('price_sgd' in p)))
  })

  test('PKR-03 a rule naming nothing to take, a PT or corporate package, or another studio’s package is refused', async () => {
    await expectStatus(await createClass(one, { package_rule: rule('only') }), 400, 'package_rule_empty')
    for (const foreign of [one.pt, one.corporate, two.mat, randomUUID()]) {
      const res = await expectStatus(await createClass(one, { package_rule: rule('except', [one.mat, foreign]) }), 400, 'package_rule_invalid_package')
      assert.deepEqual(res.package_ids, [foreign])
    }

    // The same refusals on an edit and a series, and nothing is written.
    const classId = await addClass(one, { package_rule: rule('only', [one.mat]) })
    await expectStatus(await editClass(one, classId, { package_rule: rule('only') }), 400, 'package_rule_empty')
    await expectStatus(await editClass(one, classId, { package_rule: rule('only', [two.promo]) }), 400, 'package_rule_invalid_package')
    await expectStatus(await editClass(one, classId, { package_rule: rule('only', [one.pt]), preview: true }), 400, 'package_rule_invalid_package')
    assert.deepEqual(await storedRule(classId), { mode: 'only', packageIds: [one.mat] })

    const first = new Date(Date.now() + 30 * DAY)
    const seriesBody = {
      class_type_id: one.classTypeId,
      main_instructor_id: one.seriesInstructor.id,
      location_id: one.locationId,
      room_id: one.seriesRoomId,
      weekday: ((first.getUTCDay() + 6) % 7) + 1,
      start_time: '06:00',
      end_time: '07:00',
      capacity_online: 10,
      credit_cost: 1,
      first_date: plainDate(first),
      last_date: plainDate(new Date(first.getTime() + 14 * DAY)),
      package_rule: rule('only'),
    }
    await expectStatus(await send('POST', one.admin.headers, '/api/v1/portal/admin/schedule/series/preview', seriesBody), 400, 'package_rule_empty')
    await expectStatus(
      await send('POST', one.admin.headers, '/api/v1/portal/admin/schedule/series', { ...seriesBody, package_rule: rule('except', [one.corporate]) }),
      400,
      'package_rule_invalid_package',
    )
  })

  /* ── changing a rule on a class with bookings ───────────────────────── */

  test('PKR-04 a preview says how many bookings a rule change would cancel, and changes nothing', async () => {
    const classId = await addClass(one)
    const ada = await member(one)
    const promo = await holds(one, ada, one.promo)
    const bo = await member(one)
    await holds(one, bo, one.mat)
    const adaBooking = await expectStatus(await book(ada, classId), 201)
    await expectStatus(await book(bo, classId), 201)

    const preview = await expectStatus(await editClass(one, classId, { package_rule: rule('except', [one.promo]), preview: true }), 200)
    assert.deepEqual(preview, { would_cancel: 1 })
    assert.deepEqual(
      await expectStatus(await editClass(one, classId, { package_rule: rule('only', [one.promo, one.mat]), preview: true }), 200),
      { would_cancel: 0 },
    )

    assert.deepEqual(await storedRule(classId), { mode: 'all', packageIds: [] }, 'the rule is not saved')
    assert.equal((await bookingRow(adaBooking.booking_id)).state, 'confirmed', 'nobody is cancelled')
    assert.equal((await pkg(promo)).creditsOrSessionsRemaining, 4)
  })

  test('PKR-05 saving a rule change cancels only the bookings it no longer accepts, returns their credits, emails them, and costs no cancellation', async () => {
    const [policy] = await harness.db.select().from(schema.globalPolicy).where(eq(schema.globalPolicy.tenantId, one.id))
    // A cap of one: had the studio's cancel counted, the member's own cancel below would forfeit.
    await harness.db.update(schema.globalPolicy).set({ cancelCapCount: 1 }).where(eq(schema.globalPolicy.tenantId, one.id))
    try {
      const classId = await addClass(one, { credit_cost: 2 })
      const cy = await member(one)
      const promo = await holds(one, cy, one.promo, { credits: 6 })
      const dee = await member(one)
      const mat = await holds(one, dee, one.mat, { credits: 6 })
      const eli = await member(one)
      await holds(one, eli, one.unlimited, { kind: 'unlimited' })

      const cysBooking = (await expectStatus(await book(cy, classId), 201)).booking_id
      const deesBooking = (await expectStatus(await book(dee, classId), 201)).booking_id
      const elisBooking = (await expectStatus(await book(eli, classId), 201)).booking_id
      assert.equal((await pkg(promo)).creditsOrSessionsRemaining, 4)

      // Only the mat bundle: Cy's promo bundle and Eli's plan are no longer accepted.
      const saved = await expectStatus(await editClass(one, classId, { package_rule: rule('only', [one.mat]) }), 200)
      assert.equal(saved.package_rule.mode, 'only')
      assert.deepEqual(await storedRule(classId), { mode: 'only', packageIds: [one.mat] })

      const cys = await bookingRow(cysBooking)
      assert.equal(cys.state, 'cancelled')
      assert.equal(cys.refundOutcome, 'credit_returned')
      assert.equal((await pkg(promo)).creditsOrSessionsRemaining, 6, 'the credits go back to the package that paid')
      assert.equal((await bookingRow(elisBooking)).state, 'cancelled')
      assert.equal((await bookingRow(deesBooking)).state, 'confirmed', 'a package still accepted keeps its seat')
      assert.equal((await pkg(mat)).creditsOrSessionsRemaining, 4)

      const [mail] = await emailsTo(cy, 'class_rule_cancelled')
      assert.ok(mail, 'the member is emailed')
      assert.match(mail.body, new RegExp(`${NAME} promo`))
      assert.match(mail.body, new RegExp(CLASS_TYPE_NAME))
      assert.match(mail.body, /Credits returned[\s\S]*?2/)
      const [elisMail] = await emailsTo(eli, 'class_rule_cancelled')
      assert.match(elisMail!.body, /Credits returned[\s\S]*?0/, 'an Unlimited Plan spent nothing, so nothing is returned')
      assert.equal((await emailsTo(dee, 'class_rule_cancelled')).length, 0)

      // The studio's cancel is not the member's: their one allowed cancel is still there.
      const other = await addClass(one)
      const own = (await expectStatus(await book(cy, other), 201)).booking_id
      await expectStatus(await send('DELETE', cy.headers, `/api/v1/me/bookings/${own}`), 200)
      assert.equal((await bookingRow(own)).refundOutcome, 'credit_returned', 'refunded, so within the cap')
    } finally {
      await harness.db
        .update(schema.globalPolicy)
        .set({ cancelCapCount: policy!.cancelCapCount })
        .where(eq(schema.globalPolicy.tenantId, one.id))
    }
  })

  test('CXL-63 a booking a rule change cancels is recorded as a system cancel, naming no staff member', async () => {
    const classId = await addClass(one)
    const fin = await member(one)
    await holds(one, fin, one.promo)
    const bookingId = (await expectStatus(await book(fin, classId), 201)).booking_id

    await expectStatus(await editClass(one, classId, { package_rule: rule('only', [one.mat]) }), 200)

    assert.equal((await bookingRow(bookingId)).state, 'cancelled')
    const records = await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.bookingId, bookingId))
    assert.deepEqual(
      records.map(r => [r.source, r.cancelledByStaffId]),
      [['system', null]],
    )
  })

  test('PKR-06 a seat a rule change frees goes to the first waiting member the class accepts, skipping one it does not', async () => {
    assert.equal((await setFlag(one, true)).status, 200)
    const classId = await addClass(one, { capacity_online: 1, capacity_waitlist: 3 })
    const seated = await member(one)
    await holds(one, seated, one.promo)
    const first = await member(one)
    await holds(one, first, one.promo)
    const second = await member(one)
    const secondsBundle = await holds(one, second, one.mat)

    await expectStatus(await book(seated, classId), 201)
    await expectStatus(await send('POST', first.headers, `/api/v1/me/waitlist/classes/${classId}`), 201)
    await expectStatus(await send('POST', second.headers, `/api/v1/me/waitlist/classes/${classId}`), 201)

    await expectStatus(await editClass(one, classId, { package_rule: rule('except', [one.promo]) }), 200)

    assert.equal((await bookingsOn(first, classId)).length, 0, 'the head of the line holds only a refused package')
    const [promoted] = await bookingsOn(second, classId)
    assert.ok(promoted, 'the next member in line is booked')
    assert.equal(promoted.state, 'confirmed')
    assert.equal(promoted.clientPackageId, secondsBundle)
    const [waiting] = await harness.db
      .select({ status: schema.waitlistEntries.status })
      .from(schema.waitlistEntries)
      .where(and(eq(schema.waitlistEntries.clientId, first.clientId), eq(schema.waitlistEntries.classId, classId)))
    assert.equal(waiting?.status, 'waiting', 'the skipped member keeps their place')
  })

  test('PKR-07 a rule change that cancels nobody saves at once', async () => {
    const classId = await addClass(one)
    const fay = await member(one)
    await holds(one, fay, one.mat)
    const booking = (await expectStatus(await book(fay, classId), 201)).booking_id

    assert.deepEqual(await expectStatus(await editClass(one, classId, { package_rule: rule('only', [one.mat]), preview: true }), 200), {
      would_cancel: 0,
    })
    await expectStatus(await editClass(one, classId, { package_rule: rule('only', [one.mat]) }), 200)
    assert.deepEqual(await storedRule(classId), { mode: 'only', packageIds: [one.mat] })
    assert.equal((await bookingRow(booking)).state, 'confirmed')

    // And back to all, which cancels nobody either.
    await expectStatus(await editClass(one, classId, { package_rule: rule('all') }), 200)
    assert.deepEqual(await storedRule(classId), { mode: 'all', packageIds: [] })
  })

  /* ── the series ─────────────────────────────────────────────────────── */

  test('PKR-08 a weekly series copies its rule onto every class it makes and every class an extend adds; one class’s own edit stays its own', async () => {
    const first = new Date(Date.now() + 40 * DAY)
    const weekday = ((first.getUTCDay() + 6) % 7) + 1
    const created = await expectStatus(
      await send('POST', one.admin.headers, '/api/v1/portal/admin/schedule/series', {
        class_type_id: one.classTypeId,
        main_instructor_id: one.seriesInstructor.id,
        location_id: one.locationId,
        room_id: one.seriesRoomId,
        weekday,
        start_time: '07:30',
        end_time: '08:30',
        capacity_online: 10,
        credit_cost: 1,
        first_date: plainDate(first),
        last_date: plainDate(new Date(first.getTime() + 14 * DAY)),
        package_rule: rule('except', [one.promo, one.archived]),
      }),
      201,
    )
    assert.equal(created.class_ids.length, 3)
    assert.deepEqual(created.series.package_rule, {
      mode: 'except',
      packages: [
        { id: one.promo, name: `${NAME} promo`, kind: 'credit_bundle', archived: false },
        { id: one.archived, name: `${NAME} archived`, kind: 'trial', archived: true },
      ],
    })
    const expected = { mode: 'except', packageIds: [one.promo, one.archived].sort() }
    for (const id of created.class_ids) assert.deepEqual(await storedRule(id), expected)

    const extended = await expectStatus(
      await send('POST', one.admin.headers, `/api/v1/portal/admin/schedule/series/${created.series.id}/extend`, {
        last_date: plainDate(new Date(first.getTime() + 28 * DAY)),
      }),
      200,
    )
    assert.equal(extended.class_ids.length, 2)
    for (const id of extended.class_ids) assert.deepEqual(await storedRule(id), expected, 'an extend copies it too')

    // One class's own edit is that class's alone.
    const [edited, ...others] = created.class_ids as string[]
    await expectStatus(await editClass(one, edited!, { package_rule: rule('only', [one.mat]) }), 200)
    assert.deepEqual(await storedRule(edited!), { mode: 'only', packageIds: [one.mat] })
    for (const id of [...others, ...extended.class_ids]) assert.deepEqual(await storedRule(id), expected)
    const series = await expectStatus(await send('GET', one.admin.headers, `/api/v1/portal/admin/schedule/series/${created.series.id}`), 200)
    assert.equal(series.package_rule.mode, 'except', 'the series keeps its own rule')
  })

  test('PKR-16 an admin changes a series’ rule: the classes an extend adds carry the new one, the classes it already made keep theirs', async () => {
    const first = new Date(Date.now() + 70 * DAY)
    const created = await expectStatus(
      await send('POST', one.admin.headers, '/api/v1/portal/admin/schedule/series', {
        class_type_id: one.classTypeId,
        main_instructor_id: one.seriesInstructor.id,
        location_id: one.locationId,
        room_id: one.seriesRoomId,
        weekday: ((first.getUTCDay() + 6) % 7) + 1,
        start_time: '11:00',
        end_time: '12:00',
        capacity_online: 10,
        credit_cost: 1,
        first_date: plainDate(first),
        last_date: plainDate(new Date(first.getTime() + 7 * DAY)),
      }),
      201,
    )
    const seriesId = created.series.id
    await expectStatus(await send('PUT', one.admin.headers, `/api/v1/portal/admin/schedule/series/${seriesId}/package-rule`, rule('only')), 400, 'package_rule_empty')

    const changed = await expectStatus(
      await send('PUT', one.admin.headers, `/api/v1/portal/admin/schedule/series/${seriesId}/package-rule`, rule('only', [one.mat])),
      200,
    )
    assert.deepEqual(changed.package_rule, {
      mode: 'only',
      packages: [{ id: one.mat, name: `${NAME} mat`, kind: 'credit_bundle', archived: false }],
    })
    for (const id of created.class_ids) assert.deepEqual(await storedRule(id), { mode: 'all', packageIds: [] }, 'made before the change')

    const extended = await expectStatus(
      await send('POST', one.admin.headers, `/api/v1/portal/admin/schedule/series/${seriesId}/extend`, {
        last_date: plainDate(new Date(first.getTime() + 14 * DAY)),
      }),
      200,
    )
    assert.equal(extended.class_ids.length, 1)
    assert.deepEqual(await storedRule(extended.class_ids[0]), { mode: 'only', packageIds: [one.mat] })

    // Instructors cannot change a series.
    await expectStatus(
      await send('PUT', one.instructor.headers, `/api/v1/portal/admin/schedule/series/${seriesId}/package-rule`, rule('all')),
      403,
    )
  })

  /* ── not_accepted wherever a payer is chosen ────────────────────────── */

  test('PKR-09 a member paying with a package the class does not take is refused not_accepted; an accepted Dormant package pays instead', async () => {
    const classId = await addClass(one, { package_rule: rule('except', [one.promo]) })
    const gus = await member(one)
    const promo = await holds(one, gus, one.promo, { running: true })

    await expectStatus(await book(gus, classId, { client_package_id: promo }), 409, 'not_accepted')
    await expectStatus(await book(gus, classId), 409, 'not_accepted')
    assert.equal((await pkg(promo)).creditsOrSessionsRemaining, 5, 'nothing is debited')

    // A Dormant package the class does take is the Default payer, running or not.
    const mat = await holds(one, gus, one.mat)
    const res = await expectStatus(await book(gus, classId), 201)
    assert.equal((await bookingRow(res.booking_id)).clientPackageId, mat)
    assert.ok((await pkg(mat)).expiresAt, 'and starts')
    assert.equal((await pkg(promo)).creditsOrSessionsRemaining, 5)
  })

  test('PKR-10 staff booking a member and the member joining the waitlist are refused not_accepted when nothing of theirs is accepted', async () => {
    assert.equal((await setFlag(one, true)).status, 200)
    const hal = await member(one)
    await holds(one, hal, one.promo)
    const open = await addClass(one, { capacity_buffer: 2, package_rule: rule('only', [one.mat]) })
    await expectStatus(
      await send('POST', one.admin.headers, `/api/v1/portal/admin/schedule/classes/${open}/bookings`, { client_id: hal.clientId }),
      409,
      'not_accepted',
    )

    const full = await addClass(one, { capacity_online: 1, capacity_waitlist: 3, package_rule: rule('only', [one.mat]) })
    const seated = await member(one)
    await holds(one, seated, one.mat)
    await expectStatus(await book(seated, full), 201)
    await expectStatus(await send('POST', hal.headers, `/api/v1/me/waitlist/classes/${full}`), 409, 'not_accepted')

    // The waitlist panel says why a waiting member could not be added.
    const ivy = await member(one)
    const ivysMat = await holds(one, ivy, one.mat)
    await expectStatus(await send('POST', ivy.headers, `/api/v1/me/waitlist/classes/${full}`), 201)
    await harness.db.update(schema.clientPackages).set({ sourceClassPackageId: one.promo }).where(eq(schema.clientPackages.id, ivysMat))
    const detail = await expectStatus(await send('GET', one.admin.headers, `/api/v1/portal/admin/schedule/classes/${full}`), 200)
    assert.deepEqual(detail.waitlist.map((w: any) => w.payment_status), [{ status: 'cannot_pay', reason: 'not_accepted' }])
  })

  /* ── what members read ──────────────────────────────────────────────── */

  test('PKR-11 the class detail names what a class takes, and signed in marks the member’s own packages; the list only says restricted', async () => {
    const classId = await addClass(one, { package_rule: rule('only', [one.mat, one.unlimited]) })
    const open = await addClass(one)

    const signedOut = await expectStatus(await harness.app.request(`/api/v1/public/classes/${classId}`, { headers: visitor(one) }), 200)
    assert.equal(signedOut.restricted, true)
    assert.deepEqual(signedOut.package_rule, {
      mode: 'only',
      packages: [
        { id: one.unlimited, name: `${NAME} unlimited`, kind: 'unlimited', archived: false },
        { id: one.mat, name: `${NAME} mat`, kind: 'credit_bundle', archived: false },
      ],
    })
    assert.equal('my_packages' in signedOut, false, 'nobody’s packages are on the public detail')

    const jo = await member(one)
    const promo = await holds(one, jo, one.promo, { running: true })
    const mat = await holds(one, jo, one.mat)
    const mine = await expectStatus(await send('GET', jo.headers, `/api/v1/me/classes/${classId}`), 200)
    assert.deepEqual(mine.package_rule, signedOut.package_rule)
    assert.equal(mine.default_client_package_id, mat)
    assert.deepEqual(
      mine.my_packages.map((p: any) => [p.id, p.running, p.eligible, p.reason]),
      [
        [promo, true, false, 'not_accepted'],
        [mat, false, true, null],
      ],
    )
    const dormant = mine.my_packages.find((p: any) => p.id === mat)
    assert.equal(dormant.remaining, 5)
    assert.ok(dormant.activation_end_if_picked, 'what picking it would stamp')
    assert.equal(mine.my_packages[0].expires_at !== null, true)

    // The list carries only the flag.
    const from = new Date(Date.now() + 19 * DAY).toISOString()
    const to = new Date(Date.now() + 80 * DAY).toISOString()
    const list = await expectStatus(
      await harness.app.request(`/api/v1/public/classes?from=${from}&to=${to}&location_id=${one.locationId}`, { headers: visitor(one) }),
      200,
    )
    const byId = new Map(list.classes.map((c: any) => [c.id, c]))
    assert.equal((byId.get(classId) as any).restricted, true)
    assert.equal((byId.get(open) as any).restricted, false)
    assert.equal('package_rule' in (byId.get(classId) as any), false)
  })

  /* ── a studio's rules move with it, and stay in it ──────────────────── */

  test('PKR-12 a studio’s class and series rules survive export and import into another studio, pointing at the copies', async () => {
    const transfer = await import('../services/tenants/transfer')
    const newTenant = async (slug: string) => {
      const [row] = await harness.db.execute<{ id: string }>(sql`
        INSERT INTO tenants (slug, name, timezone, status)
        VALUES (${slug}, ${`Rules ${slug}`}, 'Asia/Singapore', 'active')
        RETURNING id
      `)
      return row!.id
    }
    const source = await newTenant(`rules-src-${run}`)
    const [location] = await harness.db.insert(schema.locations).values({ tenantId: source, name: 'Premises' }).returning()
    const [room] = await harness.db.insert(schema.rooms).values({ tenantId: source, locationId: location!.id, name: 'Room', capacity: 10 }).returning()
    const [type] = await harness.db.insert(schema.classTypes).values({ tenantId: source, name: 'Flow' }).returning()
    const [teacher] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: source, email: `teacher@${DOMAIN}`, name: 'Teacher', role: 'instructor', status: 'active', authUserId: randomUUID() })
      .returning()
    await harness.db.insert(schema.instructors).values({ tenantId: source, staffUserId: teacher!.id })
    const [kept, refused] = await harness.db
      .insert(schema.classPackages)
      .values([
        { tenantId: source, name: 'Kept pack', kind: 'credit_bundle', credits: 5, validityDays: 30, priceSgd: '50.00' },
        { tenantId: source, name: 'Refused pack', kind: 'credit_bundle', credits: 5, validityDays: 30, priceSgd: '50.00' },
      ])
      .returning()
    const startsAt = new Date(Date.now() + 50 * DAY)
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: source,
        classTypeId: type!.id,
        mainInstructorId: teacher!.id,
        locationId: location!.id,
        roomId: room!.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 5,
        creditCost: 1,
        packageRuleMode: 'only',
        createdByStaffId: teacher!.id,
      })
      .returning()
    await harness.db.insert(schema.classRulePackages).values({ tenantId: source, classId: cls!.id, classPackageId: kept!.id })
    const [series] = await harness.db
      .insert(schema.classSeries)
      .values({
        tenantId: source,
        classTypeId: type!.id,
        mainInstructorId: teacher!.id,
        locationId: location!.id,
        roomId: room!.id,
        weekday: 1,
        startTime: '09:00',
        endTime: '10:00',
        capacityOnline: 5,
        creditCost: 1,
        packageRuleMode: 'except',
        firstDate: plainDate(startsAt),
        lastDate: plainDate(startsAt),
        createdByStaffId: teacher!.id,
      })
      .returning()
    await harness.db.insert(schema.classSeriesRulePackages).values({ tenantId: source, seriesId: series!.id, classPackageId: refused!.id })

    const archive = await transfer.exportTenant(source)
    assert.equal(archive.manifest.counts.class_rule_packages, 1)
    assert.equal(archive.manifest.counts.class_series_rule_packages, 1)

    const target = await newTenant(`rules-dst-${run}`)
    const summary = await transfer.importTenant(target, archive)
    assert.equal(summary.remapped, true, 'a copy beside the original gets fresh ids')

    const [copiedClassRule] = await harness.db.execute<{ mode: string; name: string; class_tenant: string; package_tenant: string }>(sql`
      SELECT c.package_rule_mode AS mode, p.name, c.tenant_id AS class_tenant, p.tenant_id AS package_tenant
      FROM class_rule_packages r
      JOIN classes c ON c.id = r.class_id
      JOIN class_packages p ON p.id = r.class_package_id
      WHERE r.tenant_id = ${target}
    `)
    assert.deepEqual(copiedClassRule, { mode: 'only', name: 'Kept pack', class_tenant: target, package_tenant: target })
    const [copiedSeriesRule] = await harness.db.execute<{ mode: string; name: string; series_tenant: string; package_tenant: string }>(sql`
      SELECT s.package_rule_mode AS mode, p.name, s.tenant_id AS series_tenant, p.tenant_id AS package_tenant
      FROM class_series_rule_packages r
      JOIN class_series s ON s.id = r.series_id
      JOIN class_packages p ON p.id = r.class_package_id
      WHERE r.tenant_id = ${target}
    `)
    assert.deepEqual(copiedSeriesRule, { mode: 'except', name: 'Refused pack', series_tenant: target, package_tenant: target })

    // Both studios gone again, the way an operator removes one.
    const { deleteTenant } = await import('../services/tenants/delete')
    for (const [tenantId, slug] of [
      [source, `rules-src-${run}`],
      [target, `rules-dst-${run}`],
    ] as const) {
      await harness.db.execute(sql`UPDATE tenants SET status = 'suspended' WHERE id = ${tenantId}`)
      await deleteTenant({ tenantId, confirmSlug: slug })
    }
  })

  test('PKR-13 one studio’s rule rows are neither visible to nor writable by another', async () => {
    const { withTenant, db } = await import('../db')
    await addClass(one, { package_rule: rule('only', [one.mat]) })
    await addClass(two, { package_rule: rule('only', [two.mat]) })

    for (const [table, owner] of [
      [schema.classRulePackages, 'class'],
      [schema.classSeriesRulePackages, 'series'],
    ] as const) {
      const seenByOne = await withTenant(one.id, () => db.select({ tenantId: table.tenantId }).from(table))
      assert.ok(
        seenByOne.every(r => r.tenantId === one.id),
        `an unfiltered read of the ${owner} rule rows returned another studio's`,
      )
    }
    const seen = await withTenant(one.id, () =>
      db.select({ tenantId: schema.classRulePackages.tenantId }).from(schema.classRulePackages),
    )
    assert.ok(seen.length > 0, 'studio one still sees its own rule rows')
    const everyone = await harness.db.select({ tenantId: schema.classRulePackages.tenantId }).from(schema.classRulePackages)
    assert.ok(new Set(everyone.map(r => r.tenantId)).has(two.id), 'the other studio has rule rows for this to prove anything')

    // A write naming the other studio is refused.
    const [twosClass] = await harness.db
      .select({ id: schema.classRulePackages.classId })
      .from(schema.classRulePackages)
      .where(eq(schema.classRulePackages.tenantId, two.id))
      .limit(1)
    await assert.rejects(
      () =>
        withTenant(one.id, () =>
          db.insert(schema.classRulePackages).values({ tenantId: two.id, classId: twosClass!.id, classPackageId: two.promo }),
        ),
      (err: { cause?: { message?: string } }) => /row-level security/i.test(err.cause?.message ?? ''),
    )
    const smuggled = await harness.db
      .select()
      .from(schema.classRulePackages)
      .where(and(eq(schema.classRulePackages.classId, twosClass!.id), inArray(schema.classRulePackages.classPackageId, [two.promo])))
    assert.equal(smuggled.length, 0)
  })
})
