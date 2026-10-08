import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { MailTransport, OutboundMessage } from '../lib/mailer'

const run = Date.now().toString(36)
const DOMAIN = `${run}.checkin-nag.test`
const NAME = `Nag ${run}`
const HOUR = 60 * 60 * 1000

/**
 * The check-in nag (#359: NTF-18, admin-restructure §11 and §16b): a session
 * whose check-in is still `pending` 24 hours after it ended emails its
 * Instructor, with every active Admin of that studio copied — once.
 *
 * Fired as a cron tick fires it (`scheduledJobs.sendCheckInNags`: the fan-out
 * over every Tenant included) at an instant held on the app's clock. The
 * instant is centuries out, so no session another file left behind ends near
 * it and every nag the tick sends is one of this file's.
 */
describe('the check-in nag job', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let jobs!: typeof import('../jobs')
  let ensureAuthUser!: typeof import('../services/auth/auth-users').ensureAuthUser

  type Staff = { id: string; email: string; name: string }
  type Studio = { id: string; slug: string; locationId: string; roomId: string; classTypeId: string; instructor: Staff; admin: Staff }

  let one!: Studio
  let two!: Studio

  const NOW = new Date(Date.UTC(2390 + Math.floor(Math.random() * 100), 2, 10, 12, 0))

  const sent: OutboundMessage[] = []
  const recording: MailTransport = {
    name: 'null',
    async send(message) {
      sent.push(message)
      return { messageId: `checkin-nag-${sent.length}`, response: 'recorded' }
    },
  }
  let restoreMail: () => void = () => {}
  const templateOf = (m: OutboundMessage) => m.tags.find(t => t.name === 'template')?.value
  const drainNags = () => sent.splice(0).filter(m => templateOf(m) === 'checkin_nag')

  let people = 0
  async function staffAt(tenantId: string, role: 'admin' | 'instructor', status: 'active' | 'archived' = 'active'): Promise<Staff> {
    const name = `${role === 'admin' ? 'Ada' : 'Ines'} ${people}`
    const email = `${role}-${people++}@${DOMAIN}`
    const authUserId = await ensureAuthUser(harness.db, 'staff', { email, name, tenantId })
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId, email, name, role, status, authUserId })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId, staffUserId: row!.id })
    return { id: row!.id, email, name }
  }

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const [location] = await harness.db.select().from(schema.locations).where(eq(schema.locations.tenantId, tenant.id)).limit(1)
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `${NAME} room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    const [classType] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: `${NAME} Hatha ${tenant.slug}` })
      .returning({ id: schema.classTypes.id })
    return {
      ...tenant,
      locationId: location!.id,
      roomId: room!.id,
      classTypeId: classType!.id,
      instructor: await staffAt(tenant.id, 'instructor'),
      admin: await staffAt(tenant.id, 'admin'),
    }
  }

  let members = 0
  async function client(at: Studio): Promise<string> {
    const email = `member-${members++}@${DOMAIN}`
    const authUserId = await ensureAuthUser(harness.db, 'client', { email, name: 'Mia', tenantId: at.id })
    const [row] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name: 'Mia', phone: '+6580000000', authUserId })
      .returning({ id: schema.clients.id })
    return row!.id
  }

  const codes = () => ({ qrToken: randomUUID(), code: `RT-${randomUUID().slice(0, 6).toUpperCase()}` })
  type Row = 'pending' | 'attended' | 'no_show'

  /** A class that ended `endedAgo` before NOW, a confirmed booking per roster row. */
  async function classEnded(at: Studio, endedAgo: number, roster: Row[], lifecycle: 'active' | 'cancelled' = 'active'): Promise<string> {
    const endsAt = new Date(NOW.getTime() - endedAgo)
    const [cls] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId: at.classTypeId,
        mainInstructorId: at.instructor.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt: new Date(endsAt.getTime() - HOUR),
        endsAt,
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: at.admin.id,
        lifecycle,
      })
      .returning({ id: schema.classes.id })
    for (const state of roster) {
      await harness.db.insert(schema.bookings).values({
        tenantId: at.id,
        clientId: await client(at),
        kind: 'class',
        classId: cls!.id,
        creditsOrSessionsUsed: 0,
        checkInState: state,
        ...codes(),
      })
    }
    return cls!.id
  }

  /** A private session that ended `endedAgo` before NOW, its one member still unmarked. */
  async function ptSessionEnded(at: Studio, endedAgo: number): Promise<string> {
    const endsAt = new Date(NOW.getTime() - endedAgo)
    const clientId = await client(at)
    const [session] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: at.id,
        instructorId: at.instructor.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt: new Date(endsAt.getTime() - HOUR),
        endsAt,
        sessionType: '1on1',
        capacityOnline: 1,
        scheduledAt: new Date(endsAt.getTime() - 7 * 24 * HOUR),
        scheduledByStaffId: at.admin.id,
      })
      .returning({ id: schema.ptSessions.id })
    await harness.db.insert(schema.bookings).values({ tenantId: at.id, clientId, kind: 'pt', ptSessionId: session!.id, creditsOrSessionsUsed: 0, ...codes() })
    return session!.id
  }

  /** Every active Admin of `at` — the one definition of who is copied. */
  async function activeAdmins(at: Studio): Promise<string[]> {
    const rows = await harness.db
      .select({ email: schema.staffUsers.email })
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.tenantId, at.id), eq(schema.staffUsers.role, 'admin'), eq(schema.staffUsers.status, 'active')))
    return rows.map(r => r.email)
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    jobs = await import('../jobs')
    ;({ ensureAuthUser } = await import('../services/auth/auth-users'))
    restoreMail = (await import('../lib/mailer')).useTransport(recording)
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    harness.clock.set(NOW)
  })

  after(async () => {
    if (!harness) return
    restoreMail()
    harness.clock.reset()
    try {
      const ours = `%@${DOMAIN}`
      const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      const staff = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM bookings WHERE client_id IN (${clients})`)
      await harness.db.execute(sql`DELETE FROM pt_sessions WHERE instructor_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM classes WHERE created_by_staff_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours} OR subject_rendered LIKE ${`%${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staff})`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE ${`${NAME}%`}`)
      await harness.db.execute(sql`DELETE FROM rooms WHERE name LIKE ${`${NAME}%`}`)
    } finally {
      await harness.close()
    }
  })

  test('NTF-18 a class still pending 24 hours after it ended emails its Instructor with every active Admin copied, once, and no other studio\'s staff', async () => {
    harness.clock.set(NOW)
    const archived = await staffAt(one.id, 'admin', 'archived')
    await classEnded(one, 25 * HOUR, ['pending', 'pending', 'attended'])
    sent.splice(0)

    await jobs.scheduledJobs.sendCheckInNags()

    const nags = drainNags()
    const expected = [one.instructor.email, ...(await activeAdmins(one)).filter(e => e !== one.instructor.email)].sort()
    assert.deepEqual(nags.map(m => m.to).sort(), expected, 'the Instructor and each active Admin of the studio, one email each')
    for (const m of nags) {
      assert.match(m.subject, new RegExp(`${NAME} Hatha ${one.slug}`))
      assert.match(m.text ?? '', /2 member\(s\) on it are still unmarked/)
      assert.ok((m.text ?? '').includes(one.instructor.name), 'the Instructor is named')
    }
    const toInstructor = nags.find(m => m.to === one.instructor.email)!
    assert.match(toInstructor.html, new RegExp(`href="http://${one.slug}\\.portal\\.localhost:3001/instructor/check-in"`))
    const toAdmin = nags.find(m => m.to === one.admin.email)!
    assert.match(toAdmin.html, new RegExp(`href="http://${one.slug}\\.portal\\.localhost:3001/admin/check-in"`))
    assert.ok(!nags.some(m => m.to === two.admin.email || m.to === two.instructor.email), 'no other studio\'s staff')
    assert.ok(!nags.some(m => m.to === archived.email), 'no archived Admin')

    // The next tick, and one an hour on: the session has had its nag.
    await jobs.scheduledJobs.sendCheckInNags()
    harness.clock.set(new Date(NOW.getTime() + HOUR))
    await jobs.scheduledJobs.sendCheckInNags()
    assert.deepEqual(drainNags(), [], 'exactly once')
    harness.clock.set(NOW)
  })

  test('NTF-18 a session is not nagged before 24 hours have passed, nor when its check-in is complete or it was cancelled', async () => {
    harness.clock.set(NOW)
    // Every earlier nag is spent; these are the only candidates.
    const early = await classEnded(two, 23 * HOUR, ['pending'])
    await classEnded(two, 26 * HOUR, ['attended', 'no_show'])
    await classEnded(two, 26 * HOUR, ['pending'], 'cancelled')
    sent.splice(0)

    await jobs.scheduledJobs.sendCheckInNags()
    assert.deepEqual(drainNags(), [], 'nothing is due')

    // Two hours on, the early one has passed its 24 hours.
    harness.clock.set(new Date(NOW.getTime() + 2 * HOUR))
    await jobs.scheduledJobs.sendCheckInNags()
    const nags = drainNags()
    const expected = [two.instructor.email, ...(await activeAdmins(two)).filter(e => e !== two.instructor.email)].sort()
    assert.deepEqual(nags.map(m => m.to).sort(), expected)
    assert.ok(nags.every(m => /1 member\(s\) on it are still unmarked/.test(m.text ?? '')))
    const [row] = await harness.db.select({ sentAt: schema.classes.checkinNagSentAt }).from(schema.classes).where(eq(schema.classes.id, early))
    assert.ok(row!.sentAt, 'the class records that it has had its nag')
    harness.clock.set(NOW)
  })

  test('NTF-18 a private session still pending 24 hours after it ended nags its Instructor too', async () => {
    // Ten hours on, a session that ended 15 hours before NOW is 25 hours past its end.
    harness.clock.set(new Date(NOW.getTime() + 10 * HOUR))
    await ptSessionEnded(one, 15 * HOUR)
    sent.splice(0)

    await jobs.scheduledJobs.sendCheckInNags()

    const nags = drainNags()
    const expected = [one.instructor.email, ...(await activeAdmins(one)).filter(e => e !== one.instructor.email)].sort()
    assert.deepEqual(nags.map(m => m.to).sort(), expected)
    assert.ok(nags.every(m => /Private session/.test(m.subject)))
    await jobs.scheduledJobs.sendCheckInNags()
    assert.deepEqual(drainNags(), [], 'exactly once')
    harness.clock.set(NOW)
  })
})
