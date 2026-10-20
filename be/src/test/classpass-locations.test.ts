import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, like, or } from 'drizzle-orm'
import { integrationTestsEnabled, inTenantContext, SKIP_REASON, startTestApp, type TestApp } from './harness'

/**
 * ClassPass location mappings (#410): an Admin maps each name ClassPass gives
 * a location in its emails to one of the studio's Locations. Driven through
 * the mapping service and the ClassPass page's routes.
 */
describe('ClassPass location mappings', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let mappings!: typeof import('../services/classpass/locations')

  const DOMAIN = `${randomUUID().slice(0, 8)}.classpass-locations.test`
  // No dash, upper case or double space in it, so it reads the same normalised.
  const TAG = `cpsloc${randomUUID().slice(0, 8)}`
  const locationIds: string[] = []

  async function location(tenantId: string, opts: { archived?: boolean; deleted?: boolean } = {}) {
    const [row] = await harness.db
      .insert(schema.locations)
      .values({
        tenantId,
        name: `${TAG} ${locationIds.length}`,
        archivedAt: opts.archived || opts.deleted ? new Date() : null,
        deletedAt: opts.deleted ? new Date() : null,
      })
      .returning({ id: schema.locations.id })
    locationIds.push(row!.id)
    return row!.id
  }

  /** A ClassPass name no other test in this file uses. */
  const name = (label: string) => `${TAG} ${label}`

  async function staff(tenant: { id: string; slug: string }, who: string, role: 'admin' | 'instructor') {
    const email = `${who}-${tenant.slug}@${DOMAIN}`
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(and(eq(schema.staffAuthUsers.tenantId, tenant.id), eq(schema.staffAuthUsers.email, email)))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: who, role, status: 'active', authUserId: user!.id })
      .returning({ id: schema.staffUsers.id })
    if (role === 'instructor') {
      await harness.db.insert(schema.instructors).values({ tenantId: tenant.id, staffUserId: row!.id })
    }
    return headers
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    mappings = inTenantContext(await import('../services/classpass/locations'))
  })

  after(async () => {
    const db = harness.db
    if (locationIds.length) {
      await db
        .delete(schema.classpassLocationMappings)
        .where(inArray(schema.classpassLocationMappings.locationId, locationIds))
    }
    const staffIds = (
      await db.select({ id: schema.staffUsers.id }).from(schema.staffUsers).where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    ).map(s => s.id)
    const authIds = (
      await db
        .select({ id: schema.staffAuthUsers.id })
        .from(schema.staffAuthUsers)
        .where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    ).map(u => u.id)
    if (authIds.length) {
      await db
        .delete(schema.authEvents)
        .where(or(inArray(schema.authEvents.actorUserId, authIds), inArray(schema.authEvents.subjectUserId, authIds)))
    }
    if (staffIds.length) {
      await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
      await db.delete(schema.instructors).where(inArray(schema.instructors.staffUserId, staffIds))
      await db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    }
    await db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    if (locationIds.length) await db.delete(schema.locations).where(inArray(schema.locations.id, locationIds))
    await harness?.close()
  })

  test('CPS-21 an Admin maps a ClassPass location name to a Location, and it is listed normalised', async () => {
    const { one } = harness.tenants
    const harbour = await location(one.id)

    const added = await mappings.addClassPassLocationMapping(one.id, {
      locationName: `  ${name('Studio-Harbour  Street')} `,
      locationId: harbour,
    })
    assert.equal(added.locationName, name('studio - harbour street'))
    assert.equal(added.locationId, harbour)

    const listed = (await mappings.listClassPassLocationMappings(one.id)).find(m => m.id === added.id)
    assert.ok(listed, 'the new mapping is listed')
    assert.equal(listed.locationName, added.locationName)
    assert.equal(listed.locationId, harbour)
  })

  test('CPS-22 a second spelling that differs only in spaces or dash characters is the same entry, and is refused', async () => {
    const { one } = harness.tenants
    const harbour = await location(one.id)
    const other = await location(one.id)
    await mappings.addClassPassLocationMapping(one.id, { locationName: name('Studio-Quay'), locationId: harbour })

    for (const spelling of [name('Studio - Quay'), name('STUDIO – quay'), name('studio—Quay')]) {
      await assert.rejects(
        mappings.addClassPassLocationMapping(one.id, { locationName: spelling, locationId: other }),
        (err: any) => err.status === 409 && err.code === 'classpass_mapping_exists',
      )
    }
    const forQuay = (await mappings.listClassPassLocationMappings(one.id)).filter(
      m => m.locationName === name('studio - quay'),
    )
    assert.deepEqual(forQuay.map(m => m.locationId), [harbour])
  })

  test("CPS-23 a mapping to an archived or deleted Location, or to another studio's, is refused, on add and on change", async () => {
    const { one, two } = harness.tenants
    const live = await location(one.id)
    const archived = await location(one.id, { archived: true })
    const deleted = await location(one.id, { deleted: true })
    const theirs = await location(two.id)

    const refusals: [string, number, string][] = [
      [archived, 400, 'location_archived'],
      [deleted, 404, 'location_not_found'],
      [theirs, 404, 'location_not_found'],
      [randomUUID(), 404, 'location_not_found'],
    ]
    for (const [locationId, status, code] of refusals) {
      await assert.rejects(
        mappings.addClassPassLocationMapping(one.id, { locationName: name('Refused'), locationId }),
        (err: any) => err.status === status && err.code === code,
      )
    }
    assert.equal(
      (await mappings.listClassPassLocationMappings(one.id)).some(m => m.locationName === name('refused')),
      false,
    )

    const kept = await mappings.addClassPassLocationMapping(one.id, { locationName: name('Kept'), locationId: live })
    for (const [locationId, status, code] of refusals) {
      await assert.rejects(
        mappings.changeClassPassLocationMapping(one.id, kept.id, { locationId }),
        (err: any) => err.status === status && err.code === code,
      )
    }
    const after = (await mappings.listClassPassLocationMappings(one.id)).find(m => m.id === kept.id)
    assert.equal(after?.locationId, live)
  })

  test('CPS-24 an Admin changes a mapping, including to a name ClassPass cut short, and removes it', async () => {
    const { one } = harness.tenants
    const first = await location(one.id)
    const second = await location(one.id)
    const mapping = await mappings.addClassPassLocationMapping(one.id, { locationName: name('Studio-Pier'), locationId: first })
    const neighbour = await mappings.addClassPassLocationMapping(one.id, {
      locationName: name('Studio-Dock'),
      locationId: first,
    })

    const truncated = await mappings.changeClassPassLocationMapping(one.id, mapping.id, {
      locationName: name('Studio -'),
      locationId: second,
    })
    assert.equal(truncated.locationName, name('studio -'))
    assert.equal(truncated.locationId, second)

    // Renaming onto another mapping's name, however spelt, is refused.
    await assert.rejects(
      mappings.changeClassPassLocationMapping(one.id, mapping.id, { locationName: name('STUDIO – dock') }),
      (err: any) => err.status === 409 && err.code === 'classpass_mapping_exists',
    )
    // Respelling its own name is no clash.
    const same = await mappings.changeClassPassLocationMapping(one.id, mapping.id, { locationName: name('studio–') })
    assert.equal(same.locationName, name('studio -'))

    await mappings.removeClassPassLocationMapping(one.id, mapping.id)
    const left = await mappings.listClassPassLocationMappings(one.id)
    assert.equal(left.some(m => m.id === mapping.id), false)
    assert.equal(left.some(m => m.id === neighbour.id), true)

    for (const attempt of [
      () => mappings.removeClassPassLocationMapping(one.id, mapping.id),
      () => mappings.changeClassPassLocationMapping(one.id, mapping.id, { locationId: second }),
    ]) {
      await assert.rejects(attempt(), (err: any) => err.status === 404 && err.code === 'classpass_mapping_not_found')
    }
  })

  test("CPS-25 an Admin lists, adds, changes and removes mappings on the ClassPass page; an Instructor is refused, and another studio's mapping is not found", async () => {
    const { one, two } = harness.tenants
    const admin = await staff(two, 'cps-loc-admin', 'admin')
    const instructor = await staff(two, 'cps-loc-instructor', 'instructor')
    const atTwo = await location(two.id)
    const alsoAtTwo = await location(two.id)
    const atOne = await location(one.id)
    const northwinds = await mappings.addClassPassLocationMapping(one.id, { locationName: name('Theirs'), locationId: atOne })

    const call = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
      harness.app.request(`/api/v1/portal/admin/classpass/locations${path}`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })

    const added = await call(admin, 'POST', '', { location_name: name('Studio-Lane'), location_id: atTwo })
    assert.equal(added.status, 201)
    const mapping = (await added.json()) as Record<string, any>
    assert.equal(mapping.location_name, name('studio - lane'))
    assert.equal(mapping.location_id, atTwo)

    const again = await call(admin, 'POST', '', { location_name: name('Studio - Lane'), location_id: alsoAtTwo })
    assert.equal(again.status, 409)
    assert.equal(((await again.json()) as { error: string }).error, 'classpass_mapping_exists')

    const changed = await call(admin, 'PATCH', `/${mapping.id}`, { location_id: alsoAtTwo })
    assert.equal(changed.status, 200)
    assert.equal(((await changed.json()) as { location_id: string }).location_id, alsoAtTwo)

    const listed = await call(admin, 'GET', '')
    assert.equal(listed.status, 200)
    const list = ((await listed.json()) as { mappings: Record<string, any>[] }).mappings
    const row = list.find(m => m.id === mapping.id)
    assert.ok(row)
    assert.equal(row.location.archived_at, null)
    assert.equal(typeof row.location.name, 'string')
    assert.equal(list.some(m => m.id === northwinds.id), false, "northwind's mapping is not in acme's list")

    for (const [method, path, body] of [
      ['PATCH', `/${northwinds.id}`, { location_id: atTwo }],
      ['DELETE', `/${northwinds.id}`, undefined],
    ] as const) {
      const res = await call(admin, method, path, body)
      assert.equal(res.status, 404)
      assert.equal(((await res.json()) as { error: string }).error, 'classpass_mapping_not_found')
    }

    for (const [method, path, body] of [
      ['GET', '', undefined],
      ['POST', '', { location_name: name('Instructor'), location_id: atTwo }],
      ['PATCH', `/${mapping.id}`, { location_id: atTwo }],
      ['DELETE', `/${mapping.id}`, undefined],
    ] as const) {
      assert.equal((await call(instructor, method, path, body)).status, 403)
    }

    const removed = await call(admin, 'DELETE', `/${mapping.id}`)
    assert.equal(removed.status, 204)
    const remaining = await mappings.listClassPassLocationMappings(two.id)
    assert.equal(remaining.some(m => m.id === mapping.id), false)
    assert.equal(
      (await mappings.listClassPassLocationMappings(one.id)).some(m => m.id === northwinds.id),
      true,
      "northwind's mapping is untouched",
    )
  })
})
