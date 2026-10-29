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

/**
 * Staff attention, Updates about sessions (#476, #493): `session_changed`,
 * `session_cancelled_by_admin` and `pt_session_cancelled_by_member`. Each is
 * written in the transaction of the act that caused it, for the instructors on
 * the session, and never for the person who did the act.
 *
 * Every test makes a studio of its own. These tests read the Updates tab and
 * the bell's unread count only, so they say nothing about Needs action items.
 */
describe('Staff attention: session Updates', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  type Studio = { id: string; slug: string; locationId: string; roomId: string; classTypeId: string }
  type Staff = { headers: Record<string, string>; id: string; name: string }
  type Member = { clientId: string; name: string; headers: Record<string, string> }

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
    const slug = `ses-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Session Studio', adminEmail: `owner@${slug}.test` })
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

  const otherRoom = async (studio: Studio) => {
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: studio.id, locationId: studio.locationId, name: `Second room ${people++}`, capacity: 10 })
      .returning({ id: schema.rooms.id })
    return room!.id
  }

  const adminAt = async (studio: Studio, name = 'boss'): Promise<Staff> => {
    const email = `${name}${people++}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role: 'admin', status: 'active', authUserId: user!.id })
      .returning()
    return { headers, id: row!.id, name }
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
    const id = invitation!.staffUserId!
    // The tests that have an instructor cancel their own session need these.
    await json(
      await send(`/portal/admin/staff/${id}`, admin.headers, 'PATCH', {
        permissions: ['schedule_classes', 'take_pt_bookings'],
      }),
      200,
    )
    return { headers: await harness.signInAs('staff', email, studio), id, name }
  }

  let members = 0
  const memberOf = async (studio: Studio, name = 'Mia'): Promise<Member> => {
    const email = `member${members++}@${studio.slug}.test`
    const headers = await harness.signInAs('client', email, studio)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, studio.id)))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, name, headers }
  }

  const codes = () => ({ qrToken: randomUUID(), code: `RT-${randomUUID().slice(0, 6).toUpperCase()}` })

  let slots = 0
  /** A start `days` days from now on the hour, plus a few minutes no other fixture shares, so two never start together. */
  const startIn = (days: number) => new Date(Math.floor((Date.now() + days * DAY) / HOUR) * HOUR + slots++ * 7 * 60 * 1000)

  /** A scheduled class with `main`, and `supporting` beside them, `days` from now. */
  const classOf = async (studio: Studio, admin: Staff, main: Staff, supporting: Staff[] = [], days = 5) => {
    const startsAt = startIn(days)
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: studio.id,
        classTypeId: studio.classTypeId,
        mainInstructorId: main.id,
        locationId: studio.locationId,
        roomId: studio.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: admin.id,
        instructorPaySgd: '30.00',
      })
      .returning({ id: schema.classes.id })
    for (const s of supporting) {
      await harness.db.insert(schema.classSupportingInstructors).values({ tenantId: studio.id, classId: cls!.id, instructorId: s.id })
    }
    return { id: cls!.id, startsAt }
  }

  /** A scheduled private session for `member` with `instructor`, as the studio leaves one after scheduling. */
  const ptOf = async (studio: Studio, admin: Staff, instructor: Staff, member: Member, days = 5) => {
    const startsAt = startIn(days)
    const [req] = await harness.db
      .insert(schema.ptRequests)
      .values({
        tenantId: studio.id,
        clientId: member.clientId,
        locationId: studio.locationId,
        sessionType: '1on1',
        status: 'scheduled',
        expiresAt: new Date(Date.now() + 2 * DAY),
      })
      .returning({ id: schema.ptRequests.id })
    const [session] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: studio.id,
        ptRequestId: req!.id,
        instructorId: instructor.id,
        locationId: studio.locationId,
        roomId: studio.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        sessionType: '1on1',
        capacityOnline: 1,
        scheduledAt: new Date(),
        scheduledByStaffId: admin.id,
        instructorPaySgd: '30.00',
      })
      .returning({ id: schema.ptSessions.id })
    await harness.db.update(schema.ptRequests).set({ scheduledPtSessionId: session!.id }).where(eq(schema.ptRequests.id, req!.id))
    await harness.db.insert(schema.ptSessionClients).values({ tenantId: studio.id, ptSessionId: session!.id, clientId: member.clientId })
    const [booking] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: studio.id,
        clientId: member.clientId,
        kind: 'pt',
        ptSessionId: session!.id,
        creditsOrSessionsUsed: 0,
        ...codes(),
      })
      .returning({ id: schema.bookings.id })
    return { requestId: req!.id, id: session!.id, bookingId: booking!.id, startsAt }
  }

  /** A one-day workshop taught by `main` (and `supporting`) on its day, `days` from now. */
  const workshopOf = async (studio: Studio, admin: Staff, main: Staff, supporting: Staff[] = [], days = 9) => {
    const startsAt = startIn(days)
    const [w] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: studio.id, name: 'Inversions', locationId: studio.locationId, createdByStaffId: admin.id })
      .returning({ id: schema.workshops.id })
    const [day] = await harness.db
      .insert(schema.workshopDays)
      .values({
        tenantId: studio.id,
        workshopId: w!.id,
        ord: 1,
        roomId: studio.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * HOUR),
        basePriceSgd: '0.00',
        capacityOnline: 10,
      })
      .returning({ id: schema.workshopDays.id })
    await harness.db.insert(schema.workshopInstructors).values([
      { tenantId: studio.id, workshopId: w!.id, instructorId: main.id, role: 'main' as const },
      ...supporting.map(s => ({ tenantId: studio.id, workshopId: w!.id, instructorId: s.id, role: 'supporting' as const })),
    ])
    return { id: w!.id, dayId: day!.id, startsAt }
  }

  // Inviting an Instructor and granting their permissions legitimately tells them `permissions_changed` and the
  // Admins `staff_joined` (#491), so both helpers read only this ticket's kinds.
  const SESSION_KINDS = ['session_changed', 'session_cancelled_by_admin', 'pt_session_cancelled_by_member']
  const updatesOf = async (who: Staff) =>
    (
      (await json(await send('/portal/attention', who.headers), 200)).updates.items as Array<Record<string, any>>
    ).filter(u => SESSION_KINDS.includes(u.kind))
  const unread = async (who: Staff) => (await updatesOf(who)).filter(u => !u.read_at).length

  const patchClass = (admin: Staff, id: string, body: Record<string, unknown>) =>
    send(`/portal/admin/schedule/classes/${id}`, admin.headers, 'PATCH', body)

  /** "Tue 28 Oct, 7:00 pm" in Singapore, the studio's default zone. */
  const when = (at: Date) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Singapore',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
        .formatToParts(at)
        .map(x => [x.type, x.value]),
    )
    return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}`
  }
  const dayOf = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(at)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
  })

  after(async () => {
    await harness?.close()
  })

  test('ATN-180 moving a class tells its main and supporting instructors, linking the class, and tells the admin who moved it nothing', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const cls = await classOf(studio, admin, ada, [ben])
    const newStart = new Date(cls.startsAt.getTime() + DAY + HOUR)

    await json(
      await patchClass(admin, cls.id, { starts_at: newStart.toISOString(), ends_at: new Date(newStart.getTime() + HOUR).toISOString() }),
      200,
    )

    for (const who of [ada, ben]) {
      assert.equal(await unread(who), 1)
      const [u] = await updatesOf(who)
      assert.equal(u!.kind, 'session_changed')
      assert.equal(u!.title, `boss moved Hatha from ${when(cls.startsAt)} to ${when(newStart)}`)
      assert.equal(u!.href, `/instructor/schedule/class/${cls.id}`)
    }
    assert.equal(await unread(admin), 0)
  })

  test('ATN-195 an admin who also teaches is linked to the admin portal for every session Update, never to the instructor one', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const dual = await adminAt(studio, 'dual')
    await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: dual.id })
    const ada = await instructorAt(studio, admin, 'ada')
    const mia = await memberOf(studio, 'Mia')

    // Moved: the class page.
    const moved = await classOf(studio, admin, dual)
    const newStart = new Date(moved.startsAt.getTime() + DAY)
    await json(
      await patchClass(admin, moved.id, { starts_at: newStart.toISOString(), ends_at: new Date(newStart.getTime() + HOUR).toISOString() }),
      200,
    )
    // Cancelled: the class page.
    const cancelled = await classOf(studio, admin, dual)
    await json(await send(`/portal/admin/schedule/classes/${cancelled.id}/cancel`, admin.headers, 'POST', {}), 200)
    // Handed to someone else: the schedule on that day.
    const handed = await classOf(studio, admin, dual)
    await json(await patchClass(admin, handed.id, { main_instructor_id: ada.id }), 200)
    // A member cancelling their private session: the session page.
    const pt = await ptOf(studio, admin, dual, mia)
    await json(await send(`/me/pt-sessions/${pt.requestId}/cancel`, mia.headers, 'POST', {}), 200)

    const hrefs = new Map((await updatesOf(dual)).map(u => [u.kind + (u.title.includes(' gave ') ? ':handed' : ''), u.href as string]))
    assert.equal(hrefs.get('session_cancelled_by_admin'), `/admin/schedule/class/${cancelled.id}`)
    assert.equal(hrefs.get('session_changed:handed'), `/admin/schedule?date=${dayOf(handed.startsAt)}`)
    assert.equal(hrefs.get('session_changed'), `/admin/schedule/class/${moved.id}`)
    assert.equal(hrefs.get('pt_session_cancelled_by_member'), `/admin/schedule/pt/${pt.id}`)
    for (const href of hrefs.values()) assert.ok(href.startsWith('/admin/'), href)
  })

  test('ATN-197 every session Update that names a member is stored with that member, so permanently deleting them removes it; a session with two members names neither', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const mia = await memberOf(studio, 'Mia')
    const noor = await memberOf(studio, 'Noor')
    const omar = await memberOf(studio, 'Omar')

    // Mia's one-on-one is moved and then cancelled by an admin; her other one she cancels herself.
    const moved = await ptOf(studio, admin, ada, mia)
    const newStart = new Date(moved.startsAt.getTime() + DAY)
    await json(
      await send(`/portal/admin/pt-sessions/sessions/${moved.id}`, admin.headers, 'PATCH', {
        starts_at: newStart.toISOString(),
        ends_at: new Date(newStart.getTime() + HOUR).toISOString(),
      }),
      200,
    )
    await json(await send(`/portal/admin/pt-sessions/${moved.requestId}/cancel`, admin.headers, 'POST', {}), 200)
    const hers = await ptOf(studio, admin, ben, mia, 7)
    await json(await send(`/me/pt-sessions/${hers.requestId}/cancel`, mia.headers, 'POST', {}), 200)

    // A 2-on-1 of Noor and Omar is moved: the Update names neither.
    const pair = await ptOf(studio, admin, ada, noor, 9)
    await harness.db.insert(schema.ptSessionClients).values({ tenantId: studio.id, ptSessionId: pair.id, clientId: omar.clientId })
    const pairStart = new Date(pair.startsAt.getTime() + DAY)
    await json(
      await send(`/portal/admin/pt-sessions/sessions/${pair.id}`, admin.headers, 'PATCH', {
        starts_at: pairStart.toISOString(),
        ends_at: new Date(pairStart.getTime() + HOUR).toISOString(),
      }),
      200,
    )

    const rows = await harness.db.select().from(schema.staffUpdates).where(eq(schema.staffUpdates.tenantId, studio.id))
    const sessionRows = rows.filter(r => SESSION_KINDS.includes(r.kind))
    const named = (r: (typeof sessionRows)[number]) => JSON.stringify(r.payload).includes('Mia')
    assert.ok(sessionRows.filter(named).length >= 3, 'moved, cancelled by an admin, and cancelled by the member all name Mia')
    for (const r of sessionRows.filter(named)) assert.equal(r.subjectClientId, mia.clientId, r.kind)
    const pairRow = sessionRows.find(r => (r.payload as { sessionId?: string }).sessionId === pair.id)
    assert.equal((pairRow!.payload as { subject: string }).subject, 'the 2-on-1 private session')
    assert.equal(pairRow!.subjectClientId, null)
    for (const name of ['Noor', 'Omar']) assert.ok(!JSON.stringify(pairRow!.payload).includes(name), name)

    await json(
      await harness.app.request(`/api/v1/portal/admin/clients/${mia.clientId}/permanently`, { method: 'DELETE', headers: admin.headers }),
      200,
    )
    const after = await harness.db.select().from(schema.staffUpdates).where(eq(schema.staffUpdates.tenantId, studio.id))
    assert.ok(!after.some(r => JSON.stringify(r.payload).includes('Mia')), 'nothing left names Mia')
    assert.ok(after.some(r => r.id === pairRow!.id), 'the 2-on-1 Update is not Mia’s to take')
  })

  test('ATN-181 changing only a class’s room tells the instructors it changed, and an edit that changes nothing they teach tells nobody', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const cls = await classOf(studio, admin, ada)

    await json(await patchClass(admin, cls.id, { capacity_online: 12 }), 200)
    assert.equal(await unread(ada), 0)

    await json(await patchClass(admin, cls.id, { room_id: await otherRoom(studio) }), 200)
    const [u] = await updatesOf(ada)
    assert.equal(u!.kind, 'session_changed')
    assert.equal(u!.title, `boss changed the room, location or end time of Hatha on ${when(cls.startsAt)}`)
    assert.equal(u!.href, `/instructor/schedule/class/${cls.id}`)
    assert.equal(await unread(ada), 1)
  })

  test('ATN-182 giving a class to another instructor tells the one taken off, linking the schedule that day, and the supporting instructor who stays; the new one is told nothing here', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const cat = await instructorAt(studio, admin, 'cat')
    const cls = await classOf(studio, admin, ada, [cat])

    await json(await patchClass(admin, cls.id, { main_instructor_id: ben.id }), 200)

    const [handed] = await updatesOf(ada)
    assert.equal(handed!.kind, 'session_changed')
    assert.equal(handed!.title, `boss gave Hatha on ${when(cls.startsAt)} to ben`)
    assert.equal(handed!.href, `/instructor/schedule?date=${dayOf(cls.startsAt)}`)

    const [stays] = await updatesOf(cat)
    assert.equal(stays!.title, `boss changed the instructor of Hatha on ${when(cls.startsAt)} to ben`)
    assert.equal(stays!.href, `/instructor/schedule/class/${cls.id}`)

    assert.equal(await unread(ben), 0)
  })

  test('ATN-183 taking a supporting instructor off a class tells them, and moving a class and handing it over at once gives the one taken off a single update', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const cat = await instructorAt(studio, admin, 'cat')
    const cls = await classOf(studio, admin, ada, [cat])

    await json(await patchClass(admin, cls.id, { supporting_instructor_ids: [] }), 200)
    const [removed] = await updatesOf(cat)
    assert.equal(removed!.title, `boss took you off Hatha on ${when(cls.startsAt)}`)
    assert.equal(removed!.href, `/instructor/schedule?date=${dayOf(cls.startsAt)}`)
    assert.equal(await unread(ada), 0)

    const later = new Date(cls.startsAt.getTime() + 2 * HOUR)
    await json(
      await patchClass(admin, cls.id, {
        main_instructor_id: ben.id,
        starts_at: later.toISOString(),
        ends_at: new Date(later.getTime() + HOUR).toISOString(),
      }),
      200,
    )
    const items = await updatesOf(ada)
    assert.equal(items.length, 1)
    assert.equal(items[0]!.title, `boss gave Hatha on ${when(later)} to ben`)
  })

  test('ATN-184 an admin cancelling a class tells everyone teaching it; ending a series that cancels classes writes one update per class', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const cls = await classOf(studio, admin, ada, [ben])

    await json(await send(`/portal/admin/schedule/classes/${cls.id}/cancel`, admin.headers, 'POST', {}), 200)
    for (const who of [ada, ben]) {
      const [u] = await updatesOf(who)
      assert.equal(u!.kind, 'session_cancelled_by_admin')
      assert.equal(u!.title, `boss cancelled Hatha on ${when(cls.startsAt)}, which you were teaching`)
      assert.equal(u!.href, `/instructor/schedule/class/${cls.id}`)
    }
    assert.equal(await unread(admin), 0)

    // A weekly series with three classes, ended from its first date: all three are unbooked, so all three are cancelled.
    const first = new Date(Date.now() + 8 * DAY + 8 * HOUR)
    const date = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(d)
    const room = await otherRoom(studio)
    const made = await json(
      await send('/portal/admin/schedule/series', admin.headers, 'POST', {
        class_type_id: studio.classTypeId,
        location_id: studio.locationId,
        room_id: room,
        weekday: Number(
          { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[
            new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', weekday: 'short' }).format(first) as 'Mon'
          ],
        ),
        start_time: '10:00',
        end_time: '11:00',
        capacity_online: 8,
        credit_cost: 1,
        first_date: date(first),
        last_date: date(new Date(first.getTime() + 14 * DAY)),
        main_instructor_id: ada.id,
        supporting_instructors: [{ instructor_id: ben.id }],
      }),
      201,
    )
    assert.equal(made.class_ids.length, 3)
    const before = (await updatesOf(ada)).length
    const ended = await json(
      await send(`/portal/admin/schedule/series/${made.series.id}/end`, admin.headers, 'POST', { from_date: date(first) }),
      200,
    )
    assert.equal(ended.cancelled_class_ids.length, 3)
    assert.equal((await updatesOf(ada)).length, before + 3)
    assert.equal((await updatesOf(ben)).length, before + 3)
  })

  test('ATN-185 an admin cancelling a private session, or moving it, tells its instructor; handing it to another tells the one taken off', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const mia = await memberOf(studio, 'Mia')
    const pt = await ptOf(studio, admin, ada, mia)

    const moved = new Date(pt.startsAt.getTime() + DAY)
    await json(
      await send(`/portal/admin/pt-sessions/sessions/${pt.id}`, admin.headers, 'PATCH', {
        starts_at: moved.toISOString(),
        ends_at: new Date(moved.getTime() + HOUR).toISOString(),
      }),
      200,
    )
    const [m] = await updatesOf(ada)
    assert.equal(m!.title, `boss moved the private session with Mia from ${when(pt.startsAt)} to ${when(moved)}`)
    assert.equal(m!.href, `/instructor/schedule/pt/${pt.id}`)

    await json(await send(`/portal/admin/pt-sessions/sessions/${pt.id}`, admin.headers, 'PATCH', { instructor_id: ben.id }), 200)
    const [h] = await updatesOf(ada)
    assert.equal(h!.title, `boss gave the private session with Mia on ${when(moved)} to ben`)
    assert.equal(await unread(ben), 0)

    await json(await send(`/portal/admin/pt-sessions/${pt.requestId}/cancel`, admin.headers, 'POST', {}), 200)
    const [c] = await updatesOf(ben)
    assert.equal(c!.kind, 'session_cancelled_by_admin')
    assert.equal(c!.title, `boss cancelled the private session with Mia on ${when(moved)}, which you were teaching`)
    assert.equal(c!.href, `/instructor/schedule/pt/${pt.id}`)
    // Ada was taken off before it was cancelled: she hears nothing more.
    assert.equal(await unread(ada), 2)
  })

  test('ATN-186 an admin cancelling a workshop tells its instructors, linking the schedule that day', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const w = await workshopOf(studio, admin, ada, [ben])

    await json(await send(`/portal/admin/workshops/${w.id}/cancel`, admin.headers, 'POST', {}), 200)
    for (const who of [ada, ben]) {
      const [u] = await updatesOf(who)
      assert.equal(u!.kind, 'session_cancelled_by_admin')
      assert.equal(u!.title, `boss cancelled Inversions on ${when(w.startsAt)}, which you were teaching`)
      assert.equal(u!.href, `/instructor/schedule?date=${dayOf(w.startsAt)}`)
    }
  })

  test('ATN-187 moving a workshop day, or giving the workshop to another instructor, tells the instructors', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const ben = await instructorAt(studio, admin, 'ben')
    const w = await workshopOf(studio, admin, ada)

    const moved = new Date(w.startsAt.getTime() + DAY)
    await json(
      await send(`/portal/admin/workshops/${w.id}/days/${w.dayId}`, admin.headers, 'PATCH', {
        starts_at: moved.toISOString(),
        ends_at: new Date(moved.getTime() + 2 * HOUR).toISOString(),
      }),
      200,
    )
    const [m] = await updatesOf(ada)
    assert.equal(m!.title, `boss moved Inversions from ${when(w.startsAt)} to ${when(moved)}`)
    assert.equal(m!.href, `/instructor/schedule?date=${dayOf(moved)}`)

    await json(await send(`/portal/admin/workshops/${w.id}`, admin.headers, 'PATCH', { main_instructor_id: ben.id }), 200)
    const [h] = await updatesOf(ada)
    assert.equal(h!.title, `boss gave Inversions on ${when(moved)} to ben`)
    assert.equal(await unread(ben), 0)
  })

  test('ATN-201 an Admin who also teaches a workshop moves its day in the editor\'s one save: the other instructor is told by the Admin\'s name, the Admin is told nothing, and a refused save tells nobody', async () => {
    const studio = await freshStudio()
    const owner = await adminAt(studio)
    const dual = await adminAt(studio, 'dual')
    await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: dual.id })
    const ada = await instructorAt(studio, owner, 'ada')
    const w = await workshopOf(studio, owner, ada, [dual])
    const mia = await memberOf(studio, 'Mia')

    const tierIds: string[] = []
    for (const [i, name] of ['Full', 'Other'].entries()) {
      const [tier] = await harness.db
        .insert(schema.workshopTiers)
        .values({ tenantId: studio.id, workshopId: w.id, name, regularPriceSgd: '100.00', ord: i + 1 })
        .returning({ id: schema.workshopTiers.id })
      await harness.db.insert(schema.workshopTierDays).values({ tenantId: studio.id, workshopTierId: tier!.id, workshopDayId: w.dayId })
      tierIds.push(tier!.id)
    }

    const detailPath = `/portal/admin/workshops/${w.id}`
    const read = async () =>
      (await json(await send(detailPath, dual.headers), 200)) as {
        name: string
        days: { id: string; room_id: string; starts_at: string; ends_at: string; capacity_online: number }[]
      }
    const saveWith = async (moveBy: number, keep: string[]) => {
      const [day] = (await read()).days
      return send(detailPath, dual.headers, 'PATCH', {
        days: [
          {
            id: day!.id,
            ref: day!.id,
            room_id: day!.room_id,
            starts_at: new Date(Date.parse(day!.starts_at) + moveBy).toISOString(),
            ends_at: new Date(Date.parse(day!.ends_at) + moveBy).toISOString(),
            capacity_online: day!.capacity_online,
          },
        ],
        tiers: keep.map(id => ({ id, name: id === tierIds[0] ? 'Full' : 'Other', regular_price_sgd: '100.00', day_refs: [day!.id] })),
      })
    }

    await json(await saveWith(DAY, tierIds), 200)
    const moved = new Date(w.startsAt.getTime() + DAY)
    const [told] = await updatesOf(ada)
    assert.equal(told!.title, `dual moved Inversions from ${when(w.startsAt)} to ${when(moved)}`)
    assert.equal((await updatesOf(ada)).length, 1)
    assert.deepEqual(await updatesOf(dual), [], 'the Admin who saved was told of their own change')

    // A member is still paying for the first tier, so taking it off is refused.
    await harness.db.insert(schema.purchases).values({
      tenantId: studio.id,
      clientId: mia.clientId,
      kind: 'workshop',
      totalSgd: '100.00',
      metadata: { workshop_tier_id: tierIds[0], workshop_id: w.id },
    })
    const refused = await json(await saveWith(DAY, [tierIds[1]!]), 409)
    assert.equal(refused.error, 'workshop_tier_has_open_purchases')
    assert.equal((await updatesOf(ada)).length, 1, 'a refused save told the instructor')
    assert.deepEqual(await updatesOf(dual), [])
  })

  test('ATN-188 a member cancelling their private session, by the request or by their booking, tells its instructor and names the member', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await instructorAt(studio, admin, 'ada')
    const mia = await memberOf(studio, 'Mia')
    const noor = await memberOf(studio, 'Noor')
    const first = await ptOf(studio, admin, ada, mia)
    const second = await ptOf(studio, admin, ada, noor, 6)

    await json(await send(`/me/pt-sessions/${first.requestId}/cancel`, mia.headers, 'POST', {}), 200)
    await json(await send(`/me/bookings/${second.bookingId}`, noor.headers, 'DELETE'), 200)

    const items = await updatesOf(ada)
    assert.equal(items.length, 2)
    const byTitle = new Map(items.map(u => [u.title as string, u]))
    const miaUpdate = byTitle.get(`Mia cancelled their private session with you on ${when(first.startsAt)}`)
    const noorUpdate = byTitle.get(`Noor cancelled their private session with you on ${when(second.startsAt)}`)
    assert.equal(miaUpdate?.kind, 'pt_session_cancelled_by_member')
    assert.equal(miaUpdate?.href, `/instructor/schedule/pt/${first.id}`)
    assert.equal(noorUpdate?.href, `/instructor/schedule/pt/${second.id}`)
    assert.equal(await unread(admin), 0)
  })

  test('ATN-189 an instructor cancelling their own class or private session is told nothing by it, and one admin cancelling tells the others nothing', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const other = await adminAt(studio, 'second')
    const ada = await instructorAt(studio, admin, 'ada')
    const mia = await memberOf(studio, 'Mia')
    const cls = await classOf(studio, admin, ada)
    const pt = await ptOf(studio, admin, ada, mia)

    await json(await send(`/portal/instructor/schedule/classes/${cls.id}/cancel`, ada.headers, 'POST', { reason: 'Unwell' }), 200)
    await json(await send(`/portal/instructor/pt-requests/${pt.requestId}/cancel`, ada.headers, 'POST', {}), 200)
    assert.equal(await unread(ada), 0)
    assert.deepEqual(await updatesOf(ada), [])

    // Another admin cancelling a class nobody else teaches writes nothing for admins: these updates are for instructors.
    const solo = await classOf(studio, admin, ada, [], 7)
    await json(await send(`/portal/admin/schedule/classes/${solo.id}/cancel`, other.headers, 'POST', {}), 200)
    assert.equal(await unread(admin), 0)
    assert.equal(await unread(other), 0)
    assert.equal(await unread(ada), 1)
  })
})
