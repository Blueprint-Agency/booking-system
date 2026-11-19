import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.public-entities.test`
// Every name this file writes carries `run`, so a list is read for this file's
// rows only: other files add packages and Entities to the same two studios.
const TAG = `Entities ${run}`

type Ref = { id: string; name: string; slug: string }
type PublicEntity = Ref & { has_live_packages: boolean }

/**
 * The member app's package menu over real HTTP: the studio's Entities read by a
 * visitor, and the package reads that name each package's Entity and narrow to
 * one by its slug. Both studios get the same shape of fixture so every read is
 * also checked for the other studio's rows.
 *
 * Written from the CAT rows of the Scenario Inventory
 * (`docs/md/test-scenarios.md`), ticket #561 of spec #554.
 */
describe('public Entities and the package reads by Entity over HTTP', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  type Studio = {
    id: string
    slug: string
    /** Live and shown in this order, though `reformer` is made first. */
    mat: Ref
    reformer: Ref
    /** Live, but every package in it is archived or removed. */
    empty: Ref
    /** Archived: it has left every menu. */
    retired: Ref
    packages: { matClass: string; matPt: string; matCorporate: string; reformerClass: string; archived: string; removedPt: string }
    member: Record<string, string>
  }

  let one!: Studio
  let two!: Studio

  /** What the member app on `tenant`'s hostname sends when nobody is signed in. */
  const visitor = (tenant: { slug: string }): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('client', tenant),
    'X-Forwarded-For': harnessAddress(),
  })

  async function get(path: string, headers: Record<string, string>) {
    const res = await harness.app.request(path, { headers })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, text }
  }

  async function getOk(path: string, headers: Record<string, string>) {
    const res = await get(path, headers)
    assert.equal(res.status, 200, res.text)
    return res.body
  }

  /** This file's Entities out of a public list, in the order the studio shows them. */
  const ours = (list: PublicEntity[]) => list.filter(e => e.name.startsWith(TAG))

  async function studio(tenant: { id: string; slug: string }): Promise<Studio> {
    const entity = async (name: string, position: number, archived = false): Promise<Ref> => {
      const slug = `${run}-${name.toLowerCase()}-${tenant.slug}`
      const [row] = await harness.db
        .insert(schema.entities)
        .values({ tenantId: tenant.id, name: `${TAG} ${name}`, slug, position, archivedAt: archived ? new Date() : null })
        .returning({ id: schema.entities.id })
      return { id: row!.id, name: `${TAG} ${name}`, slug }
    }
    // Made out of display order on purpose: the order read back is by position.
    const reformer = await entity('Reformer', 102)
    const mat = await entity('Mat', 101)
    const empty = await entity('Empty', 104)
    const retired = await entity('Retired', 103, true)

    const email = `staff-${tenant.slug}@${DOMAIN}`
    const { ensureAuthUser } = await import('../services/auth/auth-users')
    const authUserId = await ensureAuthUser(harness.db, 'staff', { email, name: 'Staff', tenantId: tenant.id })
    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: `Staff ${run}`, role: 'admin', status: 'active', authUserId })
      .returning({ id: schema.staffUsers.id })

    const classPackage = async (name: string, entityId: string, status: 'active' | 'archived' = 'active') => {
      const [row] = await harness.db
        .insert(schema.classPackages)
        .values({
          tenantId: tenant.id,
          entityId,
          name: `${TAG} ${tenant.slug} ${name}`,
          kind: 'credit_bundle',
          credits: 10,
          validityDays: 90,
          priceSgd: '200.00',
          status,
        })
        .returning({ id: schema.classPackages.id })
      return row!.id
    }
    const ptPackage = async (name: string, entityId: string, removed = false) => {
      const [row] = await harness.db
        .insert(schema.ptPackages)
        .values({
          tenantId: tenant.id,
          entityId,
          name: `${TAG} ${tenant.slug} ${name}`,
          sessionType: '1on1',
          numSessions: 5,
          validityDays: 90,
          priceSgd: '400.00',
          // A package is removed only after it is archived.
          status: removed ? 'archived' : 'active',
          deletedAt: removed ? new Date() : null,
        })
        .returning({ id: schema.ptPackages.id })
      return row!.id
    }
    const corporatePackage = async (name: string, entityId: string) => {
      const [row] = await harness.db
        .insert(schema.corporatePackages)
        .values({
          tenantId: tenant.id,
          entityId,
          name: `${TAG} ${tenant.slug} ${name}`,
          priceSgd: '900.00',
          status: 'active',
          createdByStaffId: staff!.id,
        })
        .returning({ id: schema.corporatePackages.id })
      return row!.id
    }

    const memberEmail = `member-${tenant.slug}@${DOMAIN}`
    const member = await harness.signInAs('client', memberEmail, tenant)
    const [user] = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, memberEmail))
    await harness.db
      .insert(schema.clients)
      .values({ tenantId: tenant.id, email: memberEmail, name: 'Member', phone: '+6580000001', authUserId: user!.id })

    return {
      ...tenant,
      mat,
      reformer,
      empty,
      retired,
      packages: {
        matClass: await classPackage('Mat ten', mat.id),
        matPt: await ptPackage('Mat PT', mat.id),
        matCorporate: await corporatePackage('Mat team', mat.id),
        reformerClass: await classPackage('Reformer ten', reformer.id),
        archived: await classPackage('Retired ten', empty.id, 'archived'),
        removedPt: await ptPackage('Removed PT', empty.id, true),
      },
      member,
    }
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    one = await studio(harness.tenants.one)
    two = await studio(harness.tenants.two)
  })

  after(async () => {
    if (!harness) return
    const tagged = `${TAG}%`
    const email = `%@${DOMAIN}`
    await harness.db.execute(sql`DELETE FROM class_packages WHERE name LIKE ${tagged}`)
    await harness.db.execute(sql`DELETE FROM pt_packages WHERE name LIKE ${tagged}`)
    await harness.db.execute(sql`DELETE FROM corporate_packages WHERE name LIKE ${tagged}`)
    await harness.db.execute(sql`DELETE FROM entities WHERE name LIKE ${tagged}`)
    await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${email}`)
    await harness.db.execute(sql`DELETE FROM client_auth_users WHERE email LIKE ${email}`)
    await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${email}`)
    await harness.db.execute(sql`DELETE FROM staff_auth_users WHERE email LIKE ${email}`)
    await harness.close()
  })

  test('CAT-14 a visitor reads the studio\'s live Entities in display order, each with its slug and whether it has packages on sale', async () => {
    for (const at of [one, two]) {
      const { entities } = await getOk('/api/v1/public/entities', visitor(at))
      const mine = ours(entities)
      assert.deepEqual(
        mine.map(e => e.id),
        [at.mat.id, at.reformer.id, at.empty.id],
        'ordered by position, not by when each was made; the archived one is absent',
      )
      assert.deepEqual(
        mine.map(e => e.slug),
        [at.mat.slug, at.reformer.slug, at.empty.slug],
      )
      assert.deepEqual(
        mine.map(e => e.has_live_packages),
        [true, true, false],
        'an Entity whose packages are all archived or removed has none on sale',
      )
      assert.deepEqual(Object.keys(mine[0]!).sort(), ['has_live_packages', 'id', 'name', 'slug'])
      assert.ok(!entities.some((e: PublicEntity) => e.id === at.retired.id), 'an archived Entity has left the menu')
    }
  })

  test('CAT-14 an Entity counts as live for a corporate package alone, and stops when that package is archived', async () => {
    const [corporateOnly] = await harness.db
      .insert(schema.entities)
      .values({ tenantId: one.id, name: `${TAG} Corporate only`, slug: `${run}-corporate-only`, position: 105 })
      .returning({ id: schema.entities.id })
    const [staff] = await harness.db.select({ id: schema.staffUsers.id }).from(schema.staffUsers).where(eq(schema.staffUsers.email, `staff-${one.slug}@${DOMAIN}`))
    const [pkg] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId: one.id, entityId: corporateOnly!.id, name: `${TAG} Only corporate`, priceSgd: '500.00', status: 'active', createdByStaffId: staff!.id })
      .returning({ id: schema.corporatePackages.id })

    const flag = async () => {
      const { entities } = await getOk('/api/v1/public/entities', visitor(one))
      return (entities as PublicEntity[]).find(e => e.id === corporateOnly!.id)?.has_live_packages
    }
    assert.equal(await flag(), true)
    await harness.db.update(schema.corporatePackages).set({ status: 'archived' }).where(eq(schema.corporatePackages.id, pkg!.id))
    assert.equal(await flag(), false)
  })

  test('CAT-15 every package the public and the signed-in reads return names its Entity, class, PT and corporate alike', async () => {
    const at = one
    const publicPackages = await getOk('/api/v1/public/packages', visitor(at))
    const publicCorporate = await getOk('/api/v1/public/corporate-packages', visitor(at))
    const memberClass = await getOk('/api/v1/me/class-packages', at.member)
    const memberPt = await getOk('/api/v1/me/pt-packages', at.member)
    const memberCorporate = await getOk('/api/v1/me/corporate-packages', at.member)

    const entityOf = (list: any[], id: string) => list.find(p => p.id === id)?.entity
    assert.deepEqual(entityOf(publicPackages.class_packages, at.packages.matClass), at.mat)
    assert.deepEqual(entityOf(publicPackages.class_packages, at.packages.reformerClass), at.reformer)
    assert.deepEqual(entityOf(publicPackages.pt_packages, at.packages.matPt), at.mat)
    assert.deepEqual(entityOf(publicCorporate.corporate_packages, at.packages.matCorporate), at.mat)
    assert.deepEqual(entityOf(memberClass.class_packages, at.packages.matClass), at.mat)
    assert.deepEqual(entityOf(memberPt.pt_packages, at.packages.matPt), at.mat)
    assert.deepEqual(entityOf(memberCorporate.corporate_packages, at.packages.matCorporate), at.mat)
  })

  test('CAT-16 the Entity slug narrows the class, PT and corporate package reads to that Entity, in any casing', async () => {
    for (const at of [one, two]) {
      for (const slug of [at.mat.slug, at.mat.slug.toUpperCase()]) {
        const q = `?entity=${encodeURIComponent(slug)}`
        const packages = await getOk(`/api/v1/public/packages${q}`, visitor(at))
        const corporate = await getOk(`/api/v1/public/corporate-packages${q}`, visitor(at))
        assert.deepEqual(
          packages.class_packages.map((p: { id: string }) => p.id),
          [at.packages.matClass],
        )
        assert.deepEqual(
          packages.pt_packages.map((p: { id: string }) => p.id),
          [at.packages.matPt],
        )
        assert.deepEqual(
          corporate.corporate_packages.map((p: { id: string }) => p.id),
          [at.packages.matCorporate],
        )
      }
      const reformer = await getOk(`/api/v1/public/packages?entity=${at.reformer.slug}`, visitor(at))
      assert.deepEqual(
        reformer.class_packages.map((p: { id: string }) => p.id),
        [at.packages.reformerClass],
      )
      assert.deepEqual(reformer.pt_packages, [])
    }
  })

  test('CAT-16 with no slug the reads still list every Entity\'s packages, so a browser not yet redeployed sees what it saw before', async () => {
    const packages = await getOk('/api/v1/public/packages', visitor(one))
    const ids = packages.class_packages.map((p: { id: string }) => p.id)
    assert.ok(ids.includes(one.packages.matClass) && ids.includes(one.packages.reformerClass))
    const blank = await getOk('/api/v1/public/packages?entity=', visitor(one))
    assert.deepEqual(blank, packages, 'an empty slug is no filter')
  })

  test('CAT-17 a slug that names no live Entity of the studio answers 200 with nothing, never an error and never another Entity\'s packages', async () => {
    const at = one
    for (const slug of [`${run}-nothing-by-this-name`, at.retired.slug, two.mat.slug]) {
      const q = `?entity=${encodeURIComponent(slug)}`
      const packages = await getOk(`/api/v1/public/packages${q}`, visitor(at))
      assert.deepEqual(packages, { class_packages: [], pt_packages: [] }, slug)
      assert.deepEqual(await getOk(`/api/v1/public/corporate-packages${q}`, visitor(at)), { corporate_packages: [] }, slug)
      assert.deepEqual((await getOk(`/api/v1/me/class-packages${q}`, at.member)).class_packages, [], slug)
      assert.deepEqual(await getOk(`/api/v1/me/pt-packages${q}`, at.member), { pt_packages: [] }, slug)
      assert.deepEqual(await getOk(`/api/v1/me/corporate-packages${q}`, at.member), { corporate_packages: [] }, slug)
    }
  })

  test('CAT-17 a slug longer than any Entity\'s is refused as a bad request', async () => {
    const res = await get(`/api/v1/public/packages?entity=${'a'.repeat(200)}`, visitor(one))
    assert.equal(res.status, 400, res.text)
  })

  test('CAT-18 a signed-in member and a visitor are shown the same packages for the same Entity', async () => {
    for (const at of [one, two]) {
      for (const entity of [at.mat, at.reformer]) {
        const q = `?entity=${entity.slug}`
        const publicPackages = await getOk(`/api/v1/public/packages${q}`, visitor(at))
        const memberClass = await getOk(`/api/v1/me/class-packages${q}`, at.member)
        const memberPt = await getOk(`/api/v1/me/pt-packages${q}`, at.member)
        const ids = (list: { id: string }[]) => list.map(p => p.id).sort()
        assert.deepEqual(ids(memberClass.class_packages), ids(publicPackages.class_packages))
        assert.deepEqual(ids(memberPt.pt_packages), ids(publicPackages.pt_packages))
        const publicCorporate = await getOk(`/api/v1/public/corporate-packages${q}`, visitor(at))
        const memberCorporate = await getOk(`/api/v1/me/corporate-packages${q}`, at.member)
        assert.deepEqual(ids(memberCorporate.corporate_packages), ids(publicCorporate.corporate_packages))
      }
    }
  })

  test('CAT-19 one studio never reads the other\'s Entities or packages by Entity, however the slug is spelt', async () => {
    for (const [at, other] of [
      [one, two],
      [two, one],
    ] as const) {
      const { entities } = await getOk('/api/v1/public/entities', visitor(at))
      const ids = (entities as PublicEntity[]).map(e => e.id)
      assert.ok(ids.includes(at.mat.id))
      assert.ok(!ids.includes(other.mat.id) && !ids.includes(other.reformer.id) && !ids.includes(other.empty.id))

      const packages = await getOk('/api/v1/public/packages', visitor(at))
      const everyId = [...packages.class_packages, ...packages.pt_packages].map((p: { id: string }) => p.id)
      assert.ok(!everyId.includes(other.packages.matClass) && !everyId.includes(other.packages.matPt))
      for (const p of [...packages.class_packages, ...packages.pt_packages]) {
        assert.ok(!p.entity || p.entity.id !== other.mat.id)
      }
    }
  })
})
