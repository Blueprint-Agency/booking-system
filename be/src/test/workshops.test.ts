import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { stripeWebhookPath, type StripeFake } from './stripe-fake'
import { billed } from './billing-details-fixture'

const run = Date.now().toString(36)
const DOMAIN = `${run}.workshops.test`
// Not ending in "Flow" / "Bundle": isolation.test.ts purges by those suffixes.
const PACKAGE_NAME = `Workshop-suite pass ${run}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * Workshops over real HTTP (#203): the admin editor's routes, the member
 * catalogue, and buying a place — paid through checkout, free by Register.
 *
 * Written from the WSP rows of the Scenario Inventory (`docs/md/test-scenarios.md`).
 * Each studio gets premises of its own, so no other file's classes can clash
 * with a workshop day's room.
 */
describe('workshops over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let stripe!: StripeFake
  let bookSvc!: typeof import('../services/workshops/book')

  type Studio = { id: string; slug: string; locationId: string; roomId: string; otherLocationId: string; otherRoomId: string }
  type Staff = { staffId: string; headers: Record<string, string> }
  type Member = { clientId: string; headers: Record<string, string> }

  let one!: Studio
  let two!: Studio
  let adminAtOne!: Staff
  let teacherAtOne!: Staff
  let adminAtTwo!: Staff
  let teacherAtTwo!: Staff

  const emailFor = (name: string) => `${name.toLowerCase().replace(/\s+/g, '-')}@${DOMAIN}`
  const json = (headers: Record<string, string>) => ({ ...headers, 'Content-Type': 'application/json' })

  /** Premises of the test's own at `tenant`: two locations, a room in each. */
  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const premises = async (name: string) => {
      const [location] = await harness.db
        .insert(schema.locations)
        .values({ tenantId: tenant.id, name: `${name} ${run}` })
        .returning({ id: schema.locations.id })
      const [room] = await harness.db
        .insert(schema.rooms)
        .values({ tenantId: tenant.id, locationId: location!.id, name: `${name} room`, capacity: 30 })
        .returning({ id: schema.rooms.id })
      return { locationId: location!.id, roomId: room!.id }
    }
    const a = await premises('Workshop hall')
    const b = await premises('Workshop annex')
    return { ...tenant, ...a, otherLocationId: b.locationId, otherRoomId: b.roomId }
  }

  async function staff(at: Studio, name: string, role: 'admin' | 'instructor'): Promise<Staff> {
    const email = emailFor(`${name}-${at.slug}`)
    const headers = await harness.signInAs('staff', email, at)
    const [authUser] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status: 'active', authUserId: authUser!.id })
      .returning({ id: schema.staffUsers.id })
    await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    return { staffId: row!.id, headers }
  }

  async function member(at: { id: string; slug: string }, name: string): Promise<Member> {
    const email = emailFor(`${name}-${at.slug}`)
    const headers = await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, email))
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, email, name, phone: '+6580000000', authUserId: user!.id })
      .returning({ id: schema.clients.id })
    return { clientId: client!.id, headers }
  }

  async function call(path: string, headers: Record<string, string>, init: { method?: string; body?: unknown } = {}) {
    const res = await harness.app.request(path, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? headers : json(headers),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await res.text()
    let body: any = null
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    return { status: res.status, body, text }
  }

  /** Days are placed far enough apart that no two workshops in this file share a room slot. */
  let slot = 0
  const nextStart = () => new Date(Date.now() + 30 * DAY + slot++ * 3 * HOUR)

  type DaySpec = { capacity: number; startsAt?: Date; roomId?: string }
  type TierSpec = { name: string; price: string; days: number[]; earlyBird?: { price: string; cutoff: Date } }
  type Workshop = { id: string; dayIds: string[]; tierIds: string[] }

  /** A workshop built through the admin editor's own routes, as the portal does. */
  async function workshop(
    at: Studio,
    admin: Staff,
    teacher: Staff,
    spec: { name: string; days: DaySpec[]; tiers: TierSpec[]; locationId?: string },
  ): Promise<Workshop> {
    const created = await call('/api/v1/portal/admin/workshops', admin.headers, {
      method: 'POST',
      body: {
        name: `${spec.name} ${run}`,
        location_id: spec.locationId ?? at.locationId,
        main_instructor_id: teacher.staffId,
        main_instructor_pay_sgd: 100,
      },
    })
    assert.equal(created.status, 201, created.text)
    const id = created.body.id as string
    const dayIds: string[] = []
    for (const [i, d] of spec.days.entries()) {
      const startsAt = d.startsAt ?? nextStart()
      const day = await call(`/api/v1/portal/admin/workshops/${id}/days`, admin.headers, {
        method: 'POST',
        body: {
          ord: i + 1,
          room_id: d.roomId ?? at.roomId,
          starts_at: startsAt.toISOString(),
          ends_at: new Date(startsAt.getTime() + 2 * HOUR).toISOString(),
          capacity_online: d.capacity,
        },
      })
      assert.equal(day.status, 201, day.text)
      dayIds.push(day.body.id)
    }
    const tierIds: string[] = []
    for (const [i, t] of spec.tiers.entries()) {
      const tier = await call(`/api/v1/portal/admin/workshops/${id}/tiers`, admin.headers, {
        method: 'POST',
        body: {
          name: t.name,
          regular_price_sgd: t.price,
          early_bird_price_sgd: t.earlyBird?.price,
          early_bird_cutoff_at: t.earlyBird?.cutoff.toISOString(),
          ord: i + 1,
          day_ids: t.days.map(n => dayIds[n]!),
        },
      })
      assert.equal(tier.status, 201, tier.text)
      tierIds.push(tier.body.id)
    }
    return { id, dayIds, tierIds }
  }

  const checkout = async (who: Member, w: Workshop, tier = 0) =>
    call('/api/v1/me/checkout/workshop', who.headers, {
      method: 'POST',
      body: await billed(harness.app, who.headers, { workshop_id: w.id, workshop_tier_id: w.tierIds[tier] }),
    })

  const bookingsOf = (who: Member, w: Workshop) =>
    harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.clientId, who.clientId), eq(schema.bookings.workshopId, w.id)))

  let sessions = 0
  const newSession = () => {
    sessions++
    return { id: `cs_${run}_${sessions}`, url: `https://checkout.stripe.test/${run}/${sessions}` }
  }

  const GOOD_SIGNATURE = 't=1,v1=workshops'
  type SessionParams = { metadata: Record<string, string>; line_items: { price_data: { unit_amount: number } }[] }
  const lastSession = () => stripe.callsTo('checkout.sessions.create').at(-1)!.args[0] as SessionParams

  const paidSession = (params: SessionParams, intent: string) => ({
    id: `cs_${intent}`,
    payment_intent: intent,
    payment_status: 'paid',
    amount_total: params.line_items.reduce((n, l) => n + l.price_data.unit_amount, 0),
    metadata: params.metadata,
  })

  const deliverPaid = (session: object) =>
    harness.app.request(stripeWebhookPath(one.slug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': GOOD_SIGNATURE },
      body: JSON.stringify({ id: `evt_${randomUUID()}`, type: 'checkout.session.completed', data: { object: session } }),
    })

  const workshopSalesOf = (who: Member) =>
    harness.db
      .select()
      .from(schema.purchases)
      .where(and(eq(schema.purchases.clientId, who.clientId), eq(schema.purchases.kind, 'workshop')))

  async function untilQueued(answered: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 10_000
    for (;;) {
      const [row] = await harness.db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`)
      if (row!.n > 0) return
      assert.equal(answered(), false, `${what} answered before it queued`)
      assert.ok(Date.now() < deadline, `${what} never queued`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    bookSvc = inTenantContext(await import('../services/workshops/book'))
    stripe = (await import('./stripe-fake')).installStripeFake()
    stripe.reply('customers.create', () => ({ id: `cus_${run}_${sessions}` }))
    stripe.reply('checkout.sessions.create', newSession)
    stripe.reply('webhooks.constructEvent', (body: unknown, signature: unknown) => {
      if (signature !== GOOD_SIGNATURE) throw new Error('No signatures found matching the expected signature for payload')
      return JSON.parse(String(body))
    })
    stripe.reply('paymentIntents.retrieve', (id: unknown) => ({
      id,
      latest_charge: { id: `ch_${String(id)}`, receipt_url: null },
    }))

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
    // Each studio sells on an account of its own — the only way a studio sells
    // at all (#293).
    stripe.ownAccount(one)
    stripe.ownAccount(two)
    adminAtOne = await staff(one, 'Ada Admin', 'admin')
    teacherAtOne = await staff(one, 'Tia Teacher', 'instructor')
    adminAtTwo = await staff(two, 'Ada Admin', 'admin')
    teacherAtTwo = await staff(two, 'Tia Teacher', 'instructor')
  })

  after(async () => {
    stripe?.restore()
    if (!harness) return
    const ours = `%@${DOMAIN}`
    const clients = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
    const staffIds = sql`SELECT id FROM staff_users WHERE email LIKE ${ours}`
    const workshops = sql`SELECT id FROM workshops WHERE created_by_staff_id IN (${staffIds})`
    const locations = sql`SELECT id FROM locations WHERE name LIKE ${`% ${run}`}`
    await harness.db.execute(sql`DELETE FROM audit_log WHERE actor_staff_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM bookings WHERE workshop_id IN (${workshops}) OR client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM receipts WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM stripe_payments WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM payment_customers WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${clients})`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name = ${PACKAGE_NAME}`)
    await harness.db.execute(sql`DELETE FROM promotions WHERE parent_id IN (${workshops})`)
    await harness.db.execute(sql`DELETE FROM workshop_tier_days WHERE workshop_tier_id IN (SELECT id FROM workshop_tiers WHERE workshop_id IN (${workshops}))`)
    await harness.db.execute(sql`DELETE FROM workshop_tiers WHERE workshop_id IN (${workshops})`)
    await harness.db.execute(sql`DELETE FROM workshop_days WHERE workshop_id IN (${workshops})`)
    await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (${workshops})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE id IN (${workshops})`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE location_id IN (${locations})`)
    await harness.db.execute(sql`DELETE FROM locations WHERE id IN (${locations})`)
    await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_billing_details WHERE client_id IN (SELECT id FROM clients WHERE email LIKE ${ours})`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM instructors WHERE staff_user_id IN (${staffIds})`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
    await harness.close()
  })

  /* ── the admin editor ──────────────────────────────────────────────── */

  test('WSP-01 an admin lists workshops at every location of the studio, and only its own', async () => {
    const here = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Hall retreat',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '100.00', days: [0] }],
    })
    const there = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Annex retreat',
      locationId: one.otherLocationId,
      days: [{ capacity: 10, roomId: one.otherRoomId }],
      tiers: [{ name: 'Full', price: '100.00', days: [0] }],
    })
    const elsewhere = await workshop(two, adminAtTwo, teacherAtTwo, {
      name: 'Other studio retreat',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '100.00', days: [0] }],
    })

    const listed = await call('/api/v1/portal/admin/workshops', adminAtOne.headers)
    assert.equal(listed.status, 200, listed.text)
    const ids = (listed.body.workshops as { id: string }[]).map(w => w.id)
    assert.ok(ids.includes(here.id), 'the workshop at the first location is listed')
    assert.ok(ids.includes(there.id), 'the workshop at the second location is listed')
    assert.ok(!ids.includes(elsewhere.id), "another studio's workshop is not")
  })

  test('an instructor and a member are refused the admin workshop routes', async () => {
    const asInstructor = await call('/api/v1/portal/admin/workshops', teacherAtOne.headers)
    assert.equal(asInstructor.status, 403, asInstructor.text)
    const creating = await call('/api/v1/portal/admin/workshops', teacherAtOne.headers, {
      method: 'POST',
      body: { name: `Sneaky ${run}`, location_id: one.locationId, main_instructor_id: teacherAtOne.staffId, main_instructor_pay_sgd: 0 },
    })
    assert.equal(creating.status, 403, creating.text)

    // A member's session is not a staff session at all.
    const ana = await member(one, 'Ana Portal')
    const asMember = await call('/api/v1/portal/admin/workshops', ana.headers)
    assert.equal(asMember.status, 401, asMember.text)
  })

  test("staff are refused the member's workshop routes", async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Members only',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Free', price: '0.00', days: [0] }],
    })
    for (const who of [adminAtOne, teacherAtOne]) {
      const browsing = await call('/api/v1/me/workshops', who.headers)
      assert.equal(browsing.status, 401, browsing.text)
      const buying = await call('/api/v1/me/checkout/workshop', who.headers, {
        method: 'POST',
        body: { workshop_id: w.id, workshop_tier_id: w.tierIds[0] },
      })
      assert.equal(buying.status, 401, buying.text)
    }
    const booked = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.workshopId, w.id))
    assert.equal(booked.length, 0)
  })

  test("another studio's admin cannot read, change or cancel a workshop", async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Guarded retreat',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '100.00', days: [0] }],
    })
    const read = await call(`/api/v1/portal/admin/workshops/${w.id}`, adminAtTwo.headers)
    assert.equal(read.status, 404, read.text)
    const renamed = await call(`/api/v1/portal/admin/workshops/${w.id}`, adminAtTwo.headers, {
      method: 'PATCH',
      body: { name: 'Taken over' },
    })
    assert.equal(renamed.status, 404, renamed.text)
    const cancelled = await call(`/api/v1/portal/admin/workshops/${w.id}/cancel`, adminAtTwo.headers, { method: 'POST' })
    assert.equal(cancelled.status, 404, cancelled.text)

    const [row] = await harness.db.select().from(schema.workshops).where(eq(schema.workshops.id, w.id))
    assert.equal(row!.name, `Guarded retreat ${run}`)
    assert.equal(row!.lifecycle, 'active')
  })

  test('WSP-04 a workshop day in a room at another location is refused', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, { name: 'Hall only', days: [], tiers: [] })
    const startsAt = nextStart()
    const day = await call(`/api/v1/portal/admin/workshops/${w.id}/days`, adminAtOne.headers, {
      method: 'POST',
      body: {
        ord: 1,
        room_id: one.otherRoomId,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
        capacity_online: 10,
      },
    })
    assert.equal(day.status, 400, day.text)
    assert.equal(day.body.error, 'room_location_mismatch')
    const days = await harness.db.select().from(schema.workshopDays).where(eq(schema.workshopDays.workshopId, w.id))
    assert.equal(days.length, 0)
  })

  test('WSP-23 a workshop day with no online, waitlist or buffer place is refused with a sentence, and nothing is written', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Placeless day',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '80.00', days: [0] }],
    })
    const none = { capacity_online: 0, capacity_waitlist: 0, capacity_buffer: 0 }
    const detailPath = `/api/v1/portal/admin/workshops/${w.id}`
    const stored = async () => {
      const res = await call(detailPath, adminAtOne.headers)
      assert.equal(res.status, 200, res.text)
      return res.body.days as { id: string; starts_at: string; ends_at: string; capacity_online: number }[]
    }
    const before = await stored()
    const startsAt = nextStart()

    const refusals = [
      await call(`${detailPath}/days`, adminAtOne.headers, {
        method: 'POST',
        body: {
          ord: 2,
          room_id: one.roomId,
          starts_at: startsAt.toISOString(),
          ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
          ...none,
        },
      }),
      await call(`${detailPath}/days/${w.dayIds[0]}`, adminAtOne.headers, { method: 'PATCH', body: none }),
      await call(`${detailPath}/schedule`, adminAtOne.headers, {
        method: 'PUT',
        body: {
          days: [
            { id: before[0]!.id, ref: 'kept', room_id: one.roomId, starts_at: before[0]!.starts_at, ends_at: before[0]!.ends_at, capacity_online: 10 },
            {
              ref: 'empty',
              room_id: one.roomId,
              starts_at: startsAt.toISOString(),
              ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
              ...none,
            },
          ],
          tiers: [{ id: w.tierIds[0], name: 'Full', regular_price_sgd: '80.00', day_refs: ['kept', 'empty'] }],
        },
      }),
    ]
    for (const res of refusals) {
      assert.equal(res.status, 400, res.text)
      assert.equal(res.body.error, 'capacity_required', res.text)
      assert.match(String(res.body.message), /at least one/i, `says why: ${res.text}`)
    }
    assert.deepEqual(await stored(), before, 'a refused day changes nothing')
  })

  test('WSP-05 each day of a three-day workshop is its own timetable tile, marked day N of 3', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Three-day immersion',
      days: [{ capacity: 10 }, { capacity: 10 }, { capacity: 10 }],
      tiers: [{ name: 'Full', price: '300.00', days: [0, 1, 2] }],
    })
    const from = new Date(Date.now() + 29 * DAY).toISOString()
    const to = new Date(Date.now() + 60 * DAY).toISOString()
    const res = await call(
      `/api/v1/portal/admin/schedule?type=workshop&location_id=${one.locationId}&from=${from}&to=${to}`,
      adminAtOne.headers,
    )
    assert.equal(res.status, 200, res.text)
    const tiles = (res.body.entries as { kind: string; workshop_id: string; id: string; day_index: number; day_count: number }[])
      .filter(e => e.workshop_id === w.id)
    assert.equal(tiles.length, 3)
    assert.deepEqual(tiles.map(t => t.id).sort(), [...w.dayIds].sort())
    assert.deepEqual(tiles.map(t => t.day_index).sort(), [1, 2, 3])
    for (const t of tiles) {
      assert.equal(t.kind, 'workshop')
      assert.equal(t.day_count, 3)
    }
  })

  /* ── the member side ───────────────────────────────────────────────── */

  test("a member browses their studio's workshops, and never another studio's", async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Browsable retreat',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '120.00', days: [0] }],
    })
    const ana = await member(one, 'Ana Browse')
    const list = await call('/api/v1/me/workshops', ana.headers)
    assert.equal(list.status, 200, list.text)
    assert.ok((list.body.workshops as { id: string }[]).some(x => x.id === w.id))
    const detail = await call(`/api/v1/me/workshops/${w.id}`, ana.headers)
    assert.equal(detail.status, 200, detail.text)
    assert.equal(detail.body.tiers[0].id, w.tierIds[0])

    const bo = await member(two, 'Bo Browse')
    const theirs = await call('/api/v1/me/workshops', bo.headers)
    assert.equal(theirs.status, 200, theirs.text)
    assert.ok(!(theirs.body.workshops as { id: string }[]).some(x => x.id === w.id))
    const peek = await call(`/api/v1/me/workshops/${w.id}`, bo.headers)
    assert.equal(peek.status, 404, peek.text)
  })

  test('WSP-32 a member opening a workshop by an id that is not one, or by one no workshop has, is answered 404 workshop_not_found', async () => {
    const ana = await member(one, 'Ana Typo')
    for (const id of ['not-a-uuid', '123', `${randomUUID()}x`, randomUUID()]) {
      const reply = await call(`/api/v1/me/workshops/${id}`, ana.headers)
      assert.deepEqual([reply.status, reply.body?.error], [404, 'workshop_not_found'], `${id}: ${reply.text}`)
    }
  })

  test('WSP-03 a workshop with no tier is not offered to members, and its last tier cannot be removed', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Unpriced retreat',
      days: [{ capacity: 10 }],
      tiers: [],
    })
    const ana = await member(one, 'Ana Unpriced')
    const listed = async () =>
      ((await call('/api/v1/me/workshops', ana.headers)).body.workshops as { id: string }[]).some(x => x.id === w.id)
    assert.equal(await listed(), false, 'a workshop no one can buy is not in the catalogue')
    const peek = await call(`/api/v1/me/workshops/${w.id}`, ana.headers)
    assert.equal(peek.status, 404, peek.text)

    const tierAt = (name: string) =>
      call(`/api/v1/portal/admin/workshops/${w.id}/tiers`, adminAtOne.headers, {
        method: 'POST',
        body: { name, regular_price_sgd: '80.00', ord: 1, day_ids: [w.dayIds[0]] },
      })
    const first = await tierAt('Full')
    assert.equal(first.status, 201, first.text)
    assert.equal(await listed(), true, 'priced, it is on sale')

    const tiersPath = `/api/v1/portal/admin/workshops/${w.id}/tiers`
    const last = await call(`${tiersPath}/${first.body.id}`, adminAtOne.headers, { method: 'DELETE' })
    assert.equal(last.status, 409, last.text)
    assert.equal(last.body.error, 'workshop_tier_required')
    assert.equal((await call(tiersPath, adminAtOne.headers)).body.tiers.length, 1, 'the tier is still there')

    // With another tier in its place, the first one may go.
    const second = await tierAt('Replacement')
    assert.equal(second.status, 201, second.text)
    const gone = await call(`${tiersPath}/${first.body.id}`, adminAtOne.headers, { method: 'DELETE' })
    assert.equal(gone.status, 200, gone.text)
    assert.deepEqual(
      ((await call(tiersPath, adminAtOne.headers)).body.tiers as { id: string }[]).map(t => t.id),
      [second.body.id],
    )
  })

  test('WSP-20 a workshop save the API refuses changes none of its days or tiers, so saving it again adds nothing', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Booked swap',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Free', price: '0.00', days: [0] }],
    })
    const ana = await member(one, 'Ana Booked Swap')
    assert.equal((await checkout(ana, w)).status, 201)

    const detailPath = `/api/v1/portal/admin/workshops/${w.id}`
    const stored = async () => {
      const res = await call(detailPath, adminAtOne.headers)
      assert.equal(res.status, 200, res.text)
      return {
        days: (res.body.days as { id: string }[]).map(d => d.id).sort(),
        tiers: (res.body.tiers as { id: string; name: string }[]).map(t => `${t.id} ${t.name}`).sort(),
      }
    }
    const before = await stored()
    const [day] = (await call(detailPath, adminAtOne.headers)).body.days as {
      id: string
      starts_at: string
      ends_at: string
    }[]
    const added = nextStart()
    const schedule = (tiers: object[]) =>
      call(`${detailPath}/schedule`, adminAtOne.headers, {
        method: 'PUT',
        body: {
          days: [
            { id: day!.id, ref: day!.id, room_id: one.roomId, starts_at: day!.starts_at, ends_at: day!.ends_at, capacity_online: 10 },
            {
              ref: 'added',
              room_id: one.roomId,
              starts_at: added.toISOString(),
              ends_at: new Date(added.getTime() + 2 * HOUR).toISOString(),
              capacity_online: 10,
            },
          ],
          tiers,
        },
      })
    const replacement = { name: 'Replacement', regular_price_sgd: '95.00', day_refs: [day!.id, 'added'] }

    for (const attempt of ['first', 'second']) {
      const refused = await schedule([replacement])
      assert.equal(refused.status, 409, refused.text)
      assert.equal(refused.body.error, 'workshop_tier_has_bookings')
      assert.deepEqual(await stored(), before, `the ${attempt} refused save wrote nothing`)
    }

    const none = await schedule([])
    assert.equal(none.status, 409, none.text)
    assert.equal(none.body.error, 'workshop_tier_required')
    assert.deepEqual(await stored(), before, 'a save with no tier wrote nothing')

    const kept = await schedule([{ id: w.tierIds[0], name: 'Free', regular_price_sgd: '0.00', day_refs: [day!.id] }, replacement])
    assert.equal(kept.status, 200, kept.text)
    const after = await stored()
    assert.equal(after.days.length, 2, 'the added day is saved once')
    assert.deepEqual(
      ((await call(detailPath, adminAtOne.headers)).body.tiers as { name: string }[]).map(t => t.name),
      ['Free', 'Replacement'],
    )
  })

  test('WSP-24 a workshop save refused for a booked tier or for leaving no tier says why in a sentence, and writes nothing', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Refusal sentences',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Free', price: '0.00', days: [0] }],
    })
    const bea = await member(one, 'Bea Refusal Sentences')
    assert.equal((await checkout(bea, w)).status, 201)

    const detailPath = `/api/v1/portal/admin/workshops/${w.id}`
    const detail = await call(detailPath, adminAtOne.headers)
    const [day] = detail.body.days as { id: string; starts_at: string; ends_at: string }[]
    const tierIds = () =>
      call(detailPath, adminAtOne.headers).then(res => (res.body.tiers as { id: string }[]).map(t => t.id).sort())
    const before = await tierIds()
    const schedule = (tiers: object[]) =>
      call(`${detailPath}/schedule`, adminAtOne.headers, {
        method: 'PUT',
        body: {
          days: [{ id: day!.id, ref: day!.id, room_id: one.roomId, starts_at: day!.starts_at, ends_at: day!.ends_at, capacity_online: 10 }],
          tiers,
        },
      })

    const booked = await schedule([{ name: 'Replacement', regular_price_sgd: '95.00', day_refs: [day!.id] }])
    assert.equal(booked.status, 409, booked.text)
    assert.equal(booked.body.error, 'workshop_tier_has_bookings')
    assert.match(String(booked.body.message), /1 confirmed booking\b/, booked.text)

    const none = await schedule([])
    assert.equal(none.status, 409, none.text)
    assert.equal(none.body.error, 'workshop_tier_required')
    assert.match(String(none.body.message), /at least one tier/i, none.text)

    assert.deepEqual(await tierIds(), before, 'neither refused save changed a tier')
  })

  test('WSP-25 a tier with a sale still open on it, unpaid on a live payment page or part-paid, cannot be removed, and one left unpaid past its payment page can', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Open sale tier',
      days: [{ capacity: 10 }],
      tiers: [
        { name: 'Full', price: '150.00', days: [0] },
        { name: 'Other', price: '90.00', days: [0] },
      ],
    })
    const cara = await member(one, 'Cara Open Sale')
    const started = await checkout(cara, w)
    assert.equal(started.status, 200, started.text)
    const [sale] = await harness.db
      .select({ id: schema.purchases.id })
      .from(schema.purchases)
      .where(and(eq(schema.purchases.clientId, cara.clientId), eq(schema.purchases.kind, 'workshop')))
    assert.ok(sale, 'the checkout opened a Purchase')

    const tiersPath = `/api/v1/portal/admin/workshops/${w.id}/tiers`
    const remove = () => call(`${tiersPath}/${w.tierIds[0]}`, adminAtOne.headers, { method: 'DELETE' })
    const tierIds = async () =>
      ((await call(tiersPath, adminAtOne.headers)).body.tiers as { id: string }[]).map(t => t.id).sort()
    const both = [...w.tierIds].sort()

    const unpaid = await remove()
    assert.equal(unpaid.status, 409, unpaid.text)
    assert.equal(unpaid.body.error, 'workshop_tier_has_open_purchases')
    assert.match(String(unpaid.body.message), /1 unfinished purchase\b/, unpaid.text)
    assert.deepEqual(await tierIds(), both, 'the tier on an unpaid sale is still there')

    await harness.db.execute(
      sql`UPDATE purchases SET created_at = now() - interval '3 days', part_paid_at = now() - interval '3 days', amount_paid_sgd = '50.00' WHERE id = ${sale!.id}`,
    )
    const partPaid = await remove()
    assert.equal(partPaid.status, 409, partPaid.text)
    assert.equal(partPaid.body.error, 'workshop_tier_has_open_purchases')
    assert.deepEqual(await tierIds(), both, 'the tier on a part-paid sale is still there')

    await harness.db.execute(
      sql`UPDATE purchases SET part_paid_at = null, amount_paid_sgd = '0.00' WHERE id = ${sale!.id}`,
    )
    const lapsed = await remove()
    assert.equal(lapsed.status, 200, lapsed.text)
    assert.deepEqual(await tierIds(), [w.tierIds[1]], 'a sale nobody can pay into any more holds no tier')
  })

  test('WSP-26 a sale started with its tier id in capitals holds the tier, and so does a sale whose tier is removed by its id in capitals', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Capital tier',
      days: [{ capacity: 10 }],
      tiers: [
        { name: 'Full', price: '150.00', days: [0] },
        { name: 'Half', price: '90.00', days: [0] },
        { name: 'Other', price: '60.00', days: [0] },
      ],
    })
    const dee = await member(one, 'Dee Capital Tier')
    const started = await call('/api/v1/me/checkout/workshop', dee.headers, {
      method: 'POST',
      body: await billed(harness.app, dee.headers, { workshop_id: w.id, workshop_tier_id: w.tierIds[0]!.toUpperCase() }),
    })
    assert.equal(started.status, 200, started.text)
    const eve = await member(one, 'Eve Lower Tier')
    assert.equal((await checkout(eve, w, 1)).status, 200)

    const tiersPath = `/api/v1/portal/admin/workshops/${w.id}/tiers`
    const capitalSale = await call(`${tiersPath}/${w.tierIds[0]}`, adminAtOne.headers, { method: 'DELETE' })
    assert.equal(capitalSale.status, 409, capitalSale.text)
    assert.equal(capitalSale.body.error, 'workshop_tier_has_open_purchases')
    const capitalRemoval = await call(`${tiersPath}/${w.tierIds[1]!.toUpperCase()}`, adminAtOne.headers, { method: 'DELETE' })
    assert.equal(capitalRemoval.status, 409, capitalRemoval.text)
    assert.equal(capitalRemoval.body.error, 'workshop_tier_has_open_purchases')
    assert.deepEqual(
      ((await call(tiersPath, adminAtOne.headers)).body.tiers as { id: string }[]).map(t => t.id).sort(),
      [...w.tierIds].sort(),
      'both held tiers are still there',
    )
  })

  test("WSP-27 a payment made on a tier's payment page that lands after the tier was removed is recorded, given back once and its Purchase closed Abandoned, and the confirmation page says nothing was granted", async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Late payment tier',
      days: [{ capacity: 10 }],
      tiers: [
        { name: 'Full', price: '150.00', days: [0] },
        { name: 'Other', price: '90.00', days: [0] },
      ],
    })
    const eli = await member(one, 'Eli Late Payment')
    assert.equal((await checkout(eli, w)).status, 200)
    const params = lastSession()
    const [sale] = await workshopSalesOf(eli)
    await harness.db.execute(sql`UPDATE purchases SET created_at = now() - interval '25 hours' WHERE id = ${sale!.id}`)
    const removed = await call(`/api/v1/portal/admin/workshops/${w.id}/tiers/${w.tierIds[0]}`, adminAtOne.headers, {
      method: 'DELETE',
    })
    assert.equal(removed.status, 200, removed.text)

    const intent = `pi_${randomUUID()}`
    const asked = stripe.callsTo('refunds.create').length
    const delivered = await deliverPaid(paidSession(params, intent))
    assert.equal(delivered.status, 200, await delivered.text())

    assert.equal((await bookingsOf(eli, w)).length, 0, 'a place was booked on a removed tier')
    const [closed] = await workshopSalesOf(eli)
    assert.equal(closed!.status, 'abandoned')
    const [payment] = await harness.db
      .select()
      .from(schema.stripePayments)
      .where(eq(schema.stripePayments.paymentIntentId, intent))
    assert.ok(payment, 'the payment is recorded nowhere')
    assert.equal(payment.purchaseId, sale!.id)
    assert.ok(payment.refundRequestedAt, 'its return is on its way')
    assert.deepEqual(
      stripe.callsTo('refunds.create').slice(asked).map(c => (c.args[0] as { payment_intent: string }).payment_intent),
      [intent],
      'the payment, and only it, is given back',
    )

    stripe.reply('checkout.sessions.retrieve', () => paidSession(params, intent))
    const confirmation = await call('/api/v1/me/checkout/sync-session', eli.headers, {
      method: 'POST',
      body: { session_id: `cs_${intent}` },
    })
    assert.equal(confirmation.status, 200, confirmation.text)
    assert.equal(confirmation.body.status, 'abandoned')
    assert.equal(stripe.callsTo('refunds.create').length, asked + 1, 'the replay asked for it twice')
  })

  test('WSP-28 a tier removal and a checkout for that tier at the same moment take turns: a removal mid-checkout waits and is refused for the new sale, and a checkout mid-removal waits and finds no tier', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Racing tier',
      days: [{ capacity: 10 }],
      tiers: [
        { name: 'Full', price: '150.00', days: [0] },
        { name: 'Other', price: '90.00', days: [0] },
      ],
    })
    const tiersPath = `/api/v1/portal/admin/workshops/${w.id}/tiers`
    const tierIds = async () =>
      ((await call(tiersPath, adminAtOne.headers)).body.tiers as { id: string }[]).map(t => t.id).sort()

    const fay = await member(one, 'Fay Mid Checkout')
    let reach!: () => void
    let release!: () => void
    const reached = new Promise<void>(resolve => (reach = resolve))
    const released = new Promise<void>(resolve => (release = resolve))
    stripe.reply('checkout.sessions.create', async () => {
      reach()
      await released
      return newSession()
    })
    try {
      const paying = checkout(fay, w)
      await reached
      let answered = false
      const removing = call(`${tiersPath}/${w.tierIds[0]}`, adminAtOne.headers, { method: 'DELETE' }).finally(
        () => (answered = true),
      )
      await untilQueued(() => answered, 'the removal')
      release()
      assert.equal((await paying).status, 200)
      const removal = await removing
      assert.equal(removal.status, 409, removal.text)
      assert.equal(removal.body.error, 'workshop_tier_has_open_purchases')
      assert.deepEqual(await tierIds(), [...w.tierIds].sort(), 'the tier on the sale made mid-removal is still there')
    } finally {
      release()
      stripe.reply('checkout.sessions.create', newSession)
    }

    const gus = await member(one, 'Gus Mid Removal')
    const { withTenant } = await import('../db')
    const tiersSvc = await import('../services/workshops/tiers')
    let letGo!: () => void
    const held = new Promise<void>(resolve => (letGo = resolve))
    let removed!: () => void
    const tierGone = new Promise<void>(resolve => (removed = resolve))
    const removal = withTenant(one.id, async () => {
      await tiersSvc.deleteTier(one.id, w.id, w.tierIds[1]!)
      removed()
      await held
    })
    try {
      await Promise.race([tierGone, removal])
      let answered = false
      const buying = checkout(gus, w, 1).finally(() => (answered = true))
      await untilQueued(() => answered, 'the checkout')
      letGo()
      await removal
      const bought = await buying
      assert.equal(bought.status, 404, bought.text)
      assert.equal(bought.body.error, 'workshop_tier_not_found')
      assert.equal((await workshopSalesOf(gus)).length, 0, 'a sale was opened on a removed tier')
    } finally {
      letGo()
      await removal.catch(() => undefined)
    }
  })

  test('WSP-29 a tier whose only bookings were cancelled cannot be removed, and the refusal says why in a sentence', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Cancelled history tier',
      days: [{ capacity: 10 }],
      tiers: [
        { name: 'Free', price: '0.00', days: [0] },
        { name: 'Other', price: '90.00', days: [0] },
      ],
    })
    const hal = await member(one, 'Hal Cancelled')
    assert.equal((await checkout(hal, w)).status, 201)
    await harness.db.execute(sql`UPDATE bookings SET state = 'cancelled', cancelled_at = now() WHERE client_id = ${hal.clientId}`)

    const tiersPath = `/api/v1/portal/admin/workshops/${w.id}/tiers`
    const refused = await call(`${tiersPath}/${w.tierIds[0]}`, adminAtOne.headers, { method: 'DELETE' })
    assert.equal(refused.status, 409, refused.text)
    assert.equal(refused.body.error, 'workshop_tier_has_booking_history')
    assert.match(String(refused.body.message), /1 cancelled or no-show booking\b/, refused.text)
    assert.deepEqual(
      ((await call(tiersPath, adminAtOne.headers)).body.tiers as { id: string }[]).map(t => t.id).sort(),
      [...w.tierIds].sort(),
    )
  })

  test('WSP-30 a workshop save that removes a tier with an unpaid sale is refused, saying the hold clears within a day, and writes nothing until the payment page has closed', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Save held tier',
      days: [{ capacity: 10 }],
      tiers: [
        { name: 'Full', price: '150.00', days: [0] },
        { name: 'Other', price: '90.00', days: [0] },
      ],
    })
    const ivy = await member(one, 'Ivy Save Held')
    assert.equal((await checkout(ivy, w)).status, 200)
    const [sale] = await workshopSalesOf(ivy)

    const detailPath = `/api/v1/portal/admin/workshops/${w.id}`
    const detail = async () => {
      const res = await call(detailPath, adminAtOne.headers)
      assert.equal(res.status, 200, res.text)
      return res.body as { days: { id: string; starts_at: string; ends_at: string; capacity_online: number }[]; tiers: { id: string }[] }
    }
    const [day] = (await detail()).days
    const save = () =>
      call(`${detailPath}/schedule`, adminAtOne.headers, {
        method: 'PUT',
        body: {
          days: [{ id: day!.id, ref: day!.id, room_id: one.roomId, starts_at: day!.starts_at, ends_at: day!.ends_at, capacity_online: 12 }],
          tiers: [{ id: w.tierIds[1], name: 'Other', regular_price_sgd: '90.00', day_refs: [day!.id] }],
        },
      })

    const opened = sale!.createdAt.getTime()
    try {
      harness.clock.set(new Date(opened + DAY - 60_000))
      const refused = await save()
      assert.equal(refused.status, 409, refused.text)
      assert.equal(refused.body.error, 'workshop_tier_has_open_purchases')
      assert.match(String(refused.body.message), /1 unfinished purchase\b/, refused.text)
      assert.match(String(refused.body.message), /within a day/, refused.text)
      const unchanged = await detail()
      assert.equal(unchanged.days[0]!.capacity_online, 10, 'the refused save edited the day')
      assert.deepEqual(unchanged.tiers.map(t => t.id).sort(), [...w.tierIds].sort())

      harness.clock.set(new Date(opened + DAY + 60_000))
      const saved = await save()
      assert.equal(saved.status, 200, saved.text)
      const after = await detail()
      assert.equal(after.days[0]!.capacity_online, 12)
      assert.deepEqual(after.tiers.map(t => t.id), [w.tierIds[1]])
    } finally {
      harness.clock.reset()
    }
  })

  test('WSP-31 a new workshop is made with its days, tiers and promotions in one request, so a refused create leaves no workshop behind and trying again makes one', async () => {
    const name = `One request retreat ${run}`
    const startsAt = nextStart()
    const endsAt = new Date(startsAt.getTime() + 2 * HOUR)
    const create = (tierDayRef: string) =>
      call('/api/v1/portal/admin/workshops', adminAtOne.headers, {
        method: 'POST',
        body: {
          name,
          location_id: one.locationId,
          main_instructor_id: teacherAtOne.staffId,
          main_instructor_pay_sgd: 100,
          days: [{ ref: 'first', room_id: one.roomId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), capacity_online: 10 }],
          tiers: [{ name: 'Full', regular_price_sgd: '120.00', day_refs: [tierDayRef] }],
          promotions: [
            {
              label: 'Launch',
              kind: 'percent',
              percent_off: 10,
              starts_at: new Date(Date.now() - DAY).toISOString(),
              ends_at: new Date(Date.now() + DAY).toISOString(),
            },
          ],
        },
      })
    const named = () =>
      harness.db.select({ id: schema.workshops.id }).from(schema.workshops).where(eq(schema.workshops.name, name))

    const refused = await create('missing')
    assert.equal(refused.status, 400, refused.text)
    assert.equal(refused.body.error, 'invalid_workshop_day_ids')
    assert.deepEqual(await named(), [], 'the refused create left a workshop behind')

    const created = await create('first')
    assert.equal(created.status, 201, created.text)
    assert.deepEqual(await named(), [{ id: created.body.id }], 'trying again made more than one workshop')
    const detail = await call(`/api/v1/portal/admin/workshops/${created.body.id}`, adminAtOne.headers)
    assert.equal(detail.body.days.length, 1)
    assert.deepEqual((detail.body.tiers as { name: string; day_ids: string[] }[]).map(t => [t.name, t.day_ids]), [
      ['Full', [detail.body.days[0].id]],
    ])
    assert.deepEqual((detail.body.promotions as { label: string }[]).map(p => p.label), ['Launch'])
  })

  test('SCH-37 a workshop roster naming one supporting instructor twice, once in capitals, keeps them once at the pay given, and the main instructor in capitals as supporting is refused', async () => {
    const sam = await staff(one, `Sam Support ${run}`, 'instructor')
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Two spellings roster',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '100.00', days: [0] }],
    })
    const detailPath = `/api/v1/portal/admin/workshops/${w.id}`
    const twice = await call(detailPath, adminAtOne.headers, {
      method: 'PATCH',
      body: {
        supporting_instructors: [
          { instructor_id: sam.staffId, pay_sgd: 45 },
          { instructor_id: sam.staffId.toUpperCase() },
        ],
      },
    })
    assert.equal(twice.status, 200, twice.text)
    const roster = (await call(detailPath, adminAtOne.headers)).body.supporting_instructors as {
      instructor_id: string
      pay_sgd: number | string | null
    }[]
    assert.deepEqual(
      roster.map(s => [s.instructor_id.toLowerCase(), Number(s.pay_sgd)]),
      [[sam.staffId.toLowerCase(), 45]],
    )

    const mainAsSupporting = await call(detailPath, adminAtOne.headers, {
      method: 'PATCH',
      body: { supporting_instructors: [{ instructor_id: teacherAtOne.staffId.toUpperCase(), pay_sgd: 10 }] },
    })
    assert.equal(mainAsSupporting.status, 400, mainAsSupporting.text)
    assert.equal(mainAsSupporting.body.error, 'supporting_instructor_duplicates_main')
  })

  test('WSP-21 removing one of two tiers while the other is being removed leaves the workshop one tier', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Two tier race',
      days: [{ capacity: 10 }],
      tiers: [
        { name: 'Morning', price: '50.00', days: [0] },
        { name: 'Evening', price: '60.00', days: [0] },
      ],
    })
    const { withTenant } = await import('../db')
    const tiersSvc = await import('../services/workshops/tiers')
    let letGo!: () => void
    const released = new Promise<void>(resolve => (letGo = resolve))
    let removed!: () => void
    const firstRemoved = new Promise<void>(resolve => (removed = resolve))
    const first = withTenant(one.id, async () => {
      await tiersSvc.deleteTier(one.id, w.id, w.tierIds[0]!)
      removed()
      await released
    })
    await Promise.race([firstRemoved, first])

    const tiersPath = `/api/v1/portal/admin/workshops/${w.id}/tiers`
    let answered = false
    const second = call(`${tiersPath}/${w.tierIds[1]}`, adminAtOne.headers, { method: 'DELETE' }).finally(
      () => (answered = true),
    )
    while (!answered) {
      const [row] = (await harness.db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`)) as unknown as { n: number }[]
      if (Number(row?.n ?? 0) >= 1) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    letGo()
    await first

    const res = await second
    assert.equal(res.status, 409, res.text)
    assert.equal(res.body.error, 'workshop_tier_required')
    assert.deepEqual(
      ((await call(tiersPath, adminAtOne.headers)).body.tiers as { id: string }[]).map(t => t.id),
      [w.tierIds[1]],
      'the tier removed second is still there',
    )
  })

  test("a member of another studio cannot buy a place in this studio's workshop", async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Members-only retreat',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Free', price: '0.00', days: [0] }],
    })
    const bo = await member(two, 'Bo Trespass')
    const res = await checkout(bo, w)
    assert.equal(res.status, 404, res.text)
    assert.equal((await bookingsOf(bo, w)).length, 0)
  })

  test('WSP-07 a member holding credits pays a paid tier through checkout, and no credit is spent', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Paid retreat',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '150.00', days: [0] }],
    })
    const ana = await member(one, 'Ana Credits')
    const [pkg] = await harness.db
      .insert(schema.classPackages)
      .values({ tenantId: one.id, name: PACKAGE_NAME, kind: 'credit_bundle', credits: 10, validityDays: 90, priceSgd: '200.00' })
      .returning({ id: schema.classPackages.id })
    const { clientPackageId } = await inTenantContext(await import('../services/packages/purchase')).grantPackage(one.id, {
      clientId: ana.clientId,
      purchaseId: null,
      amountSgd: '200.00',
      packageKind: 'class',
      packageId: pkg!.id,
    })
    const before = stripe.callsTo('checkout.sessions.create').length

    const res = await checkout(ana, w)
    assert.equal(res.status, 200, res.text)
    assert.match(res.body.url, /^https:\/\/checkout\.stripe\.test\//)

    const created = stripe.callsTo('checkout.sessions.create').slice(before)
    assert.equal(created.length, 1)
    const params = created[0]!.args[0] as { line_items: { price_data: { unit_amount: number } }[] }
    assert.equal(params.line_items[0]!.price_data.unit_amount, 15000)

    const [held] = await harness.db
      .select({ remaining: schema.clientPackages.creditsOrSessionsRemaining })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.id, clientPackageId))
    assert.equal(held!.remaining, 10, 'no credit was deducted')
    assert.equal((await bookingsOf(ana, w)).length, 0, 'the place is not booked until the payment lands')
  })

  test('WSP-08 a free tier is registered at once without checkout, and the confirmation is logged under the studio', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Free open day',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Free', price: '0.00', days: [0] }],
    })
    const ana = await member(one, 'Ana Free')
    const before = stripe.callsTo('checkout.sessions.create').length

    const res = await checkout(ana, w)
    assert.equal(res.status, 201, res.text)
    assert.equal(res.body.outcome, 'granted')
    assert.equal(stripe.callsTo('checkout.sessions.create').length, before, 'checkout was skipped')

    const booked = await bookingsOf(ana, w)
    assert.equal(booked.length, 1)
    assert.equal(booked[0]!.id, res.body.booking_id)
    assert.equal(booked[0]!.state, 'confirmed')
    assert.equal(booked[0]!.amountPaidSgd, '0.00')

    const mine = await call('/api/v1/me/workshop-bookings', ana.headers)
    assert.equal(mine.status, 200, mine.text)
    assert.ok(JSON.stringify(mine.body).includes(res.body.booking_id), 'the booking is on the member’s own list')

    const logged = await harness.db
      .select()
      .from(schema.emailLog)
      .where(eq(schema.emailLog.recipientEmail, emailFor(`Ana Free-${one.slug}`)))
    assert.equal(logged.length, 1)
    assert.equal(logged[0]!.tenantId, one.id)
    assert.equal(logged[0]!.templateSlug, 'workshop_purchase_confirmed')
    assert.equal(logged[0]!.recipientUserId, ana.clientId)
    assert.equal(logged[0]!.status, 'sent')
    assert.ok(logged[0]!.queuedAt instanceof Date && logged[0]!.sentAt instanceof Date)
  })

  const purchasesOf = (who: Member) =>
    harness.db.select().from(schema.purchases).where(eq(schema.purchases.clientId, who.clientId))

  test('WSP-18 a free registration opens one settled S$0.00 workshop Purchase, and the place points at it', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Free settled open day',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Free', price: '0.00', days: [0] }],
    })
    const ana = await member(one, 'Ana Settled')

    const res = await checkout(ana, w)
    assert.equal(res.status, 201, res.text)
    assert.equal(res.body.outcome, 'granted')

    const bought = await purchasesOf(ana)
    assert.equal(bought.length, 1, 'one Purchase for one place')
    assert.equal(bought[0]!.tenantId, one.id)
    assert.equal(bought[0]!.kind, 'workshop')
    assert.equal(bought[0]!.status, 'paid')
    assert.equal(bought[0]!.totalSgd, '0.00')
    assert.equal(bought[0]!.amountPaidSgd, '0.00')
    assert.ok(bought[0]!.settledAt instanceof Date, 'the Purchase is settled')
    assert.deepEqual(bought[0]!.lines, [
      {
        description: `Free settled open day ${run} — Free`,
        quantity: 1,
        listPriceSgd: '0.00',
        discountSgd: '0.00',
        discounts: [],
        amountSgd: '0.00',
      },
    ])

    const [place] = await bookingsOf(ana, w)
    assert.equal(place!.id, res.body.booking_id)
    assert.equal(place!.purchaseId, bought[0]!.id, 'the booking points at its Purchase')

    // Registering again is refused, and opens nothing.
    const again = await checkout(ana, w)
    assert.equal(again.status, 409, again.text)
    assert.equal(again.body.error, 'already_booked')
    assert.equal((await purchasesOf(ana)).length, 1)
    assert.equal((await bookingsOf(ana, w)).length, 1)

    // What the member sees is unchanged: the place, its QR, the one confirmation.
    const mine = await call('/api/v1/me/workshop-bookings', ana.headers)
    assert.equal(mine.status, 200, mine.text)
    const listed = (mine.body.workshop_bookings as { id: string; qr_token: string; code: string }[]).find(
      b => b.id === res.body.booking_id,
    )
    assert.ok(listed, 'the booking is on the member’s own list')
    assert.equal(listed.qr_token, place!.qrToken, 'with its QR code')
    assert.equal(listed.code, place!.code)
    const mailed = await harness.db
      .select()
      .from(schema.emailLog)
      .where(eq(schema.emailLog.recipientEmail, emailFor(`Ana Settled-${one.slug}`)))
    assert.deepEqual(mailed.map(m => m.templateSlug), ['workshop_purchase_confirmed'])

    // Finance shows the free ticket as it always has: S$0.00 paid, nothing
    // refunded, no way it was paid, and nothing added to the totals.
    const finance = await call(
      `/api/v1/portal/admin/finance?${new URLSearchParams({
        type: 'workshop',
        q: 'Ana Settled',
        from: new Date(Date.now() - DAY).toISOString(),
        to: new Date(Date.now() + DAY).toISOString(),
      })}`,
      adminAtOne.headers,
    )
    assert.equal(finance.status, 200, finance.text)
    const tickets = (finance.body.rows as { kind: string; id: string }[]).filter(r => r.kind === 'workshop_ticket')
    assert.equal(tickets.length, 1, finance.text)
    assert.deepEqual(
      (({ id, list_price_sgd, paid_sgd, discount_sgd, refunded, complimentary, methods, method_label }) =>
        ({ id, list_price_sgd, paid_sgd, discount_sgd, refunded, complimentary, methods, method_label }))(
        tickets[0] as any,
      ),
      {
        id: res.body.booking_id,
        list_price_sgd: 0,
        paid_sgd: 0,
        discount_sgd: 0,
        refunded: false,
        complimentary: false,
        methods: [],
        method_label: null,
      },
    )
    assert.equal(finance.body.totals.gross_sgd, 0)
    assert.equal(finance.body.totals.refunds_sgd, 0)
  })

  test('WSP-19 two registrations for one free place at once leave one place and one Purchase', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Free double tap',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Free', price: '0.00', days: [0] }],
    })
    const ana = await member(one, 'Ana Double Tap')

    const both = await Promise.all([checkout(ana, w), checkout(ana, w)])
    assert.deepEqual(both.map(r => r.status).sort(), [201, 409], both.map(r => r.text).join(' / '))

    const places = await bookingsOf(ana, w)
    const bought = await purchasesOf(ana)
    assert.equal(places.length, 1, 'one place')
    assert.equal(bought.length, 1, 'one Purchase')
    assert.equal(places[0]!.purchaseId, bought[0]!.id)
  })

  test('WSP-10 the lowest of the active promotions sets the price shown and the price charged', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Promoted retreat',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '200.00', days: [0] }],
    })
    const live = { starts_at: new Date(Date.now() - DAY).toISOString(), ends_at: new Date(Date.now() + 10 * DAY).toISOString() }
    const promos = await call(`/api/v1/portal/admin/workshops/${w.id}/promotions`, adminAtOne.headers, {
      method: 'PUT',
      body: {
        promotions: [
          { label: 'Ten off', kind: 'percent', percent_off: 10, ...live },
          { label: 'Special', kind: 'special_price', special_price_sgd: '160.00', ...live },
          { label: 'Quarter off', kind: 'percent', percent_off: 25, ...live },
        ],
      },
    })
    assert.equal(promos.status, 200, promos.text)
    const quarterOff = (promos.body.promotions as { id: string; label: string }[]).find(p => p.label === 'Quarter off')!

    const ana = await member(one, 'Ana Promo')
    const detail = await call(`/api/v1/me/workshops/${w.id}`, ana.headers)
    assert.equal(detail.status, 200, detail.text)
    assert.equal(Number(detail.body.tiers[0].effective_price_sgd), 150)
    assert.equal(detail.body.tiers[0].applied_promotion_id, quarterOff.id)

    const before = stripe.callsTo('checkout.sessions.create').length
    const res = await checkout(ana, w)
    assert.equal(res.status, 200, res.text)
    const params = stripe.callsTo('checkout.sessions.create')[before]!.args[0] as {
      line_items: { price_data: { unit_amount: number } }[]
    }
    assert.equal(params.line_items[0]!.price_data.unit_amount, 15000)
  })

  test('WSP-11 a tier is full when the smallest day it covers is full', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Two-day uneven',
      days: [{ capacity: 3 }, { capacity: 1 }],
      tiers: [
        { name: 'Both days', price: '180.00', days: [0, 1] },
        { name: 'Day 2 only', price: '0.00', days: [1] },
      ],
    })
    const first = await member(one, 'Ana First')
    const taken = await checkout(first, w, 1)
    assert.equal(taken.status, 201, taken.text)

    const late = await member(one, 'Ana Late')
    const before = stripe.callsTo('checkout.sessions.create').length
    const res = await checkout(late, w, 0)
    assert.equal(res.status, 409, res.text)
    assert.equal(res.body.error, 'workshop_full')
    assert.equal(stripe.callsTo('checkout.sessions.create').length, before, 'nobody was sent to pay for a full tier')
    assert.equal((await bookingsOf(late, w)).length, 0)
  })

  test('WSP-06 a tier covering several days has room only while every day it covers has room, and no count is sent', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Weekend intensive',
      days: [{ capacity: 2 }, { capacity: 1 }],
      tiers: [
        { name: 'Both days', price: '180.00', days: [0, 1] },
        { name: 'Day 1 only', price: '0.00', days: [0] },
        { name: 'Day 2 only', price: '0.00', days: [1] },
      ],
    })
    const [bothDays, dayOne, dayTwo] = w.tierIds
    const ana = await member(one, 'Ana Room')
    const room = async () => {
      const detail = await call(`/api/v1/me/workshops/${w.id}`, ana.headers)
      assert.equal(detail.status, 200, detail.text)
      return Object.fromEntries((detail.body.tiers as { id: string; has_room: unknown }[]).map(t => [t.id, t.has_room]))
    }

    assert.deepEqual(await room(), { [bothDays!]: true, [dayOne!]: true, [dayTwo!]: true })

    // Day 1 still has a seat left after one place: every tier keeps its room.
    const first = await member(one, 'Ana Day One')
    assert.equal((await checkout(first, w, 1)).status, 201)
    assert.deepEqual(await room(), { [bothDays!]: true, [dayOne!]: true, [dayTwo!]: true })

    // Day 2's one seat goes: every tier covering day 2 is out of room, day 1 alone is not.
    const second = await member(one, 'Ana Day Two')
    assert.equal((await checkout(second, w, 2)).status, 201)
    assert.deepEqual(await room(), { [bothDays!]: false, [dayOne!]: true, [dayTwo!]: false })

    // What the catalogue says is what the purchase gate does.
    const late = await member(one, 'Ana No Room')
    const refused = await checkout(late, w, 0)
    assert.equal(refused.status, 409, refused.text)
    assert.equal(refused.body.error, 'workshop_full')
    assert.equal((await bookingsOf(late, w)).length, 0)

    // No figure of seats, room or bookings leaves the member catalogue: not per
    // tier, not per day, not on the card.
    const countLike = /(^|_)(capacity|spots?|seats?|room|booked|bookings|remaining|left|taken|count|enrolled|available)(_|$)/i
    const detail = await call(`/api/v1/me/workshops/${w.id}`, ana.headers)
    const list = await call('/api/v1/me/workshops', ana.headers)
    const card = (list.body.workshops as { id: string }[]).find(x => x.id === w.id)!
    // `days_count` / `tiers_count` are how many days and tiers the workshop has.
    const keysOf = (o: object) =>
      Object.keys(o).filter(k => countLike.test(k) && k !== 'days_count' && k !== 'tiers_count')
    for (const tier of detail.body.tiers as object[]) assert.deepEqual(keysOf(tier), ['has_room'])
    for (const day of detail.body.days as object[]) assert.deepEqual(keysOf(day), [])
    assert.deepEqual(keysOf(card), [])
    assert.deepEqual(keysOf(detail.body), [])

    // Reading the catalogue wrote nothing: the two places are still the only ones.
    const placed = await harness.db.select().from(schema.bookings).where(eq(schema.bookings.workshopId, w.id))
    assert.equal(placed.length, 2)

    // Another studio's member is told nothing about it; staff are not members.
    const bo = await member(two, 'Bo Room')
    const peek = await call(`/api/v1/me/workshops/${w.id}`, bo.headers)
    assert.equal(peek.status, 404, peek.text)
    assert.equal(peek.body.error, 'workshop_not_found')
    const staffPeek = await call(`/api/v1/me/workshops/${w.id}`, adminAtOne.headers)
    assert.equal(staffPeek.status, 401, staffPeek.text)
  })

  test('WSP-12 the free-register path refuses a paid tier and books nothing', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Not free',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '90.00', days: [0] }],
    })
    const ana = await member(one, 'Ana Freeloader')
    await assert.rejects(
      () => bookSvc.bookWorkshopFree(one.id, { clientId: ana.clientId, workshopId: w.id, workshopTierId: w.tierIds[0]!, lines: [] }),
      (err: { code?: string }) => err.code === 'workshop_is_not_free',
    )
    assert.equal((await bookingsOf(ana, w)).length, 0)
  })

  test('WSP-13 a member who already holds a place is refused a second one', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Once only',
      days: [{ capacity: 10 }],
      tiers: [
        { name: 'Free', price: '0.00', days: [0] },
        { name: 'Paid', price: '50.00', days: [0] },
      ],
    })
    const ana = await member(one, 'Ana Twice')
    assert.equal((await checkout(ana, w, 0)).status, 201)

    const again = await checkout(ana, w, 0)
    assert.equal(again.status, 409, again.text)
    assert.equal(again.body.error, 'already_booked')

    const before = stripe.callsTo('checkout.sessions.create').length
    const paid = await checkout(ana, w, 1)
    assert.equal(paid.status, 409, paid.text)
    assert.equal(paid.body.error, 'already_booked')
    assert.equal(stripe.callsTo('checkout.sessions.create').length, before)

    assert.equal((await bookingsOf(ana, w)).length, 1)
  })

  test('WSP-14 a cancelled workshop cannot be bought', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Called off',
      days: [{ capacity: 10 }],
      tiers: [
        { name: 'Free', price: '0.00', days: [0] },
        { name: 'Paid', price: '50.00', days: [0] },
      ],
    })
    const cancelled = await call(`/api/v1/portal/admin/workshops/${w.id}/cancel`, adminAtOne.headers, { method: 'POST' })
    assert.equal(cancelled.status, 200, cancelled.text)

    const ana = await member(one, 'Ana Cancelled')
    for (const tier of [0, 1]) {
      const res = await checkout(ana, w, tier)
      assert.equal(res.status, 400, res.text)
      assert.equal(res.body.error, 'workshop_not_active')
    }
    assert.equal((await bookingsOf(ana, w)).length, 0)
  })

  /* ── the confirmation email's template ─────────────────────────────── */

  const CONFIRMATION = 'workshop_purchase_confirmed'

  const templateAt = async (tenantId: string) =>
    (
      await harness.db
        .select()
        .from(schema.emailTemplates)
        .where(and(eq(schema.emailTemplates.tenantId, tenantId), eq(schema.emailTemplates.slug, CONFIRMATION)))
    )[0]!

  /** A member registers for a free workshop at `at`; hands back the confirmation's log row. */
  async function registerAndReadConfirmation(at: Studio, admin: Staff, teacher: Staff, name: string) {
    const w = await workshop(at, admin, teacher, {
      name: `Mailed open day ${at.slug}`,
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Free', price: '0.00', days: [0] }],
    })
    const who = await member(at, name)
    assert.equal((await checkout(who, w)).status, 201)
    const [row] = await harness.db
      .select()
      .from(schema.emailLog)
      .where(and(eq(schema.emailLog.recipientEmail, emailFor(`${name}-${at.slug}`)), eq(schema.emailLog.templateSlug, CONFIRMATION)))
    assert.ok(row, `no confirmation was logged at ${at.slug}`)
    return { row, workshopName: `Mailed open day ${at.slug} ${run}` }
  }

  test('NTF-19 a studio that has not customised a template is sent the seeded default subject and body', async () => {
    const { buildEmailTemplates } = await import('../db/seed/email-copy')
    const { tenantOrigin } = await import('../lib/allowed-origins')
    const { provisioningFor } = await import('../db/seed/provisioning')
    const { renderTemplate } = await import('../services/notifications/render')
    const [tenant] = await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, two.id))
    const seed = buildEmailTemplates({
      clientUrl: tenantOrigin('client', two.slug)!,
      portalUrl: tenantOrigin('portal', two.slug)!,
      studio: { name: tenant!.name, footer: provisioningFor({ id: two.id })?.emailFooter },
    }).find(t => t.slug === CONFIRMATION)!
    const stored = await templateAt(two.id)
    assert.equal(stored.subject, seed.subject, 'the studio still holds the seeded subject')
    assert.equal(stored.bodyHtml, seed.bodyHtml, 'the studio still holds the seeded body')

    const { row, workshopName } = await registerAndReadConfirmation(two, adminAtTwo, teacherAtTwo, 'Bo Seeded')
    assert.equal(row.subjectRendered, renderTemplate(seed.subject, { workshop_name: workshopName }))
    // The body is framed by the shared layout, so the seeded copy's own wording
    // is looked for inside it: its longest run of literal text.
    const literal = seed.bodyHtml
      .split(/\{\{\w+\}\}|<[^>]*>/)
      .map(s => s.trim())
      .sort((a, b) => b.length - a.length)[0]!
    assert.ok(literal.length > 10, `the seeded body has no literal text to look for: ${seed.bodyHtml}`)
    assert.ok(row.bodyRendered.includes(literal), `the seeded body's "${literal}" is not in the email sent`)
  })

  test("a studio's own wording of a template reaches only its own members", async () => {
    const original = await templateAt(one.id)
    // Saved straight to the studio's row: the portal's editor route is not
    // built yet (NTF-20, #234).
    const marker = `own-wording-${run}`
    await harness.db
      .update(schema.emailTemplates)
      .set({ subject: 'Booked: {{workshop_name}}', bodyHtml: `<p>${marker} {{workshop_name}}</p>` })
      .where(eq(schema.emailTemplates.id, original.id))
    try {
      const own = await registerAndReadConfirmation(one, adminAtOne, teacherAtOne, 'Ana Reworded')
      assert.equal(own.row.subjectRendered, `Booked: ${own.workshopName}`)
      assert.ok(own.row.bodyRendered.includes(marker), "the studio's own body was sent")

      const other = await registerAndReadConfirmation(two, adminAtTwo, teacherAtTwo, 'Bo Unreworded')
      assert.equal(other.row.subjectRendered, `Your place at ${other.workshopName} is confirmed`)
      assert.ok(!other.row.bodyRendered.includes(marker), "one studio's wording reached another studio's member")
    } finally {
      await harness.db
        .update(schema.emailTemplates)
        .set({ subject: original.subject, bodyHtml: original.bodyHtml })
        .where(eq(schema.emailTemplates.id, original.id))
    }
  })

  test('WSP-14 a workshop whose days are all over cannot be bought', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Already happened',
      days: [{ capacity: 10, startsAt: new Date(Date.now() - 3 * DAY - slot++ * 3 * HOUR) }],
      tiers: [
        { name: 'Free', price: '0.00', days: [0] },
        { name: 'Paid', price: '50.00', days: [0] },
      ],
    })
    const ana = await member(one, 'Ana Too Late')
    const before = stripe.callsTo('checkout.sessions.create').length
    for (const tier of [0, 1]) {
      const res = await checkout(ana, w, tier)
      assert.equal(res.status, 400, res.text)
      assert.equal(res.body.error, 'workshop_ended')
    }
    assert.equal(stripe.callsTo('checkout.sessions.create').length, before)
    assert.equal((await bookingsOf(ana, w)).length, 0)
  })

  test('an early-bird price is charged until its cutoff on the app clock, and the regular price from then', async () => {
    const cutoff = new Date(Math.floor((Date.now() + 10 * DAY) / 60_000) * 60_000)
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Early bird retreat',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '150.00', days: [0], earlyBird: { price: '120.00', cutoff } }],
    })
    const charged = async (who: Member) => {
      const before = stripe.callsTo('checkout.sessions.create').length
      const res = await checkout(who, w)
      assert.equal(res.status, 200, res.text)
      const created = stripe.callsTo('checkout.sessions.create').slice(before)
      assert.equal(created.length, 1)
      return (created[0]!.args[0] as { line_items: { price_data: { unit_amount: number } }[] }).line_items[0]!.price_data
        .unit_amount
    }
    try {
      harness.clock.set(new Date(cutoff.getTime() - 1000))
      assert.equal(await charged(await member(one, 'Ana Early')), 12000)
      harness.clock.set(cutoff)
      assert.equal(await charged(await member(one, 'Ana On Time')), 15000)
    } finally {
      harness.clock.reset()
    }
  })

  test('a workshop stops being sold when its last day ends on the app clock', async () => {
    const startsAt = nextStart()
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Ends by the clock',
      days: [{ capacity: 10, startsAt }],
      tiers: [{ name: 'Free', price: '0.00', days: [0] }, { name: 'Paid', price: '50.00', days: [0] }],
    })
    const ana = await member(one, 'Ana By The Clock')
    const before = stripe.callsTo('checkout.sessions.create').length
    try {
      harness.clock.set(new Date(startsAt.getTime() + 2 * HOUR)) // the day's end
      for (const tier of [0, 1]) {
        const res = await checkout(ana, w, tier)
        assert.equal(res.status, 400, res.text)
        assert.equal(res.body.error, 'workshop_ended')
      }
    } finally {
      harness.clock.reset()
    }
    assert.equal(stripe.callsTo('checkout.sessions.create').length, before)
    assert.equal((await bookingsOf(ana, w)).length, 0)
  })
})
