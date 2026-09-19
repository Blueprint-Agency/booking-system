import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, inTenantContext, type TestApp } from './harness'

const OPERATOR = 'mindbody-operator@platform.test'
process.env.PLATFORM_ADMIN_EMAILS = OPERATOR

/**
 * The Mindbody migration's first slice, end to end, at the one seam that
 * matters: fixture reports and a fixture config go through the transform, the
 * zip goes through the super portal's own import route into a Tenant
 * provisioned the way the runbook says (no first admin), and everything after
 * that is asked of the platform the way a member, an admin or the operator
 * would ask it. Nothing here reads the transform's row JSON.
 *
 * The fixture studio and its people are invented (`src/mindbody/fixtures`).
 */
describe('a Mindbody studio, transformed and imported', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let tenants!: typeof import('../services/tenants/tenants')
  let transform!: typeof import('../mindbody/transform')
  let ensureAuthUser!: typeof import('../services/auth/auth-users')['ensureAuthUser']
  let operator!: Record<string, string>

  const FIXTURES = path.join(__dirname, '..', 'mindbody', 'fixtures')
  const run = Date.now().toString(36)
  let studios = 0

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    tenants = await import('../services/tenants/tenants')
    transform = await import('../mindbody/transform')
    ;({ ensureAuthUser } = await import('../services/auth/auth-users'))
    operator = await harness.signInAs('platform', OPERATOR, null)
  })

  after(async () => {
    await harness?.close()
  })

  /** The fixture, transformed for one Tenant. */
  async function transformFor(tenant: { id: string; slug: string }) {
    const config = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as Record<string, any>
    config.studio.slug = tenant.slug
    // The links in the email copy are this environment's, as they would be on staging.
    config.originPatterns = process.env.TENANT_ORIGIN_PATTERNS
    return transform.transformMindbody({ reportsDir: path.join(FIXTURES, 'reports'), config, tenantId: tenant.id })
  }

  /** A Tenant provisioned the way the runbook says — no first admin — and the fixture transformed for it. */
  async function transformedStudio() {
    const slug = `mb-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Mindbody Fixture Studio' })
    return { tenant, slug, ...(await transformFor(tenant)) }
  }

  async function importZip(tenantId: string, zip: Buffer) {
    const form = new FormData()
    form.append('archive', new File([new Uint8Array(zip)], 'studio.zip', { type: 'application/zip' }))
    const res = await harness.app.request(`/api/v1/platform/tenants/${tenantId}/import`, {
      method: 'POST',
      headers: operator,
      body: form,
    })
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }

  const get = (url: string, headers: Record<string, string>) => harness.app.request(url, { headers })
  const post = (url: string, headers: Record<string, string>) =>
    harness.app.request(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })

  const count = async (table: string, tenantId: string) => {
    const [row] = await harness.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`,
    )
    return row!.n
  }

  test('the zip imports into a freshly provisioned studio, which opens, and its people can sign in', async () => {
    // A member who is already on the platform — at another studio, say — has
    // an account before the import. The import must reuse it, not make another.
    const existing = await ensureAuthUser(harness.db, 'client', { email: 'ada.reuse@example.test', name: 'Ada Reuse' })

    const studio = await transformedStudio()
    assert.equal((await tenants.loadTenantById(studio.tenant.id))?.status, 'suspended')

    const imported = await importZip(studio.tenant.id, studio.zip)
    assert.equal(imported.status, 200, JSON.stringify(imported.body))
    assert.equal(imported.body.opened, true, 'the archive brought an admin, so the studio opens')
    assert.equal(imported.body.remapped, false, 'ids are kept as the transform wrote them')
    assert.equal((await tenants.loadTenantById(studio.tenant.id))?.status, 'active')

    // A member signs in with the email they used at the studio, and is themselves.
    const jane = await harness.signInAs('client', 'jane.doe@example.test', studio)
    const me = await get('/api/v1/me', jane)
    assert.equal(me.status, 200, await me.clone().text())
    assert.equal(((await me.json()) as { name: string }).name, 'Jane Doe')

    const [ada] = await harness.db
      .select({ authUserId: schema.clients.authUserId })
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, studio.tenant.id), eq(schema.clients.email, 'ada.reuse@example.test')))
    assert.equal(ada?.authUserId, existing, 'an email already on the platform keeps its one account')

    // The owner is an active Admin from the first minute.
    const owner = await harness.signInAs('staff', 'owner@example.test', studio)
    const ownerMe = await get('/api/v1/portal/auth/me', owner)
    assert.equal(ownerMe.status, 200, await ownerMe.clone().text())
    assert.equal(((await ownerMe.json()) as { role: string }).role, 'admin')

    // Everyone else is pending, with an invitation the owner can resend.
    const listed = await get('/api/v1/portal/admin/staff', owner)
    assert.equal(listed.status, 200, await listed.clone().text())
    const { invitations } = (await listed.json()) as { invitations: { id: string; email: string; status: string }[] }
    assert.deepEqual(
      invitations.map(i => i.email).sort(),
      ['frank@example.test', 'ivy@example.test'],
    )
    const ivy = invitations.find(i => i.email === 'ivy@example.test')!
    const resent = await post(`/api/v1/portal/admin/staff/invitations/${ivy.id}/resend`, owner)
    assert.equal(resent.status, 200, await resent.clone().text())

    // A teacher who is only history is archived, and cannot get in.
    const oldTeacherEmail = studio.archive.rows.staff_users!.find(r => r.status === 'archived')!.email as string
    const oldTeacher = await harness.signInAs('staff', oldTeacherEmail, studio)
    const refused = await get('/api/v1/portal/auth/me', oldTeacher)
    assert.equal(refused.status, 403, await refused.clone().text())

    // The studio shell.
    const rooms = await harness.db
      .select({ name: schema.rooms.name, capacity: schema.rooms.capacity })
      .from(schema.rooms)
      .where(eq(schema.rooms.tenantId, studio.tenant.id))
    assert.deepEqual(
      rooms.map(r => `${r.name}:${r.capacity}`).sort(),
      ['Hot Room:15', 'Riverside Studio:12', 'Studio 2 - Normal Room:20'],
    )
    assert.equal(await count('locations', studio.tenant.id), 2)
    assert.equal(await count('class_types', studio.tenant.id), 2)
    assert.equal(await count('email_templates', studio.tenant.id), 33)
    assert.equal(await count('clients', studio.tenant.id), 8)

    // A member cancellation reads the policy, and finds the studio's own.
    const policy = inTenantContext(await import('../services/policy/evaluate-cancellation'))
    const [client] = await harness.db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, studio.tenant.id), eq(schema.clients.email, 'jane.doe@example.test')))
    const verdict = await policy.evaluateCancellation({
      tenantId: studio.tenant.id,
      clientId: client!.id,
      kind: 'class',
      sessionStartsAt: new Date(Date.now() + 48 * 3_600_000),
      now: new Date(),
    })
    assert.equal(verdict.windowHours, 12)
  })

  test('the same archive without the ensure-accounts flag is refused, as a restore always was', async () => {
    const studio = await transformedStudio()
    studio.archive.manifest.ensureAccounts = false
    const { packArchive } = await import('../services/tenants/transfer-archive')
    const imported = await importZip(studio.tenant.id, await packArchive(studio.archive))
    assert.equal(imported.status, 409)
    assert.match(imported.body.message, /auth_user_id/)
    assert.equal(await count('clients', studio.tenant.id), 0)
  })

  test('an archive built for one slug is refused by a studio with another', async () => {
    const studio = await transformedStudio()
    const { tenant: other } = await provision.provisionTenant({ slug: `mb-${run}-other`, name: 'Another Fixture' })
    const imported = await importZip(other.id, studio.zip)
    assert.equal(imported.status, 409)
    assert.match(imported.body.message, /built for mb-/)
    assert.equal(await count('clients', other.id), 0)
  })

  test('a failed import leaves neither rows nor accounts behind', async () => {
    const fresh = `rollback-${run}@example.test`
    const studio = await transformedStudio()
    studio.archive.rows.clients![0]!.email = fresh
    // Two templates with one slug: refused by the unique key, long after every
    // member's account has been ensured.
    const templates = studio.archive.rows.email_templates!
    templates.push({ ...templates[0]!, id: '00000000-0000-4000-8000-00000000abcd' })
    studio.archive.manifest.counts.email_templates = templates.length
    const { packArchive } = await import('../services/tenants/transfer-archive')

    const imported = await importZip(studio.tenant.id, await packArchive(studio.archive))
    assert.equal(imported.status, 409, JSON.stringify(imported.body))

    for (const table of ['clients', 'staff_users', 'locations', 'email_templates']) {
      assert.equal(await count(table, studio.tenant.id), 0, `${table} must be empty after a failed import`)
    }
    const accounts = await harness.db
      .select({ id: schema.clientAuthUsers.id })
      .from(schema.clientAuthUsers)
      .where(eq(schema.clientAuthUsers.email, fresh))
    assert.deepEqual(accounts, [], 'no account outlives the import that made it')
    assert.equal((await tenants.loadTenantById(studio.tenant.id))?.status, 'suspended')

    // And the studio is still empty, so the operator can import again.
    const corrected = await transformFor(studio.tenant)
    assert.equal((await importZip(studio.tenant.id, corrected.zip)).status, 200)
  })
})
