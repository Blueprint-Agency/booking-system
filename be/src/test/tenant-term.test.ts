import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'
import { withEnv } from './with-env'

const run = Date.now().toString(36)
const OPERATOR = `operator-${run}@term.test`

/**
 * A studio's Term: start and end dates set from the super portal, and a studio
 * whose Term has ended treated as suspended from that moment — before the sweep
 * has written anything — and not reopened until the Term is extended.
 */
describe('tenant term', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  withEnv({ PLATFORM_ADMIN_EMAIL: OPERATOR })

  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let term!: typeof import('../services/tenants/term')
  let operator!: Record<string, string>

  const platform = (path: string, method: string, body?: unknown) =>
    harness.app.request(`/api/v1/platform${path}`, {
      method,
      headers: { Authorization: operator.Authorization!, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const expectStatus = async (res: Response, status: number, error?: string) => {
    const body = await res.text()
    assert.equal(res.status, status, body)
    if (error) assert.equal((JSON.parse(body) as { error: string }).error, error)
    return JSON.parse(body) as any
  }

  const stored = async (id: string) =>
    (await harness.db.select().from(schema.tenants).where(eq(schema.tenants.id, id)))[0]!

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    term = await import('../services/tenants/term')
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    if (!harness) return
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.close()
  })

  test('a new studio’s Term starts today on its own clock, and runs for the months picked', async () => {
    const created = await expectStatus(
      await platform('/tenants', 'POST', {
        slug: `term-new-${run}`,
        name: 'Term New',
        timezone: 'Pacific/Kiritimati',
        term_months: 6,
      }),
      201,
    )
    const today = term.localDate('Pacific/Kiritimati')
    assert.equal(created.tenant.term.start_date, today)
    assert.equal(created.tenant.term.end_date, term.termEndDate(today, 6))
    assert.equal(created.tenant.term.ended, false)

    // Without a duration the Term is open-ended.
    const open = await provision.provisionTenant({ slug: `term-open-${run}`, name: 'Term Open' })
    assert.equal(open.tenant.termEndDate, null)
    assert.equal(open.tenant.termStartDate, term.localDate('Asia/Singapore'))
  })

  test('the operator sets a start and a duration; the end is computed', async () => {
    const { tenant } = await provision.provisionTenant({ slug: `term-set-${run}`, name: 'Term Set' })

    const body = await expectStatus(
      await platform(`/tenants/${tenant.id}/term`, 'PUT', { start_date: '2026-08-31', months: 6 }),
      200,
    )
    assert.deepEqual(body.tenant.term, { start_date: '2026-08-31', end_date: '2027-02-28', ended: false })

    const list = await expectStatus(await platform('/tenants', 'GET'), 200)
    const row = list.tenants.find((t: { id: string }) => t.id === tenant.id)
    assert.deepEqual(row.term, body.tenant.term, 'the list shows the Term')

    await expectStatus(await platform(`/tenants/${tenant.id}/term`, 'PUT', { start_date: '2026-08-31', months: 4 }), 400)
    await expectStatus(await platform(`/tenants/${tenant.id}/term`, 'PUT', { start_date: '2026-02-30', months: 3 }), 400)
  })

  test('a studio whose Term has ended is suspended at once, and stays so until the Term is extended', async () => {
    const slug = `term-end-${run}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Term End', adminEmail: `owner@${slug}.test` })

    // Unauthenticated on purpose, as in the suspension test: an open studio
    // reaches the staff auth middleware and is refused for want of a token.
    const call = () => harness.app.request('/api/v1/portal/auth/me', { headers: { 'X-Tenant-Slug': slug } })
    assert.equal((await call()).status, 401)

    // A Term that ended long ago.
    const ended = await expectStatus(
      await platform(`/tenants/${tenant.id}/term`, 'PUT', { start_date: '2020-01-01', months: 3 }),
      200,
    )
    assert.equal(ended.tenant.term.ended, true)

    // Suspended from this moment — nothing has written it yet…
    assert.equal((await stored(tenant.id)).status, 'active')
    const refused = await call()
    assert.equal(refused.status, 403)
    assert.deepEqual(await refused.json(), { error: 'tenant_suspended', status: 'suspended' })
    const resolved = await expectStatus(await harness.app.request(`/api/v1/public/tenants/by-slug/${slug}`), 200)
    assert.equal(resolved.tenant.status, 'suspended', 'the frontends see a paused studio')

    // …and the sweep writes it down.
    const swept = await term.suspendEndedTerms()
    assert.ok(swept.some(t => t.id === tenant.id))
    assert.equal((await stored(tenant.id)).status, 'suspended')
    assert.equal((await term.suspendEndedTerms()).some(t => t.id === tenant.id), false, 'once')

    // Reactivating is refused while the Term is over.
    await expectStatus(
      await platform(`/tenants/${tenant.id}/status`, 'PATCH', { status: 'active' }),
      409,
      'tenant_term_ended',
    )

    // Extending the Term does not reopen the studio by itself…
    await expectStatus(
      await platform(`/tenants/${tenant.id}/term`, 'PUT', { start_date: term.localDate('Asia/Singapore'), months: 12 }),
      200,
    )
    assert.equal((await stored(tenant.id)).status, 'suspended')
    assert.equal((await call()).status, 403)

    // …the operator does, and then it is open.
    await expectStatus(await platform(`/tenants/${tenant.id}/status`, 'PATCH', { status: 'active' }), 200)
    assert.equal((await call()).status, 401)
  })

  test('a studio still inside its Term is left alone by the sweep', async () => {
    const { tenant } = await provision.provisionTenant({
      slug: `term-live-${run}`,
      name: 'Term Live',
      adminEmail: `owner@term-live-${run}.test`,
      termMonths: 3,
    })
    const swept = await term.suspendEndedTerms()
    assert.equal(swept.some(t => t.id === tenant.id), false)
    assert.equal((await stored(tenant.id)).status, 'active')
  })
})
