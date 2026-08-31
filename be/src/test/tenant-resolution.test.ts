import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from './harness'

/**
 * The forged header, end to end.
 *
 * `X-Tenant-Slug` is set by our own proxies, and a proxy is one forged header
 * away from being impersonated — so the backend treats it as a claim to be
 * corroborated, never as a fact. This file is the proof for the corroboration a
 * public request can carry: the browser's own `Origin`, which under the
 * subdomain scheme contains the tenant and which a page cannot lie about.
 *
 * The authenticated half — the Clerk organization claim — is proven in
 * `services/tenants/org-claim.test.ts`, on the pure decision itself, because
 * this harness cannot mint a Clerk JWT to drive the middleware with.
 */
describe('tenant resolution', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  /** A location named after its studio, so a leak is legible in the response. */
  const NAME = (slug: string) => `probe-location-${slug}`

  before(async () => {
    harness = await startTestApp()
    one = harness.tenants.one
    two = harness.tenants.two

    const { locations } = await import('../db/schema/catalog')
    for (const tenant of [one, two]) {
      await harness.db
        .insert(locations)
        .values({ tenantId: tenant.id, name: NAME(tenant.slug), address: '1 Probe Road' })
        .onConflictDoNothing()
    }
  })

  after(async () => {
    if (!harness) return
    const { locations } = await import('../db/schema/catalog')
    for (const tenant of [one, two]) {
      await harness.db.delete(locations).where(eq(locations.name, NAME(tenant.slug)))
    }
    await harness.close()
  })

  const names = async (res: Response) => {
    const body = (await res.json()) as { locations: Array<{ name: string }> }
    return body.locations.map(l => l.name)
  }

  const clientOrigin = (slug: string) => `http://${slug}.localhost:3000`

  test('the header alone reaches only that tenant', async () => {
    const res = await harness.app.request('/api/v1/public/locations', {
      headers: { 'X-Tenant-Slug': two.slug },
    })
    assert.equal(res.status, 200)
    const found = await names(res)
    assert.ok(found.includes(NAME(two.slug)))
    assert.ok(!found.includes(NAME(one.slug)))
  })

  test('a header that disagrees with the Origin is refused', async () => {
    // The page is served from studio two and asks for studio one's data.
    const res = await harness.app.request('/api/v1/public/locations', {
      headers: { 'X-Tenant-Slug': one.slug, Origin: clientOrigin(two.slug) },
    })
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'tenant_mismatch' })
  })

  test('a forged header cannot reach the other tenant, in either direction', async () => {
    for (const [header, origin] of [
      [one.slug, two.slug],
      [two.slug, one.slug],
    ] as const) {
      const res = await harness.app.request('/api/v1/public/locations', {
        headers: { 'X-Tenant-Slug': header, Origin: clientOrigin(origin) },
      })
      assert.equal(res.status, 403)
      // Nothing about the other studio came back — not even a hint that the
      // slug it named exists.
      assert.deepEqual(await res.json(), { error: 'tenant_mismatch' })
    }
  })

  test('the refusal does not depend on the forged slug being real', async () => {
    // A header naming a studio that does not exist is refused identically to
    // one naming a studio that does, so the response cannot be used to find out
    // which slugs are taken.
    const invented = await harness.app.request('/api/v1/public/locations', {
      headers: { 'X-Tenant-Slug': 'no-such-studio', Origin: clientOrigin(two.slug) },
    })
    assert.equal(invented.status, 403)
    assert.deepEqual(await invented.json(), { error: 'tenant_mismatch' })
  })

  test('the header agreeing with the Origin is the ordinary path', async () => {
    const res = await harness.app.request('/api/v1/public/locations', {
      headers: { 'X-Tenant-Slug': two.slug, Origin: clientOrigin(two.slug) },
    })
    assert.equal(res.status, 200)
    const found = await names(res)
    assert.ok(found.includes(NAME(two.slug)))
    assert.ok(!found.includes(NAME(one.slug)))
  })

  test('the Origin alone resolves the tenant, with no header at all', async () => {
    // A browser on `acme.localhost:3000` is unambiguously asking about acme,
    // whether or not the proxy stamped its header.
    const res = await harness.app.request('/api/v1/public/locations', {
      headers: { Origin: clientOrigin(two.slug) },
    })
    assert.equal(res.status, 200)
    const found = await names(res)
    assert.ok(found.includes(NAME(two.slug)))
    assert.ok(!found.includes(NAME(one.slug)))
  })

  test('an origin that names no tenant refuses nothing', async () => {
    // The proxy's own server-side calls send no `Origin` at all, and the bare
    // local origin names no studio. Neither is evidence, so neither may refuse
    // a slug — the header stands on its own.
    const headerSets: Record<string, string>[] = [
      { 'X-Tenant-Slug': two.slug },
      { 'X-Tenant-Slug': two.slug, Origin: 'http://localhost:3000' },
      // An origin we do not recognise at all is in the same position: CORS has
      // already refused the browser, and it says nothing about the tenant.
      { 'X-Tenant-Slug': two.slug, Origin: 'https://evil.example.com' },
    ]
    for (const headers of headerSets) {
      const res = await harness.app.request('/api/v1/public/locations', { headers })
      assert.equal(res.status, 200)
      assert.ok((await names(res)).includes(NAME(two.slug)))
    }
  })

  test('the portal origin names the tenant the same way', async () => {
    const res = await harness.app.request('/api/v1/public/locations', {
      headers: { 'X-Tenant-Slug': one.slug, Origin: `http://${two.slug}.portal.localhost:3001` },
    })
    assert.equal(res.status, 403)
  })

  test('CORS admits a tenant subdomain that did not exist at deploy time', async () => {
    // The point of the pattern: `whoever.localhost:3000` is allowlisted without
    // anyone having listed it, because a studio is created by inserting a row.
    const res = await harness.app.request('/api/v1/public/locations', {
      headers: { Origin: 'http://whoever.localhost:3000' },
    })
    // 404 — the slug resolves to no tenant — but the CORS header proves the
    // origin itself was admitted.
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://whoever.localhost:3000')
    assert.equal(res.status, 404)
  })

  test('a header nobody corroborated may not provision a membership', async () => {
    // The hole this closes: reads are fenced by the policies, so a forged header
    // finds nothing — and the middleware would then have treated "no row" as "a
    // new member", writing one into the studio the header named. A valid token
    // for studio A plus `X-Tenant-Slug: B` would have bought a membership at B.
    //
    // Driven one layer below HTTP, because this harness cannot mint a Clerk JWT:
    // the gate itself is what is under test, on the two facts the middleware
    // reads.
    const { Hono } = await import('hono')
    const { resolveTenant, tenantCorroborated, tenantId } = await import('../middleware/tenant')

    const probe = new Hono()
    probe.use('*', resolveTenant)
    probe.get('/probe', c =>
      c.json({ tenantId: tenantId(c), corroborated: tenantCorroborated(c) }),
    )

    const ask = async (headers: Record<string, string>) => {
      const res = await probe.request('/probe', { headers })
      return res.json() as Promise<{ tenantId: string; corroborated: boolean }>
    }

    // The header on its own vouches for nothing — provisioning is refused.
    assert.deepEqual(await ask({ 'X-Tenant-Slug': two.slug }), {
      tenantId: two.id,
      corroborated: false,
    })

    // The browser's own origin agreeing with it does.
    assert.deepEqual(
      await ask({ 'X-Tenant-Slug': two.slug, Origin: clientOrigin(two.slug) }),
      { tenantId: two.id, corroborated: true },
    )

    // And a request that claimed nothing has nothing to have forged, so the
    // pre-tenancy path provisions exactly as it always did.
    assert.deepEqual(await ask({}), { tenantId: one.id, corroborated: true })
  })

  test('an origin outside every pattern gets no CORS header', async () => {
    const res = await harness.app.request('/api/v1/public/locations', {
      headers: { Origin: 'https://evil.example.com' },
    })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  })
})
