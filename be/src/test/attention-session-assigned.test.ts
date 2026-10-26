import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  HARNESS_PASSWORD,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * Staff attention, the Updates tab (#476, #492): `session_assigned` is written
 * for an instructor when someone else schedules them to teach, on every create
 * or assign path, once per series, never for the person who did the act.
 *
 * Every act goes through the real portal routes; every test makes a studio of
 * its own, so what an instructor's Updates say is about that test alone.
 */
describe('Staff attention: session assigned', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let ensureAuthUser!: typeof import('../services/auth/auth-users').ensureAuthUser

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  // Tuesday 10 June 2031, 11:00 UTC: 7:00 pm in Singapore, where a studio starts out.
  const TUE = new Date(Date.UTC(2031, 5, 10, 11, 0))
  const WHEN = 'Tue 10 Jun, 7:00 pm'

  type Studio = { id: string; slug: string; locationId: string; roomId: string; otherRoomId: string; classTypeId: string }
  type Staff = { headers: Record<string, string>; id: string; name: string }

  let studios = 0
  let people = 0

  const send = (path: string, headers: Record<string, string>, method = 'GET', body?: unknown) =>
    harness.app.request(`/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as Record<string, any>
  }

  const portalHeaders = (studio: Studio) => ({
    Origin: frontendOrigin('staff', studio),
    'X-Tenant-Slug': studio.slug,
    'X-Forwarded-For': harnessAddress(),
  })

  const freshStudio = async (): Promise<Studio> => {
    const slug = `asg-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Assign Studio', adminEmail: `owner@${slug}.test` })
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `${slug} Studio`, address: '1 Test Street' })
      .returning({ id: schema.locations.id })
    const rooms = await harness.db
      .insert(schema.rooms)
      .values([
        { tenantId: tenant.id, locationId: location!.id, name: 'Room A', capacity: 20 },
        { tenantId: tenant.id, locationId: location!.id, name: 'Room B', capacity: 20 },
      ])
      .returning({ id: schema.rooms.id })
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: 'Vinyasa' })
      .returning({ id: schema.classTypes.id })
    return {
      id: tenant.id,
      slug,
      locationId: location!.id,
      roomId: rooms[0]!.id,
      otherRoomId: rooms[1]!.id,
      classTypeId: type!.id,
    }
  }

  const adminAt = async (studio: Studio, name = 'boss'): Promise<Staff> => {
    const email = `admin${people++}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role: 'admin', status: 'active', authUserId: user!.id })
      .returning()
    return { headers, id: row!.id, name }
  }

  const instructorAt = async (studio: Studio, admin: Staff, name: string): Promise<Staff> => {
    const email = `${name}${people++}@${studio.slug}.test`
    await json(await send('/portal/admin/staff/invite', admin.headers, 'POST', { email, role: 'instructor' }), 201)
    const [invitation] = await harness.db
      .select({ token: schema.staffInvitations.token, staffUserId: schema.staffInvitations.staffUserId })
      .from(schema.staffInvitations)
      .where(and(eq(schema.staffInvitations.tenantId, studio.id), eq(schema.staffInvitations.email, email)))
    await json(
      await send('/public/staff-invitation/accept', portalHeaders(studio), 'POST', {
        token: invitation!.token,
        password: HARNESS_PASSWORD,
      }),
      200,
    )
    return { headers: await harness.signInAs('staff', email, studio), id: invitation!.staffUserId!, name }
  }

  /** A member holding a PT package, to seat on a manual session. */
  const ptMember = async (studio: Studio) => {
    const email = `member${people++}@${studio.slug}.test`
    const authUserId = await ensureAuthUser(harness.db, 'client', { email, name: 'Mia', tenantId: studio.id })
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name: 'Mia', phone: '+6580000000', authUserId })
      .returning({ id: schema.clients.id })
    const [source] = await harness.db
      .insert(schema.ptPackages)
      .values({ tenantId: studio.id, name: 'Five private sessions', sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '300.00' })
      .returning({ id: schema.ptPackages.id })
    const [pkg] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: studio.id,
        clientId: client!.id,
        kind: 'pt',
        sourcePtPackageId: source!.id,
        validityDays: 90,
        creditsOrSessionsRemaining: 5,
        expiresAt: new Date(TUE.getTime() + 60 * DAY),
        active: true,
        amountPaidSgd: '300.00',
        listPriceSgd: '300.00',
      })
      .returning({ id: schema.clientPackages.id })
    return { clientId: client!.id, packageId: pkg!.id }
  }

  const classBody = (studio: Studio, main: Staff, extra: Record<string, unknown> = {}) => ({
    class_type_id: studio.classTypeId,
    main_instructor_id: main.id,
    location_id: studio.locationId,
    room_id: studio.roomId,
    starts_at: TUE.toISOString(),
    ends_at: new Date(TUE.getTime() + HOUR).toISOString(),
    capacity_online: 10,
    credit_cost: 1,
    ...extra,
  })

  const seriesBody = (studio: Studio, extra: Record<string, unknown> = {}) => ({
    class_type_id: studio.classTypeId,
    location_id: studio.locationId,
    room_id: studio.roomId,
    weekday: 2,
    start_time: '19:00',
    end_time: '20:00',
    capacity_online: 10,
    credit_cost: 1,
    first_date: '2031-06-10',
    last_date: '2031-06-24',
    ...extra,
  })

  const manualBody = (studio: Studio, member: { clientId: string; packageId: string }, extra: Record<string, unknown> = {}) => ({
    session_type: '1on1',
    location_id: studio.locationId,
    room_id: studio.roomId,
    starts_at: TUE.toISOString(),
    ends_at: new Date(TUE.getTime() + HOUR).toISOString(),
    members: [{ client_id: member.clientId, client_package_id: member.packageId }],
    ...extra,
  })

  const updatesOf = async (who: Staff) =>
    (await json(await send('/portal/attention', who.headers), 200)).updates.items as Array<Record<string, any>>
  const assigned = async (who: Staff) => (await updatesOf(who)).filter(u => u.kind === 'session_assigned')

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ;({ ensureAuthUser } = await import('../services/auth/auth-users'))
  })

  after(async () => {
    await harness?.close()
  })

  test('ATN-170 an admin scheduling a class names its main instructor, who is told by name, class and time, linked to the class page; the admin is told nothing', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const res = await json(await send('/portal/admin/schedule/classes', admin.headers, 'POST', classBody(studio, ada)), 201)

    const [u] = await assigned(ada)
    assert.equal((await assigned(ada)).length, 1)
    assert.equal(u!.title, `boss scheduled you to teach Vinyasa on ${WHEN}`)
    assert.equal(u!.href, `/instructor/schedule/class/${res.id}`)
    assert.equal(u!.read_at, null)
    // The admin is told nothing of the scheduling (a newcomer's staff_joined is #491's, not this ticket's).
    assert.deepEqual((await updatesOf(admin)).filter(x => x.kind === 'session_assigned'), [])
  })

  test('ATN-171 a supporting instructor added at creation is told "as a supporting instructor", and the main instructor is not told that', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const res = await json(
      await send('/portal/admin/schedule/classes', admin.headers, 'POST', classBody(studio, ada, { supporting_instructor_ids: [ben.id] })),
      201,
    )

    const [main] = await assigned(ada)
    assert.equal(main!.title, `boss scheduled you to teach Vinyasa on ${WHEN}`)
    const [support] = await assigned(ben)
    assert.equal(support!.title, `boss scheduled you to teach Vinyasa on ${WHEN} as a supporting instructor`)
    assert.equal(support!.href, `/instructor/schedule/class/${res.id}`)
    assert.equal((await assigned(ada)).length, 1)
    assert.equal((await assigned(ben)).length, 1)
  })

  test('ATN-172 a series gives its instructor exactly one update, worded as a weekly repeat and linked to its first class', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const res = await json(
      await send(
        '/portal/admin/schedule/series',
        admin.headers,
        'POST',
        seriesBody(studio, { main_instructor_id: ada.id, supporting_instructors: [{ instructor_id: ben.id }] }),
      ),
      201,
    )
    assert.equal(res.class_ids.length, 3)

    const mine = await assigned(ada)
    assert.equal(mine.length, 1, 'one update for the series, not one per class')
    assert.equal(mine[0]!.title, 'boss scheduled you to teach Vinyasa every Tuesday at 7:00 pm from Tue 10 Jun')
    assert.equal(mine[0]!.href, `/instructor/schedule/class/${res.class_ids[0]}`)

    const theirs = await assigned(ben)
    assert.equal(theirs.length, 1)
    assert.equal(theirs[0]!.title, 'boss scheduled you to teach Vinyasa every Tuesday at 7:00 pm from Tue 10 Jun as a supporting instructor')

    // Extending the series adds classes to a series they already teach: nothing new to tell.
    await json(await send(`/portal/admin/schedule/series/${res.series.id}/extend`, admin.headers, 'POST', { last_date: '2031-07-08' }), 200)
    assert.equal((await assigned(ada)).length, 1)
  })

  test('ATN-173 scheduling a PT request tells its instructor, linked to the session page', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const member = await ptMember(studio)
    const [req] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: studio.id,
        clientId: member.clientId,
        locationId: studio.locationId,
        sessionType: '1on1',
        status: 'pending',
        origin: 'member',
        expiresAt: new Date(Date.now() + 2 * DAY),
      })
      .returning({ id: schema.ptRequests.id })
    await json(
      await send(`/portal/admin/pt-sessions/${req!.id}/schedule`, admin.headers, 'POST', {
        instructor_id: ada.id,
        location_id: studio.locationId,
        room_id: studio.roomId,
        starts_at: TUE.toISOString(),
        ends_at: new Date(TUE.getTime() + HOUR).toISOString(),
      }),
      201,
    )
    const [session] = await harness.db
      .select({ id: schema.ptSessions.id })
      .from(schema.ptSessions)
      .where(eq(schema.ptSessions.ptRequestId, req!.id))

    const [u] = await assigned(ada)
    assert.equal(u!.title, `boss scheduled you to teach a private session on ${WHEN}`)
    assert.equal(u!.href, `/instructor/schedule/pt/${session!.id}`)
  })

  test('ATN-174 a manual PT session tells its instructor', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const member = await ptMember(studio)
    await json(
      await send('/portal/admin/pt-sessions/manual', admin.headers, 'POST', manualBody(studio, member, { instructor_id: ada.id })),
      201,
    )
    const [session] = await harness.db
      .select({ id: schema.ptSessions.id })
      .from(schema.ptSessions)
      .where(eq(schema.ptSessions.instructorId, ada.id))

    const mine = await assigned(ada)
    assert.equal(mine.length, 1)
    assert.equal(mine[0]!.title, `boss scheduled you to teach a private session on ${WHEN}`)
    assert.equal(mine[0]!.href, `/instructor/schedule/pt/${session!.id}`)
  })

  test('ATN-175 a workshop tells its main and supporting instructors, and links to the schedule on its first day, since it has no instructor page', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    await json(
      await send('/portal/admin/workshops', admin.headers, 'POST', {
        name: 'Backbend Intensive',
        location_id: studio.locationId,
        main_instructor_id: ada.id,
        supporting_instructors: [{ instructor_id: ben.id }],
        days: [
          {
            ref: 'd1',
            room_id: studio.roomId,
            starts_at: TUE.toISOString(),
            ends_at: new Date(TUE.getTime() + 2 * HOUR).toISOString(),
            capacity_online: 10,
          },
        ],
        tiers: [{ name: 'Full', regular_price_sgd: '100.00', day_refs: ['d1'] }],
      }),
      201,
    )

    const [main] = await assigned(ada)
    assert.equal(main!.title, `boss scheduled you to teach Backbend Intensive on ${WHEN}`)
    assert.equal(main!.href, '/instructor/schedule?date=2031-06-10')
    const [support] = await assigned(ben)
    assert.equal(support!.title, `boss scheduled you to teach Backbend Intensive on ${WHEN} as a supporting instructor`)
    assert.equal(support!.href, '/instructor/schedule?date=2031-06-10')
  })

  test('ATN-176 scheduling a corporate request tells its instructors, linked to the schedule on that date', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const email = `buyer${people++}@${studio.slug}.test`
    const authUserId = await ensureAuthUser(harness.db, 'client', { email, name: 'Mia', tenantId: studio.id })
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name: 'Mia', phone: '+6580000000', authUserId })
      .returning({ id: schema.clients.id })
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId: studio.id, clientId: client!.id, kind: 'corporate_package', totalSgd: '1500.00', amountPaidSgd: '1500.00', status: 'paid' })
      .returning({ id: schema.purchases.id })
    const [pkg] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: studio.id, name: 'Team Offsite', priceSgd: '1500.00', createdByStaffId: admin.id })
      .returning({ id: schema.corporatePackages.id })
    const [req] = await harness.db
      .insert(schema.corporateRequests)
      .values({ tenantId: studio.id, clientId: client!.id, corporatePackageId: pkg!.id, purchaseId: purchase!.id, status: 'pending' })
      .returning({ id: schema.corporateRequests.id })
    await json(
      await send(`/portal/admin/corporate-requests/${req!.id}/schedule`, admin.headers, 'POST', {
        main_instructor_id: ada.id,
        supporting_instructor_ids: [ben.id],
        location_id: studio.locationId,
        room_id: studio.roomId,
        starts_at: TUE.toISOString(),
        ends_at: new Date(TUE.getTime() + HOUR).toISOString(),
      }),
      201,
    )

    const [main] = await assigned(ada)
    assert.equal(main!.title, `boss scheduled you to teach a corporate session for Mia on ${WHEN}`)
    assert.equal(main!.href, '/instructor/schedule?date=2031-06-10')
    const [support] = await assigned(ben)
    assert.equal(support!.title, `boss scheduled you to teach a corporate session for Mia on ${WHEN} as a supporting instructor`)
  })

  test('ATN-177 adding a supporting instructor to a class, or making someone its main, tells that person; saving without a change tells no one', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const cat = await instructorAt(studio, admin, 'cat')
    const made = await json(await send('/portal/admin/schedule/classes', admin.headers, 'POST', classBody(studio, ada)), 201)
    const url = `/portal/admin/schedule/classes/${made.id}`

    await json(await send(url, admin.headers, 'PATCH', { supporting_instructor_ids: [ben.id] }), 200)
    const [added] = await assigned(ben)
    assert.equal(added!.title, `boss scheduled you to teach Vinyasa on ${WHEN} as a supporting instructor`)
    assert.equal(added!.href, `/instructor/schedule/class/${made.id}`)

    // The same roster again, and a move of the room: ben is already on it.
    await json(await send(url, admin.headers, 'PATCH', { supporting_instructor_ids: [ben.id], room_id: studio.otherRoomId }), 200)
    assert.equal((await assigned(ben)).length, 1)
    assert.equal((await assigned(ada)).length, 1)

    await json(await send(url, admin.headers, 'PATCH', { main_instructor_id: cat.id }), 200)
    const [taken] = await assigned(cat)
    assert.equal(taken!.title, `boss scheduled you to teach Vinyasa on ${WHEN}`)
  })

  test('ATN-178 an instructor who schedules their own class, series or private session is told nothing', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const member = await ptMember(studio)

    await json(await send('/portal/instructor/schedule/classes', ada.headers, 'POST', classBody(studio, ada)), 201)
    await json(await send('/portal/instructor/schedule/series', ada.headers, 'POST', seriesBody(studio, { main_instructor_id: ada.id, first_date: '2031-06-17', last_date: '2031-06-24' })), 201)
    const later = new Date(TUE.getTime() + 3 * HOUR).toISOString()
    await json(
      await send('/portal/instructor/pt-requests/manual', ada.headers, 'POST', manualBody(studio, member, { starts_at: later, ends_at: new Date(Date.parse(later) + HOUR).toISOString() })),
      201,
    )
    assert.deepEqual(await updatesOf(ada), [])
  })

  test('ATN-179 a class that fails to save leaves no update behind', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const refused = await send('/portal/admin/schedule/classes', admin.headers, 'POST', classBody(studio, ada, { capacity_online: 0 }))
    assert.equal(refused.status, 400)
    assert.deepEqual(await updatesOf(ada), [])
  })
})
