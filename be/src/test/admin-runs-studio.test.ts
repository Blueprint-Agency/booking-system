import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

/**
 * A studio admin runs the whole studio (#148), over real HTTP.
 *
 * Every portal surface that used to be closed to admins opens to them;
 * clients, workshops and rooms stop being read-only for them. An instructor
 * keeps exactly what they had: none of it.
 */
describe('admins run the studio', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `admin-runs-${run}.test`
  const TAG = `arun-${run}`
  const at = (name: string) => `${name}@${DOMAIN}`

  const send = (path: string, headers: Record<string, string>, method = 'GET', body?: unknown) =>
    harness.app.request(`/api/v1/portal/admin${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const ok = async (res: Response) => {
    const text = await res.text()
    assert.ok(res.status >= 200 && res.status < 300, `expected 2xx, got ${res.status}: ${text}`)
    return (text ? JSON.parse(text) : {}) as Record<string, any>
  }

  const staffAt = async (tenant: { id: string; slug: string }, email: string, role: 'admin' | 'instructor') => {
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: email, role, status: 'active', authUserId: user!.id })
      .returning()
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return { headers, row: row!, authUserId: user!.id }
  }

  let admin!: Awaited<ReturnType<typeof staffAt>>
  let instructor!: Awaited<ReturnType<typeof staffAt>>
  let adminTwo!: Awaited<ReturnType<typeof staffAt>>
  let location!: { id: string }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ one, two } = harness.tenants)
    admin = await staffAt(one, at('admin'), 'admin')
    instructor = await staffAt(one, at('instructor'), 'instructor')
    adminTwo = await staffAt(two, at('admin-two'), 'admin')
    const [seededLocation] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(and(eq(schema.locations.tenantId, one.id), isNull(schema.locations.deletedAt), isNull(schema.locations.archivedAt)))
      .limit(1)
    assert.ok(seededLocation, 'the fixture studio has a seeded location')
    location = seededLocation
  })

  after(async () => {
    if (!harness) return
    // Whatever cleanup throws, the pools close: an open socket keeps the test
    // process alive, and CI then sits at the job timeout instead of failing.
    try {
      await cleanUp()
    } finally {
      await harness.close()
    }
  })

  const cleanUp = async () => {
    const staff = await harness.db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const staffIds = staff.map(s => s.id)
    const auth = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    const pattern = `${TAG}%`
    await harness.db.execute(sql`
      DELETE FROM inbox_items WHERE payload->>'workshopId' IN (SELECT id::text FROM workshops WHERE name LIKE ${pattern})`)
    await harness.db.execute(sql`DELETE FROM workshop_instructors WHERE workshop_id IN (SELECT id FROM workshops WHERE name LIKE ${pattern})`)
    await harness.db.execute(sql`DELETE FROM workshops WHERE name LIKE ${pattern}`)
    // Sessions before rooms: a corporate session may sit in this run's room,
    // and rooms.id is ON DELETE restrict.
    await harness.db.execute(sql`DELETE FROM corporate_sessions WHERE client_name LIKE ${pattern}`)
    await harness.db.execute(sql`DELETE FROM corporate_packages WHERE name LIKE ${pattern}`)
    await harness.db.execute(sql`DELETE FROM rooms WHERE name LIKE ${pattern}`)
    await harness.db.execute(sql`DELETE FROM locations WHERE name LIKE ${pattern}`)
    await harness.db.execute(sql`DELETE FROM class_types WHERE name LIKE ${pattern}`)
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${pattern}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${pattern}`)
    await harness.db.execute(sql`DELETE FROM promo_codes WHERE label LIKE ${pattern}`)
    if (auth.length) {
      await harness.db.delete(schema.authEvents).where(inArray(schema.authEvents.actorUserId, auth.map(a => a.id)))
    }
    if (staffIds.length) {
      await harness.db
        .update(schema.globalPolicy)
        .set({ updatedByStaffId: null })
        .where(inArray(schema.globalPolicy.updatedByStaffId, staffIds))
      await harness.db.delete(schema.staffInvitations).where(inArray(schema.staffInvitations.invitedByStaffId, staffIds))
      await harness.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
      await harness.db.delete(schema.instructors).where(inArray(schema.instructors.staffUserId, staffIds))
    }
    await harness.db.delete(schema.clients).where(like(schema.clients.email, `%@${DOMAIN}`))
    if (staffIds.length) await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
  }

  /** One write in each group that used to be closed or read-only to admins. */
  const writes = (): Array<{ group: string; method: string; path: string; body?: unknown }> => [
    { group: 'locations', method: 'POST', path: '/locations', body: { name: `${TAG} Studio` } },
    { group: 'class types', method: 'POST', path: '/class-types', body: { name: `${TAG} Flow` } },
    { group: 'instructors', method: 'POST', path: '/instructors', body: { email: at(`teacher-${Math.random().toString(36).slice(2)}`), name: 'New Teacher' } },
    { group: 'class packages', method: 'POST', path: '/class-packages', body: { name: `${TAG} Ten`, kind: 'credit_bundle', credits: 10, validity_days: 90, price_sgd: 200 } },
    { group: 'PT packages', method: 'POST', path: '/pt-packages', body: { name: `${TAG} PT`, session_type: '1on1', num_sessions: 5, validity_days: 90, price_sgd: 400 } },
    { group: 'corporate packages', method: 'POST', path: '/corporate-packages', body: { name: `${TAG} Corp`, price_sgd: '900.00' } },
    { group: 'promo codes', method: 'POST', path: '/promo-codes', body: { label: `${TAG} Promo`, kind: 'percent', percent_off: 10, applies_to_all: true } },
    { group: 'policy', method: 'PATCH', path: '/policy/global', body: {} },
    { group: 'clients', method: 'POST', path: '/clients', body: { name: 'Ada Lovelace', email: at(`member-${Math.random().toString(36).slice(2)}`), phone: '+6591234567' } },
    { group: 'rooms', method: 'POST', path: '/rooms', body: { location_id: location.id, name: `${TAG} Room`, capacity: 12 } },
  ]

  /**
   * Writes whose handler is not built yet (they answer 501) or that need a row
   * the test would have to invent first: what they prove here is only that the
   * role gate lets an admin through, which is all this ticket changes.
   */
  const gated = (): Array<{ group: string; method: string; path: string; body?: unknown }> => [
    { group: 'corporate sessions', method: 'POST', path: `/corporate-sessions/${crypto.randomUUID()}/cancel` },
    { group: 'bookings', method: 'POST', path: `/bookings/${crypto.randomUUID()}/cancel` },
    { group: 'notifications', method: 'PATCH', path: '/notifications/templates/welcome', body: {} },
    { group: 'waiver', method: 'PATCH', path: '/waiver', body: {} },
    { group: 'marketing', method: 'PATCH', path: '/marketing', body: {} },
    { group: 'feature flags', method: 'PATCH', path: '/feature-flags/anything', body: {} },
    { group: 'workshops', method: 'POST', path: `/workshops/${crypto.randomUUID()}/cancel` },
  ]

  test('an admin makes a change in every group', async () => {
    for (const w of writes()) {
      const res = await send(w.path, admin.headers, w.method, w.body)
      const text = await res.text()
      assert.ok(res.status >= 200 && res.status < 300, `${w.group}: expected 2xx, got ${res.status}: ${text}`)
    }
    for (const w of gated()) {
      const res = await send(w.path, admin.headers, w.method, w.body)
      const text = await res.text()
      assert.notEqual(res.status, 403, `${w.group}: the admin was refused: ${text}`)
      assert.notEqual(res.status, 401, `${w.group}: ${text}`)
    }
  })

  test('an instructor is refused every one of those writes', async () => {
    for (const w of [...writes(), ...gated()]) {
      const res = await send(w.path, instructor.headers, w.method, w.body)
      assert.equal(res.status, 403, `${w.group}: ${await res.text()}`)
    }
  })

  test('an admin creates a workshop and cancels it', async () => {
    const created = await ok(
      await send('/workshops', admin.headers, 'POST', {
        name: `${TAG} Retreat`,
        location_id: location.id,
        main_instructor_id: instructor.row.id,
        main_instructor_pay_sgd: 100,
      }),
    )
    const cancelled = await ok(await send(`/workshops/${created.id}/cancel`, admin.headers, 'POST', {}))
    const [row] = await harness.db.select().from(schema.workshops).where(eq(schema.workshops.id, created.id))
    assert.equal(row?.lifecycle, 'cancelled', JSON.stringify(cancelled))
  })

  test('an admin books a corporate session', async () => {
    const [room] = await harness.db
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      // Not this run's own `${TAG} Room`: without an ORDER BY Postgres hands back
      // whichever row it likes, and a session in that room blocks its cleanup.
      .where(and(eq(schema.rooms.locationId, location.id), sql`${schema.rooms.name} NOT LIKE ${`${TAG}%`}`))
      .limit(1)
    assert.ok(room, 'the seeded location has a room')
    const pkg = await ok(await send('/corporate-packages', admin.headers, 'POST', { name: `${TAG} Offsite`, price_sgd: '900.00' }))
    // Far out and at a random hour, so no fixture class holds the room or the instructor.
    const startsAt = new Date(Date.now() + (400 + Math.floor(Math.random() * 300)) * 24 * 3600_000)
    startsAt.setUTCHours(Math.floor(Math.random() * 20), 0, 0, 0)
    await ok(
      await send('/corporate-sessions', admin.headers, 'POST', {
        corporate_package_id: pkg.corporatePackage.id,
        client_name: `${TAG} Client`,
        main_instructor_id: instructor.row.id,
        location_id: location.id,
        room_id: room.id,
        starts_at: startsAt.toISOString(),
        ends_at: new Date(startsAt.getTime() + 3600_000).toISOString(),
      }),
    )
  })

  test('an admin deletes a client, sees it in the deleted view, and restores it', async () => {
    const created = await ok(
      await send('/clients', admin.headers, 'POST', { name: 'Grace Hopper', email: at('deleted'), phone: '+6591234568' }),
    )
    await ok(await send(`/clients/${created.id}`, admin.headers, 'DELETE'))
    const deleted = await ok(await send('/clients?include_deleted=true&q=deleted', admin.headers))
    const listed = JSON.stringify(deleted)
    assert.ok(listed.includes(created.id), `the deleted view shows the client: ${listed.slice(0, 400)}`)
    await ok(await send(`/clients/${created.id}/restore`, admin.headers, 'POST', {}))
    const [row] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, created.id))
    assert.equal(row?.deletedAt, null)
  })

  test('an admin impersonates a member, and the sign-in log names the admin', async () => {
    const member = await ok(
      await send('/clients', admin.headers, 'POST', { name: 'Ada Byron', email: at('impersonated'), phone: '+6591234569' }),
    )
    const minted = await ok(await send(`/clients/${member.id}/impersonate`, admin.headers, 'POST', {}))
    assert.equal(typeof minted.token, 'string')
    const [client] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, member.id))
    const [started] = await harness.db
      .select()
      .from(schema.authEvents)
      .where(and(eq(schema.authEvents.actorUserId, admin.authUserId), eq(schema.authEvents.kind, 'impersonation_started')))
    assert.ok(started, 'impersonation_started names the admin as actor')
    assert.equal(started.subjectUserId, client!.authUserId)
  })

  test("an admin of one studio cannot reach the other studio's rows", async () => {
    const theirs = await ok(
      await send('/clients', adminTwo.headers, 'POST', { name: 'Other Member', email: at('other-studio'), phone: '+6591234570' }),
    )
    const [theirLocation] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(eq(schema.locations.tenantId, two.id))
      .limit(1)

    assert.equal((await send(`/clients/${theirs.id}`, admin.headers, 'DELETE')).status, 404)
    assert.equal((await send(`/clients/${theirs.id}/impersonate`, admin.headers, 'POST', {})).status, 404)
    assert.equal((await send(`/locations/${theirLocation!.id}`, admin.headers, 'PATCH', { name: 'Stolen' })).status, 404)
    const [row] = await harness.db.select().from(schema.clients).where(eq(schema.clients.id, theirs.id))
    assert.equal(row?.deletedAt, null)
  })

  test('an admin sees every active location', async () => {
    const extra = await ok(await send('/locations', admin.headers, 'POST', { name: `${TAG} Annex` }))

    const res = await harness.app.request('/api/v1/portal/auth/me', { headers: admin.headers })
    const me = (await res.json()) as { locations: Array<{ id: string }> }
    const ids = me.locations.map(l => l.id)
    assert.ok(ids.includes(location.id))
    assert.ok(ids.includes(extra.id), 'a newly added location is listed')
  })
})
