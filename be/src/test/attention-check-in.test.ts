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
 * Staff attention (#476, #481): the `check_in_unfinished` kind. A session that
 * still has people not marked shows in the bell of every Admin and of the
 * session's own Instructor, from an hour after it ends until thirty days after.
 *
 * Every test makes a studio of its own, and the clock is held at one instant per
 * test so the window's two edges are exact.
 */
describe('Staff attention: unfinished check-ins', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  usePaymentKey()
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let ensureAuthUser!: typeof import('../services/auth/auth-users').ensureAuthUser

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const MIN = 60 * 1000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

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
    const slug = `chk-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Check-in Studio', adminEmail: `owner@${slug}.test` })
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

  const codes = () => ({ qrToken: randomUUID(), code: `RT-${randomUUID().slice(0, 6).toUpperCase()}` })
  type Row = 'pending' | 'attended' | 'no_show'

  /** A class that ended `endedAgo` before the app's clock, one confirmed booking per roster row. */
  const classEnded = async (
    studio: Studio,
    instructor: Staff,
    admin: Staff,
    endedAgo: number,
    roster: Row[],
    locationId = studio.locationId,
  ) => {
    const endsAt = new Date(harness.clock.now().getTime() - endedAgo)
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: studio.id,
        classTypeId: studio.classTypeId,
        mainInstructorId: instructor.id,
        locationId,
        roomId: studio.roomId,
        startsAt: new Date(endsAt.getTime() - HOUR),
        endsAt,
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: admin.id,
        // Priced, so the instructor-pay line (#486) stays out of these counts.
        instructorPaySgd: '30.00',
      })
      .returning({ id: schema.classes.id })
    const bookingIds: string[] = []
    for (const state of roster) {
      const [b] = await harness.db
        .insert(schema.bookings)
        .values({
          tenantId: studio.id,
          clientId: await memberOf(studio),
          kind: 'class',
          classId: cls!.id,
          creditsOrSessionsUsed: 0,
          checkInState: state,
          ...codes(),
        })
        .returning({ id: schema.bookings.id })
      bookingIds.push(b!.id)
    }
    return { id: cls!.id, bookingIds, endsAt }
  }

  /** A private session that ended `endedAgo` ago; `seats` are its members, a booking row for each marked one. */
  const ptEnded = async (
    studio: Studio,
    instructor: Staff,
    admin: Staff,
    endedAgo: number,
    seats: Array<Row | 'no_booking'>,
    /** Whether the session's request named a class type (`pt_requests.class_type_id` is optional). */
    withClassType = false,
  ) => {
    const endsAt = new Date(harness.clock.now().getTime() - endedAgo)
    let ptRequestId: string | undefined
    if (withClassType) {
      const [request] = await harness.db
        .insert(schema.ptRequests)
        .values({
          tenantId: studio.id,
          clientId: await memberOf(studio),
          locationId: studio.locationId,
          classTypeId: studio.classTypeId,
          sessionType: seats.length > 1 ? '2on1' : '1on1',
          status: 'scheduled',
          expiresAt: new Date(endsAt.getTime() + DAY),
        })
        .returning({ id: schema.ptRequests.id })
      ptRequestId = request!.id
    }
    const [session] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: studio.id,
        ...(ptRequestId ? { ptRequestId } : {}),
        instructorId: instructor.id,
        locationId: studio.locationId,
        roomId: studio.roomId,
        startsAt: new Date(endsAt.getTime() - HOUR),
        endsAt,
        sessionType: seats.length > 1 ? '2on1' : '1on1',
        capacityOnline: seats.length,
        scheduledAt: new Date(endsAt.getTime() - 7 * DAY),
        scheduledByStaffId: admin.id,
        instructorPaySgd: '30.00',
      })
      .returning({ id: schema.ptSessions.id })
    for (const seat of seats) {
      const clientId = await memberOf(studio)
      await harness.db.insert(schema.ptSessionClients).values({ tenantId: studio.id, ptSessionId: session!.id, clientId })
      if (seat === 'no_booking') continue
      await harness.db.insert(schema.bookings).values({
        tenantId: studio.id,
        clientId,
        kind: 'pt',
        ptSessionId: session!.id,
        creditsOrSessionsUsed: 0,
        checkInState: seat,
        ...codes(),
      })
    }
    return { id: session!.id, endsAt }
  }

  const summary = async (who: Staff, query = '') => json(await send(`/portal/attention/summary${query}`, who.headers), 200)
  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const unfinished = async (who: Staff) =>
    ((await panel(who)).needs_action.groups as Array<{ items: Array<Record<string, any>> }>)
      .flatMap(g => g.items)
      .filter(i => i.kind === 'check_in_unfinished')

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ;({ ensureAuthUser } = await import('../services/auth/auth-users'))
    harness.clock.set(new Date(Date.UTC(2031, 5, 10, 12, 0)))
  })

  after(async () => {
    await harness?.close()
  })

  test('ATN-40 an admin sees a class with unmarked people as one Classes & sessions item that counts them, links to the desk on that date with the session selected, and feeds the check_in badge', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const cls = await classEnded(studio, tara, admin, 3 * HOUR, ['pending', 'pending', 'attended', 'no_show'])

    const counts = await summary(admin)
    assert.equal(counts.by_group.check_in, 1)
    assert.equal(counts.needs_action, 1)

    const body = await panel(admin)
    const group = body.needs_action.groups.find((g: any) => g.key === 'classes_sessions')
    assert.equal(group.label, 'Classes & sessions')
    assert.equal(group.see_all_href, '/admin/check-in')
    const [item] = group.items
    assert.equal(item.id, `check_in_unfinished:class:${cls.id}`)
    assert.equal(item.kind, 'check_in_unfinished')
    // Copy as spec #476 words it: "Finish check-in for {class} on {date}" / "{n} of {m} people not marked · {time} · {location}".
    assert.match(item.title, /^Finish check-in for Hatha on \w{3} \d{1,2} \w{3}$/)
    assert.match(item.detail, new RegExp(`^2 of 4 people not marked · \\d{1,2}:\\d{2} [ap]m · ${studio.slug} Studio$`))
    assert.equal(item.href, `/admin/check-in?date=2031-06-10&session=class:${cls.id}&location=${studio.locationId}`)
    assert.deepEqual(item.location, { id: studio.locationId, name: `${studio.slug} Studio` })
    assert.equal(item.dismissable, false)

    const mine = await unfinished(tara)
    assert.equal(mine.length, 1)
    assert.equal(
      mine[0]!.href,
      `/instructor/check-in?date=2031-06-10&session=class:${cls.id}&location=${studio.locationId}`,
      'the link opens the viewer’s own desk',
    )
  })

  test('ATN-41 an item appears from an hour after the session ends and is left out after thirty days, both edges on the app’s clock', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const start = harness.clock.now()
    const cls = await classEnded(studio, tara, admin, 0, ['pending'])
    const see = async () => (await unfinished(admin)).filter(i => i.id === `check_in_unfinished:class:${cls.id}`).length

    harness.clock.set(new Date(cls.endsAt.getTime() + HOUR - 1))
    assert.equal(await see(), 0, 'one millisecond short of an hour')
    assert.equal((await summary(admin)).by_group.check_in ?? 0, 0)

    harness.clock.set(new Date(cls.endsAt.getTime() + HOUR))
    assert.equal(await see(), 1, 'exactly an hour after it ended')
    assert.equal((await summary(admin)).by_group.check_in, 1)

    harness.clock.set(new Date(cls.endsAt.getTime() + 30 * DAY - 1))
    assert.equal(await see(), 1, 'still there a millisecond inside thirty days')

    harness.clock.set(new Date(cls.endsAt.getTime() + 30 * DAY))
    assert.equal(await see(), 0, 'gone at thirty days')
    assert.equal((await summary(admin)).by_group.check_in ?? 0, 0)
    harness.clock.set(start)
  })

  test('ATN-42 an instructor sees only the sessions they teach, a class by its main instructor and a private session by its instructor, while an admin sees every one', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const kim = await instructorAt(studio, admin, 'kim')
    const taraClass = await classEnded(studio, tara, admin, 2 * HOUR, ['pending'])
    await classEnded(studio, kim, admin, 2 * HOUR, ['pending'])
    const taraPt = await ptEnded(studio, tara, admin, 2 * HOUR, ['pending'])
    await ptEnded(studio, kim, admin, 2 * HOUR, ['pending'])

    assert.deepEqual(
      (await unfinished(tara)).map(i => i.id).sort(),
      [`check_in_unfinished:class:${taraClass.id}`, `check_in_unfinished:pt:${taraPt.id}`].sort(),
    )
    assert.equal((await summary(tara)).by_group.check_in, 2)
    assert.equal((await summary(admin)).by_group.check_in, 4)
    const pt = (await unfinished(tara)).find(i => i.id.includes(':pt:'))!
    assert.match(pt.title, /^Finish check-in for Private session on /)
    assert.match(pt.detail, /^1 of 1 person not marked · /)
    assert.equal(pt.href, `/instructor/check-in?date=2031-06-10&session=pt:${taraPt.id}&location=${studio.locationId}`)
  })

  test('ATN-43 a private session counts a member with no booking as unmarked, as the desk does', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const pt = await ptEnded(studio, tara, admin, 2 * HOUR, ['attended', 'no_booking'])

    const [item] = await unfinished(admin)
    assert.equal(item!.id, `check_in_unfinished:pt:${pt.id}`)
    assert.match(item!.title, /^Finish check-in for Private session on /)
    assert.match(item!.detail, /^1 of 2 people not marked · /)
  })

  test('ATN-193 a private session booked for a class type is named by it, as its request item is', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const pt = await ptEnded(studio, tara, admin, 2 * HOUR, ['pending'], true)

    const [item] = await unfinished(admin)
    assert.equal(item!.id, `check_in_unfinished:pt:${pt.id}`)
    assert.match(item!.title, /^Finish check-in for Hatha on /)
  })

  test('ATN-44 the item goes once every row is attended or no-show, and a cancelled session never shows', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const cls = await classEnded(studio, tara, admin, 2 * HOUR, ['pending', 'pending'])
    const cancelled = await classEnded(studio, tara, admin, 2 * HOUR, ['pending'])
    await harness.db.update(schema.classes).set({ lifecycle: 'cancelled' }).where(eq(schema.classes.id, cancelled.id))

    assert.equal((await unfinished(admin)).length, 1)
    assert.equal((await summary(admin)).by_group.check_in, 1)

    await harness.db.update(schema.bookings).set({ checkInState: 'attended' }).where(eq(schema.bookings.id, cls.bookingIds[0]!))
    assert.match((await unfinished(admin))[0]!.detail, /^1 of 2 people not marked/)
    await harness.db.update(schema.bookings).set({ checkInState: 'no_show' }).where(eq(schema.bookings.id, cls.bookingIds[1]!))
    assert.deepEqual(await unfinished(admin), [])
    assert.equal((await summary(admin)).by_group.check_in ?? 0, 0)
    assert.equal((await summary(admin)).needs_action, 0)
  })

  test('ATN-45 the check_in badge honours location_id while the bubble counts every location, and another studio sees none of it', async () => {
    const studio = await freshStudio()
    const other = await freshStudio()
    const east = (
      await harness.db
        .insert(schema.locations)
        .values({ tenantId: studio.id, name: `${studio.slug} East`, address: '2 Test Street' })
        .returning({ id: schema.locations.id })
    )[0]!.id
    const admin = await adminAt(studio)
    const otherAdmin = await adminAt(other)
    const tara = await instructorAt(studio, admin, 'tara')
    await classEnded(studio, tara, admin, 2 * HOUR, ['pending'])
    await classEnded(studio, tara, admin, 2 * HOUR, ['pending'], east)
    await classEnded(studio, tara, admin, 2 * HOUR, ['pending'], east)

    const all = await summary(admin)
    assert.equal(all.needs_action, 3)
    assert.equal(all.by_group.check_in, 3)
    const here = await summary(admin, `?location_id=${studio.locationId}`)
    assert.equal(here.needs_action, 3)
    assert.equal(here.by_group.check_in, 1)
    assert.equal((await summary(admin, `?location_id=${east}`)).by_group.check_in, 2)

    assert.equal((await summary(otherAdmin)).needs_action, 0)
  })
})
