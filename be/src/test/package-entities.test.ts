import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { frontendOrigin, harnessAddress, inTenantContext, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { memberFixtures } from './member-fixtures'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `${run}.package-entities.test`
const OPERATOR = `operator@${DOMAIN}`

/**
 * Every catalogue package belongs to an Entity (#556, spec #554), over real
 * HTTP: the five kinds an admin sells (Credit Bundle, Unlimited Plan, Trial,
 * PT package, Corporate package) take an Entity on create and edit, refuse one
 * that is not this studio's or is archived, list by Entity, say how many
 * members a move takes along, move without cancelling anything, and hold an
 * Entity back from being archived while one is in it.
 *
 * Every studio here is made the way the super portal makes one, so what a test
 * moves, archives and deletes never touches a fixture another file reads.
 */
describe('every package belongs to an Entity', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let operator!: Record<string, string>
  let fixtures!: ReturnType<typeof memberFixtures>

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Studio = { id: string; slug: string; admin: Headers; entities: { all: string; pilates: string; barre: string } }

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

  const admin = (at: Studio, path: string, method = 'GET', body?: unknown) =>
    send(method, `/api/v1/portal/admin/${path}`, at.admin, body)

  /** The five kinds an admin sells, how each is made, and where each answer carries the package. */
  type Kind = {
    path: 'class-packages' | 'pt-packages' | 'corporate-packages'
    /** The key the list answers under. */
    list: string
    /** The key a single package is wrapped in, if any. */
    one: string | null
    body: Record<string, unknown>
    table: 'class_packages' | 'pt_packages' | 'corporate_packages'
  }
  const KINDS: Record<'credit_bundle' | 'unlimited' | 'trial' | 'pt' | 'corporate', Kind> = {
    credit_bundle: {
      path: 'class-packages',
      list: 'class_packages',
      one: null,
      table: 'class_packages',
      body: { kind: 'credit_bundle', credits: 5, validity_days: 30, price_sgd: '50.00' },
    },
    unlimited: {
      path: 'class-packages',
      list: 'class_packages',
      one: null,
      table: 'class_packages',
      body: { kind: 'unlimited', duration_months: 3, price_sgd: '300.00' },
    },
    trial: {
      path: 'class-packages',
      list: 'class_packages',
      one: null,
      table: 'class_packages',
      body: { kind: 'trial', credits: 2, validity_days: 14, price_sgd: '10.00' },
    },
    pt: {
      path: 'pt-packages',
      list: 'pt_packages',
      one: null,
      table: 'pt_packages',
      body: { session_type: '1on1', num_sessions: 5, validity_days: 90, price_sgd: '400.00' },
    },
    corporate: { path: 'corporate-packages', list: 'corporatePackages', one: 'corporatePackage', table: 'corporate_packages', body: { price_sgd: '900.00' } },
  }
  type KindName = keyof typeof KINDS
  const KIND_NAMES = Object.keys(KINDS) as KindName[]
  const unwrap = (kind: Kind, body: any) => (kind.one ? body?.[kind.one] : body)

  let counter = 0
  /** Create a package of `kind` through the API. `entity` is the Entity id, or `undefined` to leave it out. */
  async function create(at: Studio, name: KindName, entity: string | undefined, extra: Record<string, unknown> = {}) {
    const kind = KINDS[name]
    return admin(at, kind.path, 'POST', {
      name: `${name} ${run} ${counter++}`,
      ...kind.body,
      ...(entity === undefined ? {} : { entity_id: entity }),
      ...extra,
    })
  }
  async function made(at: Studio, name: KindName, entity: string) {
    const res = await create(at, name, entity)
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return unwrap(KINDS[name], res.body)
  }
  const read = (at: Studio, name: KindName, id: string) => admin(at, `${KINDS[name].path}/${id}`)
  const entityOf = async (at: Studio, name: KindName, id: string) => unwrap(KINDS[name], (await read(at, name, id)).body).entity_id as string
  const patch = (at: Studio, name: KindName, id: string, body: unknown) => admin(at, `${KINDS[name].path}/${id}`, 'PATCH', body)

  async function staffAt(at: { id: string; slug: string }, name: string) {
    const email = `${name}-${at.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, at)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.email, email), eq(schema.staffAuthUsers.tenantId, at.id)))
    await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: at.id, email, name, role: 'admin', status: 'active', authUserId: user!.id })
    return headers
  }

  const created: Array<{ id: string; slug: string }> = []

  /** A studio with the Entities "All classes" (first), "Pilates" and "Barre", the last archived. */
  async function newStudio(label: string): Promise<Studio> {
    const slug = `${label}-${run}`
    const res = await send('POST', '/api/v1/platform/tenants', operator, {
      slug,
      name: `Package entities ${label}`,
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
    const studio: Studio = { ...tenant, admin: await staffAt(tenant, 'admin'), entities: { all: '', pilates: '', barre: '' } }
    const [first] = (await admin(studio, 'entities')).body.entities
    studio.entities.all = first.id
    for (const name of ['Pilates', 'Barre'] as const) {
      const row = await admin(studio, 'entities', 'POST', { name })
      assert.equal(row.status, 201, JSON.stringify(row.body))
      studio.entities[name === 'Pilates' ? 'pilates' : 'barre'] = row.body.id
    }
    const gone = await admin(studio, `entities/${studio.entities.barre}/archive`, 'POST')
    assert.equal(gone.status, 200, JSON.stringify(gone.body))
    return studio
  }

  let studio!: Studio
  let other!: Studio

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    fixtures = memberFixtures(harness, schema, DOMAIN)
    operator = await harness.signInAs('platform', OPERATOR, null)
    studio = await newStudio('pkg-main')
    other = await newStudio('pkg-other')
  })

  after(async () => {
    if (!harness) return
    try {
      const { setTenantStatus } = await import('../services/tenants/tenants')
      const { deleteTenant } = await import('../services/tenants/delete')
      for (const tenant of created) {
        await harness.db.execute(sql`DELETE FROM tenant_imports WHERE tenant_id = ${tenant.id}`)
        await setTenantStatus(tenant.id, 'suspended')
        await deleteTenant({ tenantId: tenant.id, confirmSlug: tenant.slug })
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

  /* ── create and edit ────────────────────────────────────────────────── */

  test('PKG-59 an admin creates each of the five kinds in an Entity: an Entity that is not an id is refused, and the package answers with its Entity', async () => {
    for (const name of KIND_NAMES) {
      const kind = KINDS[name]

      const notAnId = await create(studio, name, 'yoga')
      assert.equal(notAnId.status, 400, `${name}: ${JSON.stringify(notAnId.body)}`)
      assert.equal(notAnId.body.error, 'invalid_request')
      assert.match(notAnId.body.message, /entity/i, `${name}: the sentence names what is wrong`)

      const ok = await create(studio, name, studio.entities.pilates)
      assert.equal(ok.status, 201, `${name}: ${JSON.stringify(ok.body)}`)
      const pkg = unwrap(kind, ok.body)
      assert.equal(pkg.entity_id, studio.entities.pilates)
      assert.deepEqual(pkg.entity, { id: studio.entities.pilates, name: 'Pilates', slug: 'pilates' })

      // Nothing was written by the refusals: the list holds only the one made.
      const listed = (await admin(studio, `${kind.path}?entity=${studio.entities.pilates}`)).body[kind.list]
      assert.ok(listed.some((p: any) => p.id === pkg.id), `${name}: listed`)
    }
  })

  test('PKG-60 a package is refused an Entity that is archived or unknown, on create and on edit, and nothing is written', async () => {
    const stranger = '11111111-1111-4111-8111-111111111111'
    for (const name of KIND_NAMES) {
      const kind = KINDS[name]
      const before = (await admin(studio, kind.path)).body[kind.list].length
      const mine = await made(studio, name, studio.entities.all)
      const total = before + 1

      const gone = await create(studio, name, studio.entities.barre)
      assert.equal(gone.status, 409, `${name}: ${JSON.stringify(gone.body)}`)
      assert.equal(gone.body.error, 'entity_archived')
      const unknown = await create(studio, name, stranger)
      assert.equal(unknown.status, 404, `${name}: ${JSON.stringify(unknown.body)}`)
      assert.equal(unknown.body.error, 'entity_not_found')

      const moveToArchived = await patch(studio, name, mine.id, { entity_id: studio.entities.barre })
      assert.equal(moveToArchived.status, 409, `${name}: ${JSON.stringify(moveToArchived.body)}`)
      assert.equal(moveToArchived.body.error, 'entity_archived')
      const moveToUnknown = await patch(studio, name, mine.id, { entity_id: stranger })
      assert.equal(moveToUnknown.status, 404, `${name}: ${JSON.stringify(moveToUnknown.body)}`)

      assert.equal((await admin(studio, kind.path)).body[kind.list].length, total, `${name}: no package was written`)
      assert.equal(await entityOf(studio, name, mine.id), studio.entities.all, `${name}: it stayed where it was`)
    }
  })

  test('PKG-61 an admin moves a package to another Entity with a patch, and a package in an Entity since archived can still be edited in place', async () => {
    for (const name of KIND_NAMES) {
      const pkg = await made(studio, name, studio.entities.all)
      const moved = await patch(studio, name, pkg.id, { entity_id: studio.entities.pilates })
      assert.equal(moved.status, 200, `${name}: ${JSON.stringify(moved.body)}`)
      assert.equal(unwrap(KINDS[name], moved.body).entity.name, 'Pilates')
      assert.equal(await entityOf(studio, name, pkg.id), studio.entities.pilates)

      // Put it in an Entity, empty the Entity of everything else, archive it: the package is archived first.
      const stuck = await made(studio, name, studio.entities.pilates)
      await harness.db.execute(
        sql`UPDATE ${sql.identifier(KINDS[name].table)} SET entity_id = ${studio.entities.barre} WHERE id = ${stuck.id}`,
      )
      const renamed = await patch(studio, name, stuck.id, { name: `renamed ${name} ${run}` })
      assert.equal(renamed.status, 200, `${name}: a package in an archived Entity is still editable: ${JSON.stringify(renamed.body)}`)
      assert.equal(await entityOf(studio, name, stuck.id), studio.entities.barre)
      const same = await patch(studio, name, stuck.id, { entity_id: studio.entities.barre })
      assert.equal(same.status, 200, `${name}: naming the Entity it is already in changes nothing: ${JSON.stringify(same.body)}`)
    }

    // A patch that only names the Entity is a real change for a corporate package, which has no other field a patch must carry.
    const corporate = await made(studio, 'corporate', studio.entities.all)
    await patch(studio, 'corporate', corporate.id, { entity_id: studio.entities.pilates })
    assert.equal(await entityOf(studio, 'corporate', corporate.id), studio.entities.pilates)
  })

  test('PKG-62 the admin lists of packages carry each one\'s Entity and filter by it', async () => {
    for (const name of KIND_NAMES) {
      const kind = KINDS[name]
      const inAll = await made(studio, name, studio.entities.all)
      const inPilates = await made(studio, name, studio.entities.pilates)

      const filtered = (await admin(studio, `${kind.path}?entity=${studio.entities.pilates}`)).body[kind.list]
      assert.ok(filtered.length >= 1)
      for (const p of filtered) assert.equal(p.entity_id, studio.entities.pilates, `${name}: only that Entity's packages`)
      assert.ok(filtered.some((p: any) => p.id === inPilates.id), name)
      assert.ok(!filtered.some((p: any) => p.id === inAll.id), name)

      const everything = (await admin(studio, kind.path)).body[kind.list]
      const row = everything.find((p: any) => p.id === inAll.id)
      assert.deepEqual(row.entity, { id: studio.entities.all, name: 'All classes', slug: 'all-classes' }, `${name}: each row names its Entity`)

      const bad = await admin(studio, `${kind.path}?entity=not-an-id`)
      assert.equal(bad.status, 400, name)
    }
  })

  test('TEN-140 another studio\'s Entity is refused as unknown, on create, on edit and in a filter, and what one studio puts in its Entity never counts against another\'s', async () => {
    for (const name of KIND_NAMES) {
      const kind = KINDS[name]
      const mine = await made(studio, name, studio.entities.all)
      const theirs = other.entities.all

      const onCreate = await create(studio, name, theirs)
      assert.equal(onCreate.status, 404, `${name}: ${JSON.stringify(onCreate.body)}`)
      assert.equal(onCreate.body.error, 'entity_not_found', 'the same answer as an Entity that exists nowhere')
      const onEdit = await patch(studio, name, mine.id, { entity_id: theirs })
      assert.equal(onEdit.status, 404, `${name}: ${JSON.stringify(onEdit.body)}`)
      assert.equal(await entityOf(studio, name, mine.id), studio.entities.all)

      // Nothing of theirs is in the table under that Entity: the FK would have accepted it.
      const [leak] = await harness.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(kind.table)} WHERE tenant_id = ${studio.id} AND entity_id = ${theirs}`,
      )
      assert.equal(leak!.n, 0, `${name}: no row of this studio points at the other's Entity`)
      assert.deepEqual((await admin(studio, `${kind.path}?entity=${theirs}`)).body[kind.list], [], `${name}: a filter on their Entity finds nothing of ours`)
    }

    // Their Entity's count is theirs: ours does not move when they add a package.
    const usage = async (at: Studio, entity: string) =>
      (await admin(at, 'entities')).body.entities.find((e: any) => e.id === entity).in_use.class_packages as number
    const [oursBefore, theirsBefore] = [await usage(studio, studio.entities.pilates), await usage(other, other.entities.pilates)]
    const theirPackage = await made(other, 'credit_bundle', other.entities.pilates)
    assert.equal(await usage(other, other.entities.pilates), theirsBefore + 1)
    assert.equal(await usage(studio, studio.entities.pilates), oursBefore)
    assert.equal((await admin(studio, `class-packages/${theirPackage.id}`)).status, 404, 'their package is not ours to read')
  })

  /* ── a move, and the members it takes along ─────────────────────────── */

  let members = 0
  async function holder(at: Studio): Promise<string> {
    const email = `holder-${members++}@${DOMAIN}`
    const client = await fixtures.insertRow('clients', at.id, { email, name: 'Holder' })
    return client.id as string
  }
  async function holds(at: Studio, clientId: string, source: { class?: string; pt?: string }, active = true): Promise<string> {
    const [row] = await harness.db
      .insert(schema.clientPackages)
      .values({
        tenantId: at.id,
        clientId,
        kind: source.pt ? 'pt' : 'credit_bundle',
        sourceClassPackageId: source.class ?? null,
        sourcePtPackageId: source.pt ?? null,
        validityDays: 30,
        creditsOrSessionsRemaining: 3,
        active,
        amountPaidSgd: '50.00',
        listPriceSgd: '50.00',
      })
      .returning({ id: schema.clientPackages.id })
    return row!.id
  }

  test('PKG-63 before a move, the admin is told how many members hold the package: distinct members with a live holding, and none for a corporate package', async () => {
    const bundle = await made(studio, 'credit_bundle', studio.entities.all)
    const pt = await made(studio, 'pt', studio.entities.all)
    const [one, two, three] = [await holder(studio), await holder(studio), await holder(studio)]
    await holds(studio, one, { class: bundle.id })
    await holds(studio, one, { class: bundle.id }) // the same member twice is one member
    await holds(studio, two, { class: bundle.id })
    await holds(studio, three, { class: bundle.id }, false) // an ended holding is nobody's
    await holds(studio, one, { pt: pt.id })

    const preview = (name: KindName, id: string, entity: string) =>
      admin(studio, `${KINDS[name].path}/${id}/entity-preview?entity_id=${entity}`)

    const bundleCount = await preview('credit_bundle', bundle.id, studio.entities.pilates)
    assert.equal(bundleCount.status, 200, JSON.stringify(bundleCount.body))
    assert.equal(bundleCount.body.members_holding, 2)
    assert.equal((await preview('pt', pt.id, studio.entities.pilates)).body.members_holding, 1)

    const corporate = await made(studio, 'corporate', studio.entities.all)
    const corporateCount = await preview('corporate', corporate.id, studio.entities.pilates)
    assert.equal(corporateCount.status, 200, JSON.stringify(corporateCount.body))
    assert.equal(corporateCount.body.members_holding, 0)

    // A read: nothing moved.
    assert.equal(await entityOf(studio, 'credit_bundle', bundle.id), studio.entities.all)

    // The same refusals as the move itself.
    assert.equal((await preview('credit_bundle', bundle.id, studio.entities.barre)).status, 409)
    assert.equal((await preview('credit_bundle', bundle.id, other.entities.pilates)).status, 404)
    assert.equal((await admin(studio, `class-packages/${pt.id}/entity-preview?entity_id=${studio.entities.pilates}`)).status, 404, 'an id of another kind is no package here')
    assert.equal((await admin(studio, `class-packages/${bundle.id}/entity-preview`)).status, 400, 'an Entity is required')
  })

  test('PKG-64 moving a package takes the packages members hold with it and cancels no booking', async () => {
    const bundle = await made(studio, 'credit_bundle', studio.entities.all)
    const client = await holder(studio)
    const heldId = await holds(studio, client, { class: bundle.id })
    const booking = await fixtures.insertRow('bookings', studio.id, {
      client_id: client,
      client_package_id: heldId,
      state: 'confirmed',
    })

    const moved = await patch(studio, 'credit_bundle', bundle.id, { entity_id: studio.entities.pilates })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))

    // The held package has no Entity of its own: it reads the catalogue package's.
    const [held] = await harness.db.execute<{ entity_id: string; active: boolean; source: string }>(sql`
      SELECT p.entity_id, c.active, c.source_class_package_id AS source
      FROM client_packages c JOIN class_packages p ON p.id = c.source_class_package_id
      WHERE c.id = ${heldId}
    `)
    assert.deepEqual({ ...held }, { entity_id: studio.entities.pilates, active: true, source: bundle.id })

    const [still] = await harness.db.execute<{ state: string; client_package_id: string }>(sql`
      SELECT state, client_package_id FROM bookings WHERE id = ${booking.id as string}
    `)
    assert.deepEqual({ ...still }, { state: 'confirmed', client_package_id: heldId }, 'the booking is as it was')
    const cancellations = await harness.db.execute(sql`SELECT 1 FROM bookings WHERE tenant_id = ${studio.id} AND state <> 'confirmed'`)
    assert.equal(cancellations.length, 0)
  })

  /* ── an Entity still in use cannot be archived ──────────────────────── */

  test('PKG-65 an Entity with active packages cannot be archived and the refusal counts them; archived and removed packages do not count', async () => {
    const fresh = await admin(studio, 'entities', 'POST', { name: `Reformer ${run}` })
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body))
    const id = fresh.body.id as string
    const archive = () => admin(studio, `entities/${id}/archive`, 'POST')

    const bundle = await made(studio, 'credit_bundle', id)
    await made(studio, 'trial', id)
    const pt = await made(studio, 'pt', id)
    const corporate = await made(studio, 'corporate', id)

    const refused = await archive()
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.error, 'entity_in_use')
    assert.equal(refused.body.class_packages, 2)
    assert.equal(refused.body.pt_packages, 1)
    assert.equal(refused.body.corporate_packages, 1)
    const shown = (await admin(studio, 'entities')).body.entities.find((e: any) => e.id === id)
    assert.deepEqual(shown.in_use, { class_types: 0, class_packages: 2, pt_packages: 1, corporate_packages: 1 })

    // Archiving or removing a package takes it out of the count; moving it takes it to the other Entity.
    assert.equal((await admin(studio, `class-packages/${bundle.id}/archive`, 'POST')).status, 200)
    assert.equal((await admin(studio, `pt-packages/${pt.id}/archive`, 'POST')).status, 200)
    assert.equal((await admin(studio, `corporate-packages/${corporate.id}`, 'PATCH', { status: 'archived' })).status, 200)
    assert.equal((await admin(studio, `class-packages/${bundle.id}`, 'DELETE')).status, 204)
    const trialsLeft = (await archive()).body
    assert.equal(trialsLeft.error, 'entity_in_use')
    assert.equal(trialsLeft.class_packages, 1, 'only the trial still counts')
    assert.equal(trialsLeft.pt_packages, 0)
    assert.equal(trialsLeft.corporate_packages, 0)

    const [trial] = (await admin(studio, `class-packages?entity=${id}&status=active`)).body.class_packages
    assert.equal((await patch(studio, 'trial', trial.id, { entity_id: studio.entities.all })).status, 200)
    assert.equal((await archive()).status, 200, 'nothing active is left in it')
  })

  test('PKG-66 an archived package cannot be put back into an Entity that has since been archived', async () => {
    for (const name of KIND_NAMES) {
      const kind = KINDS[name]
      const entity = await admin(studio, 'entities', 'POST', { name: `Temp ${name} ${run}` })
      const pkg = await made(studio, name, entity.body.id)
      const archived =
        name === 'corporate'
          ? await admin(studio, `${kind.path}/${pkg.id}`, 'PATCH', { status: 'archived' })
          : await admin(studio, `${kind.path}/${pkg.id}/archive`, 'POST')
      assert.equal(archived.status, 200, `${name}: ${JSON.stringify(archived.body)}`)
      const gone = await admin(studio, `entities/${entity.body.id}/archive`, 'POST')
      assert.equal(gone.status, 200, `${name}: ${JSON.stringify(gone.body)}`)

      const back = await admin(studio, `${kind.path}/${pkg.id}/unarchive`, 'POST')
      assert.equal(back.status, 409, `${name}: ${JSON.stringify(back.body)}`)
      assert.equal(back.body.error, 'entity_archived')
      if (name === 'corporate') {
        const viaPatch = await admin(studio, `${kind.path}/${pkg.id}`, 'PATCH', { status: 'active' })
        assert.equal(viaPatch.status, 409, JSON.stringify(viaPatch.body))
      }

      // Moved to a live Entity first, it comes back.
      assert.equal((await patch(studio, name, pkg.id, { entity_id: studio.entities.all })).status, 200, `${name}: a move is allowed while archived`)
      assert.equal((await admin(studio, `${kind.path}/${pkg.id}/unarchive`, 'POST')).status, 200, name)
    }
  })

  /* ── what members and visitors read ─────────────────────────────────── */

  test('PKG-67 the catalogue a member or visitor reads names each package\'s Entity', async () => {
    const bundle = await made(studio, 'credit_bundle', studio.entities.pilates)
    const pt = await made(studio, 'pt', studio.entities.pilates)
    const corporate = await made(studio, 'corporate', studio.entities.pilates)
    const pilates = { id: studio.entities.pilates, name: 'Pilates', slug: 'pilates' }

    const visitor = { 'X-Tenant-Slug': studio.slug, Origin: frontendOrigin('client', studio) }
    const visitorRead = (path: string) => send('GET', `/api/v1/public/${path}`, visitor)

    const email = `reader-${members++}@${DOMAIN}`
    const headers = await harness.signInAs('client', email, studio)
    const [user] = await harness.db.select({ id: schema.clientAuthUsers.id }).from(schema.clientAuthUsers).where(eq(schema.clientAuthUsers.email, email))
    await fixtures.insertRow('clients', studio.id, { email, name: 'Reader', auth_user_id: user!.id })
    const memberRead = (path: string) => send('GET', `/api/v1/me/${path}`, headers)

    const entityOn = (rows: any[], id: string) => {
      const row = rows.find(r => r.id === id)
      assert.ok(row, `${id} is listed`)
      assert.equal(row.entity_id, pilates.id)
      return row.entity
    }
    const publicPackages = (await visitorRead('packages')).body
    assert.deepEqual(entityOn(publicPackages.class_packages, bundle.id), pilates)
    assert.deepEqual(entityOn(publicPackages.pt_packages, pt.id), pilates)
    assert.deepEqual(entityOn((await visitorRead('corporate-packages')).body.corporate_packages, corporate.id), pilates)
    assert.deepEqual(entityOn((await memberRead('class-packages')).body.class_packages, bundle.id), pilates)
    assert.deepEqual(entityOn((await memberRead('pt-packages')).body.pt_packages, pt.id), pilates)
    assert.deepEqual(entityOn((await memberRead('corporate-packages')).body.corporate_packages, corporate.id), pilates)
  })

  /* ── a studio's archive ─────────────────────────────────────────────── */

  test('TEN-141 a studio\'s export and restore carry each package\'s Entity: copied beside it, each package points at the copy of its own Entity', async () => {
    const transfer = await import('../services/tenants/transfer')
    // Deleted with the other studios at the end, whether or not this test got there.
    const newTenant = async (slug: string) => {
      const [row] = await harness.db.execute<{ id: string }>(sql`
        INSERT INTO tenants (slug, name, timezone, status)
        VALUES (${slug}, ${`Package entities ${slug}`}, 'Asia/Singapore', 'active')
        RETURNING id
      `)
      created.push({ id: row!.id, slug })
      return row!.id
    }
    const sourceSlug = `pkgent-src-${run}`
    const source = await newTenant(sourceSlug)
    const [yoga, pilates] = await harness.db
      .insert(schema.entities)
      .values([
        { tenantId: source, name: 'Yoga', slug: 'yoga', position: 0 },
        { tenantId: source, name: 'Pilates', slug: 'pilates', position: 1 },
      ])
      .returning()
    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: source, email: `owner-${sourceSlug}@${DOMAIN}`, name: 'Owner', role: 'admin', status: 'active', authUserId: randomUUID() })
      .returning()
    await harness.db.insert(schema.classPackages).values([
      { tenantId: source, entityId: yoga!.id, name: 'Yoga pack', kind: 'credit_bundle', credits: 5, validityDays: 30, priceSgd: '50.00' },
      { tenantId: source, entityId: pilates!.id, name: 'Pilates plan', kind: 'unlimited', durationMonths: 3, priceSgd: '300.00' },
    ])
    await harness.db.insert(schema.ptPackages).values({ tenantId: source, entityId: pilates!.id, name: 'Pilates PT', sessionType: '1on1', numSessions: 5, validityDays: 90, priceSgd: '400.00' })
    await harness.db.insert(schema.corporatePackages).values({ tenantId: source, entityId: yoga!.id, name: 'Yoga corporate', priceSgd: '900.00', createdByStaffId: staff!.id })

    const archive = await transfer.exportTenant(source)
    for (const table of ['class_packages', 'pt_packages', 'corporate_packages']) {
      for (const row of archive.rows[table]!) assert.ok(row.entity_id, `${table} rows carry their Entity in the archive`)
    }

    const targetSlug = `pkgent-dst-${run}`
    const target = await newTenant(targetSlug)
    await transfer.importTenant(target, archive)

    const placed = (tenantId: string) =>
      harness.db.execute<{ package: string; entity: string; entity_tenant: string }>(sql`
        SELECT p.name AS package, e.name AS entity, e.tenant_id AS entity_tenant FROM class_packages p JOIN entities e ON e.id = p.entity_id WHERE p.tenant_id = ${tenantId}
        UNION ALL SELECT p.name, e.name, e.tenant_id FROM pt_packages p JOIN entities e ON e.id = p.entity_id WHERE p.tenant_id = ${tenantId}
        UNION ALL SELECT p.name, e.name, e.tenant_id FROM corporate_packages p JOIN entities e ON e.id = p.entity_id WHERE p.tenant_id = ${tenantId}
      `)
    const expected = [
      { package: 'Pilates PT', entity: 'Pilates' },
      { package: 'Pilates plan', entity: 'Pilates' },
      { package: 'Yoga corporate', entity: 'Yoga' },
      { package: 'Yoga pack', entity: 'Yoga' },
    ]
    for (const tenantId of [source, target]) {
      const rows = [...(await placed(tenantId))].sort((a, b) => (a.package < b.package ? -1 : 1))
      assert.deepEqual(rows.map(r => ({ package: r.package, entity: r.entity })), expected)
      for (const row of rows) assert.equal(row.entity_tenant, tenantId, 'each points at its own studio\'s copy of the Entity')
    }
  })

  /* ── the service default ────────────────────────────────────────────── */

  test('PKG-68 a package made by the service with no Entity named goes in the studio\'s first live Entity', async () => {
    const classPackages = inTenantContext(await import('../services/packages/class-packages'))
    const ptPackages = inTenantContext(await import('../services/packages/pt-packages'))
    const corporatePackages = inTenantContext(await import('../services/packages/corporate-packages'))
    const staff = (await harness.db.select({ id: schema.staffUsers.id }).from(schema.staffUsers).where(eq(schema.staffUsers.tenantId, studio.id)))[0]!

    const a = await classPackages.createClassPackage(studio.id, { name: `service ${run}`, kind: 'credit_bundle', credits: 1, validityDays: 30, priceSgd: '10.00' })
    const b = await ptPackages.createPtPackage(studio.id, { name: `service pt ${run}`, sessionType: '1on1', numSessions: 1, validityDays: 30, priceSgd: '10.00' })
    const c = await corporatePackages.createCorporatePackage(studio.id, { name: `service corp ${run}`, priceSgd: '10.00', createdByStaffId: staff.id })
    for (const row of [a, b, c]) assert.equal(row.entityId, studio.entities.all)

    // The first by display order: move "Pilates" to the front and it is the default.
    const reorder = await admin(studio, 'entities/order', 'PUT', { ids: [studio.entities.pilates, studio.entities.all] })
    assert.equal(reorder.status, 200, JSON.stringify(reorder.body))
    const d = await classPackages.createClassPackage(studio.id, { name: `service 2 ${run}`, kind: 'credit_bundle', credits: 1, validityDays: 30, priceSgd: '10.00' })
    assert.equal(d.entityId, studio.entities.pilates)
    await admin(studio, 'entities/order', 'PUT', { ids: [studio.entities.all, studio.entities.pilates] })
  })

  test('PKG-80 an admin creating a package with no Entity named gets the studio\'s first live Entity, never none, and a named Entity is still checked', async () => {
    for (const name of KIND_NAMES) {
      const kind = KINDS[name]
      const left = await create(studio, name, undefined)
      assert.equal(left.status, 201, `${name}: ${JSON.stringify(left.body)}`)
      const pkg = unwrap(kind, left.body)
      assert.equal(pkg.entity_id, studio.entities.all, `${name}: the first live Entity, not none`)
      assert.equal(await entityOf(studio, name, pkg.id), studio.entities.all, `${name}: and it is stored`)

      // Naming an archived Entity is still refused rather than defaulted.
      const gone = await create(studio, name, studio.entities.barre)
      assert.equal(gone.status, 409, `${name}: ${JSON.stringify(gone.body)}`)
    }
  })
})
