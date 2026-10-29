import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
import { connectPayments, usePaymentKey } from './attention-payments'

/**
 * Staff attention: the waitlist and series follow-ups.
 *
 *   - `waitlist_seat_free`: inside the Cancellation Window, a free online seat and
 *     people waiting. Admins and the class's main instructor.
 *   - `series_ending`: a series that runs out of classes within 14 days. Admins.
 *   - `series_ended_class_kept`: a class past its series' end that still has
 *     bookings. Admins, who can dismiss it.
 *
 * Series are made, extended and ended over the admin routes. Every test makes a
 * studio of its own, and the clock is moved to put each edge exactly.
 */
describe('Staff attention: waitlist and series', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  usePaymentKey()
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let ensureAuthUser!: typeof import('../services/auth/auth-users').ensureAuthUser

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const MIN = 60 * 1000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  const WINDOW_HOURS = 24
  /** Singapore is UTC+8 all year: local midnight is 16:00 UTC the evening before. */
  const SGT = 8 * HOUR

  type Studio = { id: string; slug: string; locationId: string; roomId: string; classTypeId: string }
  type Staff = { headers: Record<string, string>; id: string }

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
    const slug = `wls-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Waitlist Studio', adminEmail: `owner@${slug}.test` })
    await connectPayments(tenant.id)
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
      .values({ tenantId: tenant.id, name: 'Hatha' })
      .returning({ id: schema.classTypes.id })
    return { id: tenant.id, slug, locationId: location!.id, roomId: room!.id, classTypeId: type!.id }
  }

  const adminAt = async (studio: Studio): Promise<Staff> => {
    const email = `admin${people++}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name: 'admin', role: 'admin', status: 'active', authUserId: user!.id })
      .returning()
    // The studio's class window is the policy's own, set over the route.
    await json(await send('/portal/admin/policy/global', headers, 'PATCH', { class_window_hours: WINDOW_HOURS }), 200)
    return { headers, id: row!.id }
  }

  const instructorAt = async (studio: Studio, admin: Staff, name: string): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
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
    return { headers: await harness.signInAs('staff', email, studio), id: invitation!.staffUserId! }
  }

  let members = 0
  const memberOf = async (studio: Studio): Promise<string> => {
    const email = `member${members++}@${studio.slug}.test`
    const authUserId = await ensureAuthUser(harness.db, 'client', { email, name: 'Mia', tenantId: studio.id })
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name: 'Mia', phone: '+6580000000', authUserId })
      .returning({ id: schema.clients.id })
    return client!.id
  }

  const book = async (studio: Studio, classId: string, seat: 'online' | 'buffer' = 'online') => {
    const [b] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: studio.id,
        clientId: await memberOf(studio),
        kind: 'class',
        classId,
        seat,
        creditsOrSessionsUsed: 0,
        qrToken: randomUUID(),
        code: `RT-${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning({ id: schema.bookings.id })
    return b!.id
  }

  const wait = async (studio: Studio, classId: string) => {
    const [w] = await harness.db
      .insert(schema.waitlistEntries)
      .values({ tenantId: studio.id, classId, clientId: await memberOf(studio) })
      .returning({ id: schema.waitlistEntries.id })
    return w!.id
  }

  /** A class starting `startsIn` after the app's clock. */
  const classIn = async (
    studio: Studio,
    instructor: Staff,
    admin: Staff,
    startsIn: number,
    over: { online?: number; lifecycle?: 'active' | 'cancelled' } = {},
  ) => {
    const startsAt = new Date(harness.clock.now().getTime() + startsIn)
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: studio.id,
        classTypeId: studio.classTypeId,
        mainInstructorId: instructor.id,
        locationId: studio.locationId,
        roomId: studio.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: over.online ?? 2,
        capacityWaitlist: 5,
        creditCost: 1,
        createdByStaffId: admin.id,
        // Priced, so the instructor-pay line stays out of these counts.
        instructorPaySgd: '30.00',
        ...(over.lifecycle ? { lifecycle: over.lifecycle } : {}),
      })
      .returning({ id: schema.classes.id })
    return { id: cls!.id, startsAt }
  }

  /** A weekly Tuesday 19:00 series from `first` to `last` (plain dates), made over the admin route. */
  const seriesOver = async (studio: Studio, admin: Staff, teacher: Staff, first: string, last: string, hour = 19) => {
    const body = await json(
      await send('/portal/admin/schedule/series', admin.headers, 'POST', {
        class_type_id: studio.classTypeId,
        main_instructor_id: teacher.id,
        instructor_pay_sgd: 30,
        location_id: studio.locationId,
        room_id: studio.roomId,
        weekday: 2,
        start_time: `${hour}:00`,
        end_time: `${hour + 1}:00`,
        capacity_online: 8,
        credit_cost: 1,
        first_date: first,
        last_date: last,
      }),
      201,
    )
    return { id: body.series.id as string, classIds: body.class_ids as string[] }
  }

  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const itemsOf = async (who: Staff, kind: string): Promise<any[]> =>
    ((await panel(who)).needs_action.groups as Array<{ items: Array<Record<string, any>> }>)
      .flatMap(g => g.items)
      .filter(i => i.kind === kind)

  // 2031-06-10 is a Tuesday; the series below run on Tuesdays.
  const T0 = new Date(Date.UTC(2031, 5, 10, 4, 0))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ;({ ensureAuthUser } = await import('../services/auth/auth-users'))
    harness.clock.set(T0)
  })

  after(async () => {
    harness?.clock.reset()
    await harness?.close()
  })

  // ── waitlist_seat_free ──────────────────────────────────────────────

  test('ATN-70 an admin and the class’s main instructor see a class inside the window with a free online seat and people waiting, linking to their own class page; another instructor does not', async () => {
    harness.clock.set(T0)
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const other = await instructorAt(studio, admin, 'other')
    const cls = await classIn(studio, tara, admin, 10 * HOUR, { online: 3 })
    await book(studio, cls.id)
    await wait(studio, cls.id)
    await wait(studio, cls.id)

    const kind = 'waitlist_seat_free'
    const [item] = await itemsOf(admin, kind)
    assert.equal(item.id, `${kind}:${cls.id}`)
    assert.match(item.title, /^Hatha on \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} [ap]m has 2 free seats and 2 people waiting$/)
    assert.equal(item.detail, "The waitlist doesn't fill seats this close to class. Add someone from the waitlist")
    assert.equal(item.href, `/admin/schedule/class/${cls.id}?location=${studio.locationId}`)
    assert.equal(item.dismissable, false)
    assert.deepEqual(item.location, { id: studio.locationId, name: `${studio.slug} Studio` })
    assert.equal(
      (await panel(admin)).needs_action.groups.find((g: any) => g.items.some((i: any) => i.kind === kind)).key,
      'classes_sessions',
    )
    assert.equal((await summary(admin)).needs_action, 1)

    const [mine] = await itemsOf(tara, kind)
    assert.equal(
      mine.href,
      `/instructor/schedule/class/${cls.id}?location=${studio.locationId}`,
      'an instructor is sent to their own page',
    )
    assert.equal((await summary(tara)).needs_action, 1)

    assert.deepEqual(await itemsOf(other, kind), [])
    assert.equal((await summary(other)).needs_action, 0)
  })

  test('ATN-71 it shows from exactly the moment the Cancellation Window opens and goes the moment the class starts', async () => {
    harness.clock.set(T0)
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const cls = await classIn(studio, tara, admin, 3 * DAY)
    await wait(studio, cls.id)
    const see = async () => (await itemsOf(admin, 'waitlist_seat_free')).length

    harness.clock.set(new Date(cls.startsAt.getTime() - WINDOW_HOURS * HOUR - 1))
    assert.equal(await see(), 0, 'a millisecond before the window opens the waitlist still promotes')
    harness.clock.set(new Date(cls.startsAt.getTime() - WINDOW_HOURS * HOUR))
    assert.equal(await see(), 1, 'the waitlist has closed')
    harness.clock.set(new Date(cls.startsAt.getTime() - 1))
    assert.equal(await see(), 1)
    harness.clock.set(cls.startsAt)
    assert.equal(await see(), 0, 'the class has started')
    assert.equal((await summary(admin)).needs_action, 0)
  })

  test('ATN-72 it resolves when the online seats fill, a buffer booking leaves an online seat free, and the copy is singular for one seat and one person', async () => {
    harness.clock.set(T0)
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const cls = await classIn(studio, tara, admin, 5 * HOUR, { online: 2 })
    await wait(studio, cls.id)
    await book(studio, cls.id, 'buffer')
    await book(studio, cls.id)
    assert.equal((await itemsOf(admin, 'waitlist_seat_free')).length, 1, 'one online seat is still free')
    assert.match((await itemsOf(admin, 'waitlist_seat_free'))[0]!.title, / has 1 free seat and 1 person waiting$/)
    await book(studio, cls.id)
    assert.deepEqual(await itemsOf(admin, 'waitlist_seat_free'), [])
  })

  test('ATN-73 it resolves when the line empties; a class with nobody waiting, a cancelled class and one outside the window never show', async () => {
    harness.clock.set(T0)
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const cls = await classIn(studio, tara, admin, 5 * HOUR)
    await classIn(studio, tara, admin, 6 * HOUR)
    const entry = await wait(studio, cls.id)
    assert.equal((await itemsOf(admin, 'waitlist_seat_free')).length, 1, 'only the class with a line')

    await harness.db
      .update(schema.waitlistEntries)
      .set({ status: 'withdrawn', resolvedAt: harness.clock.now(), resolvedBy: 'client' })
      .where(eq(schema.waitlistEntries.id, entry))
    assert.deepEqual(await itemsOf(admin, 'waitlist_seat_free'), [])

    const cancelled = await classIn(studio, tara, admin, 5 * HOUR, { lifecycle: 'cancelled' })
    const far = await classIn(studio, tara, admin, 3 * DAY)
    await wait(studio, cancelled.id)
    await wait(studio, far.id)
    assert.deepEqual(await itemsOf(admin, 'waitlist_seat_free'), [])
  })

  // ── series_ending ───────────────────────────────────────────────────

  test('ATN-74 a series whose last date is within 14 days is an admin item naming the class, weekday, time and last date, linking to the series’ last class; instructors never see it', async () => {
    harness.clock.set(T0)
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const series = await seriesOver(studio, admin, tara, '2031-06-17', '2031-07-01')
    assert.equal(series.classIds.length, 3)
    const lastClass = series.classIds.at(-1)

    harness.clock.set(new Date(Date.UTC(2031, 5, 17) - SGT))
    const [item] = await itemsOf(admin, 'series_ending')
    assert.equal(item.id, `series_ending:${series.id}`)
    assert.equal(item.title, 'The Hatha series on Tuesdays at 7:00 pm runs out after Tue 1 Jul')
    assert.equal(item.detail, 'Extend it to keep classes on the timetable')
    assert.equal(item.href, `/admin/schedule/class/${lastClass}?location=${studio.locationId}`)
    assert.equal(item.dismissable, false)
    assert.equal(
      (await panel(admin)).needs_action.groups.find((g: any) => g.items.some((i: any) => i.kind === 'series_ending')).key,
      'classes_sessions',
    )
    assert.deepEqual(await itemsOf(tara, 'series_ending'), [])
  })

  test('ATN-75 it appears when the last date is 14 days away on the studio’s calendar and goes after the last date has passed', async () => {
    harness.clock.set(T0)
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    await seriesOver(studio, admin, tara, '2031-06-17', '2031-07-01')
    const see = async () => (await itemsOf(admin, 'series_ending')).length
    // Studio midnight of Tue 17 Jun is 16:00 UTC the evening before.
    const midnight = (m: number, d: number) => Date.UTC(2031, m - 1, d) - SGT

    harness.clock.set(new Date(midnight(6, 17) - 1))
    assert.equal(await see(), 0, '15 days to go')
    harness.clock.set(new Date(midnight(6, 17)))
    assert.equal(await see(), 1, '14 days to go')
    harness.clock.set(new Date(midnight(7, 2) - 1))
    assert.equal(await see(), 1, 'the last date itself')
    harness.clock.set(new Date(midnight(7, 2)))
    assert.equal(await see(), 0, 'the last date has passed')
  })

  test('ATN-76 it resolves when the series is extended past 14 days, and when it is ended; an extend that stays inside 14 days leaves it showing, linking to the new last class', async () => {
    harness.clock.set(T0)
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const extended = await seriesOver(studio, admin, tara, '2031-06-17', '2031-07-01')
    const ended = await seriesOver(studio, admin, tara, '2031-06-24', '2031-07-01', 17)
    harness.clock.set(new Date(Date.UTC(2031, 5, 20) - SGT))
    assert.equal((await itemsOf(admin, 'series_ending')).length, 2)

    await json(
      await send(`/portal/admin/schedule/series/${extended.id}/extend`, admin.headers, 'POST', { last_date: '2031-09-30' }),
      200,
    )
    assert.deepEqual(
      (await itemsOf(admin, 'series_ending')).map(i => i.id),
      [`series_ending:${ended.id}`],
    )

    await json(
      await send(`/portal/admin/schedule/series/${ended.id}/end`, admin.headers, 'POST', { from_date: '2031-06-25' }),
      200,
    )
    assert.deepEqual(await itemsOf(admin, 'series_ending'), [])

    const series = await seriesOver(studio, admin, tara, '2031-06-24', '2031-06-24', 15)
    assert.equal((await itemsOf(admin, 'series_ending')).length, 1)
    const grown = await json(
      await send(`/portal/admin/schedule/series/${series.id}/extend`, admin.headers, 'POST', { last_date: '2031-07-01' }),
      200,
    )
    const [item] = await itemsOf(admin, 'series_ending')
    assert.equal(item.href, `/admin/schedule/class/${grown.class_ids.at(-1)}?location=${studio.locationId}`)
    assert.match(item.title, /runs out after Tue 1 Jul$/)
  })
})

/**
 * `series_ended_class_kept` lives in its own block: it needs a series ended with
 * a booked class left running, which `endSeries` leaves for the admin to decide.
 */
describe('Staff attention: a class kept past its series', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  usePaymentKey()
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let ensureAuthUser!: typeof import('../services/auth/auth-users').ensureAuthUser

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const HOUR = 60 * 60 * 1000
  const SGT = 8 * HOUR
  const KIND = 'series_ended_class_kept'
  const T0 = new Date(Date.UTC(2031, 5, 10, 4, 0))

  type Studio = { id: string; slug: string; locationId: string; roomId: string; classTypeId: string }
  type Staff = { headers: Record<string, string>; id: string }
  let studios = 0
  let members = 0

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

  /** A studio, its admin and an instructor, a Tuesday 19:00 series from 17 Jun to 8 Jul, and a booking on each class in `bookedOn`. */
  const scenario = async (bookedOn: number[]) => {
    const slug = `kpt-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Series Studio', adminEmail: `owner@${slug}.test` })
    await connectPayments(tenant.id)
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
      .values({ tenantId: tenant.id, name: 'Hatha' })
      .returning({ id: schema.classTypes.id })
    const studio: Studio = { id: tenant.id, slug, locationId: location!.id, roomId: room!.id, classTypeId: type!.id }

    const staff = async (name: string, role: 'admin' | 'instructor'): Promise<Staff> => {
      const email = `${name}@${slug}.test`
      const headers = await harness.signInAs('staff', email, studio)
      const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
      const [row] = await harness.db
        .insert(schema.staffUsers)
        .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
        .returning()
      if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
      return { headers, id: row!.id }
    }
    const admin = await staff('boss', 'admin')
    const teacher = await staff('teach', 'instructor')

    const created = await json(
      await send('/portal/admin/schedule/series', admin.headers, 'POST', {
        class_type_id: studio.classTypeId,
        main_instructor_id: teacher.id,
        instructor_pay_sgd: 30,
        location_id: studio.locationId,
        room_id: studio.roomId,
        weekday: 2,
        start_time: '19:00',
        end_time: '20:00',
        capacity_online: 8,
        credit_cost: 1,
        first_date: '2031-06-17',
        last_date: '2031-07-08',
      }),
      201,
    )
    const classIds = created.class_ids as string[]
    for (const i of bookedOn) {
      const email = `member${members++}@${slug}.test`
      const authUserId = await ensureAuthUser(harness.db, 'client', { email, name: 'Mia', tenantId: tenant.id })
      const [client] = await harness.db
        .insert(schema.clients)
        .values({ tenantId: tenant.id, email, name: 'Mia', phone: '+6580000000', authUserId })
        .returning({ id: schema.clients.id })
      await harness.db.insert(schema.bookings).values({
        tenantId: tenant.id,
        clientId: client!.id,
        kind: 'class',
        classId: classIds[i]!,
        creditsOrSessionsUsed: 0,
        qrToken: randomUUID(),
        code: `RT-${randomUUID().slice(0, 6).toUpperCase()}`,
      })
    }
    return { studio, admin, teacher, seriesId: created.series.id as string, classIds }
  }

  const endFrom = (s: { admin: Staff; seriesId: string }, from: string) =>
    send(`/portal/admin/schedule/series/${s.seriesId}/end`, s.admin.headers, 'POST', { from_date: from })
  const itemsOf = async (who: Staff) =>
    (
      (await json(await send('/portal/attention', who.headers), 200)).needs_action.groups as Array<{
        items: Array<Record<string, any>>
      }>
    )
      .flatMap(g => g.items)
      .filter(i => i.kind === KIND)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ;({ ensureAuthUser } = await import('../services/auth/auth-users'))
    harness.clock.set(T0)
  })

  after(async () => {
    harness?.clock.reset()
    await harness?.close()
  })

  test('ATN-77 ending a series leaves its booked classes past the end as admin items saying how many bookings, linking to the class; a booked class before the end date is not one, and instructors never see them', async () => {
    harness.clock.set(T0)
    const s = await scenario([1, 2, 2, 3])
    // Classes: 17 Jun, 24 Jun, 1 Jul, 8 Jul. Ending from 1 Jul keeps the two booked ones.
    const ended = await json(await endFrom(s, '2031-07-01'), 200)
    assert.equal(ended.booked_classes.length, 2)

    const items = await itemsOf(s.admin)
    assert.deepEqual(
      items.map(i => i.id),
      [`${KIND}:${s.classIds[2]}`, `${KIND}:${s.classIds[3]}`],
    )
    assert.match(items[0]!.title, /^Hatha on Tue 1 Jul, 7:00 pm is after the end of its series but still has 2 bookings$/)
    assert.match(items[1]!.title, /Tue 8 Jul, 7:00 pm is after the end of its series but still has 1 booking$/)
    assert.equal(items[0]!.detail, 'Cancel it, or dismiss to keep it')
    assert.equal(items[0]!.href, `/admin/schedule/class/${s.classIds[2]}?location=${s.studio.locationId}`)
    assert.equal(items[0]!.dismissable, true)
    assert.deepEqual(await itemsOf(s.teacher), [])
  })

  test('ATN-78 it resolves when the class is cancelled, and the moment it starts', async () => {
    harness.clock.set(T0)
    const s = await scenario([2, 3])
    await json(await endFrom(s, '2031-07-01'), 200)
    assert.equal((await itemsOf(s.admin)).length, 2)

    await json(await send(`/portal/admin/schedule/classes/${s.classIds[2]}/cancel`, s.admin.headers, 'POST'), 200)
    assert.deepEqual(
      (await itemsOf(s.admin)).map(i => i.id),
      [`${KIND}:${s.classIds[3]}`],
    )

    const [cls] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, s.classIds[3]!))
    harness.clock.set(new Date(cls!.startsAt.getTime() - 1))
    assert.equal((await itemsOf(s.admin)).length, 1)
    harness.clock.set(cls!.startsAt)
    assert.deepEqual(await itemsOf(s.admin), [])
  })

  test('ATN-79 an admin dismisses it to keep the class: it goes for every admin, the class and its bookings stay, and an instructor cannot dismiss', async () => {
    harness.clock.set(T0)
    const s = await scenario([2, 3])
    await json(await endFrom(s, '2031-07-01'), 200)
    const dismiss = (who: Staff, id: string) =>
      send('/portal/attention/dismissals', who.headers, 'POST', { kind: KIND, subject_id: id })

    assert.equal((await dismiss(s.teacher, s.classIds[2]!)).status, 403)
    assert.equal((await dismiss(s.admin, s.classIds[2]!)).status, 204)
    assert.deepEqual(
      (await itemsOf(s.admin)).map(i => i.id),
      [`${KIND}:${s.classIds[3]}`],
    )
    assert.equal((await dismiss(s.admin, s.classIds[2]!)).status, 404, 'already dismissed')
    assert.equal((await dismiss(s.admin, randomUUID())).status, 404, 'not an item')
    assert.equal((await dismiss(s.admin, s.classIds[0]!)).status, 404, 'a class before the end is not an item')

    const [cls] = await harness.db.select().from(schema.classes).where(eq(schema.classes.id, s.classIds[2]!))
    assert.equal(cls!.lifecycle, 'active')
    const kept = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.classId, s.classIds[2]!))
    assert.equal(kept.length, 1)
  })
})
