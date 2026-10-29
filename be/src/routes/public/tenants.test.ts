import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from '../../test/harness'

const ARCHIVED_SLUG = 'ghoststudio'

describe('public slug resolution', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let tenants: typeof import('../../db/schema/tenancy')['tenants']

  before(async () => {
    harness = await startTestApp()
    // Imported after the harness has pointed DATABASE_URL at the scratch
    // database — a static import would bind the dev pool instead.
    ;({ tenants } = await import('../../db/schema/tenancy'))

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
    assert.equal(body.tenant.name, 'Northwind Yoga')
    assert.equal(body.tenant.timezone, 'Asia/Singapore')
    assert.equal(body.tenant.status, 'active')
    assert.equal(body.settings.display_name, 'Northwind Yoga')
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

  test('a row written without a tenant is refused, not quietly claimed', async () => {
    const { classTypes } = await import('../../db/schema/catalog')

    // `tenant_id` has no default and no pass claims a stray null, so an insert
    // that does not name its tenant fails at the database instead of filing
    // somebody else's row under the first tenant.
    await assert.rejects(
      () =>
        harness.db
          .insert(classTypes)
          .values({ name: 'Unclaimed Test Type', tenantId: null as unknown as string })
          .returning(),
      // Drizzle wraps the driver error, so the constraint name is on the cause.
      (err: { cause?: { message?: string } }) => /not[- ]null/i.test(err.cause?.message ?? ''),
    )

    const leftovers = await harness.db
      .select({ id: classTypes.id })
      .from(classTypes)
      .where(eq(classTypes.name, 'Unclaimed Test Type'))
    assert.equal(leftovers.length, 0)
  })

  test('a public route reached without a tenant is refused', async () => {
    // A public route is public
    // about *a studio* — there is no platform-wide list of locations to return —
    // so a request that names none is asking a question with no answer.
    const res = await harness.app.request('/api/v1/public/locations')
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'tenant_required' })
  })
})
