import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, sql } from 'drizzle-orm'
import { harnessAddress, integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const DOMAIN = `${run}.entities.test`
const OPERATOR = `operator@${DOMAIN}`

/**
 * Entities over HTTP (#555, spec #554): the studio-owned Entities an
 * admin manages from settings. Nothing is assigned to one yet, so these tests
 * are about the Entity itself: that every studio has one, what an admin may do
 * to the list, who may not, and that no studio can see another's.
 *
 * The in-process app against real Postgres with both fixture Tenants and real
 * sign-ins. The management tests run in a studio of their own, made the way the
 * super portal makes one, so renaming and archiving never move a fixture the
 * other files read.
 */
describe('entities over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let operator!: Record<string, string>

  type Headers = Record<string, string>
  type Reply = { status: number; body: any }
  type Studio = { id: string; slug: string; admin: Headers }

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

  const admin = (at: Studio, method: string, path: string, body?: unknown) =>
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
    return headers
  }

  /** Studios this file created through the super portal, deleted at the end. */
  const created: Array<{ id: string; slug: string }> = []

  /** A studio of this file's own, created by the operator with a first admin, opened and given an admin who is signed in. */
  async function newStudio(label: string): Promise<Studio & { instructor: Headers }> {
    const slug = `${label}-${run}`
    const res = await send('POST', '/api/v1/platform/tenants', operator, {
      slug,
      name: `Entities ${label}`,
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
    return {
      ...tenant,
      admin: await staffAt(tenant, 'admin', 'admin'),
      instructor: await staffAt(tenant, 'teacher', 'instructor'),
    }
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
      await harness.db.execute(sql`DELETE FROM email_log WHERE recipient_email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM platform_auth_users WHERE email LIKE ${ours}`)
    } finally {
      await harness.close()
    }
  })

  test('SUP-38 a studio created in the super portal starts with one Entity, "All classes", and its admin sees it in settings', async () => {
    const studio = await newStudio('sup-new')

    const list = await admin(studio, 'GET', '')
    assert.equal(list.status, 200, JSON.stringify(list.body))
    assert.equal(list.body.entities.length, 1)
    const [all] = list.body.entities
    assert.equal(all.name, 'All classes')
    assert.equal(all.slug, 'all-classes')
    assert.equal(all.position, 0)
    assert.equal(all.archived_at, null)
    assert.deepEqual(all.in_use, { class_types: 0, class_packages: 0, pt_packages: 0, corporate_packages: 0 })
  })

  test('SCH-51 each isolation fixture studio has Entities of its own, in order', async () => {
    const one = await staffAt(harness.tenants.one, 'fixture-admin', 'admin')
    const two = await staffAt(harness.tenants.two, 'fixture-admin', 'admin')
    const read = async (headers: Headers) =>
      (await send('GET', '/api/v1/portal/admin/entities', headers)).body.entities.map((e: any) => e.name)

    assert.deepEqual(await read(one), ['All classes', 'Pilates'])
    assert.deepEqual(await read(two), ['All classes'])
  })

  const names = async (at: Studio) => (await admin(at, 'GET', '')).body.entities.map((e: any) => e.name)

  test('SCH-52 an admin creates an Entity by giving it a name: it takes a slug from the name and goes last', async () => {
    const studio = await newStudio('sch-create')

    const pilates = await admin(studio, 'POST', '', { name: 'Pilates' })
    assert.equal(pilates.status, 201, JSON.stringify(pilates.body))
    assert.equal(pilates.body.name, 'Pilates')
    assert.equal(pilates.body.slug, 'pilates')
    assert.equal(pilates.body.position, 1)
    assert.equal(pilates.body.archived_at, null)

    // A name with punctuation and spaces becomes one tidy slug; the name is kept as typed, trimmed.
    const hot = await admin(studio, 'POST', '', { name: '  Hot Yoga & Flow ' })
    assert.equal(hot.status, 201, JSON.stringify(hot.body))
    assert.equal(hot.body.name, 'Hot Yoga & Flow')
    assert.equal(hot.body.slug, 'hot-yoga-flow')
    assert.equal(hot.body.position, 2)

    // A slug may be given, and is then used as it is, folded to lower case.
    const barre = await admin(studio, 'POST', '', { name: 'Barre', slug: 'Barre-Classes' })
    assert.equal(barre.status, 201, JSON.stringify(barre.body))
    assert.equal(barre.body.slug, 'barre-classes')

    assert.deepEqual(await names(studio), ['All classes', 'Pilates', 'Hot Yoga & Flow', 'Barre'])
  })

  test('SCH-53 an admin renames an Entity and edits its slug, each on its own', async () => {
    const studio = await newStudio('sch-rename')
    const [all] = (await admin(studio, 'GET', '')).body.entities

    // Renaming leaves the address alone: a slug a member's bookmark holds must not move with a typo fix.
    const renamed = await admin(studio, 'PATCH', `/${all.id}`, { name: 'Yoga' })
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body))
    assert.equal(renamed.body.name, 'Yoga')
    assert.equal(renamed.body.slug, 'all-classes')

    const reslugged = await admin(studio, 'PATCH', `/${all.id}`, { slug: 'Yoga' })
    assert.equal(reslugged.status, 200, JSON.stringify(reslugged.body))
    assert.equal(reslugged.body.name, 'Yoga')
    assert.equal(reslugged.body.slug, 'yoga')

    // Only its casing changing is not a duplicate of itself.
    const recased = await admin(studio, 'PATCH', `/${all.id}`, { name: 'YOGA' })
    assert.equal(recased.status, 200, JSON.stringify(recased.body))
    assert.deepEqual(await names(studio), ['YOGA'])
  })

  test('SCH-54 a name or slug another live Entity has is refused 409, in any casing, on create and on edit, and nothing is written', async () => {
    const studio = await newStudio('sch-dup')
    const [all] = (await admin(studio, 'GET', '')).body.entities
    const pilates = (await admin(studio, 'POST', '', { name: 'Pilates' })).body

    const refusals: Array<[what: string, reply: Reply, error: string]> = [
      ['create with a name in another casing', await admin(studio, 'POST', '', { name: 'PILATES' }), 'entity_name_taken'],
      ['create with the default name', await admin(studio, 'POST', '', { name: 'all classes' }), 'entity_name_taken'],
      ['create with a taken slug', await admin(studio, 'POST', '', { name: 'Reformer', slug: 'PILATES' }), 'entity_slug_taken'],
      ['rename to another Entity name', await admin(studio, 'PATCH', `/${all.id}`, { name: 'pilates' }), 'entity_name_taken'],
      ['edit the slug to another Entity slug', await admin(studio, 'PATCH', `/${all.id}`, { slug: 'Pilates' }), 'entity_slug_taken'],
      ['rename the other way', await admin(studio, 'PATCH', `/${pilates.id}`, { name: 'ALL CLASSES' }), 'entity_name_taken'],
    ]
    for (const [what, res, error] of refusals) {
      assert.equal(res.status, 409, `${what}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, error, what)
    }

    // A name that makes the same slug as another is a slug clash too, and is refused rather than made unique silently.
    const sameSlug = await admin(studio, 'POST', '', { name: 'Pilates!' })
    assert.equal(sameSlug.status, 409, JSON.stringify(sameSlug.body))
    assert.equal(sameSlug.body.error, 'entity_slug_taken')

    assert.deepEqual(await names(studio), ['All classes', 'Pilates'])
    const slugs = (await admin(studio, 'GET', '')).body.entities.map((e: any) => e.slug)
    assert.deepEqual(slugs, ['all-classes', 'pilates'])
  })

  test('SCH-55 a blank or over-long name, and a slug that is not URL-safe or cannot be made from the name, is refused 400', async () => {
    const studio = await newStudio('sch-invalid')
    const [all] = (await admin(studio, 'GET', '')).body.entities

    const refusals: Array<[what: string, reply: Reply, error: string]> = [
      ['a blank name', await admin(studio, 'POST', '', { name: '   ' }), 'invalid_request'],
      ['a missing name', await admin(studio, 'POST', '', {}), 'invalid_request'],
      ['a name past 80 characters', await admin(studio, 'POST', '', { name: 'x'.repeat(81) }), 'invalid_request'],
      ['a slug with a space', await admin(studio, 'POST', '', { name: 'Reformer', slug: 'two words' }), 'entity_slug_invalid'],
      ['a slug with a leading hyphen', await admin(studio, 'POST', '', { name: 'Reformer', slug: '-reformer' }), 'entity_slug_invalid'],
      ['a name with nothing a slug can be made of', await admin(studio, 'POST', '', { name: '瑜伽' }), 'entity_slug_invalid'],
      ['an edit to a blank name', await admin(studio, 'PATCH', `/${all.id}`, { name: '' }), 'invalid_request'],
      ['an edit to a slug with a slash', await admin(studio, 'PATCH', `/${all.id}`, { slug: 'a/b' }), 'entity_slug_invalid'],
      ['an edit naming nothing', await admin(studio, 'PATCH', `/${all.id}`, {}), 'invalid_request'],
    ]
    for (const [what, res, error] of refusals) {
      assert.equal(res.status, 400, `${what}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, error, what)
    }

    // A name with no Latin letters is fine once the admin supplies the slug.
    const ok = await admin(studio, 'POST', '', { name: '瑜伽', slug: 'yoga-zh' })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.deepEqual(await names(studio), ['All classes', '瑜伽'])
  })

  test('SCH-56 an edit, archive or unknown id that names no Entity is 404 entity_not_found, and an id that is not a UUID is 400', async () => {
    const studio = await newStudio('sch-missing')
    const missing = '00000000-0000-4000-8000-000000000000'
    for (const res of [
      await admin(studio, 'PATCH', `/${missing}`, { name: 'Nope' }),
      await admin(studio, 'POST', `/${missing}/archive`),
    ]) {
      assert.equal(res.status, 404, JSON.stringify(res.body))
      assert.equal(res.body.error, 'entity_not_found')
    }
    assert.equal((await admin(studio, 'PATCH', '/not-a-uuid', { name: 'Nope' })).status, 400)
  })

  test('SCH-57 an admin reorders Entities by sending every live Entity once in the order they want, and the list comes back in that order', async () => {
    const studio = await newStudio('sch-order')
    const [all] = (await admin(studio, 'GET', '')).body.entities
    const pilates = (await admin(studio, 'POST', '', { name: 'Pilates' })).body
    const barre = (await admin(studio, 'POST', '', { name: 'Barre' })).body

    const moved = await admin(studio, 'PUT', '/order', { ids: [barre.id, all.id, pilates.id] })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.deepEqual(moved.body.entities.map((e: any) => e.name), ['Barre', 'All classes', 'Pilates'])
    assert.deepEqual(moved.body.entities.map((e: any) => e.position), [0, 1, 2])
    assert.deepEqual(await names(studio), ['Barre', 'All classes', 'Pilates'])

    // The next one created still goes last.
    const next = await admin(studio, 'POST', '', { name: 'Reformer' })
    assert.equal(next.body.position, 3)

    // A list that leaves one out, repeats one, names a stranger or is empty changes nothing.
    const stranger = '00000000-0000-4000-8000-000000000000'
    for (const [what, ids] of [
      ['one left out', [all.id, pilates.id]],
      ['one repeated', [all.id, all.id, pilates.id, barre.id, next.body.id]],
      ['a stranger', [all.id, pilates.id, barre.id, stranger]],
      ['empty', []],
    ] as const) {
      const res = await admin(studio, 'PUT', '/order', { ids })
      assert.equal(res.status, 400, `${what}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, 'entity_order_invalid', what)
    }
    assert.deepEqual(await names(studio), ['Barre', 'All classes', 'Pilates', 'Reformer'])
  })

  test('SCH-58 an admin archives an Entity: it leaves the list and the menu, stays readable on request, and gives its name and slug back', async () => {
    const studio = await newStudio('sch-archive')
    const pilates = (await admin(studio, 'POST', '', { name: 'Pilates' })).body

    const archived = await admin(studio, 'POST', `/${pilates.id}/archive`)
    assert.equal(archived.status, 200, JSON.stringify(archived.body))
    assert.ok(archived.body.archived_at)
    assert.deepEqual(await names(studio), ['All classes'])

    const everything = await admin(studio, 'GET', '?include_archived=true')
    assert.deepEqual(everything.body.entities.map((e: any) => [e.name, e.archived_at !== null]), [
      ['All classes', false],
      ['Pilates', true],
    ])

    // The name and the slug are free again among live Entities.
    const again = await admin(studio, 'POST', '', { name: 'pilates' })
    assert.equal(again.status, 201, JSON.stringify(again.body))
    assert.equal(again.body.slug, 'pilates')
    assert.deepEqual(await names(studio), ['All classes', 'pilates'])

    // Archiving what is already archived is the same answer as for an Entity that is not there.
    const twice = await admin(studio, 'POST', `/${pilates.id}/archive`)
    assert.equal(twice.status, 404, JSON.stringify(twice.body))
    assert.equal(twice.body.error, 'entity_not_found')

    // A reorder is of the live ones only; the archived one is not asked for.
    const [all, second] = (await admin(studio, 'GET', '')).body.entities
    const swapped = await admin(studio, 'PUT', '/order', { ids: [second.id, all.id] })
    assert.equal(swapped.status, 200, JSON.stringify(swapped.body))
  })

  test('SCH-59 archiving the last live Entity is refused 409 cannot_archive_last_entity and leaves it live, however many archived ones the studio has', async () => {
    const studio = await newStudio('sch-last')
    const [all] = (await admin(studio, 'GET', '')).body.entities

    const refused = await admin(studio, 'POST', `/${all.id}/archive`)
    assert.equal(refused.status, 409, JSON.stringify(refused.body))
    assert.equal(refused.body.error, 'cannot_archive_last_entity')
    assert.deepEqual(await names(studio), ['All classes'])

    // With a second, the first may go; then the second is the last.
    const pilates = (await admin(studio, 'POST', '', { name: 'Pilates' })).body
    assert.equal((await admin(studio, 'POST', `/${all.id}/archive`)).status, 200)
    const last = await admin(studio, 'POST', `/${pilates.id}/archive`)
    assert.equal(last.status, 409, JSON.stringify(last.body))
    assert.equal(last.body.error, 'cannot_archive_last_entity')
    assert.deepEqual(await names(studio), ['Pilates'])
  })

  test('SCH-62 an instructor, and a caller who is signed in to nothing, can neither read nor change Entities, and nothing moves', async () => {
    const studio = await newStudio('sch-instructor')
    const [all] = (await admin(studio, 'GET', '')).body.entities
    const before = JSON.stringify((await admin(studio, 'GET', '?include_archived=true')).body)

    const calls: Array<[string, string, unknown?]> = [
      ['GET', ''],
      ['POST', '', { name: 'Pilates' }],
      ['PATCH', `/${all.id}`, { name: 'Renamed' }],
      ['PUT', '/order', { ids: [all.id] }],
      ['POST', `/${all.id}/archive`],
    ]
    for (const [method, path, body] of calls) {
      const asInstructor = await admin({ ...studio, admin: studio.instructor }, method, path, body)
      assert.equal(asInstructor.status, 403, `instructor ${method} ${path}: ${JSON.stringify(asInstructor.body)}`)
      assert.equal(asInstructor.body.error, 'forbidden_role')

      const nobody = await admin({ ...studio, admin: { Origin: studio.admin.Origin ?? '' } }, method, path, body)
      assert.ok([401, 400].includes(nobody.status), `anonymous ${method} ${path}: ${nobody.status}`)
    }

    assert.equal(JSON.stringify((await admin(studio, 'GET', '?include_archived=true')).body), before)
  })

  test('TEN-139 one studio never reads or changes another\'s Entities: lists hold only its own, and a borrowed id is not found', async () => {
    const a = await newStudio('ten-a')
    const b = await newStudio('ten-b')
    const pilates = (await admin(a, 'POST', '', { name: 'Pilates' })).body
    const [bAll] = (await admin(b, 'GET', '')).body.entities

    // Each studio's list is its own: B does not see A's Pilates, and A's name is free in B.
    assert.deepEqual(await names(b), ['All classes'])
    assert.deepEqual(await names(a), ['All classes', 'Pilates'])
    assert.equal((await admin(b, 'POST', '', { name: 'Pilates' })).status, 201)

    // B's admin asking about A's Entity by id is told there is none, and A's is untouched.
    for (const [method, path, body] of [
      ['PATCH', `/${pilates.id}`, { name: 'Hijacked' }],
      ['POST', `/${pilates.id}/archive`, undefined],
    ] as Array<[string, string, unknown]>) {
      const res = await admin(b, method, path, body)
      assert.equal(res.status, 404, `${method} ${path}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.error, 'entity_not_found')
    }
    const borrowed = await admin(b, 'PUT', '/order', { ids: [bAll.id, pilates.id] })
    assert.equal(borrowed.status, 400, JSON.stringify(borrowed.body))
    assert.equal(borrowed.body.error, 'entity_order_invalid')
    assert.deepEqual(await names(a), ['All classes', 'Pilates'])
    assert.equal((await admin(a, 'GET', '')).body.entities[1].archived_at, null)

    // And with no `WHERE tenant_id` at all, the database itself hands a studio only its own rows: the
    // application role, inside a studio's context, reading the whole table.
    const { db: appDb, withTenant } = await import('../db')
    for (const studio of [a, b]) {
      const seen = await withTenant(studio.id, () => appDb.select({ tenantId: schema.entities.tenantId }).from(schema.entities))
      assert.ok(seen.length > 0)
      assert.ok(seen.every(row => row.tenantId === studio.id), `${studio.slug} read another studio's Entity`)
    }
    // Outside any studio's context it reads none.
    assert.equal((await appDb.select().from(schema.entities)).length, 0)
  })

  test('SCH-60 nothing belongs to an Entity yet, so every Entity reports zero in use and archives', async () => {
    const studio = await newStudio('sch-unused')
    const pilates = (await admin(studio, 'POST', '', { name: 'Pilates' })).body
    assert.deepEqual(pilates.in_use, { class_types: 0, class_packages: 0, pt_packages: 0, corporate_packages: 0 })
    const archived = await admin(studio, 'POST', `/${pilates.id}/archive`)
    assert.equal(archived.status, 200, JSON.stringify(archived.body))
  })
})
