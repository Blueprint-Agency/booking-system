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
import { connectPayments, usePaymentKey } from './attention-payments'

/**
 * Staff attention (#476, #477): the bell's numbers and the panel's list, read
 * over HTTP as a signed-in admin or instructor. This file holds the spine and
 * its first kind, `pt_request_pending`; each later kind adds its own rows.
 *
 * Every test makes a studio of its own (pattern: instructor-permissions), so
 * what a count says is about the requests that test made and nobody else's.
 */
describe('Staff attention', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  usePaymentKey()
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let ptPackagesSvc!: typeof import('../services/packages/pt-packages')
  let purchaseSvc!: typeof import('../services/packages/purchase')
  let jobs!: typeof import('../jobs')

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR
  const ALL = ['schedule_classes', 'take_pt_bookings', 'manage_rosters']

  type Studio = { id: string; slug: string; locationId: string; roomId: string; classTypeId: string }
  type Staff = { headers: Record<string, string>; id: string; email: string }
  type Member = { headers: Record<string, string>; id: string }

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
    const slug = `attn-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Attention Studio', adminEmail: `owner@${slug}.test` })
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
      .values({ tenantId: tenant.id, name: `${slug} Hatha` })
      .returning({ id: schema.classTypes.id })
    return { id: tenant.id, slug, locationId: location!.id, roomId: room!.id, classTypeId: type!.id }
  }

  const secondLocation = async (studio: Studio, name: string) => {
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: studio.id, name, address: '2 Test Street' })
      .returning({ id: schema.locations.id })
    return location!.id
  }

  const adminAt = async (studio: Studio, name = 'admin'): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role: 'admin', status: 'active', authUserId: user!.id })
      .returning()
    return { headers, id: row!.id, email }
  }

  const inviteInstructor = async (studio: Studio, admin: Staff, name: string, permissions?: string[]): Promise<Staff> => {
    const email = `${name}@${studio.slug}.test`
    await json(
      await send('/portal/admin/staff/invite', admin.headers, 'POST', {
        email,
        role: 'instructor',
        ...(permissions ? { permissions } : {}),
      }),
      201,
    )
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
    return { headers, id: invitation!.staffUserId!, email }
  }

  const setPermissions = (admin: Staff, id: string, permissions: string[]) =>
    send(`/portal/admin/staff/${id}`, admin.headers, 'PATCH', { permissions })

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
    return { headers, id: client!.id }
  }

  /** A pending 1on1 PT Request, made the way a member makes one. */
  let ptPackages = 0
  const ptRequest = async (studio: Studio, member: Member, locationId = studio.locationId) => {
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
        locationId,
        sessionType: '1on1',
        clientPackageId,
        slots: [{ proposedDate: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10), startTime: '09:00', endTime: '10:00' }],
      }),
      201,
    )
    return { id: created.pt_request_id as string, clientPackageId }
  }

  let ptSlots = 0
  const schedule = (studio: Studio, who: Staff, id: string, instructor: Staff) => {
    const startsAt = new Date(Date.now() + 3 * DAY + ++ptSlots * 2 * HOUR)
    return send(`/portal/admin/pt-sessions/${id}/schedule`, who.headers, 'POST', {
      location_id: studio.locationId,
      room_id: studio.roomId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + HOUR).toISOString(),
      instructor_id: instructor.id,
    })
  }

  const summary = async (who: Staff, query = '') => json(await send(`/portal/attention/summary${query}`, who.headers), 200)
  const panel = async (who: Staff, query = '') => json(await send(`/portal/attention${query}`, who.headers), 200)
  const itemsOf = (body: Record<string, any>) =>
    (body.needs_action.groups as Array<{ items: Array<Record<string, any>> }>).flatMap(g => g.items)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ptPackagesSvc = inTenantContext(await import('../services/packages/pt-packages'))
    purchaseSvc = inTenantContext(await import('../services/packages/purchase'))
    jobs = await import('../jobs')
  })

  after(async () => {
    await harness?.close()
  })

  test('ATN-01 an admin sees a pending PT request as one Requests item written as a sentence, with its location, link and counts', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const member = await memberAt(studio, 'maya')
    const { id } = await ptRequest(studio, member)

    const counts = await summary(admin)
    assert.equal(counts.needs_action, 1)
    assert.equal(counts.unread_updates, 0)
    assert.equal(counts.total, 1)
    assert.equal(counts.by_group.pt_requests, 1)

    const body = await panel(admin)
    assert.equal(body.needs_action.groups.length, 1)
    const [group] = body.needs_action.groups
    assert.equal(group.key, 'requests')
    assert.equal(group.label, 'Requests')
    assert.equal(group.count, 1)
    assert.equal(group.see_all_href, '/admin/pt-requests')
    assert.equal(group.items.length, 1)
    const item = group.items[0]
    assert.equal(item.id, `pt_request_pending:${id}`)
    assert.equal(item.kind, 'pt_request_pending')
    assert.equal(item.title, `maya asked for a 1-on-1 ${studio.slug} Hatha session`)
    assert.match(item.detail, /^Asked just now · expires \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} [ap]m$/)
    assert.equal(item.href, `/admin/pt-requests?request=${id}&location=${studio.locationId}`)
    assert.deepEqual(item.location, { id: studio.locationId, name: `${studio.slug} Studio` })
    assert.equal(item.dismissable, false)
    assert.ok(!Number.isNaN(Date.parse(item.occurred_at)))
    assert.deepEqual(body.updates.items, [])
    assert.equal(body.updates.next_cursor, null)
    assert.equal(counts.total, itemsOf(body).length, 'the bubble equals the rows listed')
  })

  test('ATN-02 an instructor with Take PT bookings sees the unbound requests and the ones bound to them, linked to their own PT page, and not those bound to a colleague', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')
    const kim = await inviteInstructor(studio, admin, 'kim')
    const member = await memberAt(studio, 'maya')
    const open = await ptRequest(studio, member)
    const mine = await ptRequest(studio, member)
    const theirs = await ptRequest(studio, member)
    const bind = (clientPackageId: string, staffId: string) =>
      harness.db.update(schema.clientPackages).set({ boundInstructorId: staffId }).where(eq(schema.clientPackages.id, clientPackageId))
    await bind(mine.clientPackageId, tara.id)
    await bind(theirs.clientPackageId, kim.id)

    const counts = await summary(tara)
    assert.equal(counts.needs_action, 2)
    assert.equal(counts.by_group.pt_requests, 2)
    const body = await panel(tara)
    assert.deepEqual(itemsOf(body).map(i => i.id).sort(), [`pt_request_pending:${open.id}`, `pt_request_pending:${mine.id}`].sort())
    assert.ok(itemsOf(body).every(i => i.href.startsWith('/instructor/pt-requests?request=')))
    assert.equal(body.needs_action.groups[0].see_all_href, '/instructor/pt-requests')

    assert.equal((await summary(admin)).needs_action, 3, 'an admin sees the whole studio, bindings and all')
  })

  test('ATN-03 an instructor without Take PT bookings sees none, and switching it off removes the items on the very next request', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')
    const member = await memberAt(studio, 'maya')
    await ptRequest(studio, member)
    assert.equal((await summary(tara)).total, 1)

    await json(await setPermissions(admin, tara.id, ['schedule_classes', 'manage_rosters']), 200)
    const after = await summary(tara)
    // Needs action only: the change itself is an Update to Tara now (#491).
    assert.equal(after.needs_action, 0)
    assert.equal(after.by_group.pt_requests ?? 0, 0)
    assert.deepEqual((await panel(tara)).needs_action.groups, [])

    await json(await setPermissions(admin, tara.id, ALL), 200)
    assert.equal((await summary(tara)).needs_action, 1)
  })

  test('ATN-04 the request drops off when it is scheduled, cancelled or expired, and the bubble follows', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')
    const member = await memberAt(studio, 'maya')
    const toSchedule = await ptRequest(studio, member)
    const toCancel = await ptRequest(studio, member)
    const toExpire = await ptRequest(studio, member)
    // Needs action only: Tara joining is an Update to the admin now (#491).
    assert.equal((await summary(admin)).needs_action, 3)

    await json(await schedule(studio, admin, toSchedule.id, tara), 201)
    assert.equal((await summary(admin)).needs_action, 2)

    await json(await send(`/portal/admin/pt-sessions/${toCancel.id}/cancel`, admin.headers, 'POST', {}), 200)
    assert.equal((await summary(admin)).needs_action, 1)

    await harness.db
      .update(schema.ptRequests)
      .set({ expiresAt: new Date(Date.now() - HOUR) })
      .where(eq(schema.ptRequests.id, toExpire.id))
    await jobs.scheduledJobs.expireStaleSessions()
    const final = await summary(admin)
    assert.equal(final.needs_action, 0)
    assert.deepEqual(itemsOf(await panel(admin)), [])
  })

  test('ATN-05 another studio sees nothing of a studio’s requests, and its counts are its own', async () => {
    const one = await freshStudio()
    const two = await freshStudio()
    const adminOne = await adminAt(one)
    const adminTwo = await adminAt(two)
    await ptRequest(one, await memberAt(one, 'maya'))

    assert.equal((await summary(adminOne)).total, 1)
    const other = await summary(adminTwo)
    assert.equal(other.total, 0)
    assert.equal(other.needs_action, 0)
    assert.deepEqual((await panel(adminTwo)).needs_action.groups, [])
  })

  test('ATN-06 by_group honours location_id while needs_action and the list cover every location', async () => {
    const studio = await freshStudio()
    const east = await secondLocation(studio, `${studio.slug} East`)
    const admin = await adminAt(studio)
    const member = await memberAt(studio, 'maya')
    await ptRequest(studio, member)
    const farRequest = await ptRequest(studio, member, east)
    await ptRequest(studio, member, east)

    const all = await summary(admin)
    assert.equal(all.needs_action, 3)
    assert.equal(all.by_group.pt_requests, 3, 'with no location named, every location counts')
    const here = await summary(admin, `?location_id=${studio.locationId}`)
    assert.equal(here.needs_action, 3, 'the bubble covers every location')
    assert.equal(here.total, 3)
    assert.equal(here.by_group.pt_requests, 1)
    const there = await summary(admin, `?location_id=${east}`)
    assert.equal(there.by_group.pt_requests, 2)

    const far = itemsOf(await panel(admin)).find(i => i.id === `pt_request_pending:${farRequest.id}`)!
    assert.equal(far.location.name, `${studio.slug} East`)
    assert.equal(far.href, `/admin/pt-requests?request=${farRequest.id}&location=${east}`)
  })

  test('ATN-07 a 2-on-1 request whose partner has no account tells the admin to link them first', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await inviteInstructor(studio, admin, 'tara')
    const { id } = await ptRequest(studio, await memberAt(studio, 'maya'))
    await harness.db
      .update(schema.ptRequests)
      .set({ sessionType: '2on1', coClientName: 'Sam Partner', coClientEmail: `sam@${studio.slug}.test` })
      .where(eq(schema.ptRequests.id, id))

    const [adminItem] = itemsOf(await panel(admin))
    assert.equal(adminItem!.title, `maya asked for a 2-on-1 ${studio.slug} Hatha session`)
    assert.equal(adminItem!.detail, 'Partner Sam Partner needs an account before you can schedule this')
    const [instructorItem] = itemsOf(await panel(tara))
    assert.match(instructorItem!.detail, /^Asked just now/, 'the partner line is the admin copy')
  })

  test('ATN-08 the panel lists at most limit_per_group rows per group but counts them all, with the bubble still the whole count', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const member = await memberAt(studio, 'maya')
    for (let i = 0; i < 3; i++) await ptRequest(studio, member)

    const body = await panel(admin, '?limit_per_group=2')
    const [group] = body.needs_action.groups
    assert.equal(group.count, 3)
    assert.equal(group.items.length, 2)
    assert.equal((await summary(admin)).total, 3)
    assert.equal((await panel(admin)).needs_action.groups[0].items.length, 3, 'five is the default and three fit')
  })
})
