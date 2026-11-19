import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `${run}.member-schedule-entity.test`
const OPERATOR = `operator@${DOMAIN}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The member class schedule by Entity (#562, spec #554), over HTTP: each class
 * is returned with its Entity, read through its Class Type; an `entity` slug
 * narrows the list; an unknown, archived or another studio's slug lists
 * nothing; a one-Entity studio reads as before; workshops are not touched by
 * an Entity; and a public read names the studio's Entities in its order for
 * the member app's buttons.
 *
 * Every studio here is made through the super portal (so it starts with "All
 * classes") and is this file's own, so a second Entity never moves what other
 * files read from the fixture studios.
 */
describe('member schedule by Entity over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let operator!: Record<string, string>

  type Headers = Record<string, string>
  type Studio = {
    id: string
    slug: string
    admin: Headers
    member: Headers
    staffId: string
    locationId: string
    roomId: string
  }

  const send = async (method: string, path: string, headers: Headers, body?: unknown) => {
    const res = await harness.app.request(path, {
      method,
      headers: { ...headers, 'X-Forwarded-For': harnessAddress(), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, text }
  }

  /** What the member app on `at`'s hostname sends when nobody is signed in. */
  const visitor = (at: { slug: string }): Headers => ({
    'X-Tenant-Slug': at.slug,
    Origin: frontendOrigin('client', at),
  })

  const admin = (at: Studio, method: string, path: string, body?: unknown) =>
    send(method, `/api/v1/portal/admin${path}`, at.admin, body)

  async function ok(res: Promise<{ status: number; body: any; text: string }>) {
    const r = await res
    assert.equal(r.status, 200, r.text)
    return r.body
  }

  const created: Array<{ id: string; slug: string }> = []

  async function staffAt(at: { id: string; slug: string }, name: string, role: 'admin' | 'instructor') {
    const email = `${name}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, at)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, at.id)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    return { headers, id: row!.id }
  }

  async function newStudio(label: string): Promise<Studio> {
    const slug = `${label}-${run}`
    const res = await send('POST', '/api/v1/platform/tenants', operator, {
      slug,
      name: `Schedule entity ${label}`,
      timezone: 'Asia/Singapore',
      admin_email: `owner@${slug}.${DOMAIN}`,
      term_months: 3,
    })
    assert.equal(res.status, 201, res.text)
    const tenant = { id: res.body.tenant.id as string, slug }
    created.push(tenant)
    await harness.db.execute(sql`UPDATE tenants SET status = 'active' WHERE id = ${tenant.id}`)
    const { forgetCachedTenants } = await import('../services/tenants/tenants')
    forgetCachedTenants()
    const owner = await staffAt(tenant, 'admin', 'admin')
    const teacher = await staffAt(tenant, 'teacher', 'instructor')
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: 'Studio floor' })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: 'Room A', capacity: 20 })
      .returning({ id: schema.rooms.id })

    const email = `member-${slug}@${DOMAIN}`
    const memberHeaders = await harness.signInAs('client', email, tenant)
    const [authUser] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, tenant.id)))
    await harness.db
      .insert(schema.clients)
      .values({ tenantId: tenant.id, authUserId: authUser!.id, name: 'Member', email, phone: '+6591200000' })

    return { ...tenant, admin: owner.headers, member: memberHeaders, staffId: teacher.id, locationId: location!.id, roomId: room!.id }
  }

  async function entityIds(at: Studio): Promise<Record<string, string>> {
    const list = await admin(at, 'GET', '/entities?include_archived=true')
    return Object.fromEntries(list.body.entities.map((e: any) => [e.name, e.id]))
  }

  async function newEntity(at: Studio, name: string): Promise<string> {
    const res = await admin(at, 'POST', '/entities', { name })
    assert.equal(res.status, 201, res.text)
    return res.body.id
  }

  async function newType(at: Studio, body: Record<string, unknown>): Promise<any> {
    const res = await admin(at, 'POST', '/class-types', body)
    assert.equal(res.status, 201, res.text)
    return res.body
  }

  async function addClass(at: Studio, classTypeId: string, startsInMs: number) {
    const startsAt = new Date(Date.now() + startsInMs)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId,
        mainInstructorId: at.staffId,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: at.staffId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /** A studio with Yoga (its default "All classes", renamed) and Pilates, a class under each, and a sub-type class under Pilates. */
  type TwoEntities = { studio: Studio; yoga: string; pilates: string; yogaClass: string; pilatesClass: string; subTypeClass: string }
  async function twoEntityStudio(label: string): Promise<TwoEntities> {
    const studio = await newStudio(label)
    const yoga = (await entityIds(studio))['All classes']!
    const renamed = await admin(studio, 'PATCH', `/entities/${yoga}`, { name: 'Yoga', slug: 'yoga' })
    assert.equal(renamed.status, 200, renamed.text)
    const pilates = await newEntity(studio, 'Pilates')
    const hatha = await newType(studio, { name: 'Hatha', entity_id: yoga })
    const reformer = await newType(studio, { name: 'Reformer', entity_id: pilates })
    const sub = await newType(studio, { name: 'Reformer jump', parent_id: reformer.id })
    return {
      studio,
      yoga,
      pilates,
      yogaClass: await addClass(studio, hatha.id, 2 * DAY),
      pilatesClass: await addClass(studio, reformer.id, 2 * DAY + HOUR),
      subTypeClass: await addClass(studio, sub.id, 3 * DAY),
    }
  }

  const window = () => `from=${new Date(Date.now() + DAY).toISOString()}&to=${new Date(Date.now() + 10 * DAY).toISOString()}`
  const publicList = async (at: Studio, filter = '') =>
    (await ok(send('GET', `/api/v1/public/classes?${window()}${filter}`, visitor(at)))).classes as any[]
  const memberList = async (at: Studio, filter = '') =>
    (await ok(send('GET', `/api/v1/me/classes?${window()}${filter}`, at.member))).classes as any[]
  const ids = (cards: any[]) => cards.map(c => c.id).sort()

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    if (!harness) return
    try {
      const { setTenantStatus } = await import('../services/tenants/tenants')
      const { deleteTenant } = await import('../services/tenants/delete')
      for (const studio of created) {
        await harness.db.execute(sql`DELETE FROM tenant_imports WHERE tenant_id = ${studio.id}`)
        await setTenantStatus(studio.id, 'suspended')
        await deleteTenant({ tenantId: studio.id, confirmSlug: studio.slug })
      }
      const ours = `%@${DOMAIN}`
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM platform_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test('CAT-21 the public and the member class list, and the class opened, each carry the class\'s Entity read through its Class Type; a sub-type\'s class carries its parent\'s', async () => {
    const s = await twoEntityStudio('cat21')
    const yoga = { id: s.yoga, name: 'Yoga', slug: 'yoga' }
    const pilates = { id: s.pilates, name: 'Pilates', slug: 'pilates' }
    for (const [where, cards] of [['public', await publicList(s.studio)], ['member', await memberList(s.studio)]] as const) {
      const byId = new Map(cards.map(c => [c.id, c]))
      assert.deepEqual(byId.get(s.yogaClass)!.entity, yoga, `${where}: a Yoga class`)
      assert.deepEqual(byId.get(s.pilatesClass)!.entity, pilates, `${where}: a Pilates class`)
      assert.deepEqual(byId.get(s.subTypeClass)!.entity, pilates, `${where}: a sub-type's class follows its parent`)
    }
    const publicOpen = await ok(send('GET', `/api/v1/public/classes/${s.pilatesClass}`, visitor(s.studio)))
    const memberOpen = await ok(send('GET', `/api/v1/me/classes/${s.pilatesClass}`, s.studio.member))
    assert.deepEqual(publicOpen.entity, pilates)
    assert.deepEqual(memberOpen.entity, pilates)
  })

  test('CAT-22 an Entity slug narrows the public and the member class list to that Entity\'s classes, in either casing, and with the other filters', async () => {
    const s = await twoEntityStudio('cat22')
    assert.deepEqual(ids(await publicList(s.studio)), ids([{ id: s.yogaClass }, { id: s.pilatesClass }, { id: s.subTypeClass }]), 'no Entity named: every class')
    for (const list of [publicList, memberList]) {
      assert.deepEqual(ids(await list(s.studio, '&entity=yoga')), [s.yogaClass])
      assert.deepEqual(ids(await list(s.studio, '&entity=pilates')), ids([{ id: s.pilatesClass }, { id: s.subTypeClass }]))
      assert.deepEqual(ids(await list(s.studio, '&entity=PILATES')), ids([{ id: s.pilatesClass }, { id: s.subTypeClass }]), 'a slug is matched in any casing')
      assert.deepEqual(ids(await list(s.studio, `&entity=pilates&class_type_id=${(await list(s.studio, '&entity=pilates')).find(c => c.id === s.pilatesClass)!.class_type.id}`)), [s.pilatesClass], 'with another filter')
    }
  })

  test('CAT-23 an unknown slug, an archived Entity\'s slug and another studio\'s slug list nothing, and a malformed slug is refused', async () => {
    const s = await twoEntityStudio('cat23')
    const other = await twoEntityStudio('cat23b')
    await newEntity(other.studio, 'Spin')
    for (const slug of ['nobody', 'spin']) {
      assert.deepEqual(await publicList(s.studio, `&entity=${slug}`), [], `public: ${slug}`)
      assert.deepEqual(await memberList(s.studio, `&entity=${slug}`), [], `member: ${slug}`)
    }
    // Archived behind the API's back (the admin refuses while a Class Type is in it): its classes
    // stay on the unfiltered list, but its slug selects nothing.
    await harness.db.execute(sql`UPDATE entities SET archived_at = now() WHERE id = ${s.pilates}`)
    assert.deepEqual(await publicList(s.studio, '&entity=pilates'), [])
    assert.deepEqual(await memberList(s.studio, '&entity=pilates'), [])
    assert.deepEqual(ids(await publicList(s.studio, '&entity=yoga')), [s.yogaClass])
    assert.ok(ids(await publicList(s.studio)).includes(s.pilatesClass))
    const tooLong = await send('GET', `/api/v1/public/classes?entity=${'a'.repeat(200)}`, visitor(s.studio))
    assert.equal(tooLong.status, 400, tooLong.text)
  })

  test('CAT-24 a studio with one Entity reads as before: no filter lists every class, each with its Entity', async () => {
    const studio = await newStudio('cat24')
    const only = (await entityIds(studio))['All classes']!
    const type = await newType(studio, { name: 'Vinyasa' })
    const one = await addClass(studio, type.id, 2 * DAY)
    for (const cards of [await publicList(studio), await memberList(studio)]) {
      assert.deepEqual(ids(cards), [one])
      assert.deepEqual(cards[0].entity, { id: only, name: 'All classes', slug: 'all-classes' })
    }
    assert.deepEqual(ids(await publicList(studio, '&entity=all-classes')), [one])
  })

  test('CAT-25 the member workshops read is the same whichever Entity the schedule is on: a workshop belongs to no Entity', async () => {
    const s = await twoEntityStudio('cat25')
    const [workshop] = await harness.db
      .insert(schema.workshops)
      .values({ tenantId: s.studio.id, name: `Entity workshop ${run}`, locationId: s.studio.locationId, createdByStaffId: s.studio.staffId })
      .returning({ id: schema.workshops.id })
    const startsAt = new Date(Date.now() + 10 * DAY)
    const [day] = await harness.db
      .insert(schema.workshopDays)
      .values({ tenantId: s.studio.id, workshopId: workshop!.id, ord: 1, roomId: s.studio.roomId, startsAt, endsAt: new Date(startsAt.getTime() + HOUR), basePriceSgd: '80.00', capacityOnline: 10 })
      .returning({ id: schema.workshopDays.id })
    const [tier] = await harness.db
      .insert(schema.workshopTiers)
      .values({ tenantId: s.studio.id, workshopId: workshop!.id, name: 'Full', regularPriceSgd: '80.00', ord: 1 })
      .returning({ id: schema.workshopTiers.id })
    await harness.db.insert(schema.workshopTierDays).values({ tenantId: s.studio.id, workshopTierId: tier!.id, workshopDayId: day!.id })

    const plain = await ok(send('GET', '/api/v1/me/workshops', s.studio.member))
    assert.ok((plain.workshops as any[]).some(w => w.id === workshop!.id), 'the workshop is listed')
    for (const slug of ['yoga', 'pilates']) {
      const chosen = await ok(send('GET', `/api/v1/me/workshops?entity=${slug}`, s.studio.member))
      assert.deepEqual(chosen, plain, `on ${slug}`)
    }
    // And the class schedule never lists it, under any Entity.
    for (const slug of ['', '&entity=yoga', '&entity=pilates']) {
      assert.ok(!(await memberList(s.studio, slug)).some(c => c.id === workshop!.id))
    }
  })

  test('CAT-26 the public Entities read lists the studio\'s own live Entities in its order, nothing of another studio\'s, and archived ones are left out', async () => {
    const s = await twoEntityStudio('cat26')
    const other = await twoEntityStudio('cat26b')
    const barre = await newEntity(s.studio, 'Barre')
    const read = async (at: Studio) => (await ok(send('GET', '/api/v1/public/entities', visitor(at)))).entities as any[]
    assert.deepEqual(
      (await read(s.studio)).map(e => [e.name, e.slug]),
      [['Yoga', 'yoga'], ['Pilates', 'pilates'], ['Barre', 'barre']],
    )
    // Moved to the front: the studio's order is what members see.
    const reorder = await admin(s.studio, 'PUT', '/entities/order', { ids: [barre, s.yoga, s.pilates] })
    assert.equal(reorder.status, 200, reorder.text)
    assert.deepEqual((await read(s.studio)).map(e => e.slug), ['barre', 'yoga', 'pilates'])
    const archived = await admin(s.studio, 'POST', `/entities/${barre}/archive`)
    assert.equal(archived.status, 200, archived.text)
    const live = await read(s.studio)
    assert.deepEqual(live.map(e => e.slug), ['yoga', 'pilates'])
    assert.deepEqual(Object.keys(live[0]).sort(), ['id', 'name', 'slug'])
    assert.ok(!live.some(e => [other.yoga, other.pilates].includes(e.id)))
  })
})
