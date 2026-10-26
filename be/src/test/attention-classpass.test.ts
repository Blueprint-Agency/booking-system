import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import {
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * Staff attention, the ClassPass kinds (#476, #484): `classpass_review` and
 * `classpass_overbooked`, read over HTTP as a signed-in admin or instructor.
 * Each test makes a studio of its own, so a count is about its own rows only.
 */
describe('Staff attention: ClassPass', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  type Studio = { id: string; slug: string; locationId: string; classTypeId: string; instructorId: string }
  type Staff = { headers: Record<string, string>; id: string }

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

  const freshStudio = async (): Promise<Studio> => {
    const slug = `atncp-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'ClassPass Attention', adminEmail: `owner@${slug}.test` })
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `${slug} Studio`, address: '1 Test Street' })
      .returning({ id: schema.locations.id })
    const [type] = await harness.db
      .insert(schema.classTypes)
      .values({ tenantId: tenant.id, name: `${slug} Hatha` })
      .returning({ id: schema.classTypes.id })
    const inst = await staffAt({ id: tenant.id, slug }, 'teacher', 'instructor')
    return { id: tenant.id, slug, locationId: location!.id, classTypeId: type!.id, instructorId: inst.id }
  }

  const staffAt = async (tenant: { id: string; slug: string }, name: string, role: 'admin' | 'instructor'): Promise<Staff> => {
    const email = `${name}@${tenant.slug}.test`
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    return { headers, id: row!.id }
  }

  const member = async (studio: Studio, name: string) => {
    const email = `${name}@${studio.slug}.test`
    await harness.signInAs('client', email, studio)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return client!.id
  }

  type Reason = (typeof schema.classpassInboundEmails.$inferInsert)['reviewReason']
  const reviewItem = async (
    studio: Studio,
    reason: NonNullable<Reason>,
    extra: Partial<typeof schema.classpassInboundEmails.$inferInsert> = {},
  ) => {
    const [row] = await harness.db
      .insert(schema.classpassInboundEmails)
      .values({
        tenantId: studio.id,
        receivedAt: new Date(Date.now() - 3 * HOUR),
        messageId: randomUUID(),
        fromAddress: 'noreply@classpass.test',
        subject: 'ClassPass',
        kind: 'booking',
        outcome: reason === 'unparsed' ? 'unparsed' : 'review',
        reviewReason: reason,
        ...extra,
      })
      .returning({ id: schema.classpassInboundEmails.id })
    return row!.id
  }

  const futureClass = async (studio: Studio, capacityOnline: number, startsAt = new Date(Date.now() + 3 * DAY)) => {
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: studio.id,
        classTypeId: studio.classTypeId,
        mainInstructorId: studio.instructorId,
        locationId: studio.locationId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline,
        capacityBuffer: 0,
        creditCost: 1,
        createdByStaffId: studio.instructorId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  const book = async (studio: Studio, classId: string, name: string, seat: 'online' | 'overbook', source: 'classpass' | 'direct') => {
    const [row] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: studio.id,
        clientId: await member(studio, name),
        kind: 'class',
        classId,
        seat,
        source,
        ...(source === 'classpass' ? { classpassReservationId: randomUUID() } : {}),
        code: randomUUID().slice(0, 8),
        qrToken: randomUUID(),
      })
      .returning({ id: schema.bookings.id })
    return row!.id
  }

  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const itemsOf = (body: Record<string, any>) =>
    (body.needs_action.groups as Array<{ items: Array<Record<string, any>> }>).flatMap(g => g.items)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
  })

  after(async () => {
    await harness?.close()
  })

  test('ATN-80 every review reason reads as its own sentence in the ClassPass group, linked to the review item, and counts on the ClassPass badge', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const startsAt = new Date(Date.now() + 2 * DAY)
    const [tenant] = await harness.db.select({ tz: schema.tenants.timezone }).from(schema.tenants).where(eq(schema.tenants.id, studio.id))
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tenant!.tz,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
        .formatToParts(startsAt)
        .map(p => [p.type, p.value]),
    )
    const at = `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`
    await harness.db
      .insert(schema.classpassLocationMappings)
      .values({ tenantId: studio.id, locationName: 'orchard studio', locationId: studio.locationId })
    await futureClass(studio, 5, startsAt)
    await futureClass(studio, 5, startsAt)
    const base = { memberName: 'Maya Tan', startsAt, className: 'Hatha', locationName: 'Orchard Studio' }

    const ids = {
      unparsed: await reviewItem(studio, 'unparsed'),
      unmapped_location: await reviewItem(studio, 'unmapped_location', base),
      no_class: await reviewItem(studio, 'no_class', base),
      ambiguous_class: await reviewItem(studio, 'ambiguous_class', { ...base }),
      class_cancelled: await reviewItem(studio, 'class_cancelled', base),
      client_deleted: await reviewItem(studio, 'client_deleted', base),
      already_booked: await reviewItem(studio, 'already_booked', base),
      import_off: await reviewItem(studio, 'import_off', base),
      import_off_cancel: await reviewItem(studio, 'import_off', { ...base, kind: 'cancellation' }),
      import_error: await reviewItem(studio, 'import_error', base),
    }

    const counts = await summary(admin)
    assert.equal(counts.needs_action, 10)
    assert.equal(counts.by_group.classpass, 10)

    const body = await panel(admin)
    const group = body.needs_action.groups.find((g: any) => g.key === 'classpass')
    assert.equal(group.count, 10)
    assert.equal(group.see_all_href, '/admin/classpass')

    const all = await json(await send('/portal/attention?limit_per_group=50', admin.headers), 200)
    const byId = Object.fromEntries(itemsOf(all).map(i => [i.id, i]))
    const titleOf = (key: keyof typeof ids) => byId[`classpass_review:${ids[key]}`]?.title
    assert.equal(titleOf('unparsed'), "A ClassPass email couldn't be read")
    assert.equal(titleOf('unmapped_location'), `ClassPass location "Orchard Studio" isn't linked to one of your locations`)
    assert.equal(titleOf('no_class'), `No class matches Maya Tan's ClassPass booking for ${at}`)
    assert.equal(titleOf('ambiguous_class'), `2 classes match Maya Tan's ClassPass booking for ${at}`)
    assert.equal(titleOf('class_cancelled'), 'Maya Tan booked a cancelled class through ClassPass')
    assert.equal(titleOf('client_deleted'), 'A ClassPass booking came in for Maya Tan, who was deleted')
    assert.equal(titleOf('already_booked'), "Maya Tan is already booked on Hatha, but ClassPass sent another booking")
    assert.equal(titleOf('import_off'), 'A ClassPass booking for Maya Tan arrived while the import was off')
    assert.equal(titleOf('import_off_cancel'), 'A ClassPass cancellation for Maya Tan arrived while the import was off')
    assert.equal(titleOf('import_error'), "Maya Tan's ClassPass booking couldn't be imported")

    const one = byId[`classpass_review:${ids.no_class}`]
    assert.equal(one.kind, 'classpass_review')
    assert.match(one.detail, /^Received 3 h ago · book, map or dismiss it$/)
    assert.equal(one.href, `/admin/classpass?review=${ids.no_class}`)
    assert.equal(one.dismissable, false)
    assert.equal(one.location, null)
  })

  test('ATN-81 a review item leaves the list once it is dismissed or booked', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const dismissed = await reviewItem(studio, 'no_class', { memberName: 'Maya Tan', startsAt: new Date(Date.now() + DAY) })
    const booked = await reviewItem(studio, 'no_class', { memberName: 'Lee Wei', startsAt: new Date(Date.now() + DAY) })
    await reviewItem(studio, 'unparsed')
    assert.equal((await summary(admin)).by_group.classpass, 3)

    await json(await send(`/portal/admin/classpass/review/${dismissed}/dismiss`, admin.headers, 'POST'), 200)
    assert.equal((await summary(admin)).by_group.classpass, 2)

    // What the importer does on a successful placing: the row is closed with a resolved_at.
    await harness.db
      .update(schema.classpassInboundEmails)
      .set({ outcome: 'imported', reviewReason: null, resolvedAt: new Date() })
      .where(eq(schema.classpassInboundEmails.id, booked))
    const ids = itemsOf(await panel(admin)).map(i => i.id)
    assert.ok(!ids.includes(`classpass_review:${dismissed}`))
    assert.ok(!ids.includes(`classpass_review:${booked}`))
    assert.equal((await summary(admin)).by_group.classpass, 1)
  })

  test('ATN-82 an overbooked upcoming class is one item with its seats, linked to the class, and goes when its overbooked bookings are cancelled or the class has ended', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const startsAt = new Date(Date.now() + 3 * DAY)
    const classId = await futureClass(studio, 2, startsAt)
    await book(studio, classId, 'a', 'online', 'direct')
    await book(studio, classId, 'b', 'online', 'direct')
    const extra1 = await book(studio, classId, 'c', 'overbook', 'classpass')
    const extra2 = await book(studio, classId, 'd', 'overbook', 'classpass')

    assert.equal((await summary(admin)).by_group.classpass, 1)
    const item = itemsOf(await panel(admin))[0]!
    assert.equal(item.id, `classpass_overbooked:${classId}`)
    assert.equal(item.kind, 'classpass_overbooked')
    assert.match(item.title, /^atncp-.+ Hatha on \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} [ap]m is over capacity: ClassPass booked 2 more people than it has seats$/)
    assert.equal(item.detail, 'Expect 4 people')
    assert.equal(item.href, `/admin/schedule/class/${classId}?location=${studio.locationId}`)
    assert.deepEqual(item.location, { id: studio.locationId, name: `${studio.slug} Studio` })

    await harness.db.update(schema.bookings).set({ state: 'cancelled' }).where(eq(schema.bookings.id, extra1))
    assert.match(itemsOf(await panel(admin))[0]!.title, /ClassPass booked 1 more person than it has seats$/)
    await harness.db.update(schema.bookings).set({ state: 'cancelled' }).where(eq(schema.bookings.id, extra2))
    assert.equal((await summary(admin)).needs_action, 0)

    const past = await futureClass(studio, 1, new Date(Date.now() - 3 * HOUR))
    await book(studio, past, 'e', 'overbook', 'classpass')
    assert.equal((await summary(admin)).needs_action, 0, 'a class that has ended is not listed')
  })

  test('ATN-83 an instructor never sees either ClassPass kind, and one studio never sees another studio', async () => {
    const studio = await freshStudio()
    const other = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    await staffAt(other, 'admin', 'admin')
    const teacher = await staffAt(studio, 'tutor', 'instructor')
    await reviewItem(studio, 'unparsed')
    const classId = await futureClass(studio, 1)
    await book(studio, classId, 'a', 'overbook', 'classpass')

    assert.equal((await summary(admin)).needs_action, 2)
    const theirs = await summary(teacher)
    assert.equal(theirs.needs_action, 0)
    assert.equal(theirs.by_group.classpass, undefined)
    assert.deepEqual(itemsOf(await panel(teacher)), [])
  })
})
