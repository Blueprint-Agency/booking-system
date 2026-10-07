import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.member-tenancy.test`
// Every catalogue row this file writes starts with this, and none ends in
// " Bundle", " Flow", " Retreat" or " Mat" (isolation.test.ts purges those).
const NAME = `Tenancy ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * A member's studio is the only studio their requests can see or touch (#368).
 *
 * Two studios, each with its own catalogue, Locations, staff and members, and
 * the same person a member of both. Every test acts over HTTP on one studio's
 * hostname — the member app's own headers — and then reads what the request
 * left at both studios: the rows, the balances, the ledger and the mail.
 */
describe('a member sees and touches only their own studio', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let discardedMail!: typeof import('../lib/mailer').discardedMail

  type Staff = { id: string; headers: Record<string, string> }
  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
    admin: Staff
    instructor: Staff
    classId: string
    classPackageId: string
    ptPackageId: string
    ptPackage2on1Id: string
    corporatePackageId: string
    merchId: string
    workshopId: string
  }
  type Member = { clientId: string; email: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio

  let people = 0
  const emailFor = (name: string) => `${name.toLowerCase()}-${people++}@${DOMAIN}`
  const json = { 'Content-Type': 'application/json' }

  /** The headers the member app on `tenant`'s hostname sends for a signed-out visitor. */
  const memberApp = (tenant: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('client', tenant),
    'X-Forwarded-For': harnessAddress(),
  })

  /** `signedIn`'s token, presented from `tenant`'s member app instead of its own. */
  const presentedAt = (signedIn: Record<string, string>, tenant: { slug: string }): Record<string, string> => ({
    ...memberApp(tenant),
    Authorization: signedIn.Authorization!,
  })

  async function expectStatus(res: Response, status: number, error?: string): Promise<Record<string, any>> {
    const text = await res.text()
    assert.equal(res.status, status, text)
    const body = text ? (JSON.parse(text) as Record<string, any>) : {}
    if (error !== undefined) assert.equal(body.error, error, text)
    return body
  }

  const send = (path: string, headers: Record<string, string>, body?: unknown) =>
    harness.app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? headers : { ...headers, ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  /* ── fixtures ───────────────────────────────────────────────────────── */

  async function staffAt(tenant: { id: string; slug: string }, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${role}-${tenant.slug}`)
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, tenant.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: `${NAME} ${role}`, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    return { id: row!.id, headers }
  }

  /** One studio's own catalogue: a Location of its own, a class, packages of every kind, merch, a workshop. */
  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const admin = await staffAt(tenant, 'admin')
    const instructor = await staffAt(tenant, 'instructor')
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `${NAME} ${tenant.slug} Location` })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `${NAME} room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    const [classType] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: `${NAME} ${tenant.slug} type` })
      .returning({ id: schema.classTypes.id })
    const startsAt = new Date(Math.floor((Date.now() + 2 * DAY) / HOUR) * HOUR)
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: tenant.id,
        classTypeId: classType!.id,
        mainInstructorId: instructor.id,
        locationId: location!.id,
        roomId: room!.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: instructor.id,
      })
      .returning({ id: schema.classes.id })
    const [classPackage] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: tenant.id, name: `${NAME} ${tenant.slug} pass`, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00', status: 'active' })
      .returning({ id: schema.classPackages.id })
    const [ptPackage] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: `${NAME} ${tenant.slug} PT 1on1`, sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00' })
      .returning({ id: schema.ptPackages.id })
    const [ptPackage2on1] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: tenant.id, name: `${NAME} ${tenant.slug} PT 2on1`, sessionType: '2on1', numSessions: 6, validityDays: 90, priceSgd: '600.00' })
      .returning({ id: schema.ptPackages.id })
    const [corporate] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: tenant.id, name: `${NAME} ${tenant.slug} corporate`, priceSgd: '900.00', createdByStaffId: admin.id })
      .returning({ id: schema.corporatePackages.id })
    const [merch] = await harness.db
      .insert(schema.merch)
      .values({ tenantId: tenant.id, title: `${NAME} ${tenant.slug} towel`, priceSgd: '30.00' })
      .returning({ id: schema.merch.id })
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: tenant.id, name: `${NAME} ${tenant.slug} workshop`, locationId: location!.id, createdByStaffId: admin.id })
      .returning({ id: schema.workshops.id })
    const dayStarts = new Date(startsAt.getTime() + 10 * DAY)
    await harness.db.insert(schema.workshopDays).values({
      tenantId: tenant.id,
      workshopId: workshop!.id,
      ord: 1,
      roomId: room!.id,
      startsAt: dayStarts,
      endsAt: new Date(dayStarts.getTime() + HOUR),
      basePriceSgd: '80.00',
      capacityOnline: 10,
    })
    return {
      ...tenant,
      locationId: location!.id,
      roomId: room!.id,
      classTypeId: classType!.id,
      admin,
      instructor,
      classId: cls!.id,
      classPackageId: classPackage!.id,
      ptPackageId: ptPackage!.id,
      ptPackage2on1Id: ptPackage2on1!.id,
      corporatePackageId: corporate!.id,
      merchId: merch!.id,
      workshopId: workshop!.id,
    }
  }

  /** A member signed in on `at`'s member app, holding nothing yet. `email` makes the same person a member of a second studio. */
  async function member(at: { id: string; slug: string }, name: string, email = emailFor(name)): Promise<Member> {
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, email, headers }
  }

  /** A Dormant package the member holds at `at`, as a purchase there leaves it. */
  async function give(at: Studio, clientId: string, kind: 'credit_bundle' | 'pt' | 'pt2on1', credits: number): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId,
        kind: kind === 'credit_bundle' ? 'credit_bundle' : 'pt',
        sourceClassPackageId: kind === 'credit_bundle' ? at.classPackageId : null,
        sourcePtPackageId: kind === 'pt' ? at.ptPackageId : kind === 'pt2on1' ? at.ptPackage2on1Id : null,
        validityDays: 90,
        creditsOrSessionsRemaining: credits,
        active: true,
        amountPaidSgd: '100.00',
        listPriceSgd: '100.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  /* ── state ──────────────────────────────────────────────────────────── */

  async function packageRow(id: string) {
    const [row] = await harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.id, id))
    assert.ok(row, `no package ${id}`)
    return row
  }

  /** Everything the credit ledger holds about a package: its adjustments and its Credit movements. */
  async function ledgerOf(packageId: string) {
    const adjustments = await harness.db
      .select({ id: schema.manualAdjustments.id })
      .from(schema.manualAdjustments)
      .where(eq(schema.manualAdjustments.clientPackageId, packageId))
    const movements = await harness.db
      .select({ id: schema.creditMovements.id })
      .from(schema.creditMovements)
      .where(eq(schema.creditMovements.clientPackageId, packageId))
    return { adjustments: adjustments.length, movements: movements.length }
  }

  const ptRequestsOf = (clientId: string) =>
    harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.clientId, clientId))

  /** A date the studio's Book in advance window admits, as the request form would offer it. */
  async function proposableDate(at: Studio): Promise<string> {
    const window = await expectStatus(await send('/api/v1/public/pt-booking-config', memberApp(at)), 200)
    const days = Math.min(window.book_in_advance_days as number, (window.min_book_in_advance_days as number) + 1)
    const { sgToday } = await import('../lib/time')
    const today = sgToday(new Date())
    const [y, m, d] = today.split('-').map(Number) as [number, number, number]
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ discardedMail } = await import('../lib/mailer'))
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    try {
      const ours = `%@${DOMAIN}`
      const like = `${NAME}%`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      const requests = sql`SELECT id FROM pt_requests WHERE client_id IN (${clients})`
      await harness.db.execute(sql`DELETE FROM pt_request_slots WHERE pt_request_id IN (${requests})`)
      await harness.db.execute(sql`DELETE FROM pt_requests WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM credit_movements WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM manual_adjustments WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM cancellations WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (SELECT id FROM workshops WHERE name LIKE ${like})`)
      await harness.db.execute(sql`DELETE FROM workshops WHERE name LIKE ${like}`)
      await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE ${like}`)
      await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${like}`)
      await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${like}`)
      await harness.db.execute(sql`DELETE FROM corporate_packages WHERE name LIKE ${like}`)
      await harness.db.execute(sql`DELETE FROM merch WHERE title LIKE ${like}`)
      await harness.db.execute(sql`DELETE FROM rooms WHERE name LIKE ${like}`)
      await harness.db.execute(sql`DELETE FROM locations WHERE name LIKE ${like}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  /* ── browsing ───────────────────────────────────────────────────────── */

  /**
   * Every list the member app reads, the table each listed id lives in, and
   * the id of the studio's own fixture it must carry.
   */
  const catalogue: Array<{ path: string; key: string; table: string; own: (s: Studio) => string }> = [
    { path: '/api/v1/public/locations', key: 'locations', table: 'locations', own: s => s.locationId },
    { path: '/api/v1/public/classes', key: 'classes', table: 'classes', own: s => s.classId },
    { path: '/api/v1/public/class-types', key: 'class_types', table: 'class_types', own: s => s.classTypeId },
    { path: '/api/v1/public/instructors', key: 'instructors', table: 'staff_users', own: s => s.instructor.id },
    { path: '/api/v1/public/merch', key: 'merch', table: 'merch', own: s => s.merchId },
    { path: '/api/v1/public/packages', key: 'class_packages', table: 'class_packages', own: s => s.classPackageId },
    { path: '/api/v1/public/packages', key: 'pt_packages', table: 'pt_packages', own: s => s.ptPackageId },
    { path: '/api/v1/public/corporate-packages', key: 'corporate_packages', table: 'corporate_packages', own: s => s.corporatePackageId },
    { path: '/api/v1/me/classes', key: 'classes', table: 'classes', own: s => s.classId },
    { path: '/api/v1/me/class-packages', key: 'class_packages', table: 'class_packages', own: s => s.classPackageId },
    { path: '/api/v1/me/pt-packages', key: 'pt_packages', table: 'pt_packages', own: s => s.ptPackageId },
    { path: '/api/v1/me/corporate-packages', key: 'corporate_packages', table: 'corporate_packages', own: s => s.corporatePackageId },
    { path: '/api/v1/me/workshops', key: 'workshops', table: 'workshops', own: s => s.workshopId },
  ]

  /** The Tenant each id belongs to, read from its own table. */
  async function ownersOf(table: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set()
    const rows = await harness.db.execute<{ tenant_id: string }>(
      sql`SELECT DISTINCT tenant_id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})`,
    )
    return new Set([...rows].map(r => r.tenant_id))
  }

  test('TEN-01 a member browsing the member app on a studio’s hostname is shown only that studio’s catalogue, Locations and copy', async () => {
    const settingsOf = async (tenantId: string) =>
      (await harness.db.select().from(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, tenantId)))[0]
    const originalOne = await settingsOf(one.id)
    const originalTwo = await settingsOf(two.id)
    assert.ok(originalOne && originalTwo, 'each studio holds its own settings row')
    const { forgetCachedTenants } = await import('../services/tenants/tenants')
    const copyOf = (at: Studio) => ({ tagline: `${at.slug} tagline ${run}`, copy: { hero_title: `${at.slug} hero ${run}` } })
    try {
      for (const at of [one, two]) {
        await harness.db.update(schema.tenantSettings).set(copyOf(at)).where(eq(schema.tenantSettings.tenantId, at.id))
      }
      forgetCachedTenants()

      for (const [at, other] of [[one, two], [two, one]] as const) {
        const who = await member(at, 'Gus')
        for (const { path, key, table, own } of catalogue) {
          const body = await expectStatus(await send(path, who.headers), 200)
          const ids = (body[key] as Array<{ id: string }>).map(r => r.id)
          assert.ok(ids.includes(own(at)), `${at.slug}'s own ${key} is missing from ${path}`)
          assert.ok(!ids.includes(own(other)), `${other.slug}'s ${key} is listed on ${at.slug}'s ${path}`)
          assert.deepEqual([...(await ownersOf(table, ids))], [at.id], `${path} lists ${key} of another studio`)
        }

        // Another studio's catalogue rows, asked for by id, are not there.
        await expectStatus(await send(`/api/v1/me/classes/${other.classId}`, who.headers), 404)
        await expectStatus(await send(`/api/v1/public/classes/${other.classId}`, who.headers), 404)
        await expectStatus(await send(`/api/v1/me/workshops/${other.workshopId}`, who.headers), 404)

        // The copy the member app reads off its own hostname is that studio's.
        const resolved = await expectStatus(await send(`/api/v1/public/tenants/by-slug/${at.slug}`, memberApp(at)), 200)
        assert.equal(resolved.tenant.id, at.id)
        assert.equal(resolved.settings.tagline, copyOf(at).tagline)
        assert.deepEqual(resolved.settings.copy, copyOf(at).copy)
        assert.ok(!JSON.stringify(resolved).includes(`${other.slug} tagline`) && !JSON.stringify(resolved).includes(`${other.slug} hero`))
      }

      // Another studio's member, and a staff session, are refused the signed-in catalogue.
      const theirs = await member(two, 'Hal')
      await expectStatus(await send('/api/v1/me/classes', presentedAt(theirs.headers, one)), 401, 'invalid_token')
      await expectStatus(await send('/api/v1/me/classes', presentedAt(one.admin.headers, one)), 401, 'invalid_token')
    } finally {
      for (const row of [originalOne, originalTwo]) {
        await harness.db
          .update(schema.tenantSettings)
          .set({ tagline: row.tagline, copy: row.copy })
          .where(eq(schema.tenantSettings.tenantId, row.tenantId))
      }
      forgetCachedTenants()
    }
  })

  /* ── credits ────────────────────────────────────────────────────────── */

  test('TEN-02 a Credit Bundle bought at one studio never pays at another: the booking there is refused for lack of credits', async () => {
    const email = emailFor('dee')
    const atOne = await member(one, 'Dee', email)
    const bundle = await give(one, atOne.clientId, 'credit_bundle', 10)
    const atTwo = await member(two, 'Dee', email)
    const before = { pkg: await packageRow(bundle), ledger: await ledgerOf(bundle) }
    const bookingsAtTwo = () =>
      harness.db.select().from(schema.bookings).where(and(eq(schema.bookings.tenantId, two.id), eq(schema.bookings.clientId, atTwo.clientId)))

    // Studio two's Book sheet offers no package to pay with, and its wallet holds none.
    const detail = await expectStatus(await send(`/api/v1/me/classes/${two.classId}`, atTwo.headers), 200)
    assert.deepEqual(detail.my_packages, [])
    assert.equal(detail.default_client_package_id, null)
    const wallet = await expectStatus(await send('/api/v1/me/packages', atTwo.headers), 200)
    assert.ok(!JSON.stringify(wallet).includes(bundle), "studio one's package is in studio two's wallet")

    // Booking with nothing picked, and with studio one's package picked by id.
    await expectStatus(await send('/api/v1/me/bookings/class', atTwo.headers, { class_id: two.classId }), 409, 'insufficient_credits')
    await expectStatus(
      await send('/api/v1/me/bookings/class', atTwo.headers, { class_id: two.classId, client_package_id: bundle }),
      404,
      'client_package_not_found',
    )
    // Studio one's session, and a staff session, are not members at studio two.
    await expectStatus(await send('/api/v1/me/bookings/class', presentedAt(atOne.headers, two), { class_id: two.classId }), 401, 'invalid_token')
    await expectStatus(await send('/api/v1/me/bookings/class', presentedAt(two.admin.headers, two), { class_id: two.classId }), 401, 'invalid_token')

    assert.deepEqual(await bookingsAtTwo(), [], 'no booking was made at studio two')
    assert.deepEqual(await packageRow(bundle), before.pkg, "studio one's bundle is untouched")
    assert.deepEqual(await ledgerOf(bundle), before.ledger)

    // At its own studio the same bundle pays, as it should.
    const booked = await expectStatus(await send('/api/v1/me/bookings/class', atOne.headers, { class_id: one.classId }), 201)
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, booked.booking_id))
    assert.equal(row?.clientPackageId, bundle)
    assert.equal((await packageRow(bundle)).creditsOrSessionsRemaining, 9)
  })

  /* ── registering ────────────────────────────────────────────────────── */

  /** The sign-up code the studio mails, read from the inbox as the member would. */
  async function requestCode(at: { slug: string }, email: string): Promise<string> {
    await expectStatus(
      await send('/api/v1/auth/client/email-otp/send-verification-otp', memberApp(at), { email, type: 'sign-in' }),
      200,
    )
    const otp = [...discardedMail].reverse().find(m => m.to === email)?.html.match(/>(\d{6})</)?.[1]
    assert.ok(otp, `no code was mailed to ${email}`)
    return otp
  }

  const register = async (at: { slug: string }, email: string, first: string, last: string) =>
    send('/api/v1/public/members/register', memberApp(at), {
      email,
      otp: await requestCode(at, email),
      first_name: first,
      last_name: last,
      phone: '+6591234567',
      password: `a password for ${first}`,
    })

  const clientsWith = (email: string) =>
    harness.db.select().from(schema.clients).where(eq(schema.clients.email, email)).orderBy(schema.clients.tenantId)
  const packagesOf = (clientId: string) =>
    harness.db.select().from(schema.clientPackages).where(eq(schema.clientPackages.clientId, clientId)).orderBy(schema.clientPackages.id)

  test('TEN-16 a member of one studio registers at another with the same email: a separate member there, and the first record, name and packages unchanged', async () => {
    const email = emailFor('eve')
    await expectStatus(await register(one, email, 'Eve', 'Original'), 200)
    const [atOne] = await clientsWith(email)
    assert.ok(atOne)
    const bundle = await give(one, atOne.id, 'credit_bundle', 8)
    const pt = await give(one, atOne.id, 'pt', 3)
    const before = { record: atOne, packages: await packagesOf(atOne.id), ledger: [await ledgerOf(bundle), await ledgerOf(pt)] }

    const res = await register(two, email, 'Eve', 'Second')
    const body = await expectStatus(res, 200)
    assert.ok(body.token, 'the registration signs the member in at studio two')

    const rows = await clientsWith(email)
    assert.equal(rows.length, 2, 'one member record at each studio')
    const atTwo = rows.find(r => r.tenantId === two.id)
    assert.ok(atTwo, 'a member record was written at studio two')
    assert.notEqual(atTwo.id, atOne.id)
    assert.notEqual(atTwo.authUserId, atOne.authUserId, 'a login of its own (#231)')
    assert.equal(atTwo.name, 'Eve Second')
    assert.deepEqual(await packagesOf(atTwo.id), [], 'nothing is held at studio two')

    // Studio one's record, name, packages and ledger are as they were.
    assert.deepEqual(rows.find(r => r.tenantId === one.id), before.record)
    assert.deepEqual(await packagesOf(atOne.id), before.packages)
    assert.deepEqual([await ledgerOf(bundle), await ledgerOf(pt)], before.ledger)

    // Studio two's member reads their own, empty, account; studio one's session
    // still reads the first record with its packages.
    const twoHeaders = { ...memberApp(two), Authorization: `Bearer ${body.token}` }
    const meAtTwo = await expectStatus(await send('/api/v1/me', twoHeaders), 200)
    assert.equal(meAtTwo.name, 'Eve Second')
    const walletAtTwo = await expectStatus(await send('/api/v1/me/packages', twoHeaders), 200)
    assert.ok(!JSON.stringify(walletAtTwo).includes(bundle) && !JSON.stringify(walletAtTwo).includes(pt))
    const signIn = await send('/api/v1/auth/client/sign-in/email', memberApp(one), { email, password: 'a password for Eve' })
    assert.equal(signIn.status, 200, await signIn.text())
    const oneHeaders = { ...memberApp(one), Authorization: `Bearer ${signIn.headers.get('set-auth-token')}` }
    assert.equal((await expectStatus(await send('/api/v1/me', oneHeaders), 200)).name, 'Eve Original')
    const walletAtOne = JSON.stringify(await expectStatus(await send('/api/v1/me/packages', oneHeaders), 200))
    assert.ok(walletAtOne.includes(bundle) && walletAtOne.includes(pt), "studio one's packages are still the member's there")

    // Registering at studio two again is refused, and writes nothing more.
    await expectStatus(await register(two, email, 'Eve', 'Third'), 409, 'already_member')
    assert.equal((await clientsWith(email)).length, 2)
    assert.equal((await clientsWith(email)).find(r => r.tenantId === two.id)?.name, 'Eve Second')
  })

  /* ── mail ───────────────────────────────────────────────────────────── */

  test('TEN-09 with two studios’ own wording of one template, a trigger at studio two is worded by studio two’s row, never studio one’s', async () => {
    const template = (tenantId: string) =>
      harness.db
        .select()
        .from(schema.emailTemplates)
        .where(and(eq(schema.emailTemplates.tenantId, tenantId), eq(schema.emailTemplates.slug, 'sign_in_code')))
    const [originalOne] = await template(one.id)
    const [originalTwo] = await template(two.id)
    assert.ok(originalOne && originalTwo, 'each studio holds its own sign_in_code row')
    const wording = (at: Studio) => ({
      subject: `Your ${at.slug} code ${run}`,
      bodyHtml: `<p>wording-of-${at.slug}-${run}</p><p><b>{{code}}</b></p>`,
    })
    try {
      for (const [at, row] of [[one, originalOne], [two, originalTwo]] as const) {
        await harness.db.update(schema.emailTemplates).set(wording(at)).where(eq(schema.emailTemplates.id, row.id))
      }

      const email = emailFor('fay')
      const code = await requestCode(two, email)
      const sent = discardedMail.filter(m => m.to === email)
      assert.equal(sent.length, 1, 'one email for one trigger')
      assert.equal(sent[0]!.subject, wording(two).subject)
      assert.ok(sent[0]!.html.includes(`wording-of-${two.slug}-${run}`), "studio two's body was sent")
      assert.ok(!sent[0]!.html.includes(`wording-of-${one.slug}-${run}`), "studio one's wording reached studio two's member")
      assert.ok(!sent[0]!.subject.includes(one.slug))
      assert.ok(sent[0]!.html.includes(code))

      const logged = await harness.db.select().from(schema.emailLog).where(eq(schema.emailLog.recipientEmail, email))
      assert.deepEqual(
        logged.map(r => [r.tenantId, r.templateSlug, r.subjectRendered]),
        [[two.id, 'sign_in_code', wording(two).subject]],
      )
      assert.ok(!logged[0]!.bodyRendered.includes(`wording-of-${one.slug}`))
    } finally {
      for (const row of [originalOne, originalTwo]) {
        await harness.db
          .update(schema.emailTemplates)
          .set({ subject: row.subject, bodyHtml: row.bodyHtml })
          .where(eq(schema.emailTemplates.id, row.id))
      }
    }
  })

  /* ── PT requests ────────────────────────────────────────────────────── */

  test('TEN-12 a PT request naming another studio’s partner, Location or class type is refused, and nothing is written or debited', async () => {
    const ana = await member(one, 'Ana')
    const pack = await give(one, ana.clientId, 'pt2on1', 6)
    const ownPartner = await member(one, 'Ben')
    const theirs = await member(two, 'Cy')
    const slots = [{ proposedDate: await proposableDate(one), startTime: '10:00' }]
    const request = (overrides: Record<string, unknown>) =>
      send('/api/v1/me/pt-sessions/request', ana.headers, {
        classTypeId: one.classTypeId,
        locationId: one.locationId,
        sessionType: '2on1',
        clientPackageId: pack,
        slots,
        partner: { kind: 'existing', coClientId: ownPartner.clientId },
        ...overrides,
      })
    const before = { pkg: await packageRow(pack), ledger: await ledgerOf(pack) }

    await expectStatus(await request({ partner: { kind: 'existing', coClientId: theirs.clientId } }), 404, 'partner_client_not_found')
    await expectStatus(await request({ locationId: two.locationId }), 404, 'location_not_found')
    await expectStatus(await request({ classTypeId: two.classTypeId }), 404, 'class_type_not_found')

    // The other studio's member, and a staff session, cannot file one here at all.
    await expectStatus(
      await send('/api/v1/me/pt-sessions/request', presentedAt(theirs.headers, one), { locationId: one.locationId }),
      401,
      'invalid_token',
    )
    await expectStatus(
      await send('/api/v1/me/pt-sessions/request', presentedAt(one.admin.headers, one), { locationId: one.locationId }),
      401,
      'invalid_token',
    )

    assert.deepEqual(await ptRequestsOf(ana.clientId), [], 'no PT request was written')
    assert.deepEqual(await packageRow(pack), before.pkg, 'no session was debited')
    assert.deepEqual(await ledgerOf(pack), before.ledger, 'no ledger row was written')
    assert.deepEqual(await ptRequestsOf(theirs.clientId), [])

    // The same request, naming this studio's own partner, Location and class
    // type, is filed: the refusals above were the borrowed ids, nothing else.
    const filed = await expectStatus(await request({}), 201)
    const [row] = await ptRequestsOf(ana.clientId)
    assert.equal(row?.id, filed.pt_request_id)
    assert.equal(row?.tenantId, one.id)
    assert.equal(row?.coClientId, ownPartner.clientId)
    assert.equal((await packageRow(pack)).creditsOrSessionsRemaining, 4)
  })
})
