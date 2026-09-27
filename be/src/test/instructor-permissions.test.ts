import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  HARNESS_PASSWORD,
  integrationTestsEnabled,
  inTenantContext,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'
import { addDays, isoWeekday } from '../services/schedule/series-dates'

/**
 * Instructor Permissions (#327, be/docs/adr/0012): three switches an Admin sets
 * per Instructor. This file proves them end to end over HTTP — read and set
 * through the staff API, enforced on the instructor's routes, felt on the next
 * request — and that everything an Instructor needs to teach is untouched:
 * **Schedule classes** (#328) on the schedule, **Take PT bookings** (#330) on
 * the PT request queue.
 *
 * Each run gets studios of its own, provisioned the way the super portal does
 * (pattern: staff-management), and the instructors arrive by invitation
 * accepted over HTTP, so the default the column gives is the one under test.
 * Sessions are far in the future in a room and class type made here
 * (pattern: instructor-series).
 */
describe('Instructor Permissions', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let ptPackagesSvc!: typeof import('../services/packages/pt-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const ALL = ['schedule_classes', 'take_pt_bookings', 'manage_rosters'].sort()
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  /** A UTC midnight well out in the future, so every session is schedulable. */
  const BASE = (() => {
    const d = new Date(Date.now() + (500 + Math.floor(Math.random() * 200)) * DAY)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  })()
  const at = (days: number, hours = 10) => new Date(BASE + days * DAY + hours * HOUR)
  /** The Monday on or after `days` past BASE. */
  const mondayFrom = (days: number) => {
    const start = at(days).toISOString().slice(0, 10)
    return addDays(start, (1 - isoWeekday(start) + 7) % 7)
  }

  type Studio = {
    id: string
    slug: string
    locationId: string
    roomId: string
    classTypeId: string
  }
  type Staff = { headers: Record<string, string>; id: string; email: string }

  let studios = 0
  let days = 0
  /** A fresh day for each session, so nothing this file makes clashes with itself. */
  const nextDay = () => ++days

  const send = (path: string, headers: Record<string, string>, method = 'GET', body?: unknown) =>
    harness.app.request(`/api/v1${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const json = async (res: Response, status: number, error?: string) => {
    const text = await res.text()
    assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${text}`)
    const parsed = (text ? JSON.parse(text) : {}) as Record<string, any>
    if (error) assert.equal(parsed.error, error, text)
    return parsed
  }

  /** The body a `403 forbidden_permission` refusal carries. */
  const refused = async (res: Response, required: string) => {
    const body = await json(res, 403, 'forbidden_permission')
    assert.equal(body.required, required)
  }

  /** What a frontend on `studio`'s portal sends with an anonymous request. */
  const portalHeaders = (studio: Studio) => ({
    Origin: frontendOrigin('staff', studio),
    'X-Tenant-Slug': studio.slug,
    'X-Forwarded-For': harnessAddress(),
  })

  /** A studio of its own, with the fixtures a class needs. Its first admin is only invited. */
  const freshStudio = async (): Promise<Studio> => {
    const slug = `perm-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Permissions Studio', adminEmail: `owner@${slug}.test` })
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `${slug} Studio`, address: '1 Test Street' })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `${slug} Room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: `${slug} Hatha` })
      .returning({ id: schema.classTypes.id })
    return { id: tenant.id, slug, locationId: location!.id, roomId: room!.id, classTypeId: type!.id }
  }

  /** An active admin of `studio`, signed in on its portal. */
  const adminAt = async (studio: Studio, name = 'admin'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role: 'admin', status: 'active', authUserId: user!.id })
      .returning()
    return { headers, id: row!.id, email }
  }

  /**
   * An Instructor who arrived the way real ones do: invited by `admin` (with the
   * permissions stated, if any), the link accepted on the studio's own portal,
   * then signed in there.
   */
  const inviteInstructor = async (
    studio: Studio,
    admin: Staff,
    name: string,
    permissions?: string[],
  ): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    await json(
      await send('/portal/admin/staff/invite', admin.headers, 'POST', {
        email,
        role: 'instructor',
        ...(permissions ? { permissions } : {}),
      }),
      201,
    )
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
    const headers = await harness.signInAs('staff', email, studio)
    return { headers, id: invitation!.staffUserId!, email }
  }

  const me = async (who: Staff) => json(await send('/portal/auth/me', who.headers), 200)

  const staffList = async (admin: Staff) =>
    (await json(await send('/portal/admin/staff', admin.headers), 200)).staff as Array<Record<string, any>>

  const listed = async (admin: Staff, id: string) => (await staffList(admin)).find(s => s.id === id)!

  const setPermissions = (admin: Staff, id: string, permissions: string[], extra: Record<string, unknown> = {}) =>
    send(`/portal/admin/staff/${id}`, admin.headers, 'PATCH', { permissions, ...extra })

  const classBody = (studio: Studio, day: number) => {
    const startsAt = at(day)
    return {
      class_type_id: studio.classTypeId,
      location_id: studio.locationId,
      room_id: studio.roomId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
      capacity_online: 10,
      credit_cost: 1,
    }
  }

  const seriesBody = (studio: Studio, firstDate: string) => ({
    class_type_id: studio.classTypeId,
    location_id: studio.locationId,
    room_id: studio.roomId,
    weekday: 1,
    start_time: '19:00',
    end_time: '20:00',
    capacity_online: 10,
    credit_cost: 1,
    first_date: firstDate,
    last_date: addDays(firstDate, 7),
    excluded_dates: [] as string[],
  })

  const createClass = (studio: Studio, who: Staff, day = nextDay()) =>
    send('/portal/instructor/schedule/classes', who.headers, 'POST', classBody(studio, day))

  const classRow = async (id: string) => {
    const [row] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, id))
    return row!
  }

  const instructorsRow = async (studio: Studio, staffUserId: string) => {
    const [row] = await harness.db
      .select()
      .from(schema.instructors)
      .where(and(eq(schema.instructors.tenantId, studio.id), eq(schema.instructors.staffUserId, staffUserId)))
    return row
  }

  /** A member of `studio`, signed in on its member app. */
  const memberAt = async (studio: Studio, name: string) => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('client', email, studio)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { headers, id: client!.id }
  }

  /**
   * A pending, unbound 1on1 PT Request, made the way a member makes one: a PT
   * package granted to them, then the request sent from the member app.
   */
  let ptPackages = 0
  const ptRequest = async (studio: Studio, member: { headers: Record<string, string>; id: string }) => {
    const pkg = await ptPackagesSvc.createPtPackage(studio.id, {
      name: `${studio.slug} PT ${++ptPackages}`,
      sessionType: '1on1',
      numSessions: 5,
      validityDays: 90,
      priceSgd: '500.00',
    })
    const { clientPackageId } = await purchaseSvc.grantPackage(studio.id, {
      clientId: member.id,
      purchaseId: null,
      amountSgd: '500.00',
      packageKind: 'pt',
      packageId: pkg.id,
    })
    const created = await json(
      await send('/me/pt-sessions/request', member.headers, 'POST', {
        classTypeId: studio.classTypeId,
        locationId: studio.locationId,
        sessionType: '1on1',
        clientPackageId,
        slots: [
          { proposedDate: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10), startTime: '09:00', endTime: '10:00' },
        ],
      }),
      201,
    )
    return created.pt_request_id as string
  }

  /** A PT slot a few days out, a fresh one for each call, so no two sessions clash. */
  let ptSlots = 0
  const nextPtStart = () => new Date(Date.now() + 3 * DAY + ++ptSlots * 2 * HOUR)
  const ptSlot = (studio: Studio, startsAt: Date) => ({
    location_id: studio.locationId,
    room_id: studio.roomId,
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
  })

  const ptQueue = (who: Staff) => send('/portal/instructor/pt-requests', who.headers)
  const ptSchedule = (studio: Studio, who: Staff, id: string) =>
    send(`/portal/instructor/pt-requests/${id}/schedule`, who.headers, 'POST', ptSlot(studio, nextPtStart()))
  const ptCancel = (who: Staff, id: string) => send(`/portal/instructor/pt-requests/${id}/cancel`, who.headers, 'POST')
  // A manual session (#334) puts a PT session on the caller's calendar, so it is
  // Take PT bookings' too. The permission is judged before the body, so an
  // empty body is enough to see the refusal.
  const ptManual = (who: Staff) => send('/portal/instructor/pt-requests/manual', who.headers, 'POST', {})
  // The manual session's own reads and writes (#335, #337): the seat-candidates
  // read and adding or removing a member. Same permission, judged first.
  const NIL = '00000000-0000-4000-8000-000000000000'
  const ptSeatCandidates = (who: Staff) => send('/portal/instructor/pt-requests/seat-candidates', who.headers)
  const ptAddMember = (who: Staff) => send(`/portal/instructor/pt-requests/sessions/${NIL}/members`, who.headers, 'POST', {})
  const ptRemoveMember = (who: Staff) =>
    send(`/portal/instructor/pt-requests/sessions/${NIL}/members/${NIL}`, who.headers, 'DELETE')

  const ptRequestRow = async (id: string) => {
    const [row] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, id))
    return row!
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
  })

  after(async () => {
    await harness?.close()
  })

  test('STF-27 an Instructor invited with no permissions stated holds all three: me and the staff list say so, an admin is listed with null, and they schedule as today', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')

    const profile = await me(tara)
    assert.equal(profile.role, 'instructor')
    assert.deepEqual([...profile.permissions].sort(), ALL)
    assert.deepEqual([...(await me(admin)).permissions].sort(), ALL, 'an admin resolves to everything')

    assert.deepEqual([...(await listed(admin, tara.id)).permissions].sort(), ALL)
    assert.equal((await listed(admin, admin.id)).permissions, null)

    const created = await json(await createClass(studio, tara), 201)
    assert.equal(created.main_instructor_id, tara.id)
    const preview = await json(
      await send('/portal/instructor/schedule/series/preview', tara.headers, 'POST', seriesBody(studio, mondayFrom(nextDay() + 14))),
      200,
    )
    assert.equal(preview.dates.length, 2)
  })

  test('STF-28 with Schedule classes off, create, preview, series and cancel are refused 403 forbidden_permission; the timetable and teaching stay; back on, they work again', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')
    const earlier = await json(await createClass(studio, tara), 201)

    const patched = await json(await setPermissions(admin, tara.id, ['take_pt_bookings', 'manage_rosters']), 200)
    assert.deepEqual([...patched.permissions].sort(), ['manage_rosters', 'take_pt_bookings'])
    // Felt on the very next request, on the same session.
    assert.deepEqual([...(await me(tara)).permissions].sort(), ['manage_rosters', 'take_pt_bookings'])

    await refused(await createClass(studio, tara), 'schedule_classes')
    const series = seriesBody(studio, mondayFrom(nextDay() + 14))
    await refused(await send('/portal/instructor/schedule/series/preview', tara.headers, 'POST', series), 'schedule_classes')
    await refused(await send('/portal/instructor/schedule/series', tara.headers, 'POST', series), 'schedule_classes')
    await refused(
      await send(`/portal/instructor/schedule/classes/${earlier.id}/cancel`, tara.headers, 'POST', { reason: 'unwell' }),
      'schedule_classes',
    )
    assert.equal((await classRow(earlier.id)).lifecycle, 'active', 'a refusal cancels nothing')

    // The class they scheduled before the switch stays on their timetable…
    const timetable = await json(await send('/portal/instructor/schedule', tara.headers), 200)
    assert.ok(timetable.entries.some((e: any) => e.id === earlier.id))
    // …and everything they need to teach it still answers.
    const roster = await json(await send(`/portal/instructor/sessions/class/${earlier.id}/roster`, tara.headers), 200)
    assert.equal(roster.id, earlier.id)
    await json(await send('/portal/instructor/profile', tara.headers), 200)
    await json(await send('/portal/instructor/payroll', tara.headers), 200)
    await json(await send('/portal/instructor/catalog/class-types', tara.headers), 200)
    await json(await send('/portal/leave', tara.headers), 200)

    // Check-in: a member booked onto the class, inside its Check-in Window.
    const [member] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId: studio.id,
        authUserId: `perm-${run}-${studio.slug}`,
        email: `member@${studio.slug}.test`,
        name: `Member ${run}`,
        phone: '+6580000000',
      })
      .returning({ id: schema.clients.id })
    const code = `RT-${run.slice(-6).toUpperCase()}`
    const [booking] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: studio.id,
        clientId: member!.id,
        kind: 'class',
        classId: earlier.id,
        creditsOrSessionsUsed: 1,
        qrToken: `perm-token-${run}`,
        code,
      })
      .returning({ id: schema.bookings.id })
    const [tick] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: studio.id,
        clientId: member!.id,
        kind: 'class',
        classId: earlier.id,
        creditsOrSessionsUsed: 1,
        qrToken: `perm-token-tick-${run}`,
        code: `RT-T${run.slice(-5).toUpperCase()}`,
      })
      .returning({ id: schema.bookings.id })
    // Check-in reads the wall clock, so the class is moved to it: ten minutes
    // from now, inside the studio's default window (pattern: check-in.test.ts).
    const soon = new Date(Date.now() + 10 * 60 * 1000)
    await harness.db
      .update(schema.classes)
      .set({ startsAt: soon, endsAt: new Date(soon.getTime() + HOUR) })
      .where(eq(schema.classes.id, earlier.id))
    const day = await json(await send('/portal/instructor/check-in', tara.headers), 200)
    assert.ok(day.sessions.some((s: any) => s.id === earlier.id), 'the class is on their check-in desk')
    const scanned = await json(await send('/portal/instructor/check-in/scan', tara.headers, 'POST', { code }), 200)
    assert.equal(scanned.booking_id, booking!.id)
    const ticked = await json(
      await send('/portal/instructor/check-in/manual', tara.headers, 'POST', { booking_id: tick!.id }),
      200,
    )
    assert.equal(ticked.check_in_state, 'attended')

    // An Admin can still take the class off the timetable.
    await json(await send(`/portal/admin/schedule/classes/${earlier.id}/cancel`, admin.headers, 'POST', {}), 200)
    assert.equal((await classRow(earlier.id)).lifecycle, 'cancelled')

    // Back on: restored, on the next request.
    await json(await setPermissions(admin, tara.id, ALL), 200)
    assert.deepEqual([...(await me(tara)).permissions].sort(), ALL)
    await json(await createClass(studio, tara), 201)
  })

  test('STF-29 the permission is judged before ownership, and an Admin on the instructor surface is never refused by one', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')
    const omar = await inviteInstructor(studio, admin, 'omar')
    const omars = await json(await createClass(studio, omar), 201)

    // With the switch on, another instructor's class is an ownership refusal…
    await json(
      await send(`/portal/instructor/schedule/classes/${omars.id}/cancel`, tara.headers, 'POST', { reason: 'not mine' }),
      403,
      'not_main_instructor',
    )
    // …with it off, the permission is what refuses, before ownership is looked at.
    await json(await setPermissions(admin, tara.id, []), 200)
    await refused(
      await send(`/portal/instructor/schedule/classes/${omars.id}/cancel`, tara.headers, 'POST', { reason: 'not mine' }),
      'schedule_classes',
    )
    assert.equal((await classRow(omars.id)).lifecycle, 'active')

    // An Admin calling the same routes meets no permission gate: whatever else
    // answers, it is never forbidden_permission.
    for (const [path, body] of [
      ['/portal/instructor/schedule/classes', classBody(studio, nextDay())],
      ['/portal/instructor/schedule/series/preview', seriesBody(studio, mondayFrom(nextDay() + 14))],
      [`/portal/instructor/schedule/classes/${omars.id}/cancel`, { reason: 'admin' }],
    ] as const) {
      const res = await send(path, admin.headers, 'POST', body)
      const text = await res.text()
      assert.notEqual(res.status, 401, `${path}: ${text}`)
      assert.notEqual(JSON.parse(text || '{}').error, 'forbidden_permission', `${path}: ${text}`)
    }
  })

  test('STF-30 permissions are set on Instructors only: on an Admin, with a promotion in the same request, or on an admin invitation, it is refused and writes nothing; a duplicate key is malformed', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const peer = await adminAt(studio, 'peer')
    const tara = await inviteInstructor(studio, admin, 'tara')

    await json(await setPermissions(admin, peer.id, ['schedule_classes']), 400, 'permissions_require_instructor')
    assert.equal(await instructorsRow(studio, peer.id), undefined, 'no profile row was made for the admin')

    await json(
      await setPermissions(admin, tara.id, ['schedule_classes'], { role: 'admin', first_name: 'Renamed' }),
      400,
      'permissions_require_instructor',
    )
    const [taraRow] = await harness.db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, tara.id))
    assert.equal(taraRow?.role, 'instructor', 'the role change in the refused request did not land')
    assert.notEqual(taraRow?.firstName, 'Renamed', 'nor did the rest of the patch')

    // An admin invitation stating permissions is refused the same way, and
    // nothing is invited.
    const adminInvite = `new-admin@${studio.slug}.test`
    await json(
      await send('/portal/admin/staff/invite', admin.headers, 'POST', {
        email: adminInvite,
        role: 'admin',
        permissions: ['schedule_classes'],
      }),
      400,
      'permissions_require_instructor',
    )
    const invited = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.tenantId, studio.id), eq(schema.staffUsers.email, adminInvite)))
    assert.equal(invited.length, 0)
    assert.deepEqual([...(await instructorsRow(studio, tara.id))!.permissions].sort(), ALL)

    await json(await setPermissions(admin, tara.id, ['schedule_classes', 'schedule_classes']), 400)
    assert.deepEqual([...(await instructorsRow(studio, tara.id))!.permissions].sort(), ALL)
  })

  test('STF-31 a role change from Admin to Instructor yields all three; Instructor to Admin and back keeps what was set', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const peer = await adminAt(studio, 'peer')
    const tara = await inviteInstructor(studio, admin, 'tara')

    const demoted = await json(await send(`/portal/admin/staff/${peer.id}`, admin.headers, 'PATCH', { role: 'instructor' }), 200)
    assert.deepEqual([...demoted.permissions].sort(), ALL)
    assert.deepEqual([...(await me(peer)).permissions].sort(), ALL)

    await json(await setPermissions(admin, tara.id, ['manage_rosters']), 200)
    const promoted = await json(await send(`/portal/admin/staff/${tara.id}`, admin.headers, 'PATCH', { role: 'admin' }), 200)
    assert.equal(promoted.permissions, null, 'an admin is shown no switches')
    assert.deepEqual([...(await me(tara)).permissions].sort(), ALL, 'and holds everything')
    const back = await json(await send(`/portal/admin/staff/${tara.id}`, admin.headers, 'PATCH', { role: 'instructor' }), 200)
    assert.deepEqual(back.permissions, ['manage_rosters'], 'what an admin set survives the round trip')
    assert.deepEqual((await me(tara)).permissions, ['manage_rosters'])
  })

  test('STF-32 an invitation stating a subset of permissions produces an Instructor with exactly that subset once accepted, reported by every staff write', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const kim = await inviteInstructor(studio, admin, 'kim', ['manage_rosters', 'take_pt_bookings'])

    assert.deepEqual([...(await me(kim)).permissions].sort(), ['manage_rosters', 'take_pt_bookings'])
    assert.deepEqual([...(await listed(admin, kim.id)).permissions].sort(), ['manage_rosters', 'take_pt_bookings'])
    await refused(await createClass(studio, kim), 'schedule_classes')

    // Every staff row a write returns reports the grant, archive and unarchive included.
    const archived = await json(await send(`/portal/admin/staff/${kim.id}/archive`, admin.headers, 'POST', {}), 200)
    assert.deepEqual([...archived.permissions].sort(), ['manage_rosters', 'take_pt_bookings'])
    const unarchived = await json(await send(`/portal/admin/staff/${kim.id}/unarchive`, admin.headers, 'POST', {}), 200)
    assert.deepEqual([...unarchived.permissions].sort(), ['manage_rosters', 'take_pt_bookings'])
  })

  test('STF-36 with Take PT bookings off, the PT queue read, scheduling a request and cancelling a PT session are refused 403 forbidden_permission and change nothing; an Admin on the same routes is never refused; back on, they work as today', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')
    const member = await memberAt(studio, 'member')
    const taken = await ptRequest(studio, member)
    const waiting = await ptRequest(studio, member)

    // On, as today: the queue lists both and she takes one onto her calendar.
    const queue = await json(await ptQueue(tara), 200)
    assert.deepEqual(queue.pt_requests.map((r: any) => r.id).sort(), [taken, waiting].sort())
    const scheduled = await json(await ptSchedule(studio, tara, taken), 201)
    assert.equal(scheduled.pt_request.status, 'scheduled')

    await json(await setPermissions(admin, tara.id, ['schedule_classes', 'manage_rosters']), 200)

    // The read is closed as well as the writes: the queue names members.
    await refused(await ptQueue(tara), 'take_pt_bookings')
    await refused(await ptSchedule(studio, tara, waiting), 'take_pt_bookings')
    await refused(await ptCancel(tara, taken), 'take_pt_bookings')
    await refused(await ptManual(tara), 'take_pt_bookings')
    await refused(await ptSeatCandidates(tara), 'take_pt_bookings')
    await refused(await ptAddMember(tara), 'take_pt_bookings')
    await refused(await ptRemoveMember(tara), 'take_pt_bookings')
    assert.equal((await ptRequestRow(waiting)).status, 'pending', 'a refusal schedules nothing')
    assert.equal((await ptRequestRow(taken)).status, 'scheduled', 'a refusal cancels nothing')

    // An Admin on the instructor PT surface meets no permission gate.
    const adminQueue = await json(await ptQueue(admin), 200)
    assert.ok(adminQueue.pt_requests.some((r: any) => r.id === waiting))

    // Back on: the next request works as it did.
    await json(await setPermissions(admin, tara.id, ALL), 200)
    const again = await json(await ptQueue(tara), 200)
    assert.deepEqual(again.pt_requests.map((r: any) => r.id), [waiting])
    await json(await ptCancel(tara, taken), 200)
    assert.equal((await ptRequestRow(taken)).status, 'cancelled_after_scheduled')
  })

  test('STF-37 with Take PT bookings off, a PT session an Admin schedules the Instructor for is on their timetable and check-in desk, and they check the member in', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')
    await json(await setPermissions(admin, tara.id, ['schedule_classes', 'manage_rosters']), 200)
    const member = await memberAt(studio, 'member')
    const request = await ptRequest(studio, member)

    // Check-in reads the wall clock, so the session starts ten minutes from
    // now, inside the studio's default window (pattern: check-in.test.ts).
    const scheduled = await json(
      await send(`/portal/admin/pt-sessions/${request}/schedule`, admin.headers, 'POST', {
        ...ptSlot(studio, new Date(Date.now() + 10 * 60 * 1000)),
        instructor_id: tara.id,
        instructor_pay_sgd: 60,
      }),
      201,
    )
    const sessionId = scheduled.pt_request.session.id as string

    const timetable = await json(await send('/portal/instructor/schedule', tara.headers), 200)
    assert.ok(timetable.entries.some((e: any) => e.id === sessionId), 'the session is on their timetable')
    const desk = await json(await send('/portal/instructor/check-in', tara.headers), 200)
    assert.ok(desk.sessions.some((s: any) => s.id === sessionId), 'the session is on their check-in desk')

    const [booking] = await harness.db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(eq(schema.bookings.ptSessionId, sessionId))
    const ticked = await json(
      await send('/portal/instructor/check-in/manual', tara.headers, 'POST', { booking_id: booking!.id }),
      200,
    )
    assert.equal(ticked.check_in_state, 'attended')
  })

  test('TEN-29 the same email invited as Instructor at two studios is trusted separately: a switch turned off at studio A leaves studio B, read on its own hostname, untouched', async () => {
    const a = await freshStudio()
    const b = await freshStudio()
    const adminA = await adminAt(a)
    const adminB = await adminAt(b)
    const shared = `shared-${run}@perm.test`
    const inviteAt = async (studio: Studio, admin: Staff) => {
      await json(await send('/portal/admin/staff/invite', admin.headers, 'POST', { email: shared, role: 'instructor' }), 201)
      const [inv] = await harness.db
        .select({ token: schema.staffInvitations.token, staffUserId: schema.staffInvitations.staffUserId })
        .from(schema.staffInvitations)
        .where(and(eq(schema.staffInvitations.tenantId, studio.id), eq(schema.staffInvitations.email, shared)))
      await json(
        await send('/public/staff-invitation/accept', portalHeaders(studio), 'POST', { token: inv!.token, password: HARNESS_PASSWORD }),
        200,
      )
      return { headers: await harness.signInAs('staff', shared, studio), id: inv!.staffUserId!, email: shared }
    }
    const atA = await inviteAt(a, adminA)
    const atB = await inviteAt(b, adminB)
    assert.notEqual(atA.id, atB.id)

    await json(await setPermissions(adminA, atA.id, ['manage_rosters']), 200)

    assert.deepEqual((await me(atA)).permissions, ['manage_rosters'])
    assert.deepEqual([...(await me(atB)).permissions].sort(), ALL)
    assert.deepEqual([...(await listed(adminB, atB.id)).permissions].sort(), ALL)
    await refused(await createClass(a, atA), 'schedule_classes')
    await json(await createClass(b, atB), 201)
  })

  /* ── Manage rosters (#331) ─────────────────────────────────────────── */

  let members = 0
  /** A member of `studio` holding a 10-credit bundle, so any seat or line place can be paid. */
  const memberOf = async (studio: Studio, packageId: string) => {
    const n = ++members
    const [client] = await harness.db
      .insert(schema.clients)
      .values({
        tenantId: studio.id,
        authUserId: `perm-${run}-m${n}`,
        email: `m${n}@${studio.slug}.test`,
        name: `Rostered ${run} ${n}`,
        phone: '+6580000000',
      })
      .returning({ id: schema.clients.id })
    await purchaseSvc.grantPackage(studio.id, {
      clientId: client!.id,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId,
    })
    return client!.id
  }

  /**
   * A studio with the waitlist on, a bundle members can pay with, and a class
   * `instructor` scheduled for themselves: one online seat, one buffer seat, a
   * line of three.
   */
  const rosterClass = async (studio: Studio, admin: Staff, instructor: Staff) => {
    await json(await send('/portal/admin/feature-flags/waitlist_enabled', admin.headers, 'PATCH', { enabled: true }), 200)
    const pkg = await classPackagesSvc.createClassPackage(studio.id, {
      name: `${studio.slug} Pass ${nextDay()}`,
      kind: 'credit_bundle',
      credits: 10,
      // Outlasts the class, which is far in the future (BASE).
      validityDays: 1000,
      priceSgd: '200.00',
    })
    const created = await json(
      await send('/portal/instructor/schedule/classes', instructor.headers, 'POST', {
        ...classBody(studio, nextDay()),
        capacity_online: 1,
        capacity_buffer: 1,
        capacity_waitlist: 3,
      }),
      201,
    )
    return { classId: created.id as string, packageId: pkg.id }
  }

  const bookingRow = async (id: string) => {
    const [row] = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, id))
    return row!
  }

  const entryRow = async (id: string) => {
    const [row] = await harness.db.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, id))
    return row!
  }

  /** The seven roster actions the Manage rosters switch governs, on the instructor mount. */
  const rosterActions = (who: Staff, classId: string) => ({
    search: (q: string) => send(`/portal/instructor/clients?q=${encodeURIComponent(q)}`, who.headers),
    // The member's packages for the class (#333): Add member's read, so Manage rosters' too.
    packages: (clientId: string) =>
      send(`/portal/instructor/schedule/classes/${classId}/packages?client_id=${clientId}`, who.headers),
    book: (clientId: string) =>
      send(`/portal/instructor/schedule/classes/${classId}/bookings`, who.headers, 'POST', { client_id: clientId }),
    join: (clientId: string) =>
      send(`/portal/instructor/schedule/classes/${classId}/waitlist`, who.headers, 'POST', { client_id: clientId }),
    promote: (entryId: string) =>
      send(`/portal/instructor/schedule/classes/${classId}/waitlist/${entryId}/promote`, who.headers, 'POST', {}),
    remove: (entryId: string) => send(`/portal/instructor/schedule/classes/${classId}/waitlist/${entryId}`, who.headers, 'DELETE'),
    cancel: (bookingId: string) =>
      send(`/portal/instructor/bookings/${bookingId}/cancel`, who.headers, 'POST', { credit: 'return' }),
  })

  let seatedCodes = 0
  /** Four members of `studio` who can pay with `packageId`. */
  const fourMembers = async (studio: Studio, packageId: string) => [
    await memberOf(studio, packageId),
    await memberOf(studio, packageId),
    await memberOf(studio, packageId),
    await memberOf(studio, packageId),
  ]

  /** `clientId` holds the online seat of `classId`, booked the way a member books for themselves. */
  const seatOnline = async (studio: Studio, classId: string, clientId: string) => {
    const n = ++seatedCodes
    const code = `RT-${n}${run.slice(-5).toUpperCase()}`
    await harness.db.insert(schema.bookings).values({
      tenantId: studio.id,
      clientId,
      kind: 'class',
      classId,
      creditsOrSessionsUsed: 1,
      qrToken: `perm-seat-${run}-${n}`,
      code,
    })
    return code
  }

  /**
   * Every roster action, worked as today by `instructor` on a fresh class of
   * theirs: find a member, book them into the buffer seat, put two in the line,
   * cancel the booking, Add the first in line to the class, Remove the second.
   */
  const worksTheRoster = async (studio: Studio, admin: Staff, instructor: Staff) => {
    const { classId, packageId } = await rosterClass(studio, admin, instructor)
    const act = rosterActions(instructor, classId)
    const [first, walkIn, waiting, other] = await fourMembers(studio, packageId)
    await seatOnline(studio, classId, first!)

    const [walkInRow] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, walkIn!))
    const found = await json(await act.search(walkInRow!.email!), 200)
    assert.deepEqual(
      found.clients.map((c: any) => c.id),
      [walkIn],
    )
    const packages = await json(await act.packages(walkIn!), 200)
    assert.ok(Array.isArray(packages.packages), 'the member packages read serves Add member')

    const booked = await json(await act.book(walkIn!), 201)
    assert.equal(booked.seat, 'buffer')
    const line = await json(await act.join(waiting!), 201)
    const second = await json(await act.join(other!), 201)

    await json(await act.cancel(booked.booking_id), 200)
    assert.ok((await bookingRow(booked.booking_id)).cancelledAt, 'the booking is cancelled')
    const promoted = await json(await act.promote(line.entry_id), 201)
    assert.equal((await bookingRow(promoted.booking_id)).clientId, waiting)
    assert.equal((await entryRow(line.entry_id)).status, 'promoted')
    assert.equal((await act.remove(second.entry_id)).status, 204)
    assert.equal((await entryRow(second.entry_id)).status, 'removed')
  }

  test('STF-39 with Manage rosters on, an Instructor searches, books a buffer seat, works the waitlist and cancels a booking as today', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')
    await worksTheRoster(studio, admin, tara)
  })

  test('STF-40 with Manage rosters off, search, book, waitlist join, promote, remove and booking cancel are refused 403 forbidden_permission and change nothing; the roster, the waitlist read and check-in stay; the admin mounts answer; back on, they work again', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')
    const { classId, packageId } = await rosterClass(studio, admin, tara)
    const act = rosterActions(tara, classId)

    const [first, seated, waiting, walkIn] = (await fourMembers(studio, packageId)) as [string, string, string, string]
    const code = await seatOnline(studio, classId, first)
    const booked = await json(await act.book(seated), 201)
    const line = await json(await act.join(waiting), 201)

    await json(await setPermissions(admin, tara.id, ['schedule_classes', 'take_pt_bookings']), 200)

    await refused(await act.search(`Rostered ${run}`), 'manage_rosters')
    await refused(await act.packages(walkIn), 'manage_rosters')
    await refused(await act.book(walkIn), 'manage_rosters')
    await refused(await act.join(walkIn), 'manage_rosters')
    await refused(await act.promote(line.entry_id), 'manage_rosters')
    await refused(await act.remove(line.entry_id), 'manage_rosters')
    await refused(await act.cancel(booked.booking_id), 'manage_rosters')

    // A refusal changes nothing.
    assert.equal((await bookingRow(booked.booking_id)).cancelledAt, null, 'the booking stands')
    assert.equal((await entryRow(line.entry_id)).status, 'waiting')
    const walkInRows = await harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.classId, classId), eq(schema.bookings.clientId, walkIn)))
    assert.equal(walkInRows.length, 0)

    // The session page still reads: the roster with names and codes, and the line.
    const roster = await json(await send(`/portal/instructor/sessions/class/${classId}/roster`, tara.headers), 200)
    const firstRow = roster.attendees.find((a: any) => a.client.id === first)
    assert.ok(firstRow, JSON.stringify(roster.attendees))
    assert.equal(firstRow.code, code)
    assert.ok(firstRow.client.name)
    assert.ok(roster.attendees.some((a: any) => a.booking_id === booked.booking_id))
    assert.deepEqual(
      roster.waitlist.map((w: any) => w.entry_id),
      [line.entry_id],
    )
    assert.ok(roster.waitlist[0].client.name)

    // The Admin works the same class through the admin mounts of the shared routes.
    const adminLine = await json(
      await send(`/portal/admin/schedule/classes/${classId}/waitlist`, admin.headers, 'POST', { client_id: walkIn }),
      201,
    )
    assert.equal(
      (await send(`/portal/admin/schedule/classes/${classId}/waitlist/${adminLine.entry_id}`, admin.headers, 'DELETE')).status,
      204,
    )
    await json(await send(`/portal/admin/bookings/${booked.booking_id}/cancel`, admin.headers, 'POST', { credit: 'return' }), 200)
    await json(
      await send(`/portal/admin/schedule/classes/${classId}/waitlist/${line.entry_id}/promote`, admin.headers, 'POST', {}),
      201,
    )

    // An Admin on the instructor mounts meets no permission gate either.
    for (const res of [
      await send(`/portal/instructor/clients?q=${encodeURIComponent(`Rostered ${run}`)}`, admin.headers),
      await send(`/portal/instructor/schedule/classes/${classId}/waitlist`, admin.headers, 'POST', { client_id: walkIn }),
      await send(`/portal/instructor/bookings/${booked.booking_id}/cancel`, admin.headers, 'POST', { credit: 'return' }),
    ]) {
      const text = await res.text()
      assert.notEqual(res.status, 401, text)
      assert.notEqual(JSON.parse(text || '{}').error, 'forbidden_permission', text)
    }

    // Check-in stays: the class moved to ten minutes from now, inside the
    // studio's default window (pattern: STF-28).
    const soon = new Date(Date.now() + 10 * 60 * 1000)
    await harness.db
      .update(schema.classes)
      .set({ startsAt: soon, endsAt: new Date(soon.getTime() + HOUR) })
      .where(eq(schema.classes.id, classId))
    const day = await json(await send('/portal/instructor/check-in', tara.headers), 200)
    assert.ok(day.sessions.some((s: any) => s.id === classId), 'the class is on their check-in desk')
    await json(await send('/portal/instructor/check-in/scan', tara.headers, 'POST', { code }), 200)
    const promotedRow = (
      await harness.db
        .select({ id: schema.bookings.id })
        .from(schema.bookings)
        .where(and(eq(schema.bookings.classId, classId), eq(schema.bookings.clientId, waiting)))
    )[0]!
    const ticked = await json(
      await send('/portal/instructor/check-in/manual', tara.headers, 'POST', { booking_id: promotedRow.id }),
      200,
    )
    assert.equal(ticked.check_in_state, 'attended')

    // Back on: every roster action works again, on the next request.
    await json(await setPermissions(admin, tara.id, ALL), 200)
    await worksTheRoster(studio, admin, tara)
  })
})
