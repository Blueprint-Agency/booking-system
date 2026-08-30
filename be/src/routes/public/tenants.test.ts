import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from '../../test/harness'

const ARCHIVED_SLUG = 'ghoststudio'

describe('public slug resolution', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let tenants: typeof import('../../db/schema/tenancy')['tenants']
  let createTenant: typeof import('../../services/tenants/tenants')['createTenant']

  before(async () => {
    harness = await startTestApp()
    // Imported after the harness has pointed DATABASE_URL at the scratch
    // database — a static import would bind the dev pool instead.
    ;({ tenants } = await import('../../db/schema/tenancy'))
    ;({ createTenant } = await import('../../services/tenants/tenants'))

    await harness.db
      .insert(tenants)
      .values({ slug: ARCHIVED_SLUG, name: 'Ghost Studio', status: 'archived' })
      .onConflictDoNothing()
  })

  after(async () => {
    // `before` may have thrown (bad TEST_DATABASE_URL, failed migration) — don't
    // mask the real failure with a TypeError in the teardown.
    if (!harness) return
    await harness.db.delete(tenants).where(eq(tenants.slug, ARCHIVED_SLUG))
    await harness.close()
  })

  test('the fixture holds two tenants — one cannot reveal a leak', async () => {
    const rows = await harness.db.select({ slug: tenants.slug }).from(tenants)
    const slugs = rows.map(r => r.slug)
    assert.ok(slugs.includes(harness.tenants.one.slug))
    assert.ok(slugs.includes(harness.tenants.two.slug))
    assert.notEqual(harness.tenants.one.id, harness.tenants.two.id)
  })

  test('resolves tenant #1 by slug', async () => {
    const res = await harness.app.request(`/api/v1/public/tenants/by-slug/${harness.tenants.one.slug}`)
    assert.equal(res.status, 200)

    const body = (await res.json()) as { tenant: Record<string, unknown>; settings: Record<string, unknown> }
    assert.equal(body.tenant.id, harness.tenants.one.id)
    assert.equal(body.tenant.slug, harness.tenants.one.slug)
    assert.equal(body.tenant.name, 'Yoga Sadhana')
    assert.equal(body.tenant.timezone, 'Asia/Singapore')
    assert.equal(body.tenant.status, 'active')
    assert.equal(body.settings.display_name, 'Yoga Sadhana')
    // No mail-from identity or waiver text on a public, cached endpoint.
    assert.ok(!('mail_from_email' in body.settings))
    assert.ok(!('waiver_text' in body.settings))
  })

  test('resolves the second tenant to itself, not to tenant #1', async () => {
    const res = await harness.app.request(`/api/v1/public/tenants/by-slug/${harness.tenants.two.slug}`)
    assert.equal(res.status, 200)

    const body = (await res.json()) as { tenant: { id: string; slug: string; timezone: string } }
    assert.equal(body.tenant.id, harness.tenants.two.id)
    assert.equal(body.tenant.slug, harness.tenants.two.slug)
    assert.notEqual(body.tenant.id, harness.tenants.one.id)
    assert.notEqual(body.tenant.timezone, 'Asia/Singapore')
  })

  test('is unauthenticated and cacheable — it sits on every request path', async () => {
    const res = await harness.app.request(`/api/v1/public/tenants/by-slug/${harness.tenants.one.slug}`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('cache-control') ?? '', /max-age=\d+/)
  })

  test('404s an unknown slug without disclosing which slugs exist', async () => {
    const unknown = await harness.app.request('/api/v1/public/tenants/by-slug/no-such-studio')
    assert.equal(unknown.status, 404)
    const unknownBody = await unknown.text()
    assert.deepEqual(JSON.parse(unknownBody), { error: 'not_found' })

    // A reserved slug, an archived tenant and a malformed slug are all
    // answered identically — byte for byte — so the response cannot be used to
    // enumerate tenants.
    const bodies = await Promise.all(
      ['admin', ARCHIVED_SLUG, 'Not A Slug!'].map(async slug => {
        const res = await harness.app.request(
          `/api/v1/public/tenants/by-slug/${encodeURIComponent(slug)}`,
        )
        assert.equal(res.status, 404)
        return res.text()
      }),
    )
    for (const body of bodies) assert.equal(body, unknownBody)
  })

  test('tenant creation refuses a reserved slug', async () => {
    await assert.rejects(
      () => createTenant({ slug: 'admin', name: 'Impostor' }),
      (err: { code?: string; status?: number }) => {
        assert.equal(err.code, 'slug_reserved')
        assert.equal(err.status, 400)
        return true
      },
    )
    const rows = await harness.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'admin'))
    assert.equal(rows.length, 0)
  })

  test('the seed claims rows a seeder wrote without a tenant', async () => {
    const { claimSeededRowsForTenantOne } = await import('../../db/seed/claim-tenant-one')
    const { classTypes } = await import('../../db/schema/catalog')

    // `tenant_id` now defaults to tenant #1 (migration 0029), so an unclaimed
    // row has to be written as an explicit null — which is what a row inserted
    // before that migration, or by anything bypassing the default, looks like.
    const [row] = await harness.db
      .insert(classTypes)
      .values({ name: 'Unclaimed Test Type', tenantId: null })
      .returning()
    assert.ok(row)
    assert.equal(row.tenantId, null)

    try {
      await claimSeededRowsForTenantOne(harness.db)
      const [claimed] = await harness.db
        .select()
        .from(classTypes)
        .where(eq(classTypes.id, row.id))
      assert.equal(claimed?.tenantId, harness.tenants.one.id)
    } finally {
      await harness.db.delete(classTypes).where(eq(classTypes.id, row.id))
    }
  })

  test('existing behaviour is unchanged — a pre-tenancy public route still answers', async () => {
    const res = await harness.app.request('/api/v1/public/locations')
    assert.equal(res.status, 200)
    const body = (await res.json()) as { locations: unknown[] }
    assert.ok(Array.isArray(body.locations))
  })
})
