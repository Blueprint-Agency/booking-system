import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, integrationTestsEnabled, SKIP_REASON, startTestApp, inTenantContext, type TestApp } from '../../../src/test/harness'

const OPERATOR = 'mindbody-operator@platform.test'
process.env.PLATFORM_ADMIN_EMAIL = OPERATOR

/**
 * The Mindbody migration's first slice, end to end, at the one seam that
 * matters: fixture reports and a fixture config go through the transform, the
 * zip goes through the super portal's own import route into a Tenant
 * provisioned the way the runbook says (no first admin), and everything after
 * that is asked of the platform the way a member, an admin or the operator
 * would ask it. Nothing here reads the transform's row JSON.
 *
 * The fixture studio and its people are invented (`fixtures/` beside this file).
 */
describe('a Mindbody studio, transformed and imported', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../../../src/db/schema')
  let provision!: typeof import('../../../src/services/tenants/provision')
  let tenants!: typeof import('../../../src/services/tenants/tenants')
  let transform!: typeof import('./transform')
  let ensureAuthUser!: typeof import('../../../src/services/auth/auth-users')['ensureAuthUser']
  let operator!: Record<string, string>

  const FIXTURES = path.join(__dirname, 'fixtures')
  const run = Date.now().toString(36)
  let studios = 0

  before(async () => {
    harness = await startTestApp()
    schema = await import('../../../src/db/schema')
    provision = await import('../../../src/services/tenants/provision')
    tenants = await import('../../../src/services/tenants/tenants')
    transform = await import('./transform')
    ;({ ensureAuthUser } = await import('../../../src/services/auth/auth-users'))
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    await harness?.close()
  })

  /** A change to the fixture config, for a studio that wants something else of it. */
  type Edit = (config: Record<string, any>) => void

  /** The fixture, transformed for one Tenant. */
  async function transformFor(tenant: { id: string; slug: string }, edit?: Edit) {
    const config = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as Record<string, any>
    config.studio.slug = tenant.slug
    // The links in the email copy are this environment's, as they would be on staging.
    config.originPatterns = process.env.TENANT_ORIGIN_PATTERNS
    edit?.(config)
    return transform.transformMindbody({ reportsDir: path.join(FIXTURES, 'reports'), config, tenantId: tenant.id })
  }

  /** A Tenant provisioned the way the runbook says — no first admin — and the fixture transformed for it. */
  async function transformedStudio(edit?: Edit) {
    const slug = `mb-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Mindbody Fixture Studio' })
    return { tenant, slug, ...(await transformFor(tenant, edit)) }
  }

  /** The studio as it is with its past brought across from a cutoff (#181). */
  const withHistory = (purchases = false): Edit => config => {
    config.history = { from: '2026-06-01', purchases }
  }

  async function importZip(tenantId: string, zip: Buffer) {
    const form = new FormData()
    form.append('archive', new File([new Uint8Array(zip)], 'studio.zip', { type: 'application/zip' }))
    const res = await harness.app.request(`/api/v1/platform/tenants/${tenantId}/import`, {
      method: 'POST',
      headers: operator,
      body: form,
    })
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }

  const get = (url: string, headers: Record<string, string>) => harness.app.request(url, { headers })
  const post = (url: string, headers: Record<string, string>) =>
    harness.app.request(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })

  const count = async (table: string, tenantId: string) => {
    const [row] = await harness.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`,
    )
    return row!.n
  }

  test('the zip imports into a freshly provisioned studio, which opens, and its people can sign in', async () => {
    // A member who is already on the platform — at another studio, say — has
    // an account before the import. The import must reuse it, not make another.
    const existing = await ensureAuthUser(harness.db, 'client', { email: 'ada.reuse@example.test', name: 'Ada Reuse' })

    const studio = await transformedStudio()
    assert.equal((await tenants.loadTenantById(studio.tenant.id))?.status, 'suspended')

    const imported = await importZip(studio.tenant.id, studio.zip)
    assert.equal(imported.status, 200, JSON.stringify(imported.body))
    assert.equal(imported.body.opened, true, 'the archive brought an admin, so the studio opens')
    assert.equal(imported.body.remapped, false, 'ids are kept as the transform wrote them')
    assert.equal((await tenants.loadTenantById(studio.tenant.id))?.status, 'active')

    // A member signs in with the email they used at the studio, and is themselves.
    const jane = await harness.signInAs('client', 'jane.doe@example.test', studio)
    const me = await get('/api/v1/me', jane)
    assert.equal(me.status, 200, await me.clone().text())
    assert.equal(((await me.json()) as { name: string }).name, 'Jane Doe')

    const [ada] = await harness.db
      .select({ authUserId: schema.clients.authUserId })
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, studio.tenant.id), eq(schema.clients.email, 'ada.reuse@example.test')))
    assert.equal(ada?.authUserId, existing, 'an email already on the platform keeps its one account')

    // The owner is an active Admin from the first minute.
    const owner = await harness.signInAs('staff', 'owner@example.test', studio)
    const ownerMe = await get('/api/v1/portal/auth/me', owner)
    assert.equal(ownerMe.status, 200, await ownerMe.clone().text())
    assert.equal(((await ownerMe.json()) as { role: string }).role, 'admin')

    // Everyone else is pending, with an invitation the owner can resend.
    const listed = await get('/api/v1/portal/admin/staff', owner)
    assert.equal(listed.status, 200, await listed.clone().text())
    const { invitations } = (await listed.json()) as { invitations: { id: string; email: string; status: string }[] }
    assert.deepEqual(
      invitations.map(i => i.email).sort(),
      ['frank@example.test', 'ivy@example.test'],
    )
    const ivy = invitations.find(i => i.email === 'ivy@example.test')!
    const resent = await post(`/api/v1/portal/admin/staff/invitations/${ivy.id}/resend`, owner)
    assert.equal(resent.status, 200, await resent.clone().text())

    // A teacher who is only history is archived, and cannot get in.
    const oldTeacherEmail = studio.archive.rows.staff_users!.find(r => r.status === 'archived')!.email as string
    const oldTeacher = await harness.signInAs('staff', oldTeacherEmail, studio)
    const refused = await get('/api/v1/portal/auth/me', oldTeacher)
    assert.equal(refused.status, 403, await refused.clone().text())

    // The studio shell.
    const rooms = await harness.db
      .select({ name: schema.rooms.name, capacity: schema.rooms.capacity })
      .from(schema.rooms)
      .where(eq(schema.rooms.tenantId, studio.tenant.id))
    assert.deepEqual(
      rooms.map(r => `${r.name}:${r.capacity}`).sort(),
      ['Hot Room:15', 'Riverside Studio:12', 'Studio 2 - Normal Room:20'],
    )
    assert.equal(await count('locations', studio.tenant.id), 2)
    // Hatha and Vinyasa Flow, plus the Personal Training focus the PT import needs.
    assert.equal(await count('class_types', studio.tenant.id), 3)
    assert.equal(await count('email_templates', studio.tenant.id), 33)
    assert.equal(await count('clients', studio.tenant.id), 8)

    // A member cancellation reads the policy, and finds the studio's own.
    const policy = inTenantContext(await import('../../../src/services/policy/evaluate-cancellation'))
    const [client] = await harness.db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, studio.tenant.id), eq(schema.clients.email, 'jane.doe@example.test')))
    const verdict = await policy.evaluateCancellation({
      tenantId: studio.tenant.id,
      clientId: client!.id,
      kind: 'class',
      sessionStartsAt: new Date(Date.now() + 48 * 3_600_000),
      now: new Date(),
    })
    assert.equal(verdict.windowHours, 12)
  })

  test('every admin the config lists signs in to the portal as an Admin, with no invitation to accept', async () => {
    const studio = await transformedStudio(config => {
      config.studio.admins = [
        { email: 'owner@example.test', name: null },
        { email: 'helper@agency.example', name: 'Agency Helper' },
      ]
    })
    const imported = await importZip(studio.tenant.id, studio.zip)
    assert.equal(imported.status, 200, JSON.stringify(imported.body))

    for (const email of ['owner@example.test', 'helper@agency.example']) {
      const admin = await harness.signInAs('staff', email, studio)
      const me = await get('/api/v1/portal/auth/me', admin)
      assert.equal(me.status, 200, `${email}: ${await me.clone().text()}`)
      assert.equal(((await me.json()) as { role: string }).role, 'admin', email)
    }
    const helper = await harness.signInAs('staff', 'helper@agency.example', studio)
    const listed = await get('/api/v1/portal/admin/staff', helper)
    assert.equal(listed.status, 200, await listed.clone().text())
    const { invitations } = (await listed.json()) as { invitations: { email: string }[] }
    assert.ok(!invitations.some(i => i.email === 'helper@agency.example'), 'an admin who can already sign in is not invited')
  })

  test('staff onboarded on import: active by name, no invitations, a first password by reset; no email means no login', async () => {
    const studio = await transformedStudio(config => {
      config.staffOnboarding = 'active'
      config.staff.push({ mindbodyName: 'Nora Noemail', migrate: 'active', email: null, role: 'instructor', teaches: true, noLogin: true })
    })
    const imported = await importZip(studio.tenant.id, studio.zip)
    assert.equal(imported.status, 200, JSON.stringify(imported.body))

    const owner = await harness.signInAs('staff', 'owner@example.test', studio)
    const listed = await get('/api/v1/portal/admin/staff', owner)
    assert.equal(listed.status, 200, await listed.clone().text())
    const { staff, invitations } = (await listed.json()) as {
      staff: { id: string; name: string; email: string; role: string; status: string }[]
      invitations: unknown[]
    }
    assert.deepEqual(invitations, [], 'nobody is waiting on an invitation')
    const byName = new Map(staff.map(s => [s.name, s]))
    assert.deepEqual([byName.get('Ivy Instructor')?.status, byName.get('Ivy Instructor')?.role], ['active', 'instructor'])
    const nora = byName.get('Nora Noemail')!
    assert.deepEqual([nora.status, nora.role], ['active', 'instructor'], 'listed by name among the instructors')

    // Ivy has no password yet: she asks for a reset on her studio's portal, follows the link, and is in.
    const { discardedMail } = await import('../../../src/lib/mailer')
    const portal = { 'X-Tenant-Slug': studio.slug, Origin: frontendOrigin('staff', studio) }
    const json = { ...portal, 'Content-Type': 'application/json' }
    const requested = await harness.app.request('/api/v1/auth/staff/request-password-reset', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'ivy@example.test', redirectTo: `${portal.Origin}/reset-password` }),
    })
    assert.equal(requested.status, 200, await requested.clone().text())
    const mail = [...discardedMail].reverse().find(m => m.to === 'ivy@example.test')
    assert.ok(mail, 'the reset went to Ivy (the test transport, never Resend)')
    const link = new URL(mail.html.match(/href="([^"]*\/reset-password\/[^"]+)"/)![1]!.replace(/&amp;/g, '&'))
    const opened = await harness.app.request(link.pathname + link.search)
    const token = new URL(opened.headers.get('location')!).searchParams.get('token')!
    const reset = await harness.app.request('/api/v1/auth/staff/reset-password', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ token, newPassword: 'correct horse battery staple' }),
    })
    assert.equal(reset.status, 200, await reset.clone().text())
    const signedIn = await harness.app.request('/api/v1/auth/staff/sign-in/email', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'ivy@example.test', password: 'correct horse battery staple' }),
    })
    assert.equal(signedIn.status, 200, await signedIn.clone().text())
    const me = await get('/api/v1/portal/auth/me', { ...portal, Authorization: `Bearer ${signedIn.headers.get('set-auth-token')}` })
    assert.equal(me.status, 200, await me.clone().text())
    assert.equal(((await me.json()) as { role: string }).role, 'instructor')

    // Nora has no mailbox: no set-password link is sent anywhere.
    const before = discardedMail.length
    const refused = await post(`/api/v1/portal/admin/staff/${nora.id}/resend-invitation`, owner)
    assert.equal(refused.status, 400, await refused.clone().text())
    assert.equal(discardedMail.length, before)
  })

  /* ── Packages (#178) ─────────────────────────────────────────────────────── */

  type MemberPackage = {
    id: string
    kind: string
    package_name: string
    credits_or_sessions_remaining: number | null
    expires_at: string | null
    active: boolean
    dormant: boolean
    validity_days: number | null
    unlimited_location: { name: string } | string | null
    cross_location_paid_sgd: string | null
  }

  /** A studio imported and open, with what the tests below need to put a class on its timetable. */
  async function importedStudio(edit?: Edit) {
    const studio = await transformedStudio(edit)
    const imported = await importZip(studio.tenant.id, studio.zip)
    assert.equal(imported.status, 200, JSON.stringify(imported.body))

    const tenantId = studio.tenant.id
    const classesSvc = inTenantContext(await import('../../../src/services/schedule/classes'))
    const [owner] = await harness.db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.tenantId, tenantId), eq(schema.staffUsers.email, 'owner@example.test')))
    // A class is taught by someone whose role is instructor; the owner is an Admin.
    const [ivy] = await harness.db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.tenantId, tenantId), eq(schema.staffUsers.email, 'ivy@example.test')))
    const rooms = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.tenantId, tenantId))
    // By name: the imported PT focus is a Class Type too, and no class is held under it.
    const [classType] = await harness.db
      .select()
      .from(schema.classTypes)
      .where(and(eq(schema.classTypes.tenantId, tenantId), eq(schema.classTypes.name, 'Hatha')))
    let classes = 0

    /** A class a few days out, in the named room. */
    const newClass = async (roomName: string) => {
      const room = rooms.find(r => r.name === roomName)!
      const startsAt = new Date(Date.now() + (3 + classes++) * 24 * 3_600_000)
      const cls = await classesSvc.createClass(tenantId, {
        classTypeId: classType!.id,
        mainInstructorId: ivy!.id,
        locationId: room.locationId,
        roomId: room.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        capacityOnline: 10,
        capacityWaitlist: 0,
        capacityBuffer: 0,
        creditCost: 1,
        instructorPaySgd: 50,
        createdByStaffId: owner!.id,
      })
      return cls.id
    }

    const member = async (email: string) => {
      const headers = await harness.signInAs('client', email, studio)
      const packages = async () => {
        const res = await get('/api/v1/me/packages', headers)
        assert.equal(res.status, 200, await res.clone().text())
        return ((await res.json()) as { client_packages: MemberPackage[] }).client_packages
      }
      const book = async (classId: string) => {
        const res = await harness.app.request('/api/v1/me/bookings/class', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ class_id: classId }),
        })
        const body = (await res.json()) as Record<string, any>
        assert.equal(res.status, 201, JSON.stringify(body))
        return body.booking_id as string
      }
      const cancel = async (bookingId: string) => {
        const res = await harness.app.request(`/api/v1/me/bookings/${bookingId}`, { method: 'DELETE', headers })
        assert.equal(res.status, 200, await res.clone().text())
        return (await res.json()) as { refund_outcome: string }
      }
      return { headers, packages, book, cancel }
    }

    return { ...studio, tenantId, ownerId: owner!.id, newClass, member }
  }

  test('CXL-01 a migrated class pack keeps its credits and expiry; booking spends one and cancelling returns it', async () => {
    const studio = await importedStudio()
    const jane = await studio.member('jane.doe@example.test')
    const pack = async () => (await jane.packages()).find(p => p.package_name === 'Class Pack - Bundle of 10')!

    const before = await pack()
    assert.equal(before.credits_or_sessions_remaining, 5, 'six left in Mindbody, one of them already booked')
    assert.equal(before.expires_at, '2090-03-01T15:59:59.000Z')
    assert.equal(before.dormant, false)

    const bookingId = await jane.book(await studio.newClass('Hot Room'))
    assert.equal((await pack()).credits_or_sessions_remaining, 4)

    const cancelled = await jane.cancel(bookingId)
    assert.equal(cancelled.refund_outcome, 'credit_returned')
    assert.equal((await pack()).credits_or_sessions_remaining, 5)
  })

  test('a second live class pack waits Dormant, and starts with the days it had left once the first is gone', async () => {
    const studio = await importedStudio()
    const adjust = inTenantContext(await import('../../../src/services/packages/adjust'))
    const jane = await studio.member('jane.doe@example.test')
    const [client] = await harness.db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, studio.tenantId), eq(schema.clients.email, 'jane.doe@example.test')))

    const held = await jane.packages()
    const first = held.find(p => p.package_name === 'Class Pack - Bundle of 10')!
    const second = held.find(p => p.package_name === 'Class Pack - Bundle of 20')!
    assert.deepEqual([second.dormant, second.expires_at, second.credits_or_sessions_remaining], [true, null, 20])
    const daysLeft = second.validity_days!
    assert.ok(daysLeft > 20_000, 'the days it had left on the day of the download, not the 120 the catalogue sells')

    // While the first runs it is the only one that pays.
    await jane.book(await studio.newClass('Hot Room'))
    assert.equal((await jane.packages()).find(p => p.id === second.id)!.credits_or_sessions_remaining, 20)

    // The first is used up; the next booking starts the second.
    await adjust.setBalance({
      tenantId: studio.tenantId,
      clientId: client!.id,
      clientPackageId: first.id,
      balance: 0,
      reason: 'used up, for the test',
      actedByStaffId: studio.ownerId,
    })
    const bookedAt = Date.now()
    await jane.book(await studio.newClass('Hot Room'))
    const started = (await jane.packages()).find(p => p.id === second.id)!
    assert.equal(started.credits_or_sessions_remaining, 19)
    assert.equal(started.dormant, false)
    const runsFor = (new Date(started.expires_at!).getTime() - bookedAt) / 86_400_000
    assert.ok(Math.abs(runsFor - daysLeft) < 1, `runs ${daysLeft} days from its first booking, not ${runsFor}`)
  })

  test('a migrated Unlimited Plan keeps its expiry and Home Location, and with a migrated access pass covers both', async () => {
    const studio = await importedStudio()
    const rick = await studio.member('rick.roe@example.test')
    const [plan, ...others] = await rick.packages()
    assert.deepEqual(others, [])
    assert.deepEqual([plan!.kind, plan!.expires_at, plan!.cross_location_paid_sgd], ['unlimited', '2090-02-01T15:59:59.000Z', '120.00'])
    assert.match(JSON.stringify(plan!.unlimited_location), /Main Hall/)

    await rick.book(await studio.newClass('Hot Room'))
    await rick.book(await studio.newClass('Riverside Studio'))
  })

  test('a migrated PT package keeps its sessions and expiry', async () => {
    const studio = await importedStudio()
    const mei = await studio.member('mei@example.test')
    const [pt] = await mei.packages()
    assert.deepEqual(
      [pt!.kind, pt!.package_name, pt!.credits_or_sessions_remaining, pt!.expires_at],
      ['pt', 'PT - Bundle of 10', 7, '2090-04-01T15:59:59.000Z'],
    )
  })

  test('a ClassPass member s live pass is a $0 package that books a class', async () => {
    const studio = await importedStudio()
    const ada = await studio.member('ada.reuse@example.test')
    const [pass] = await ada.packages()
    assert.deepEqual([pass!.package_name, pass!.credits_or_sessions_remaining], ['ClassPass', 1])
    await ada.book(await studio.newClass('Hot Room'))
    assert.equal((await ada.packages())[0]!.credits_or_sessions_remaining, 0)
  })

  test('a member who had a trial in Mindbody cannot have another', async () => {
    const studio = await importedStudio()
    const comp = inTenantContext(await import('../../../src/services/packages/complimentary'))
    const [jane] = await harness.db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, studio.tenantId), eq(schema.clients.email, 'jane.doe@example.test')))
    const [trial] = await harness.db
      .select({ id: schema.classPackages.id })
      .from(schema.classPackages)
      .where(and(eq(schema.classPackages.tenantId, studio.tenantId), eq(schema.classPackages.kind, 'trial')))

    await assert.rejects(
      comp.giveComplimentaryPackage(studio.tenantId, {
        clientId: jane!.id,
        packageKind: 'class',
        packageId: trial!.id,
        reason: 'a second trial',
        actedByStaffId: studio.ownerId,
      }),
      (err: { code?: string }) => err.code === 'trial_already_used',
    )
    const jane2 = await studio.member('jane.doe@example.test')
    const res = await get('/api/v1/me/packages', jane2.headers)
    assert.equal(((await res.json()) as { entitlements: { trial_used: boolean } }).entitlements.trial_used, true)
  })

  test('sell products are on sale at the config s price; legacy ones are not on sale', async () => {
    const studio = await importedStudio()
    // Signed out, as the studio's own site would ask.
    const res = await get('/api/v1/public/packages', { Origin: frontendOrigin('client', studio), 'X-Tenant-Slug': studio.slug })
    assert.equal(res.status, 200, await res.clone().text())
    const body = (await res.json()) as { class_packages: { name: string; price_sgd: string }[]; pt_packages: { name: string; price_sgd: string }[] }
    assert.deepEqual(
      body.class_packages.map(p => `${p.name}:${p.price_sgd}`).sort(),
      ['2 Trial Classes:10.00', 'Class Pack - Bundle of 10:260.00', 'Unlimited 12:1700.00'],
      'Bundle of 20 and ClassPass are legacy: held, and not sold',
    )
    assert.deepEqual(body.pt_packages.map(p => `${p.name}:${p.price_sgd}`), ['PT - Bundle of 10:1200.00'])
  })

  /* ── The timetable to come (#179) ──────────────────────────────────────── */

  /** The whole imported timetable, as the portal lists it. */
  const timetableOf = async (headers: Record<string, string>, query = '') => {
    const res = await get(`/api/v1/portal/admin/schedule?from=2089-12-01&to=2090-03-01${query}`, headers)
    assert.equal(res.status, 200, await res.clone().text())
    return ((await res.json()) as { entries: Record<string, any>[] }).entries
  }

  test('the imported timetable is in the portal, empty classes and all, with its room, capacity and pay', async () => {
    const studio = await importedStudio()
    const owner = await harness.signInAs('staff', 'owner@example.test', studio)
    const entries = await timetableOf(owner)

    const classes = entries.filter(e => e.kind === 'class')
    assert.equal(classes.length, 5)
    const rooms = await harness.db.select().from(schema.rooms).where(eq(schema.rooms.tenantId, studio.tenantId))
    const hotRoom = rooms.find(r => r.name === 'Hot Room')!

    const hatha = classes.find(e => e.starts_at === '2090-01-02T11:00:00.000Z')!
    assert.deepEqual([hatha.label, hatha.room_id, hatha.capacity, hatha.booked_count], ['Hatha', hotRoom.id, 15, 2])

    // Nobody booked it in Mindbody, and it is still on the timetable.
    const empty = classes.find(e => e.starts_at === '2090-01-23T11:00:00.000Z')!
    assert.equal(empty.booked_count, 0)

    // The pay is on the class itself, which the list does not carry.
    const detail = await get(`/api/v1/portal/admin/schedule/classes/${hatha.id}`, owner)
    assert.equal(detail.status, 200, await detail.clone().text())
    const body = (await detail.json()) as Record<string, any>
    assert.equal(body.instructor_pay_sgd, 35)
    assert.equal(body.credit_cost, 1)

    // Olive is paid per head in Mindbody, which the platform has no rate for.
    const unpriced = classes.find(e => e.starts_at === '2090-01-03T02:00:00.000Z')!
    const covered = await get(`/api/v1/portal/admin/schedule/classes/${unpriced.id}`, owner)
    assert.equal(((await covered.json()) as Record<string, any>).instructor_pay_sgd, null)
  })

  test('CXL-01 an imported booking is the member s, with a working code, and cancelling it returns the credit', async () => {
    const studio = await importedStudio()
    const jane = await studio.member('jane.doe@example.test')
    const pack = async () => (await jane.packages()).find(p => p.package_name === 'Class Pack - Bundle of 10')!

    const res = await get('/api/v1/me/bookings/upcoming', jane.headers)
    assert.equal(res.status, 200, await res.clone().text())
    const bookings = ((await res.json()) as { bookings: Record<string, any>[] }).bookings
    const imported = bookings.find(b => b.starts_at === '2090-01-02T11:00:00.000Z')!
    assert.equal(imported.name, 'Hatha')
    assert.equal(imported.state, 'confirmed')
    assert.match(String(imported.code), /^RT-[0-9A-Z]{6}$/)

    // The code and token work: the booking reads back by its own id.
    const one = await get(`/api/v1/me/bookings/${imported.booking_id}`, jane.headers)
    assert.equal(one.status, 200, await one.clone().text())
    assert.equal(((await one.json()) as { code: string }).code, imported.code)

    assert.equal((await pack()).credits_or_sessions_remaining, 5, 'the unbooked balance: the seat was already paid for in Mindbody')
    const cancelled = await jane.cancel(imported.booking_id)
    assert.equal(cancelled.refund_outcome, 'credit_returned')
    assert.equal((await pack()).credits_or_sessions_remaining, 6)
  })

  test('an imported PT appointment is on both sides: the member s list and the instructor s schedule', async () => {
    const studio = await importedStudio()
    const mei = await harness.signInAs('client', 'mei@example.test', studio)
    const mine = await get('/api/v1/me/pt-sessions', mei)
    assert.equal(mine.status, 200, await mine.clone().text())
    const requests = ((await mine.json()) as { pt_requests: Record<string, any>[] }).pt_requests
    assert.equal(requests.length, 1)
    assert.equal(requests[0]!.status, 'scheduled')
    assert.equal(requests[0]!.session?.starts_at, '2090-01-02T01:00:00.000Z')
    assert.match(String(requests[0]!.booking?.code), /^RT-[0-9A-Z]{6}$/)

    // Olive teaches it, and sees it on her own schedule.
    const olive = await harness.signInAs('staff', 'owner@example.test', studio)
    const hers = await get('/api/v1/portal/instructor/schedule?from=2089-12-01&to=2090-03-01&type=pt', olive)
    assert.equal(hers.status, 200, await hers.clone().text())
    const entries = ((await hers.json()) as { entries: Record<string, any>[] }).entries
    assert.deepEqual(
      entries.map(e => e.starts_at),
      ['2090-01-02T01:00:00.000Z'],
    )
  })

  test('SCH-15 an imported series extends from the portal without duplicating a class that already came across', async () => {
    const studio = await importedStudio()
    const owner = await harness.signInAs('staff', 'owner@example.test', studio)
    const seriesId = studio.archive.rows.class_series![0]!.id as string

    const before = (await timetableOf(owner)).filter(e => e.series_id === seriesId).map(e => e.starts_at)
    assert.deepEqual(before.sort(), ['2090-01-02T11:00:00.000Z', '2090-01-09T11:00:00.000Z', '2090-01-23T11:00:00.000Z'])

    // Back over what is already there and on to the following Monday.
    const res = await harness.app.request(`/api/v1/portal/admin/schedule/series/${seriesId}/extend`, {
      method: 'POST',
      headers: { ...owner, 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_date: '2090-01-30' }),
    })
    assert.equal(res.status, 200, await res.clone().text())

    const after = (await timetableOf(owner)).filter(e => e.series_id === seriesId).map(e => e.starts_at)
    assert.deepEqual(
      after.sort(),
      [...before.sort(), '2090-01-30T11:00:00.000Z'],
      'the 16th stays excluded and the imported Mondays are not written twice',
    )
  })

  /* ── Workshops and retreats to come (#180) ─────────────────────────────── */

  test('an imported workshop is in the portal with its days, tiers, instructors and attendees', async () => {
    const studio = await importedStudio()
    const owner = await harness.signInAs('staff', 'owner@example.test', studio)

    // One tile per day, as the schedule renders a workshop, each carrying the
    // number of members with a place — the attendee count the admin sees.
    const days = (await timetableOf(owner)).filter(e => e.kind === 'workshop')
    assert.deepEqual(
      days.map(e => `${e.label} ${e.starts_at} day ${e.day_index} booked ${e.booked_count}`),
      [
        'Handstand Workshop 2090-01-07T01:00:00.000Z day 1 booked 2',
        'Handstand Workshop 2090-01-08T01:00:00.000Z day 2 booked 2',
      ],
    )

    const workshopId = studio.archive.rows.workshops![0]!.id as string
    const detail = await get(`/api/v1/portal/admin/workshops/${workshopId}`, owner)
    assert.equal(detail.status, 200, await detail.clone().text())
    const body = (await detail.json()) as Record<string, any>
    assert.equal(body.name, 'Handstand Workshop')
    assert.deepEqual(
      (body.tiers as Record<string, any>[]).map(t => `${t.name}:${t.regular_price_sgd}:${t.day_ids.length}`),
      ['Twin room:500.00:2', 'Single room:700.00:2'],
      'both room types, each granting both days',
    )

    // Ivy leads both days and Olive one, so Ivy is the main instructor.
    const [ivy, olive] = await Promise.all(
      ['ivy@example.test', 'owner@example.test'].map(async email => {
        const [row] = await harness.db
          .select({ id: schema.staffUsers.id })
          .from(schema.staffUsers)
          .where(and(eq(schema.staffUsers.tenantId, studio.tenantId), eq(schema.staffUsers.email, email)))
        return row!.id
      }),
    )
    assert.equal(body.main_instructor_id, ivy)
    assert.deepEqual(body.supporting_instructor_ids, [olive])
  })

  test('FIN-13 a member who paid for a workshop finds their place, and Finance finds the money', async () => {
    const studio = await importedStudio()

    // A deposit on a twin and a top-up to a single: one place, at the single room.
    const jane = await harness.signInAs('client', 'jane.doe@example.test', studio)
    const mine = await get('/api/v1/me/workshop-bookings', jane)
    assert.equal(mine.status, 200, await mine.clone().text())
    const places = ((await mine.json()) as { workshop_bookings: Record<string, any>[] }).workshop_bookings
    assert.equal(places.length, 1)
    assert.deepEqual(
      [places[0]!.workshop_name, places[0]!.tier_name, places[0]!.amount_paid_sgd, places[0]!.state],
      ['Handstand Workshop', 'Single room', '450.00', 'confirmed'],
    )
    assert.equal(new Date(places[0]!.starts_at as string).toISOString(), '2090-01-07T01:00:00.000Z')
    assert.match(String(places[0]!.code), /^RT-[0-9A-Z]{6}$/)

    // Workshop money, on the day of the download: the booking carries it.
    const owner = await harness.signInAs('staff', 'owner@example.test', studio)
    const finance = await get('/api/v1/portal/admin/finance?from=2026-09-01&to=2026-09-30', owner)
    assert.equal(finance.status, 200, await finance.clone().text())
    const rows = ((await finance.json()) as { rows: Record<string, any>[] }).rows.filter(r => r.kind === 'workshop_ticket')
    assert.deepEqual(
      rows.map(r => `${r.variant} ${r.user_name} ${r.paid_sgd} of ${r.list_price_sgd}`).sort(),
      ['Handstand Workshop Jane Doe 450 of 700', 'Handstand Workshop Rick Roe 500 of 500'],
    )
  })

  test('verify passes on a clean import, and fails naming the member when one balance is altered', async () => {
    const studio = await importedStudio()
    const exported = async () => {
      const res = await get(`/api/v1/platform/tenants/${studio.tenantId}/export`, operator)
      assert.equal(res.status, 200, await res.clone().text())
      return Buffer.from(await res.arrayBuffer())
    }
    assert.deepEqual(await transform.verifyImport(studio.expected, await exported()), [])

    await harness.db.execute(sql`
      UPDATE client_packages SET credits_or_sessions_remaining = 6
      WHERE tenant_id = ${studio.tenantId} AND kind = 'pt'
    `)
    assert.deepEqual(await transform.verifyImport(studio.expected, await exported()), [
      'PT sessions left, in total: expected 7, found 6',
      'Mei 林 <mei@example.test>: PT sessions left: expected 7, found 6',
    ])
  })

  /* ── The studio's past (#181) ──────────────────────────────────────────── */

  test('a member s past reads back as it happened: attended, a no-show, and a late cancel that is not a seat', async () => {
    const studio = await importedStudio(withHistory())
    const jane = await harness.signInAs('client', 'jane.doe@example.test', studio)
    const res = await get('/api/v1/me/bookings/past', jane)
    assert.equal(res.status, 200, await res.clone().text())
    const past = ((await res.json()) as { bookings: Record<string, any>[] }).bookings

    assert.deepEqual(
      past.map(b => `${new Date(b.starts_at as string).toISOString()} ${b.name} ${b.state}/${b.check_in_state}`).sort(),
      [
        '2026-08-24T11:00:00.000Z Hatha confirmed/attended',
        '2026-08-31T11:00:00.000Z Hatha no_show/no_show',
        // Only the roster knew this class ran, and her visit to it came across all the same.
        '2026-09-10T11:00:00.000Z Hatha confirmed/attended',
      ],
      'a late cancel is not a class she went to, and an early cancel never happened at all',
    )

    // The late cancel is a cancellation of its own, and the studio's rather
    // than hers, so her allowance on the platform starts clean. The one the
    // Cancellations report has a line for carries its real time.
    const cancelled = await harness.db
      .select({ source: schema.cancellations.source, at: schema.cancellations.cancelledAt })
      .from(schema.cancellations)
      .where(eq(schema.cancellations.tenantId, studio.tenantId))
    assert.deepEqual(
      cancelled.map(c => `${c.at.toISOString()} ${c.source}`).sort(),
      ['2026-07-06T09:30:00.000Z client', '2026-09-07T11:00:00.000Z admin'],
    )
    // Phones as sign-up writes them.
    const [janeRow] = await harness.db
      .select({ phone: schema.clients.phone })
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, studio.tenantId), eq(schema.clients.email, 'jane.doe@example.test')))
    assert.equal(janeRow?.phone, '+6591234567')
  })

  test('Class Popularity counts the imported check-ins, and Finance the pay payroll actually gave', async () => {
    const studio = await importedStudio(withHistory())
    const owner = await harness.signInAs('staff', 'owner@example.test', studio)

    const overview = await get('/api/v1/portal/admin/finance/overview?from=2026-08-01&to=2026-09-17', owner)
    assert.equal(overview.status, 200, await overview.clone().text())
    const popularity = ((await overview.json()) as { classes: Record<string, any>[] }).classes
    assert.deepEqual(
      popularity.map(c => `${c.name}: ${c.attended}`),
      ['Hatha: 3'],
      'three members were signed in at a Hatha in that window, and nobody at a Vinyasa Flow',
    )

    // Historical Instructor Pay is the studio's own money, not a rate applied
    // after the fact — and Olive, who has no per-class rate at all, still has it.
    const finance = await get('/api/v1/portal/admin/finance?from=2026-08-01&to=2026-09-17', owner)
    assert.equal(finance.status, 200, await finance.clone().text())
    const body = (await finance.json()) as { instructor_totals: Record<string, any>[]; unpriced_count: number }
    assert.deepEqual(
      body.instructor_totals.map(i => `${i.instructor_name} ${i.total_sgd} over ${i.session_count}`).sort(),
      ['Ivy Instructor 148 over 4', 'Olive Owner 56 over 2'],
    )
    // The past class payroll has no line for, and the past PT session —
    // Mindbody pays PT by percentage of the sale, which no report gives.
    assert.equal(body.unpriced_count, 2)
  })

  test('past purchases are the studio s own decision: opted in they are pre-launch revenue, and otherwise nothing', async () => {
    // Narrower than the packages members still hold, which were bought in August
    // and come across whether or not anybody asked for history.
    const period = 'from=2026-06-01&to=2026-07-15'
    const preLaunchSales = async (studio: { tenantId: string; slug: string }) => {
      const owner = await harness.signInAs('staff', 'owner@example.test', studio)
      const res = await get(`/api/v1/portal/admin/finance?${period}`, owner)
      assert.equal(res.status, 200, await res.clone().text())
      return ((await res.json()) as { rows: Record<string, any>[] }).rows
        .filter(r => r.kind === 'package_sale' || r.type === 'credit')
        .map(r => `${r.user_name} ${r.paid_sgd}`)
        .sort()
    }

    const without = await importedStudio(withHistory(false))
    assert.deepEqual(await preLaunchSales(without), [], 'nobody asked for the studio s pre-launch takings')

    const opted = await importedStudio(withHistory(true))
    assert.deepEqual(
      await preLaunchSales(opted),
      // Kim's was used up before launch but had not expired, so Visits Remaining
      // does not hold it either: money the studio took that nothing else counts.
      ['Jane Doe 250', 'Kim Lee 250', 'Rick Roe 250'],
    )
  })

  test('verify compares the studio s past as well as its future, and names the year that lost something', async () => {
    const studio = await importedStudio(withHistory(true))
    const exported = async () => {
      const res = await get(`/api/v1/platform/tenants/${studio.tenantId}/export`, operator)
      assert.equal(res.status, 200, await res.clone().text())
      return Buffer.from(await res.arrayBuffer())
    }
    assert.deepEqual(await transform.verifyImport(studio.expected, await exported()), [])

    // A visit lost on the way in is named by the year it happened in.
    await harness.db.execute(sql`
      UPDATE bookings SET check_in_state = 'pending'
      WHERE tenant_id = ${studio.tenantId} AND check_in_state = 'attended'
        AND class_id IN (SELECT id FROM classes WHERE tenant_id = ${studio.tenantId} AND starts_at < '2026-09-01')
    `)
    const differences = await transform.verifyImport(studio.expected, await exported())
    assert.ok(differences.includes('2026: visits attended: expected 3, found 1'), differences.join(' | '))
  })

  test('the same archive without the ensure-accounts flag is refused, as a restore always was', async () => {
    const studio = await transformedStudio()
    studio.archive.manifest.ensureAccounts = false
    const { packArchive } = await import('../../../src/services/tenants/transfer-archive')
    const imported = await importZip(studio.tenant.id, await packArchive(studio.archive))
    assert.equal(imported.status, 409)
    assert.match(imported.body.message, /auth_user_id/)
    assert.equal(await count('clients', studio.tenant.id), 0)
  })

  test('an archive built for one slug is refused by a studio with another', async () => {
    const studio = await transformedStudio()
    const { tenant: other } = await provision.provisionTenant({ slug: `mb-${run}-other`, name: 'Another Fixture' })
    const imported = await importZip(other.id, studio.zip)
    assert.equal(imported.status, 409)
    assert.match(imported.body.message, /built for mb-/)
    assert.equal(await count('clients', other.id), 0)
  })

  test('the transform checks every CHECK rule the database has on the tables it writes', async () => {
    const { CHECKS } = await import('./constraints')
    const studio = await transformedStudio()
    const tables = studio.archive.manifest.tables
    const found = await harness.db.execute<{ table: string; name: string }>(sql`
      SELECT c.relname AS table, o.conname AS name
      FROM pg_constraint o JOIN pg_class c ON c.oid = o.conrelid
      WHERE o.contype = 'c' AND c.relname IN ${sql.raw(`(${tables.map(t => `'${t}'`).join(',')})`)}`)
    const missing = [...found].filter(r => !CHECKS[r.table]?.[r.name]).map(r => `${r.table}.${r.name}`)
    assert.deepEqual(missing, [], 'a CHECK the transform does not test would fail an import at its very end: add it to tools/mindbody/transform/constraints.ts')
  })

  test('a row the database refuses is reported by table and rule, never as the SQL or the row', async () => {
    const studio = await transformedStudio()
    studio.archive.rows.client_packages![0]!.credits_or_sessions_remaining = -1
    const { packArchive } = await import('../../../src/services/tenants/transfer-archive')
    const imported = await importZip(studio.tenant.id, await packArchive(studio.archive))
    assert.equal(imported.status, 409, JSON.stringify(imported.body))
    const message = String(imported.body.message)
    assert.match(
      message,
      /^The database refused the import \(23514; table client_packages, rule client_packages_non_negative_balance\): new row for relation "client_packages" violates check constraint/,
    )
    assert.doesNotMatch(message, /Failed query|INSERT INTO|@example\.test/)
    assert.equal(await count('client_packages', studio.tenant.id), 0)
  })

  test('a failed import leaves neither rows nor accounts behind', async () => {
    const fresh = `rollback-${run}@example.test`
    const studio = await transformedStudio()
    studio.archive.rows.clients![0]!.email = fresh
    // Two templates with one slug: refused by the unique key, long after every
    // member's account has been ensured.
    const templates = studio.archive.rows.email_templates!
    templates.push({ ...templates[0]!, id: '00000000-0000-4000-8000-00000000abcd' })
    studio.archive.manifest.counts.email_templates = templates.length
    const { packArchive } = await import('../../../src/services/tenants/transfer-archive')

    const imported = await importZip(studio.tenant.id, await packArchive(studio.archive))
    assert.equal(imported.status, 409, JSON.stringify(imported.body))

    for (const table of ['clients', 'staff_users', 'locations', 'email_templates']) {
      assert.equal(await count(table, studio.tenant.id), 0, `${table} must be empty after a failed import`)
    }
    const accounts = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, fresh))
    assert.deepEqual(accounts, [], 'no account outlives the import that made it')
    assert.equal((await tenants.loadTenantById(studio.tenant.id))?.status, 'suspended')

    // And the studio is still empty, so the operator can import again.
    const corrected = await transformFor(studio.tenant)
    assert.equal((await importZip(studio.tenant.id, corrected.zip)).status, 200)
  })
})
