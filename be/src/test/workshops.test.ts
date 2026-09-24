import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'
import type { StripeFake } from './stripe-fake'

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

  const checkout = (who: Member, w: Workshop, tier = 0) =>
    call('/api/v1/me/checkout/workshop', who.headers, {
      method: 'POST',
      body: { workshop_id: w.id, workshop_tier_id: w.tierIds[tier] },
    })

  const bookingsOf = (who: Member, w: Workshop) =>
    harness.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.clientId, who.clientId), eq(schema.bookings.workshopId, w.id)))

  let sessions = 0
  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    bookSvc = inTenantContext(await import('../services/workshops/book'))
    stripe = (await import('./stripe-fake')).installStripeFake()
    stripe.reply('customers.create', () => ({ id: `cus_${run}_${sessions}` }))
    stripe.reply('checkout.sessions.create', () => {
      sessions++
      return { id: `cs_${run}_${sessions}`, url: `https://checkout.stripe.test/${run}/${sessions}` }
    })

    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
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

  test('WSP-12 the free-register path refuses a paid tier and books nothing', async () => {
    const w = await workshop(one, adminAtOne, teacherAtOne, {
      name: 'Not free',
      days: [{ capacity: 10 }],
      tiers: [{ name: 'Full', price: '90.00', days: [0] }],
    })
    const ana = await member(one, 'Ana Freeloader')
    await assert.rejects(
      () => bookSvc.bookWorkshopFree(one.id, { clientId: ana.clientId, workshopId: w.id, workshopTierId: w.tierIds[0]! }),
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
})
