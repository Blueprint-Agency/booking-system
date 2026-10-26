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

/**
 * Staff attention, Updates the admins and instructors are told of (#476, #491):
 * an instructor cancelling a class or a private session, a staff member joining,
 * and an admin changing an instructor's permissions. Each is written in the
 * transaction of the act, to the right people and never the actor.
 *
 * Every test makes a studio of its own, so a list says only what that test did.
 * The tests read the Updates list, not the bell's total.
 */
describe('Staff attention: admin and permission Updates', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let ptPackagesSvc!: typeof import('../services/packages/pt-packages')
  let classPackagesSvc!: typeof import('../services/packages/class-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  type Studio = { id: string; slug: string; locationId: string; roomId: string; classTypeId: string; classTypeName: string }
  type Staff = { headers: Record<string, string>; id: string; email: string; name: string }
  type Member = { headers: Record<string, string>; id: string; name: string }

  let studios = 0

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
    const slug = `adm-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Admin Updates Studio', adminEmail: `owner@${slug}.test` })
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `${slug} Studio`, address: '1 Test Street' })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `${slug} Room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    const classTypeName = `${slug} Hatha`
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: classTypeName })
      .returning({ id: schema.classTypes.id })
    return { id: tenant.id, slug, locationId: location!.id, roomId: room!.id, classTypeId: type!.id, classTypeName }
  }

  const adminAt = async (studio: Studio, name = 'admin'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role: 'admin', status: 'active', authUserId: user!.id })
      .returning()
    return { headers, id: row!.id, email, name }
  }

  /** Invite and accept, returning the one who joined. Optionally name them on accepting. */
  const join = async (studio: Studio, admin: Staff, name: string, role: 'admin' | 'instructor'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    await json(await send('/portal/admin/staff/invite', admin.headers, 'POST', { email, role }), 201)
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
    return { headers, id: invitation!.staffUserId!, email, name }
  }

  const memberAt = async (studio: Studio, name: string): Promise<Member> => {
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
    return { headers, id: client!.id, name }
  }

  /** A class starting in `days` days, taught by `who`, booked by `members` (each on a fresh credit bundle). */
  let classesMade = 0
  const classWith = async (studio: Studio, who: Staff, members: Member[], days = 3) => {
    const startsAt = new Date(Date.now() + days * DAY + ++classesMade * 3 * HOUR)
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: studio.id,
        classTypeId: studio.classTypeId,
        mainInstructorId: who.id,
        locationId: studio.locationId,
        roomId: studio.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: who.id,
      })
      .returning()
    if (members.length > 0) {
      const pkg = await classPackagesSvc.createClassPackage(studio.id, {
        name: `${studio.slug} bundle ${classesMade}`,
        kind: 'credit_bundle',
        credits: 10,
        validityDays: 90,
        priceSgd: '200.00',
      })
      for (const m of members) {
        await purchaseSvc.grantPackage(studio.id, {
          clientId: m.id,
          purchaseId: null,
          amountSgd: '200.00',
          packageKind: 'class',
          packageId: pkg.id,
        })
        await json(
          await send('/me/bookings/class', m.headers, 'POST', { class_id: cls!.id }),
          201,
        )
      }
    }
    return { id: cls!.id, startsAt }
  }

  /** The studio's own wording of an instant, as the Updates quote it: "Tue 28 Oct, 7:00 pm". */
  const studioWhen = (at: Date) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Singapore',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
        .formatToParts(at)
        .map(p => [p.type, p.value]),
    )
    return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`
  }

  let ptPackages = 0
  /** A scheduled 1on1 private session with `member`, taught by `instructor`. */
  const scheduledPt = async (studio: Studio, admin: Staff, instructor: Staff, member: Member) => {
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
        slots: [{ proposedDate: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10), startTime: '09:00', endTime: '10:00' }],
      }),
      201,
    )
    const requestId = created.pt_request_id as string
    const startsAt = new Date(Date.now() + 3 * DAY + ptPackages * 2 * HOUR)
    await json(
      await send(`/portal/admin/pt-sessions/${requestId}/schedule`, admin.headers, 'POST', {
        location_id: studio.locationId,
        room_id: studio.roomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        instructor_id: instructor.id,
      }),
      201,
    )
    const [req] = await harness.db.select().from(schema.ptRequests).where(eq(schema.ptRequests.id, requestId))
    return { requestId, sessionId: req!.scheduledPtSessionId!, startsAt }
  }

  const updatesOf = async (who: Staff) =>
    (await json(await send('/portal/attention', who.headers), 200)).updates.items as Array<Record<string, any>>
  const ofKind = async (who: Staff, kind: string) => (await updatesOf(who)).filter(u => u.kind === kind)

  const instructorCancelClass = (who: Staff, classId: string, reason?: string) =>
    send(`/portal/instructor/schedule/classes/${classId}/cancel`, who.headers, 'POST', reason === undefined ? {} : { reason })

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    classPackagesSvc = inTenantContext(await import('../services/packages/class-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
  })

  after(async () => {
    await harness?.close()
  })

  test('ATN-160 an instructor cancelling their class tells every active admin, with the reason and how many bookings were refunded, linking the class; the instructor is told nothing', async () => {
    const studio = await freshStudio()
    const first = await adminAt(studio, 'first')
    const second = await adminAt(studio, 'second')
    const ada = await join(studio, first, 'ada', 'instructor')
    const ben = await memberAt(studio, 'ben')
    const cat = await memberAt(studio, 'cat')
    const cls = await classWith(studio, ada, [ben, cat])

    await json(await instructorCancelClass(ada, cls.id, 'Down with flu'), 200)

    for (const admin of [first, second]) {
      const told = await ofKind(admin, 'class_cancelled_by_instructor')
      assert.equal(told.length, 1)
      assert.equal(told[0]!.title, `ada cancelled ${studio.classTypeName} on ${studioWhen(cls.startsAt)}`)
      assert.equal(told[0]!.detail, '“Down with flu” · 2 bookings refunded')
      assert.equal(told[0]!.href, `/admin/schedule/class/${cls.id}`)
      assert.equal(told[0]!.read_at, null)
    }
    assert.equal((await updatesOf(ada)).length, 0)
  })

  test('ATN-161 one booking reads "1 booking refunded", and a class nobody booked says none were', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await join(studio, admin, 'ada', 'instructor')
    const ben = await memberAt(studio, 'ben')
    const one = await classWith(studio, ada, [ben])
    const none = await classWith(studio, ada, [])

    await json(await instructorCancelClass(ada, one.id, 'Sick'), 200)
    await json(await instructorCancelClass(ada, none.id, 'Sick again'), 200)

    const details = (await ofKind(admin, 'class_cancelled_by_instructor')).map(u => u.detail).sort()
    assert.deepEqual(details, ['“Sick again” · No bookings to refund', '“Sick” · 1 booking refunded'].sort())
  })

  test('ATN-162 an admin cancelling a class writes no update; an admin who teaches and cancels it as the instructor tells the other admin, not themselves', async () => {
    const studio = await freshStudio()
    const owner = await adminAt(studio, 'boss')
    const other = await adminAt(studio, 'other')
    const ada = await join(studio, owner, 'ada', 'instructor')

    const adminCancelled = await classWith(studio, ada, [])
    await json(await send(`/portal/admin/schedule/classes/${adminCancelled.id}/cancel`, owner.headers, 'POST', {}), 200)
    assert.equal((await ofKind(owner, 'class_cancelled_by_instructor')).length, 0)
    assert.equal((await ofKind(other, 'class_cancelled_by_instructor')).length, 0)

    // The owner also teaches: they cancel their own class through the instructor route.
    await harness.db
      .insert(schema.instructors)
      .values({ tenantId: studio.id, staffUserId: owner.id })
      .onConflictDoNothing({ target: schema.instructors.staffUserId })
    const own = await classWith(studio, owner, [])
    await json(await instructorCancelClass(owner, own.id, 'Conference'), 200)
    assert.equal((await ofKind(owner, 'class_cancelled_by_instructor')).length, 0)
    const told = await ofKind(other, 'class_cancelled_by_instructor')
    assert.equal(told.length, 1)
    assert.equal(told[0]!.title, `boss cancelled ${studio.classTypeName} on ${studioWhen(own.startsAt)}`)
  })

  test('ATN-163 a refused cancel writes no update, and the instructor_cancel_class email to the admins still goes out unchanged on a good one', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await join(studio, admin, 'ada', 'instructor')
    const cls = await classWith(studio, ada, [])

    await json(await instructorCancelClass(ada, cls.id), 400)
    assert.equal((await ofKind(admin, 'class_cancelled_by_instructor')).length, 0)

    await json(await instructorCancelClass(ada, cls.id, 'Back pain'), 200)
    assert.equal((await ofKind(admin, 'class_cancelled_by_instructor')).length, 1)
    const mail = await harness.db
      .select({ status: schema.emailLog.status })
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.recipientEmail, admin.email), eq(schema.emailLog.templateSlug, 'instructor_cancel_class')))
    assert.deepEqual(mail.map(m => m.status), ['sent'])
  })

  test('ATN-164 an instructor cancelling a private session tells every active admin, naming the member and linking the session; an admin cancelling it tells no one', async () => {
    const studio = await freshStudio()
    const first = await adminAt(studio, 'first')
    const second = await adminAt(studio, 'second')
    const ada = await join(studio, first, 'ada', 'instructor')
    const dee = await memberAt(studio, 'dee')
    const eve = await memberAt(studio, 'eve')
    const byInstructor = await scheduledPt(studio, first, ada, dee)
    const byAdmin = await scheduledPt(studio, first, ada, eve)

    await json(await send(`/portal/instructor/pt-requests/${byInstructor.requestId}/cancel`, ada.headers, 'POST', {}), 200)
    await json(await send(`/portal/admin/pt-sessions/${byAdmin.requestId}/cancel`, first.headers, 'POST', {}), 200)

    for (const admin of [first, second]) {
      const told = await ofKind(admin, 'pt_session_cancelled_by_instructor')
      assert.equal(told.length, 1)
      assert.equal(told[0]!.title, `ada cancelled the private session with dee on ${studioWhen(byInstructor.startsAt)}`)
      assert.equal(told[0]!.detail, null)
      assert.equal(told[0]!.href, `/admin/schedule/pt/${byInstructor.sessionId}`)
    }
    assert.equal((await updatesOf(ada)).length, 0)
  })

  test('ATN-165 an invited instructor accepting tells every active admin "{Name} joined as instructor", linking their staff row; the newcomer and pending admins are told nothing', async () => {
    const studio = await freshStudio()
    const first = await adminAt(studio, 'first')
    const second = await adminAt(studio, 'second')
    const ada = await join(studio, first, 'ada', 'instructor')

    for (const admin of [first, second]) {
      const told = await ofKind(admin, 'staff_joined')
      assert.equal(told.length, 1)
      assert.equal(told[0]!.title, 'ada joined as instructor')
      assert.equal(told[0]!.href, `/admin/staff?staff=${ada.id}`)
    }
    assert.equal((await updatesOf(ada)).length, 0)
  })

  test('ATN-166 a new admin joining tells the other admins and not themselves', async () => {
    const studio = await freshStudio()
    const first = await adminAt(studio, 'first')
    const newcomer = await join(studio, first, 'newbie', 'admin')

    const told = await ofKind(first, 'staff_joined')
    assert.equal(told.length, 1)
    assert.equal(told[0]!.title, 'newbie joined as admin')
    assert.equal((await ofKind(newcomer, 'staff_joined')).length, 0)
  })

  test('ATN-167 an admin changing an instructor’s permissions tells that instructor what they can now and no longer do, linking their profile; the admin is told nothing', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await join(studio, admin, 'ada', 'instructor')
    const patch = (permissions: string[]) => send(`/portal/admin/staff/${ada.id}`, admin.headers, 'PATCH', { permissions })

    await json(await patch(['schedule_classes', 'manage_rosters']), 200)
    await json(await patch(['take_pt_bookings', 'schedule_classes']), 200)

    const told = await ofKind(ada, 'permissions_changed')
    assert.equal(told.length, 2)
    // Newest first.
    assert.equal(told[0]!.title, 'admin changed what you can do: you can now take PT bookings and no longer manage rosters')
    assert.equal(told[1]!.title, 'admin changed what you can do: you can no longer take PT bookings')
    for (const u of told) assert.equal(u.href, '/instructor/profile')
    assert.equal((await updatesOf(admin)).filter(u => u.kind === 'permissions_changed').length, 0)
  })

  test('ATN-168 saving the same permissions, or an edit that leaves them alone, writes no update', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const ada = await join(studio, admin, 'ada', 'instructor')

    await json(
      await send(`/portal/admin/staff/${ada.id}`, admin.headers, 'PATCH', {
        permissions: ['schedule_classes', 'take_pt_bookings', 'manage_rosters'],
      }),
      200,
    )
    await json(await send(`/portal/admin/staff/${ada.id}`, admin.headers, 'PATCH', { phone: '+6581234567' }), 200)
    assert.equal((await ofKind(ada, 'permissions_changed')).length, 0)
  })

  test('ATN-169 another studio’s admins are not told of this studio’s cancel or joiner', async () => {
    const studio = await freshStudio()
    const elsewhere = await freshStudio()
    const away = await adminAt(elsewhere)
    const admin = await adminAt(studio)
    const ada = await join(studio, admin, 'ada', 'instructor')
    const cls = await classWith(studio, ada, [])
    await json(await instructorCancelClass(ada, cls.id, 'Sick'), 200)

    assert.equal((await updatesOf(away)).length, 0)
  })
})
