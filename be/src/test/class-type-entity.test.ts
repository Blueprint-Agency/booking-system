import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `${run}.class-type-entity.test`
const OPERATOR = `operator@${DOMAIN}`
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/**
 * Every Class Type belongs to an Entity (#557, spec #554), over HTTP: an admin
 * sets the Entity on a top-level type; a sub-type shares its parent's and shows
 * it read-only; moving a parent moves its sub-types with it; the admin is told
 * how many upcoming classes and bookings a move reaches before saving; and a
 * move cancels nothing.
 *
 * The in-process app against real Postgres with real sign-ins. Every test runs
 * in a studio of its own, made the way the super portal makes one (so it starts
 * with "All classes"), so adding a second Entity here never moves what the
 * fixture studios' other files read.
 */
describe('class types and Entities over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let operator!: Record<string, string>

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Studio = { id: string; slug: string; admin: Headers; instructor: Headers; staffId: string; locationId: string; roomId: string }

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

  const types = (at: Studio, method: string, path: string, body?: unknown) =>
    send(method, `/api/v1/portal/admin/class-types${path}`, at.admin, body)
  const entities = (at: Studio, method: string, path: string, body?: unknown) =>
    send(method, `/api/v1/portal/admin/entities${path}`, at.admin, body)

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

  /** Studios this file created through the super portal, deleted at the end. */
  const created: Array<{ id: string; slug: string }> = []

  /** A studio of this file's own: created by the operator with a first admin, opened, with a Location, a Room and an instructor. */
  async function newStudio(label: string): Promise<Studio> {
    const slug = `${label}-${run}`
    const res = await send('POST', '/api/v1/platform/tenants', operator, {
      slug,
      name: `Class type entity ${label}`,
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
    const [location] = await harness.db
      .insert(schema.locations)
      .values({ tenantId: tenant.id, name: 'Studio floor' })
      .returning({ id: schema.locations.id })
    const [room] = await harness.db
      .insert(schema.rooms)
      .values({ tenantId: tenant.id, locationId: location!.id, name: 'Room A', capacity: 20 })
      .returning({ id: schema.rooms.id })
    return { ...tenant, admin: admin.headers, instructor: teacher.headers, staffId: teacher.id, locationId: location!.id, roomId: room!.id }
  }

  /** Entities by name, so a test reads "Pilates" and not an id. */
  async function entityIds(at: Studio): Promise<Record<string, string>> {
    const list = await entities(at, 'GET', '?include_archived=true')
    return Object.fromEntries(list.body.entities.map((e: any) => [e.name, e.id]))
  }

  async function newEntity(at: Studio, name: string): Promise<string> {
    const res = await entities(at, 'POST', '', { name })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body.id
  }

  async function newType(at: Studio, body: Record<string, unknown>): Promise<any> {
    const res = await types(at, 'POST', '', body)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body
  }

  const readType = async (at: Studio, id: string) => (await types(at, 'GET', `/${id}`)).body

  /** A class of a type, `startsInMs` from now (negative: already over). */
  async function addClass(at: Studio, classTypeId: string, startsInMs: number, over: Record<string, unknown> = {}) {
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
        ...over,
      })
      .returning({ id: schema.classes.id })
    return row!.id
  }

  let seq = 0
  async function member(at: Studio) {
    const email = `m${++seq}-${at.slug}@${DOMAIN}`
    await harness.signInAs('client', email, at)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(and(eq(schema.clientAuthUsers.email, email), eq(schema.clientAuthUsers.tenantId, at.id)))
    const [row] = await harness.db
      .insert(schema.clients)
      .values({ tenantId: at.id, authUserId: user!.id, name: `Member ${seq}`, email, phone: `+65912${String(seq).padStart(5, '0')}` })
      .returning({ id: schema.clients.id })
    return row!.id
  }

  async function book(at: Studio, clientId: string, classId: string, state: 'confirmed' | 'cancelled' = 'confirmed') {
    const n = ++seq
    const [row] = await harness.db
      .insert(schema.bookings)
      .values({
        tenantId: at.id,
        clientId,
        kind: 'class',
        classId,
        state,
        creditsOrSessionsUsed: 1,
        qrToken: `ctqr-${run}-${n}`,
        code: `RT-${run.slice(-3).toUpperCase()}${n}`,
      })
      .returning({ id: schema.bookings.id })
    return row!.id
  }

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

  test('SCH-66 an admin sets the Entity of a top-level Class Type on create and on edit; with none named it takes the studio’s first Entity', async () => {
    const studio = await newStudio('sch66')
    const ids = await entityIds(studio)
    const pilates = await newEntity(studio, 'Pilates')

    const reformer = await newType(studio, { name: 'Reformer', entity_id: pilates })
    assert.equal(reformer.entity_id, pilates)
    assert.equal(reformer.parent_id, null)
    assert.equal((await readType(studio, reformer.id)).entity_id, pilates)

    // Left out, it is the first Entity by order: a studio with one line never has to think about it.
    const hatha = await newType(studio, { name: 'Hatha' })
    assert.equal(hatha.entity_id, ids['All classes'])

    const moved = await types(studio, 'PATCH', `/${hatha.id}`, { entity_id: pilates })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.equal(moved.body.entity_id, pilates)
    // An edit that does not name an Entity leaves it where it is.
    const renamed = await types(studio, 'PATCH', `/${hatha.id}`, { name: 'Hatha Flow II' })
    assert.equal(renamed.body.entity_id, pilates)

    // The list carries it too.
    const list = (await types(studio, 'GET', '')).body.class_types as any[]
    assert.deepEqual(
      list.filter(t => [reformer.id, hatha.id].includes(t.id)).map(t => t.entity_id),
      [pilates, pilates],
    )
  })

  test('SCH-67 another studio’s Entity, one that does not exist and an archived one are refused on a Class Type, and nothing is written', async () => {
    const studio = await newStudio('sch67')
    const other = await newStudio('sch67b')
    const theirs = (await entityIds(other))['All classes']!
    const own = (await entityIds(studio))['All classes']!
    const spare = await newEntity(studio, 'Barre')
    const archived = await entities(studio, 'POST', `/${spare}/archive`)
    assert.equal(archived.status, 200, JSON.stringify(archived.body))
    const type = await newType(studio, { name: 'Mat', entity_id: own })

    const nobody = '00000000-0000-4000-8000-000000000000'
    for (const [what, entityId, status, error] of [
      ['another studio’s Entity', theirs, 404, 'entity_not_found'],
      ['an id nobody has', nobody, 404, 'entity_not_found'],
      ['an archived Entity', spare, 409, 'entity_archived'],
    ] as const) {
      const onCreate = await types(studio, 'POST', '', { name: `Refused ${what}`, entity_id: entityId })
      assert.equal(onCreate.status, status, `${what} on create: ${JSON.stringify(onCreate.body)}`)
      assert.equal(onCreate.body.error, error, what)
      const onEdit = await types(studio, 'PATCH', `/${type.id}`, { entity_id: entityId })
      assert.equal(onEdit.status, status, `${what} on edit: ${JSON.stringify(onEdit.body)}`)
      assert.equal(onEdit.body.error, error, what)
    }
    assert.equal((await readType(studio, type.id)).entity_id, own)
    const names = ((await types(studio, 'GET', '')).body.class_types as any[]).map(t => t.name)
    assert.deepEqual(names, ['Mat'])

    // Not a UUID at all is a plain 400.
    const bad = await types(studio, 'POST', '', { name: 'Bad', entity_id: 'pilates' })
    assert.equal(bad.status, 400, JSON.stringify(bad.body))
    assert.equal(bad.body.error, 'invalid_request')
  })

  test('SCH-68 a new sub-type takes its parent’s Entity, and an Entity named on a sub-type is refused on create and on edit, even the parent’s own', async () => {
    const studio = await newStudio('sch68')
    const ids = await entityIds(studio)
    const pilates = await newEntity(studio, 'Pilates')
    const yoga = await newType(studio, { name: 'Yoga', entity_id: ids['All classes'] })

    const hatha = await newType(studio, { name: 'Hatha', parent_id: yoga.id })
    assert.equal(hatha.entity_id, ids['All classes'])
    assert.equal(hatha.parent_id, yoga.id)

    for (const [what, entityId] of [['another Entity', pilates], ['the parent’s own', ids['All classes']]] as const) {
      const onCreate = await types(studio, 'POST', '', { name: `Vinyasa ${what}`, parent_id: yoga.id, entity_id: entityId })
      assert.equal(onCreate.status, 400, `${what} on create: ${JSON.stringify(onCreate.body)}`)
      assert.equal(onCreate.body.error, 'class_type_entity_inherited')
      const onEdit = await types(studio, 'PATCH', `/${hatha.id}`, { entity_id: entityId })
      assert.equal(onEdit.status, 400, `${what} on edit: ${JSON.stringify(onEdit.body)}`)
      assert.equal(onEdit.body.error, 'class_type_entity_inherited')
      // Also when the same write makes it a sub-type.
      const loose = await newType(studio, { name: `Loose ${what}`, entity_id: ids['All classes'] })
      const onMakeSub = await types(studio, 'PATCH', `/${loose.id}`, { parent_id: yoga.id, entity_id: entityId })
      assert.equal(onMakeSub.status, 400, `${what} on making a sub-type: ${JSON.stringify(onMakeSub.body)}`)
      assert.equal((await readType(studio, loose.id)).parent_id, null)
    }

    // Nothing was written: the sub-type is where it was, and no stray sub-type was made.
    assert.equal((await readType(studio, hatha.id)).entity_id, ids['All classes'])
    const subTypes = ((await types(studio, 'GET', '')).body.class_types as any[]).filter(t => t.parent_id === yoga.id)
    assert.deepEqual(subTypes.map(t => t.name), ['Hatha'])
  })

  test('SCH-69 a Class Type that changes parent takes the new parent’s Entity; one made top-level keeps its own and may then be given another', async () => {
    const studio = await newStudio('sch69')
    const ids = await entityIds(studio)
    const pilates = await newEntity(studio, 'Pilates')
    const yoga = await newType(studio, { name: 'Yoga', entity_id: ids['All classes'] })
    const mat = await newType(studio, { name: 'Mat', entity_id: pilates })
    const flow = await newType(studio, { name: 'Flow', entity_id: ids['All classes'] })

    // Top-level -> sub-type of a parent in another Entity.
    const underMat = await types(studio, 'PATCH', `/${flow.id}`, { parent_id: mat.id })
    assert.equal(underMat.status, 200, JSON.stringify(underMat.body))
    assert.equal(underMat.body.entity_id, pilates)
    // Sub-type -> another parent.
    const underYoga = await types(studio, 'PATCH', `/${flow.id}`, { parent_id: yoga.id })
    assert.equal(underYoga.body.entity_id, ids['All classes'])
    // The dialog sends the parent it already has with every save: nothing changes.
    const same = await types(studio, 'PATCH', `/${flow.id}`, { parent_id: yoga.id, name: 'Flow II' })
    assert.equal(same.status, 200, JSON.stringify(same.body))
    assert.equal(same.body.entity_id, ids['All classes'])
    // Sub-type -> top-level: keeps the Entity it had, and now accepts its own.
    const free = await types(studio, 'PATCH', `/${flow.id}`, { parent_id: null })
    assert.equal(free.body.parent_id, null)
    assert.equal(free.body.entity_id, ids['All classes'])
    const own = await types(studio, 'PATCH', `/${flow.id}`, { entity_id: pilates })
    assert.equal(own.status, 200, JSON.stringify(own.body))
    assert.equal(own.body.entity_id, pilates)
    // And it can be made top-level and given another Entity in one write.
    const back = await types(studio, 'PATCH', `/${flow.id}`, { parent_id: mat.id })
    assert.equal(back.body.entity_id, pilates)
    const both = await types(studio, 'PATCH', `/${flow.id}`, { parent_id: null, entity_id: ids['All classes'] })
    assert.equal(both.status, 200, JSON.stringify(both.body))
    assert.equal(both.body.entity_id, ids['All classes'])
  })

  test('SCH-70 moving a parent to another Entity moves its sub-types with it in the same write, archived ones too, and no other type', async () => {
    const studio = await newStudio('sch70')
    const ids = await entityIds(studio)
    const pilates = await newEntity(studio, 'Pilates')
    const yoga = await newType(studio, { name: 'Yoga', entity_id: ids['All classes'] })
    const hatha = await newType(studio, { name: 'Hatha', parent_id: yoga.id })
    const vinyasa = await newType(studio, { name: 'Vinyasa', parent_id: yoga.id })
    const bystander = await newType(studio, { name: 'Bystander', entity_id: ids['All classes'] })
    const archived = await types(studio, 'POST', `/${vinyasa.id}/archive`)
    assert.equal(archived.status, 200, JSON.stringify(archived.body))

    const moved = await types(studio, 'PATCH', `/${yoga.id}`, { entity_id: pilates })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.equal(moved.body.entity_id, pilates)

    const list = ((await types(studio, 'GET', '?include_archived=true')).body.class_types as any[])
    const entityOf = (id: string) => list.find(t => t.id === id).entity_id
    assert.equal(entityOf(yoga.id), pilates)
    assert.equal(entityOf(hatha.id), pilates)
    assert.equal(entityOf(vinyasa.id), pilates)
    assert.equal(entityOf(bystander.id), ids['All classes'])

    // Moved back, they all follow again.
    await types(studio, 'PATCH', `/${yoga.id}`, { entity_id: ids['All classes'] })
    const after = ((await types(studio, 'GET', '?include_archived=true')).body.class_types as any[])
    assert.deepEqual(
      [yoga.id, hatha.id, vinyasa.id].map(id => after.find(t => t.id === id).entity_id),
      [ids['All classes'], ids['All classes'], ids['All classes']],
    )
  })

  test('SCH-71 the move preview counts the upcoming classes and confirmed bookings of the type and its sub-types, and not cancelled, ended or other types’ ones', async () => {
    const studio = await newStudio('sch71')
    const ids = await entityIds(studio)
    const pilates = await newEntity(studio, 'Pilates')
    const yoga = await newType(studio, { name: 'Yoga', entity_id: ids['All classes'] })
    const hatha = await newType(studio, { name: 'Hatha', parent_id: yoga.id })
    const other = await newType(studio, { name: 'Other', entity_id: ids['All classes'] })

    const ada = await member(studio)
    const bo = await member(studio)
    const onYoga = await addClass(studio, yoga.id, 2 * DAY)
    const onHatha = await addClass(studio, hatha.id, 3 * DAY)
    const ended = await addClass(studio, yoga.id, -2 * DAY)
    const cancelled = await addClass(studio, yoga.id, 4 * DAY, { lifecycle: 'cancelled' })
    const notOurs = await addClass(studio, other.id, 2 * DAY)
    const underway = await addClass(studio, yoga.id, -HOUR / 2) // started, not over: still upcoming by the archive rule
    await book(studio, ada, onYoga)
    await book(studio, bo, onYoga)
    await book(studio, ada, onHatha)
    await book(studio, bo, onHatha, 'cancelled')
    await book(studio, ada, ended)
    await book(studio, ada, cancelled)
    await book(studio, ada, notOurs)
    await book(studio, bo, underway)

    const preview = await types(studio, 'GET', `/${yoga.id}/entity-preview?entity_id=${pilates}`)
    assert.equal(preview.status, 200, JSON.stringify(preview.body))
    assert.deepEqual(preview.body, { upcoming_classes: 3, bookings: 4 })

    // A type with none says so; a move to the Entity it is in reaches nothing.
    const none = await types(studio, 'GET', `/${other.id}/entity-preview?entity_id=${pilates}`)
    assert.deepEqual(none.body, { upcoming_classes: 1, bookings: 1 })
    const same = await types(studio, 'GET', `/${yoga.id}/entity-preview?entity_id=${ids['All classes']}`)
    assert.deepEqual(same.body, { upcoming_classes: 0, bookings: 0 })

    // It is a read: nothing about the type moved.
    assert.equal((await readType(studio, yoga.id)).entity_id, ids['All classes'])

    // It follows the app's clock, not the wall clock.
    harness.clock.set(new Date(Date.now() + 2.5 * DAY))
    try {
      const later = await types(studio, 'GET', `/${yoga.id}/entity-preview?entity_id=${pilates}`)
      assert.deepEqual(later.body, { upcoming_classes: 1, bookings: 1 })
    } finally {
      harness.clock.reset()
    }
  })

  test('SCH-72 the move preview refuses a sub-type, another studio’s or an archived Entity, an unknown type and a missing Entity', async () => {
    const studio = await newStudio('sch72')
    const other = await newStudio('sch72b')
    const ids = await entityIds(studio)
    const spare = await newEntity(studio, 'Barre')
    await entities(studio, 'POST', `/${spare}/archive`)
    const yoga = await newType(studio, { name: 'Yoga', entity_id: ids['All classes'] })
    const hatha = await newType(studio, { name: 'Hatha', parent_id: yoga.id })
    const theirs = (await entityIds(other))['All classes']!
    const nobody = '00000000-0000-4000-8000-000000000000'

    for (const [what, path, status, error] of [
      ['a sub-type', `/${hatha.id}/entity-preview?entity_id=${ids['All classes']}`, 400, 'class_type_entity_inherited'],
      ['another studio’s Entity', `/${yoga.id}/entity-preview?entity_id=${theirs}`, 404, 'entity_not_found'],
      ['an archived Entity', `/${yoga.id}/entity-preview?entity_id=${spare}`, 409, 'entity_archived'],
      ['a type nobody has', `/${nobody}/entity-preview?entity_id=${ids['All classes']}`, 404, 'class_type_not_found'],
      ['no Entity named', `/${yoga.id}/entity-preview`, 400, 'invalid_request'],
    ] as const) {
      const res = await types(studio, 'GET', path)
      assert.equal(res.status, status, `${what}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, error, what)
    }
    // Another studio's admin cannot read this studio's type.
    const foreign = await send('GET', `/api/v1/portal/admin/class-types/${yoga.id}/entity-preview?entity_id=${theirs}`, other.admin)
    assert.equal(foreign.status, 404, JSON.stringify(foreign.body))
    assert.equal(foreign.body.error, 'class_type_not_found')
    // An instructor may not read the admin surface.
    const instructor = await send('GET', `/api/v1/portal/admin/class-types/${yoga.id}/entity-preview?entity_id=${ids['All classes']}`, studio.instructor)
    assert.equal(instructor.status, 403, JSON.stringify(instructor.body))
  })

  test('SCH-73 moving a Class Type cancels no booking and touches no class, booking or credit; the classes keep their type', async () => {
    const studio = await newStudio('sch73')
    const ids = await entityIds(studio)
    const pilates = await newEntity(studio, 'Pilates')
    const yoga = await newType(studio, { name: 'Yoga', entity_id: ids['All classes'] })
    const hatha = await newType(studio, { name: 'Hatha', parent_id: yoga.id })
    const ada = await member(studio)
    const classId = await addClass(studio, hatha.id, 2 * DAY)
    const bookingId = await book(studio, ada, classId)

    const snapshot = async () => ({
      booking: (await harness.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId)))[0],
      cls: (await harness.db.select().from(schema.classes).where(eq(schema.classes.id, classId)))[0],
      cancellations: (await harness.db.select().from(schema.cancellations).where(eq(schema.cancellations.tenantId, studio.id))).length,
      credits: (await harness.db.select().from(schema.creditMovements).where(eq(schema.creditMovements.tenantId, studio.id))).length,
    })
    const before = await snapshot()

    const moved = await types(studio, 'PATCH', `/${yoga.id}`, { entity_id: pilates })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))

    const after = await snapshot()
    assert.deepEqual(after, before)
    assert.equal(after.booking!.state, 'confirmed')
    assert.equal(after.cls!.classTypeId, hatha.id)
    assert.equal((await readType(studio, hatha.id)).entity_id, pilates)
  })

  test('SCH-75 the class type lists and a class’s card and detail say which Entity its type is in, for a visitor and for an instructor', async () => {
    const studio = await newStudio('sch75')
    const ids = await entityIds(studio)
    const pilates = await newEntity(studio, 'Pilates')
    const yoga = await newType(studio, { name: 'Yoga', entity_id: ids['All classes'] })
    const mat = await newType(studio, { name: 'Mat', entity_id: pilates })
    const matClass = await addClass(studio, mat.id, 2 * DAY)

    const visitor = {
      'X-Tenant-Slug': studio.slug,
      Origin: frontendOrigin('client', studio),
      'X-Forwarded-For': harnessAddress(),
    }
    const entityOfType = (list: any[], id: string) => list.find(t => t.id === id)?.entity_id

    const pub = await send('GET', '/api/v1/public/class-types', visitor)
    assert.equal(pub.status, 200, JSON.stringify(pub.body))
    assert.equal(entityOfType(pub.body.class_types, yoga.id), ids['All classes'])
    assert.equal(entityOfType(pub.body.class_types, mat.id), pilates)

    const inst = await send('GET', '/api/v1/portal/instructor/catalog/class-types', studio.instructor)
    assert.equal(inst.status, 200, JSON.stringify(inst.body))
    assert.equal(entityOfType(inst.body.class_types, mat.id), pilates)

    const from = new Date(Date.now() - DAY).toISOString()
    const to = new Date(Date.now() + 5 * DAY).toISOString()
    const week = await send('GET', `/api/v1/public/classes?from=${from}&to=${to}`, visitor)
    assert.equal(week.status, 200, JSON.stringify(week.body))
    assert.equal(week.body.classes.find((c: any) => c.id === matClass).class_type.entity_id, pilates)
    const detail = await send('GET', `/api/v1/public/classes/${matClass}`, visitor)
    assert.equal(detail.status, 200, JSON.stringify(detail.body))
    assert.equal(detail.body.class_type.entity_id, pilates)
  })

  test('TEN-143 one studio’s Entity and Class Types are invisible to another’s admin: lists, edits, moves and previews by the other’s ids are refused, and nothing changes', async () => {
    const a = await newStudio('ten143a')
    const b = await newStudio('ten143b')
    const aAll = (await entityIds(a))['All classes']!
    const bAll = (await entityIds(b))['All classes']!
    const aType = await newType(a, { name: 'A Yoga', entity_id: aAll })
    const bType = await newType(b, { name: 'B Yoga', entity_id: bAll })

    // A lists its own only.
    const aList = ((await types(a, 'GET', '')).body.class_types as any[]).map(t => t.id)
    assert.deepEqual(aList, [aType.id])
    // A cannot read, edit, move, preview or archive B's type, nor give its own type B's Entity.
    for (const [what, res] of [
      ['read', await types(a, 'GET', `/${bType.id}`)],
      ['edit', await types(a, 'PATCH', `/${bType.id}`, { name: 'Taken' })],
      ['preview', await types(a, 'GET', `/${bType.id}/entity-preview?entity_id=${aAll}`)],
      ['archive', await types(a, 'POST', `/${bType.id}/archive`)],
    ] as const) {
      assert.equal(res.status, 404, `${what}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, 'class_type_not_found', what)
    }
    const borrowed = await types(a, 'PATCH', `/${aType.id}`, { entity_id: bAll })
    assert.equal(borrowed.status, 404, JSON.stringify(borrowed.body))
    assert.equal(borrowed.body.error, 'entity_not_found')
    // A sub-type of B's parent cannot be made by A either.
    const under = await types(a, 'POST', '', { name: 'Sneak', parent_id: bType.id })
    assert.equal(under.status, 404, JSON.stringify(under.body))

    // B's Entity counts only B's types, and B's type is where it was.
    const read = async (at: Studio, id: string) => (await entities(at, 'GET', '')).body.entities.find((e: any) => e.id === id)
    assert.equal((await read(b, bAll)).in_use.class_types, 1)
    assert.equal((await read(a, aAll)).in_use.class_types, 1)
    assert.equal((await readType(b, bType.id)).name, 'B Yoga')
    assert.equal((await readType(b, bType.id)).entity_id, bAll)
  })

  test('SCH-74 an Entity that still holds a live Class Type cannot be archived, and the refusal counts them; an archived type does not hold it', async () => {
    const studio = await newStudio('sch74')
    const ids = await entityIds(studio)
    const pilates = await newEntity(studio, 'Pilates')
    const mat = await newType(studio, { name: 'Mat', entity_id: pilates })
    const reformer = await newType(studio, { name: 'Reformer', entity_id: pilates })
    await newType(studio, { name: 'Springboard', parent_id: reformer.id }) // a sub-type holds it too

    const read = async (id: string) => (await entities(studio, 'GET', '')).body.entities.find((e: any) => e.id === id)
    assert.equal((await read(pilates)).in_use.class_types, 3)
    assert.equal((await read(ids['All classes']!)).in_use.class_types, 0)

    const refused = await entities(studio, 'POST', `/${pilates}/archive`)
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.error, 'entity_in_use')
    assert.equal(refused.body.class_types, 3)
    assert.equal((await read(pilates)).archived_at, null)

    // Moving them out is what frees it: archive and delete the sub-type's parent's others, move the rest.
    await types(studio, 'PATCH', `/${reformer.id}`, { entity_id: ids['All classes'] })
    assert.equal((await read(pilates)).in_use.class_types, 1)
    const archivedMat = await types(studio, 'POST', `/${mat.id}/archive`)
    assert.equal(archivedMat.status, 200, JSON.stringify(archivedMat.body))
    assert.equal((await read(pilates)).in_use.class_types, 0)
    const done = await entities(studio, 'POST', `/${pilates}/archive`)
    assert.equal(done.status, 200, JSON.stringify(done.body))
  })
})
