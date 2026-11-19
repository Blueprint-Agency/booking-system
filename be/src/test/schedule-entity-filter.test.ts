import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `${run}.schedule-entity-filter.test`
const OPERATOR = `operator@${DOMAIN}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * The staff schedule filters by Entity (#563, spec #554), over HTTP: every class
 * entry carries its Class Type's Entity and the admin schedule, the instructor's
 * My schedule and the instructor's Full studio schedule all accept an `entity`
 * filter that narrows classes only. Workshops, private sessions and corporate
 * sessions stay under every filter.
 *
 * `entity` carries an Entity ID on these staff routes. The member routes
 * (#561, #562) take a slug; the two conventions are different on purpose.
 *
 * Each studio is made the way the super portal makes one (so it starts with
 * "All classes"), so a second Entity here never moves what the fixture studios'
 * other files read.
 */
describe('the staff schedule filters by Entity over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let operator!: Record<string, string>

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Teacher = { id: string; headers: Headers }
  type Studio = {
    id: string
    slug: string
    admin: Headers
    adminId: string
    teacher: Teacher
    otherTeacher: Teacher
    locationId: string
    roomId: string
  }

  async function reply(res: Response): Promise<Reply> {
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  const send = async (method: string, path: string, headers: Headers, body?: unknown) =>
    reply(
      await harness.app.request(path, {
        method,
        headers: { ...headers, 'X-Forwarded-For': harnessAddress(), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  const get = (path: string, headers: Headers) => send('GET', `/api/v1${path}`, headers)

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
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: at.id, staffUserId: row!.id })
    }
    return { headers, id: row!.id }
  }

  const created: Array<{ id: string; slug: string }> = []

  async function newStudio(label: string): Promise<Studio> {
    const slug = `${label}-${run}`
    const res = await send('POST', '/api/v1/platform/tenants', operator, {
      slug,
      name: `Schedule entity ${label}`,
      timezone: 'Asia/Singapore',
      admin_email: `owner@${slug}.${DOMAIN}`,
      term_months: 3,
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    const tenant = { id: res.body.tenant.id as string, slug }
    created.push(tenant)
    await harness.db.execute(sql`UPDATE tenants SET status = 'active' WHERE id = ${tenant.id}`)
    const { forgetCachedTenants } = await import('../services/tenants/tenants')
    forgetCachedTenants()
    const admin = await staffAt(tenant, 'admin', 'admin')
    const teacher = await staffAt(tenant, 'teacher', 'instructor')
    const otherTeacher = await staffAt(tenant, 'other-teacher', 'instructor')
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: 'Studio floor' })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: 'Room A', capacity: 20 })
      .returning({ id: schema.rooms.id })
    return {
      ...tenant,
      admin: admin.headers,
      adminId: admin.id,
      teacher: { id: teacher.id, headers: teacher.headers },
      otherTeacher: { id: otherTeacher.id, headers: otherTeacher.headers },
      locationId: location!.id,
      roomId: room!.id,
    }
  }

  async function entityIds(at: Studio): Promise<Record<string, string>> {
    const list = await send('GET', '/api/v1/portal/admin/entities?include_archived=true', at.admin)
    return Object.fromEntries(list.body.entities.map((e: any) => [e.name, e.id]))
  }

  async function newEntity(at: Studio, name: string): Promise<string> {
    const res = await send('POST', '/api/v1/portal/admin/entities', at.admin, { name })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.id
  }

  async function newType(at: Studio, name: string, entityId: string): Promise<string> {
    const res = await send('POST', '/api/v1/portal/admin/class-types', at.admin, { name, entity_id: entityId })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.id
  }

  async function addClass(at: Studio, classTypeId: string, teacher: Teacher, startsInMs: number): Promise<string> {
    const startsAt = new Date(Date.now() + startsInMs)
    const [row] = await harness.db
      .insert(schema.classes)
      .values({
        tenantId: at.id,
        classTypeId,
        mainInstructorId: teacher.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        capacityOnline: 10,
        creditCost: 1,
        createdByStaffId: at.adminId,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  /** A workshop with one day, built through the admin editor's own routes. */
  async function addWorkshop(at: Studio, teacher: Teacher, startsInMs: number): Promise<string> {
    const made = await send('POST', '/api/v1/portal/admin/workshops', at.admin, {
      name: `Entity filter workshop ${run}`,
      location_id: at.locationId,
      main_instructor_id: teacher.id,
      main_instructor_pay_sgd: 100,
    })
    assert.equal(made.status, 201, JSON.stringify(made.body))
    const startsAt = new Date(Date.now() + startsInMs)
    const day = await send('POST', `/api/v1/portal/admin/workshops/${made.body.id}/days`, at.admin, {
      ord: 1,
      room_id: at.roomId,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 2 * HOUR).toISOString(),
      capacity_online: 8,
    })
    assert.equal(day.status, 201, JSON.stringify(day.body))
    return day.body.id
  }

  async function addPtSession(at: Studio, teacher: Teacher, startsInMs: number): Promise<string> {
    const startsAt = new Date(Date.now() + startsInMs)
    const [row] = await harness.db
      .insert(schema.ptSessions)
      .values({
        tenantId: at.id,
        instructorId: teacher.id,
        locationId: at.locationId,
        roomId: at.roomId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        sessionType: '1on1',
        capacityOnline: 1,
        scheduledAt: new Date(),
        scheduledByStaffId: at.adminId,
      })
      .returning({ id: schema.ptSessions.id })
    return row!.id
  }

  async function addCorporateSession(at: Studio, teacher: Teacher, startsInMs: number): Promise<string> {
    const [pack] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: at.id, name: `Entity filter corporate ${run}`, priceSgd: '1000.00', createdByStaffId: at.adminId })
      .returning({ id: schema.corporatePackages.id })
    const startsAt = new Date(Date.now() + startsInMs)
    const [row] = await harness.db
      .insert(schema.corporateSessions)
      .values({
        tenantId: at.id,
        corporatePackageId: pack!.id,
        clientName: `Entity filter company ${run}`,
        mainInstructorId: teacher.id,
        locationText: 'Off-site',
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
        createdByStaffId: at.adminId,
      })
      .returning({ id: schema.corporateSessions.id })
    return row!.id
  }

  const WINDOW = () => `from=${new Date(Date.now()).toISOString()}&to=${new Date(Date.now() + 20 * DAY).toISOString()}`
  const ids = (res: Reply, kind?: string) =>
    (res.body.entries as any[]).filter(e => !kind || e.kind === kind).map(e => e.id as string).sort()

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
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM platform_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  /** A studio with Yoga ("All classes") and Pilates, a class of each, and one of each other kind of entry. */
  async function twoEntityStudio(label: string) {
    const at = await newStudio(label)
    const base = await entityIds(at)
    const yoga = base['All classes']!
    const pilates = await newEntity(at, 'Pilates')
    const yogaType = await newType(at, 'Hatha', yoga)
    const pilatesType = await newType(at, 'Reformer', pilates)
    const yogaClass = await addClass(at, yogaType, at.teacher, 2 * DAY)
    const pilatesClass = await addClass(at, pilatesType, at.teacher, 3 * DAY)
    const otherPilatesClass = await addClass(at, pilatesType, at.otherTeacher, 4 * DAY)
    const workshop = await addWorkshop(at, at.teacher, 5 * DAY)
    const pt = await addPtSession(at, at.teacher, 6 * DAY)
    const corporate = await addCorporateSession(at, at.teacher, 7 * DAY)
    return { at, yoga, pilates, yogaType, pilatesType, yogaClass, pilatesClass, otherPilatesClass, workshop, pt, corporate }
  }

  test('SCH-78 an admin’s schedule carries each class’s Entity and narrows classes to the Entity asked for, leaving workshops, private sessions and corporate sessions under every filter', async () => {
    const f = await twoEntityStudio('sch78')
    const path = (q: string) => `/portal/admin/schedule?${WINDOW()}${q}`

    const all = await get(path(''), f.at.admin)
    assert.equal(all.status, 200, JSON.stringify(all.body))
    const entityOf = (id: string) => all.body.entries.find((e: any) => e.id === id).entity_id
    assert.equal(entityOf(f.yogaClass), f.yoga)
    assert.equal(entityOf(f.pilatesClass), f.pilates)
    // Only a class has an Entity of its own on the schedule.
    for (const id of [f.workshop, f.pt, f.corporate]) assert.equal(entityOf(id), null)

    // The admin's class detail names the class's Entity too.
    const detail = await get(`/portal/admin/schedule/classes/${f.pilatesClass}`, f.at.admin)
    assert.equal(detail.status, 200, JSON.stringify(detail.body))
    assert.equal(detail.body.entity_id, f.pilates)

    const kinds = ['workshop', 'pt', 'corporate'] as const
    const others = { workshop: [f.workshop], pt: [f.pt], corporate: [f.corporate] }

    const yoga = await get(path(`&entity=${f.yoga}`), f.at.admin)
    assert.equal(yoga.status, 200, JSON.stringify(yoga.body))
    assert.deepEqual(ids(yoga, 'class'), [f.yogaClass])
    for (const kind of kinds) assert.deepEqual(ids(yoga, kind), others[kind], `${kind} stays under Yoga`)

    const pilates = await get(path(`&entity=${f.pilates}`), f.at.admin)
    assert.deepEqual(ids(pilates, 'class'), [f.pilatesClass, f.otherPilatesClass].sort())
    for (const kind of kinds) assert.deepEqual(ids(pilates, kind), others[kind], `${kind} stays under Pilates`)

    // Asked for classes alone, the filter still holds; asked for workshops alone, they all come.
    assert.deepEqual(ids(await get(path(`&type=class&entity=${f.yoga}`), f.at.admin)), [f.yogaClass])
    assert.deepEqual(ids(await get(path(`&type=workshop&entity=${f.yoga}`), f.at.admin)), [f.workshop])

    // Both filters apply to classes; a Class Type filter still hides workshops, as it always did.
    const both = await get(path(`&entity=${f.pilates}&class_type_id=${f.pilatesType}`), f.at.admin)
    assert.deepEqual(ids(both, 'class'), [f.pilatesClass, f.otherPilatesClass].sort())
    assert.deepEqual(ids(both, 'workshop'), [])
    const crossed = await get(path(`&entity=${f.yoga}&class_type_id=${f.pilatesType}`), f.at.admin)
    assert.deepEqual(ids(crossed, 'class'), [])
  })

  test('SCH-79 an Entity filter that names no Entity of the studio, another studio’s included, leaves no classes and every workshop; one that is not an id is refused', async () => {
    const f = await twoEntityStudio('sch79')
    const foreign = await newStudio('sch79b')
    const foreignEntity = (await entityIds(foreign))['All classes']!
    const path = (q: string) => `/portal/admin/schedule?${WINDOW()}${q}`

    for (const entity of [foreignEntity, '00000000-0000-4000-8000-000000000000']) {
      const res = await get(path(`&entity=${entity}`), f.at.admin)
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.deepEqual(ids(res, 'class'), [], 'no class answers to an Entity that is not this studio’s')
      assert.deepEqual(ids(res, 'workshop'), [f.workshop])
    }

    const bad = await get(path('&entity=pilates'), f.at.admin)
    assert.equal(bad.status, 400, JSON.stringify(bad.body))
  })

  test('SCH-80 an archived Entity’s past classes stay readable by its id', async () => {
    const f = await twoEntityStudio('sch80')
    const past = await addClass(f.at, f.pilatesType, f.at.teacher, -3 * DAY)
    // An Entity archives once nothing live is in it.
    await harness.db.execute(sql`UPDATE class_types SET archived_at = now() WHERE id = ${f.pilatesType}`)
    const archived = await send('POST', `/api/v1/portal/admin/entities/${f.pilates}/archive`, f.at.admin)
    assert.equal(archived.status, 200, JSON.stringify(archived.body))

    const res = await get(
      `/portal/admin/schedule?from=${new Date(Date.now() - 5 * DAY).toISOString()}&to=${new Date(Date.now() + 20 * DAY).toISOString()}&entity=${f.pilates}`,
      f.at.admin,
    )
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(ids(res, 'class'), [past, f.pilatesClass, f.otherPilatesClass].sort())
    assert.ok(res.body.entries.every((e: any) => e.kind !== 'class' || e.entity_id === f.pilates))
  })

  test('SCH-81 an instructor’s My schedule and Full studio schedule carry the Entity and take the filter; My schedule stays the caller’s own and the studio’s carries no series id', async () => {
    const f = await twoEntityStudio('sch81')
    const mine = `/portal/instructor/schedule?${WINDOW()}`
    const studio = `/portal/instructor/schedule/studio?${WINDOW()}`

    const myAll = await get(mine, f.at.teacher.headers)
    assert.equal(myAll.status, 200, JSON.stringify(myAll.body))
    assert.equal(myAll.body.entries.find((e: any) => e.id === f.pilatesClass).entity_id, f.pilates)

    // The caller's own classes only, narrowed to the Entity; the other teacher's Pilates class is not theirs.
    const myPilates = await get(`${mine}&entity=${f.pilates}`, f.at.teacher.headers)
    assert.deepEqual(ids(myPilates, 'class'), [f.pilatesClass])
    assert.deepEqual(ids(myPilates, 'workshop'), [f.workshop])
    const myYoga = await get(`${mine}&entity=${f.yoga}`, f.at.teacher.headers)
    assert.deepEqual(ids(myYoga, 'class'), [f.yogaClass])
    const othersOwn = await get(`${mine}&entity=${f.pilates}`, f.at.otherTeacher.headers)
    assert.deepEqual(ids(othersOwn, 'class'), [f.otherPilatesClass])

    // The studio's whole schedule, narrowed to the Entity.
    const studioPilates = await get(`${studio}&entity=${f.pilates}`, f.at.teacher.headers)
    assert.equal(studioPilates.status, 200, JSON.stringify(studioPilates.body))
    assert.deepEqual(ids(studioPilates, 'class'), [f.pilatesClass, f.otherPilatesClass].sort())
    assert.deepEqual(ids(studioPilates, 'workshop'), [f.workshop])
    assert.deepEqual(ids(await get(`${studio}&entity=${f.yoga}`, f.at.teacher.headers), 'class'), [f.yogaClass])
    for (const entry of studioPilates.body.entries) {
      assert.equal('series_id' in entry, false, 'the studio read carries no Class Series id')
    }
    assert.equal(studioPilates.body.entries.find((e: any) => e.id === f.pilatesClass).entity_id, f.pilates)
  })

  test('SCH-82 an instructor reads the studio’s live Entities in order from the instructor catalog, and no other studio’s; a caller signed in to nothing is refused', async () => {
    const f = await twoEntityStudio('sch82')
    const other = await twoEntityStudio('sch82b')
    const third = await newEntity(f.at, 'Barre')
    await send('POST', `/api/v1/portal/admin/entities/${third}/archive`, f.at.admin)

    const res = await get('/portal/instructor/catalog/entities', f.at.teacher.headers)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(
      res.body.entities.map((e: any) => [e.id, e.name, e.slug, e.position]),
      [
        [f.yoga, 'All classes', 'all-classes', 0],
        [f.pilates, 'Pilates', 'pilates', 1],
      ],
    )
    assert.ok(!res.body.entities.some((e: any) => e.id === other.yoga || e.id === other.pilates))
    // Names and ids only: how much each holds is the admin's to read.
    assert.deepEqual(Object.keys(res.body.entities[0]).sort(), ['id', 'name', 'position', 'slug'])

    const anonymous = await harness.app.request('/api/v1/portal/instructor/catalog/entities', {
      headers: { Origin: frontendOrigin('staff', f.at), 'X-Tenant-Slug': f.at.slug, 'X-Forwarded-For': harnessAddress() },
    })
    assert.equal(anonymous.status, 401)
  })

  test('SCH-83 a one-Entity studio’s schedule reads as before: the Entity rides each class, and filtering by that Entity changes nothing', async () => {
    const at = await newStudio('sch83')
    const only = (await entityIds(at))['All classes']!
    const type = await newType(at, 'Hatha', only)
    const a = await addClass(at, type, at.teacher, 2 * DAY)
    const b = await addClass(at, type, at.otherTeacher, 3 * DAY)
    const workshop = await addWorkshop(at, at.teacher, 4 * DAY)

    const plain = await get(`/portal/admin/schedule?${WINDOW()}`, at.admin)
    assert.deepEqual(ids(plain), [a, b, workshop].sort())
    const filtered = await get(`/portal/admin/schedule?${WINDOW()}&entity=${only}`, at.admin)
    assert.deepEqual(ids(filtered), ids(plain))
    assert.ok(plain.body.entries.filter((e: any) => e.kind === 'class').every((e: any) => e.entity_id === only))
  })
})
