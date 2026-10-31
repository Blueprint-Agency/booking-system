import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { instantAt, localDate } from '../lib/studio-time'

// The studios here are provisioned on Singapore, the zone every fresh studio starts with.
const SINGAPORE = 'Asia/Singapore'
const sgInstant = (date: string, time: string) => instantAt(SINGAPORE, date, time)
const sgToday = (now: Date) => localDate(SINGAPORE, now)
import { connectPayments, usePaymentKey } from './attention-payments'

/**
 * Staff attention, instructor pay: `instructor_pay_missing`, one
 * aggregated line for admins counting completed sessions with no instructor pay
 * since the first day of the previous month. Every test makes a studio of its
 * own and holds the clock at one instant.
 */
describe('Staff attention: instructor pay missing', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  usePaymentKey()
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const HOUR = 60 * 60 * 1000

  type Studio = { id: string; slug: string; locationId: string; roomId: string; classTypeId: string }
  type Staff = { headers: Record<string, string>; id: string }

  let studios = 0

  const send = (path: string, headers: Record<string, string>) => harness.app.request(`/api/v1${path}`, { headers })

  const json = async (res: Response, status: number) => {
    const text = await res.text()
    assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as Record<string, any>
  }

  const freshStudio = async (timezone?: string): Promise<Studio> => {
    const slug = `atp-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({
      slug,
      name: 'Attention Pay Studio',
      adminEmail: `owner@${slug}.test`,
      ...(timezone ? { timezone } : {}),
    })
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

  const staffAt = async (studio: Studio, name: string, role: 'admin' | 'instructor'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: studio.id, staffUserId: row!.id })
    return { headers, id: row!.id }
  }

  /** A class that ended at `endsAt`, with the given pay (null is unpriced). */
  const classEnded = async (studio: Studio, instructor: Staff, endsAt: Date, pay: string | null = null) => {
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: studio.id,
        classTypeId: studio.classTypeId,
        mainInstructorId: instructor.id,
        locationId: studio.locationId,
        roomId: studio.roomId,
        startsAt: new Date(endsAt.getTime() - HOUR),
        endsAt,
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: instructor.id,
        instructorPaySgd: pay,
      })
      .returning({ id: schema.classes.id })
    return cls!.id
  }

  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const payItems = async (who: Staff) =>
    ((await panel(who)).needs_action.groups as Array<{ items: Array<Record<string, any>> }>)
      .flatMap(g => g.items)
      .filter(i => i.kind === 'instructor_pay_missing')

  /** The first day of the month before the one `today` is in. */
  const firstOfPreviousMonth = (today: string) => {
    const [y, m] = today.split('-').map(Number) as [number, number]
    return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
  })

  after(async () => {
    await harness?.close()
  })

  test('ATN-100 an admin sees one line counting the unpriced completed sessions, linked to Finance filtered to them, and the bubble counts it as one', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    harness.clock.set(new Date('2026-10-15T08:00:00Z'))
    const now = harness.clock.now()
    for (const daysAgo of [1, 2, 3]) await classEnded(studio, teacher, new Date(now.getTime() - daysAgo * 24 * HOUR))

    const counts = await summary(admin)
    assert.equal(counts.needs_action, 1, 'three sessions are one line in the bubble')

    const items = await payItems(admin)
    assert.equal(items.length, 1)
    const item = items[0]!
    assert.equal(item.id, 'instructor_pay_missing:window')
    assert.equal(item.title, '3 completed sessions have no instructor pay')
    assert.equal(item.detail, 'Since Tue 1 Sep. Set pay so Finance is right', 'the first day of last month, in the spec’s date style')
    assert.equal(item.href, '/admin/finance?needs_pay=1&from=2026-09-01&to=2026-10-15')
    assert.equal(item.location, null)
    assert.equal(item.dismissable, false)
  })

  test('ATN-101 the line says "1 completed session has" for one, and the count is the Finance page\'s unpriced count for the same range', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    harness.clock.set(new Date('2026-10-15T08:00:00Z'))
    const now = harness.clock.now()
    await classEnded(studio, teacher, new Date(now.getTime() - 24 * HOUR))

    const item = (await payItems(admin))[0]!
    assert.equal(item.title, '1 completed session has no instructor pay')

    const from = sgInstant('2026-09-01', '00:00').toISOString()
    const to = sgInstant('2026-10-15', '23:59').toISOString()
    const finance = await json(
      await send(`/portal/admin/finance?needs_pay=true&from=${from}&to=${to}`, admin.headers),
      200,
    )
    assert.equal(finance.unpriced_count, 1)
    assert.equal(finance.rows.length, 1)
  })

  test('ATN-199 the SQL count covers all five pay sources, main and supporting, and is the Finance page’s own unpriced count for the same range', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    const mate = await staffAt(studio, 'mate', 'instructor')
    harness.clock.set(new Date('2026-10-15T08:00:00Z'))
    const ended = new Date(harness.clock.now().getTime() - 24 * HOUR)

    // A class: main and supporting both unpriced (2). Another: both priced (0).
    const unpriced = await classEnded(studio, teacher, ended)
    await harness.db.insert(schema.classSupportingInstructors).values({ tenantId: studio.id, classId: unpriced, instructorId: mate.id })
    const priced = await classEnded(studio, teacher, ended, '30.00')
    await harness.db
      .insert(schema.classSupportingInstructors)
      .values({ tenantId: studio.id, classId: priced, instructorId: mate.id, paySgd: '10.00' })

    // A private session: main and supporting both unpriced (2).
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const email = `m@${studio.slug}.test`
    const authUserId = await ensureAuthUser(harness.db, 'client', { email, name: 'Mia', tenantId: studio.id })
    const [member] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name: 'Mia', phone: '+6580000000', authUserId })
      .returning({ id: schema.clients.id })
    const [request] = await harness.db
      .insert(schema.ptRequests)
      .values({ tenantId: studio.id, clientId: member!.id, locationId: studio.locationId, sessionType: '1on1', status: 'scheduled', expiresAt: ended })
      .returning({ id: schema.ptRequests.id })
    const [pt] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: studio.id,
        ptRequestId: request!.id,
        instructorId: teacher.id,
        locationId: studio.locationId,
        roomId: studio.roomId,
        startsAt: new Date(ended.getTime() - HOUR),
        endsAt: ended,
        sessionType: '1on1',
        capacityOnline: 1,
        scheduledAt: new Date(ended.getTime() - 48 * HOUR),
        scheduledByStaffId: admin.id,
      })
      .returning({ id: schema.ptSessions.id })
    await harness.db
      .insert(schema.ptSessionSupportingInstructors)
      .values({ tenantId: studio.id, ptSessionId: pt!.id, instructorId: mate.id })

    // Workshops: one over, main unpriced and supporting priced (1); one still to come (0).
    const workshop = async (name: string, endsAt: Date) => {
      const [w] = await harness.db
        .insert(schema.workshops)
        .values({ tenantId: studio.id, name, locationId: studio.locationId, createdByStaffId: admin.id })
        .returning({ id: schema.workshops.id })
      await harness.db.insert(schema.workshopDays).values({
        tenantId: studio.id,
        workshopId: w!.id,
        ord: 1,
        roomId: studio.roomId,
        startsAt: new Date(endsAt.getTime() - 2 * HOUR),
        endsAt,
        basePriceSgd: '100.00',
        capacityOnline: 10,
      })
      await harness.db.insert(schema.workshopInstructors).values([
        { tenantId: studio.id, workshopId: w!.id, instructorId: teacher.id, role: 'main' },
        { tenantId: studio.id, workshopId: w!.id, instructorId: mate.id, role: 'supporting', paySgd: '10.00' },
      ])
    }
    await workshop('Done', ended)
    await workshop('Later', new Date(harness.clock.now().getTime() + 48 * HOUR))

    const item = (await payItems(admin))[0]!
    assert.equal(item.title, '5 completed sessions have no instructor pay')
    const from = sgInstant('2026-09-01', '00:00').toISOString()
    const to = sgInstant('2026-10-15', '23:59').toISOString()
    const finance = await json(
      await send(`/portal/admin/finance?needs_pay=true&from=${from}&to=${to}`, admin.headers),
      200,
    )
    assert.equal(finance.unpriced_count, 5, 'the Finance page counts the same five')
  })

  test('ATN-102 only sessions since the first of the previous month count, and priced ones never do', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    harness.clock.set(new Date('2026-10-15T08:00:00Z'))
    const now = harness.clock.now()
    assert.equal(firstOfPreviousMonth(sgToday(now)), '2026-09-01')
    await classEnded(studio, teacher, sgInstant('2026-09-01', '09:00')) // first day of the window: in
    await classEnded(studio, teacher, sgInstant('2026-08-31', '09:00')) // the day before: out
    await classEnded(studio, teacher, new Date(now.getTime() - 24 * HOUR), '40.00') // priced: out
    await classEnded(studio, teacher, new Date(now.getTime() + 24 * HOUR)) // not yet completed: out

    const item = (await payItems(admin))[0]!
    assert.equal(item.title, '1 completed session has no instructor pay')
  })

  test('TEN-73 the window covers the studio\'s own days: at Sydney a session ending at 01:00 on 1 September is in, where Singapore is still on 31 August, and the link names the studio\'s today', async () => {
    // 00:30 on 16 October 2026 in Sydney (UTC+11, daylight saving): 22:30 on the 15th in Singapore.
    harness.clock.set(new Date('2026-10-15T14:30:00Z'))
    const sydney = await freshStudio('Australia/Sydney')
    const singapore = await freshStudio('Asia/Singapore')
    for (const studio of [sydney, singapore]) {
      const teacher = await staffAt(studio, 'teacher', 'instructor')
      // Ending at 01:00 on 1 September and at 23:00 on 31 August in Sydney (UTC+10); both are still 31 August in Singapore.
      await classEnded(studio, teacher, new Date('2026-08-31T15:00:00Z'))
      await classEnded(studio, teacher, new Date('2026-08-31T13:00:00Z'))
      await classEnded(studio, teacher, new Date('2026-10-10T03:00:00Z'))
    }
    const sydneyItem = (await payItems(await staffAt(sydney, 'admin', 'admin')))[0]!
    assert.equal(sydneyItem.title, '2 completed sessions have no instructor pay')
    assert.match(sydneyItem.href, /from=2026-09-01&to=2026-10-16$/)
    const singaporeItem = (await payItems(await staffAt(singapore, 'admin', 'admin')))[0]!
    assert.equal(singaporeItem.title, '1 completed session has no instructor pay')
    assert.match(singaporeItem.href, /from=2026-09-01&to=2026-10-15$/)
  })

  test('ATN-103 the line disappears once every session in the window is priced', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    harness.clock.set(new Date('2026-10-15T08:00:00Z'))
    const id = await classEnded(studio, teacher, new Date(harness.clock.now().getTime() - 24 * HOUR))
    assert.equal((await summary(admin)).needs_action, 1)

    await harness.db.update(schema.classes).set({ instructorPaySgd: '35.00' }).where(eq(schema.classes.id, id))

    assert.equal((await summary(admin)).needs_action, 0)
    assert.deepEqual(await payItems(admin), [])
  })

  test('ATN-104 an instructor is never shown the line', async () => {
    const studio = await freshStudio()
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    harness.clock.set(new Date('2026-10-15T08:00:00Z'))
    await classEnded(studio, teacher, new Date(harness.clock.now().getTime() - 24 * HOUR))

    assert.equal((await summary(teacher)).needs_action, 0)
    assert.deepEqual(await payItems(teacher), [])
  })

  test('ATN-105 the line is the same in every workspace: switching location does not narrow it', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const teacher = await staffAt(studio, 'teacher', 'instructor')
    harness.clock.set(new Date('2026-10-15T08:00:00Z'))
    await classEnded(studio, teacher, new Date(harness.clock.now().getTime() - 24 * HOUR))

    const counts = await json(await send(`/portal/attention/summary?location_id=${studio.locationId}`, admin.headers), 200)
    assert.equal(counts.needs_action, 1)
  })
})
