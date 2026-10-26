import assert from 'node:assert/strict'
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
 * Staff attention (#476, #478): the three corporate kinds, all Admin-only.
 * `corporate_request_pending`, `corporate_session_unmarked` and
 * `corporate_refunded_still_scheduled`. Every test makes a studio of its own,
 * and each kind is resolved through the real portal routes.
 */
describe('Staff attention: corporate requests', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  usePaymentKey()
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let ensureAuthUser!: typeof import('../services/auth/auth-users').ensureAuthUser

  const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR
  const START = new Date(Date.UTC(2031, 5, 10, 12, 0))

  type Studio = { id: string; slug: string; locationId: string; roomId: string; packageId: string }
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
    const slug = `corp-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Corporate Studio', adminEmail: `owner@${slug}.test` })
    await connectPayments(tenant.id)
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: `${slug} Studio`, address: '1 Test Street' })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: `${slug} Room`, capacity: 20 })
      .returning({ id: schema.rooms.id })
    return { id: tenant.id, slug, locationId: location!.id, roomId: room!.id, packageId: '' }
  }

  const adminAt = async (studio: Studio): Promise<Staff> => {
    const email = `admin${people++}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name: 'admin', role: 'admin', status: 'active', authUserId: user!.id })
      .returning()
    if (!studio.packageId) {
      const [pkg] = await harness.db
        .insert(schema.corporatePackages)
        .values({ tenantId: studio.id, name: 'Team Offsite', priceSgd: '1500.00', createdByStaffId: row!.id })
        .returning({ id: schema.corporatePackages.id })
      studio.packageId = pkg!.id
    }
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
  /** A member, with the Purchase that paid for their corporate package. */
  const buyer = async (studio: Studio, name: string) => {
    const email = `member${members++}@${studio.slug}.test`
    const authUserId = await ensureAuthUser(harness.db, 'client', { email, name, tenantId: studio.id })
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: studio.id, email, name, phone: '+6580000000', authUserId })
      .returning({ id: schema.clients.id })
    const [purchase] = await harness.db
      .insert(schema.purchases)
      .values({
        tenantId: studio.id,
        clientId: client!.id,
        kind: 'corporate_package',
        totalSgd: '1500.00',
        amountPaidSgd: '1500.00',
        status: 'paid',
      })
      .returning({ id: schema.purchases.id })
    return { clientId: client!.id, purchaseId: purchase!.id }
  }

  /** A pending request, bought `agoMs` before the app's clock. */
  const pending = async (studio: Studio, name = 'Mia', agoMs = 0) => {
    const who = await buyer(studio, name)
    const [req] = await harness.db
      .insert(schema.corporateRequests)
      .values({
        tenantId: studio.id,
        clientId: who.clientId,
        corporatePackageId: studio.packageId,
        purchaseId: who.purchaseId,
        status: 'pending',
        createdAt: new Date(harness.clock.now().getTime() - agoMs),
      })
      .returning({ id: schema.corporateRequests.id })
    return { id: req!.id, ...who }
  }

  /** Schedule a request over HTTP to start `startsInMs` after the app's clock, an hour long. */
  const scheduleOver = async (studio: Studio, admin: Staff, teacher: Staff, id: string, startsInMs: number) => {
    const startsAt = new Date(harness.clock.now().getTime() + startsInMs)
    const endsAt = new Date(startsAt.getTime() + HOUR)
    await json(
      await send(`/portal/admin/corporate-requests/${id}/schedule`, admin.headers, 'POST', {
        main_instructor_id: teacher.id,
        location_id: studio.locationId,
        room_id: studio.roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      }),
      201,
    )
    return { startsAt, endsAt }
  }

  const refund = (purchaseId: string) =>
    harness.db
      .update(schema.purchases)
      .set({ status: 'refunded', amountPaidSgd: '0.00' })
      .where(eq(schema.purchases.id, purchaseId))

  const summary = async (who: Staff) => json(await send('/portal/attention/summary', who.headers), 200)
  const panel = async (who: Staff) => json(await send('/portal/attention', who.headers), 200)
  const items = async (who: Staff, kind: string) =>
    ((await panel(who)).needs_action.groups as Array<{ items: Array<Record<string, any>> }>)
      .flatMap(g => g.items)
      .filter(i => i.kind === kind)

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ;({ ensureAuthUser } = await import('../services/auth/auth-users'))
    harness.clock.set(START)
  })

  after(async () => {
    await harness?.close()
  })

  test('ATN-20 an admin sees a pending corporate request in Requests, worded and linked to its drawer, and it feeds the corporate_requests badge', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const req = await pending(studio, 'Mia', 3 * HOUR)

    const counts = await summary(admin)
    assert.equal(counts.by_group.corporate_requests, 1)
    assert.equal(counts.needs_action, 1)

    const group = (await panel(admin)).needs_action.groups.find((g: any) => g.key === 'requests')
    assert.equal(group.see_all_href, '/admin/corporate-requests')
    const [item] = group.items
    assert.equal(item.id, `corporate_request_pending:${req.id}`)
    assert.equal(item.title, 'Mia bought Team Offsite: schedule the session')
    assert.equal(item.detail, 'Bought 3 h ago')
    assert.equal(item.href, `/admin/corporate-requests?request=${req.id}`)
    assert.equal(item.dismissable, false)
  })

  test('ATN-21 a pending request clears when it is scheduled and when it is cancelled', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const a = await pending(studio, 'Ann')
    const b = await pending(studio, 'Bea')
    assert.equal((await summary(admin)).by_group.corporate_requests, 2)

    await scheduleOver(studio, admin, tara, a.id, 2 * DAY)
    assert.deepEqual((await items(admin, 'corporate_request_pending')).map(i => i.id), [`corporate_request_pending:${b.id}`])

    await json(await send(`/portal/admin/corporate-requests/${b.id}/cancel`, admin.headers, 'POST'), 200)
    assert.deepEqual(await items(admin, 'corporate_request_pending'), [])
    assert.equal((await summary(admin)).by_group.corporate_requests ?? 0, 0)
  })

  test('ATN-22 the corporate kinds reach Admins only: an Instructor sees none and has no corporate badge', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    await pending(studio)

    const counts = await summary(tara)
    assert.equal(counts.needs_action, 0)
    assert.equal(counts.by_group.corporate_requests ?? 0, 0)
    assert.deepEqual(await items(tara, 'corporate_request_pending'), [])
  })

  test('ATN-23 a scheduled request whose session has ended is "not marked attended" from the moment it ends, and clears when marked attended', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const req = await pending(studio, 'Mia')
    const slot = await scheduleOver(studio, admin, tara, req.id, 2 * DAY)
    const see = () => items(admin, 'corporate_session_unmarked')

    harness.clock.set(new Date(slot.endsAt.getTime() - 1))
    assert.deepEqual(await see(), [], 'a millisecond before it ends')
    assert.equal((await summary(admin)).by_group.corporate_requests ?? 0, 0)

    harness.clock.set(slot.endsAt)
    const [item] = await see()
    assert.equal(item!.id, `corporate_session_unmarked:${req.id}`)
    assert.equal(item!.title, 'Mark Team Offsite for Mia as attended')
    assert.match(item!.detail, /^The session was on \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} [ap]m$/)
    assert.equal(item!.href, `/admin/corporate-requests?request=${req.id}`)
    assert.equal((await summary(admin)).by_group.corporate_requests, 1)

    await json(await send(`/portal/admin/corporate-requests/${req.id}/attended`, admin.headers, 'POST'), 200)
    assert.deepEqual(await see(), [])
    assert.equal((await summary(admin)).needs_action, 0)
    harness.clock.set(START)
  })

  test('ATN-24 an ended session clears when its request is cancelled', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const req = await pending(studio)
    const slot = await scheduleOver(studio, admin, tara, req.id, 2 * DAY)
    harness.clock.set(new Date(slot.endsAt.getTime() + HOUR))
    assert.equal((await items(admin, 'corporate_session_unmarked')).length, 1)

    await json(await send(`/portal/admin/corporate-requests/${req.id}/cancel`, admin.headers, 'POST'), 200)
    assert.deepEqual(await items(admin, 'corporate_session_unmarked'), [])
    harness.clock.set(START)
  })

  test('ATN-25 a refunded purchase with its session still booked shows the refund item, naming the session date, and clears when the request is cancelled', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const req = await pending(studio, 'Mia')
    await scheduleOver(studio, admin, tara, req.id, 2 * DAY)
    assert.deepEqual(await items(admin, 'corporate_refunded_still_scheduled'), [], 'not refunded yet')

    await refund(req.purchaseId)
    const [item] = await items(admin, 'corporate_refunded_still_scheduled')
    assert.equal(item!.id, `corporate_refunded_still_scheduled:${req.id}`)
    assert.match(item!.title, /^Mia’s Team Offsite was refunded, but its session on \w{3} \d{1,2} \w{3} is still booked$/)
    assert.equal(item!.detail, 'Cancel the session')
    assert.equal(item!.href, `/admin/corporate-requests?request=${req.id}`)
    assert.equal((await summary(admin)).by_group.corporate_requests, 1)

    await json(await send(`/portal/admin/corporate-requests/${req.id}/cancel`, admin.headers, 'POST'), 200)
    assert.deepEqual(await items(admin, 'corporate_refunded_still_scheduled'), [])
    assert.equal((await summary(admin)).needs_action, 0)
  })

  test('ATN-26 the refund item clears when only the session is cancelled, and a refunded request whose session ended counts once, as refunded', async () => {
    const studio = await freshStudio()
    const admin = await adminAt(studio)
    const tara = await instructorAt(studio, admin, 'tara')
    const req = await pending(studio)
    const slot = await scheduleOver(studio, admin, tara, req.id, 2 * DAY)
    await refund(req.purchaseId)
    harness.clock.set(new Date(slot.endsAt.getTime() + HOUR))
    assert.equal((await items(admin, 'corporate_refunded_still_scheduled')).length, 1)
    assert.deepEqual(await items(admin, 'corporate_session_unmarked'), [])
    assert.equal((await summary(admin)).by_group.corporate_requests, 1)

    await harness.db
      .update(schema.corporateSessions)
      .set({ lifecycle: 'cancelled', cancelledAt: new Date() })
      .where(eq(schema.corporateSessions.corporateRequestId, req.id))
    assert.deepEqual(await items(admin, 'corporate_refunded_still_scheduled'), [])
    harness.clock.set(START)
  })

  test('ATN-27 another studio’s Admin sees none of it', async () => {
    const studio = await freshStudio()
    const other = await freshStudio()
    await adminAt(studio)
    const otherAdmin = await adminAt(other)
    await pending(studio)

    const counts = await summary(otherAdmin)
    assert.equal(counts.needs_action, 0)
    assert.equal(counts.by_group.corporate_requests ?? 0, 0)
  })
})
