import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import {
  frontendOrigin,
  harnessAddress,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * A studio superadmin impersonates a member (#118), over real HTTP.
 *
 * The portal route creates a real `client` pool session for the member and a
 * BE-signed grant naming the superadmin behind it. The member app presents both;
 * `/me/*` then runs as the member with `impersonatedBy` set, and signing that
 * session out is what stops the impersonation.
 */
describe('member impersonation', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let one!: { id: string; slug: string }
  let two!: { id: string; slug: string }

  const run = Date.now().toString(36)
  const DOMAIN = `impersonation-${run}.test`
  const at = (name: string) => `${name}@${DOMAIN}`

  const send = (path: string, init: { body?: unknown; headers: Record<string, string>; method?: string }) =>
    harness.app.request(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    })

  const expectStatus = async (res: Response, status: number, error?: string) => {
    const body = await res.text()
    assert.equal(res.status, status, body)
    const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {}
    if (error) assert.equal(parsed.error ?? parsed.message, error)
    return parsed
  }

  const memberApp = (tenant: { slug: string }, token: string, grant?: string): Record<string, string> => ({
    'X-Tenant-Slug': tenant.slug,
    Origin: frontendOrigin('client', tenant),
    'X-Forwarded-For': harnessAddress(),
    Authorization: `Bearer ${token}`,
    ...(grant ? { 'X-Impersonation-Grant': grant } : {}),
  })

  /** A staff member of `tenant` with `role`, signed in on its portal. */
  const staffAt = async (tenant: { id: string; slug: string }, email: string, role: 'superadmin' | 'admin' | 'instructor') => {
    const headers = await harness.signInAs('staff', email, tenant)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: tenant.id, email, name: email, role, status: 'active', authUserId: user!.id })
      .returning()
    return { headers, row: row!, authUserId: user!.id }
  }

  /** A member of `tenant`, added through the portal so both rows exist. */
  const memberAt = async (tenant: { id: string }, admin: Record<string, string>, email: string) => {
    const created = await expectStatus(
      await send('/api/v1/portal/admin/clients', { body: { name: 'Ada Lovelace', email, phone: '+6591234567' }, headers: admin }),
      201,
    )
    const [row] = await harness.db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.tenantId, tenant.id), eq(schema.clients.id, created.id as string)))
    return row!
  }

  const impersonate = async (portal: Record<string, string>, clientId: string) => {
    const body = await expectStatus(
      await send(`/api/v1/portal/admin/clients/${clientId}/impersonate`, { body: {}, headers: portal }),
      200,
    )
    assert.equal(typeof body.token, 'string', 'the mint returns a session token')
    assert.equal(typeof body.grant, 'string', 'the mint returns a grant')
    return body as { token: string; grant: string; fe_client_url: string }
  }

  let superadmin!: Awaited<ReturnType<typeof staffAt>>
  let admin!: Awaited<ReturnType<typeof staffAt>>
  let instructor!: Awaited<ReturnType<typeof staffAt>>
  let superadminTwo!: Awaited<ReturnType<typeof staffAt>>

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    ;({ one, two } = harness.tenants)
    superadmin = await staffAt(one, at('superadmin'), 'superadmin')
    admin = await staffAt(one, at('admin'), 'admin')
    instructor = await staffAt(one, at('instructor'), 'instructor')
    superadminTwo = await staffAt(two, at('superadmin-two'), 'superadmin')
  })

  after(async () => {
    if (!harness) return
    const staff = await harness.db
      .select({ id: schema.staffUsers.id })
      .from(schema.staffUsers)
      .where(like(schema.staffUsers.email, `%@${DOMAIN}`))
    const staffIds = staff.map(s => s.id)
    const staffAuth = await harness.db
      .select({ id: schema.staffAuthUsers.id })
      .from(schema.staffAuthUsers)
      .where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    if (staffAuth.length) {
      await harness.db.delete(schema.authEvents).where(inArray(schema.authEvents.actorUserId, staffAuth.map(s => s.id)))
    }
    if (staffIds.length) await harness.db.delete(schema.auditLog).where(inArray(schema.auditLog.actorStaffId, staffIds))
    await harness.db.delete(schema.clients).where(like(schema.clients.email, `%@${DOMAIN}`))
    if (staffIds.length) await harness.db.delete(schema.staffUsers).where(inArray(schema.staffUsers.id, staffIds))
    await harness.db.delete(schema.emailLog).where(like(schema.emailLog.recipientEmail, `%@${DOMAIN}`))
    await harness.db.delete(schema.clientAuthUsers).where(like(schema.clientAuthUsers.email, `%@${DOMAIN}`))
    await harness.db.delete(schema.staffAuthUsers).where(like(schema.staffAuthUsers.email, `%@${DOMAIN}`))
    await harness.close()
  })

  test('a superadmin impersonates a member: /me works, carries impersonatedBy, and the audit rows name both', async () => {
    const member = await memberAt(one, superadmin.headers, at('member'))
    const { token, grant, fe_client_url } = await impersonate(superadmin.headers, member.id)

    // The member app opens on the studio's own hostname, and the token rides the
    // fragment, which a browser never sends to a server.
    const url = new URL(fe_client_url)
    assert.equal(url.origin, frontendOrigin('client', one))
    assert.equal(url.pathname, '/impersonate')
    assert.equal(url.search, '')
    const fragment = new URLSearchParams(url.hash.slice(1))
    assert.equal(fragment.get('token'), token)
    assert.equal(fragment.get('grant'), grant)

    // The session is the member's own, at this studio.
    const profile = await expectStatus(await send('/api/v1/me', { headers: memberApp(one, token, grant) }), 200)
    assert.equal(profile.email, member.email)

    // A write made while impersonating is audited as the superadmin, about the member.
    await expectStatus(
      await send('/api/v1/me', { method: 'PATCH', body: { name: 'Augusta King' }, headers: memberApp(one, token, grant) }),
      200,
    )
    const [write] = await harness.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.actorStaffId, superadmin.row.id), eq(schema.auditLog.action, 'PATCH /api/v1/me')))
    assert.ok(write, 'the impersonated write was audited')
    assert.equal((write.payload as Record<string, unknown>).impersonatedClientId, member.id)

    // The sign-in log names the superadmin as actor and the member as subject.
    const [started] = await harness.db
      .select()
      .from(schema.authEvents)
      .where(and(eq(schema.authEvents.actorUserId, superadmin.authUserId), eq(schema.authEvents.kind, 'impersonation_started')))
    assert.ok(started, 'impersonation_started was written')
    assert.equal(started.subjectUserId, member.authUserId)
    assert.equal(started.tenantId, one.id)
  })

  test('stopping revokes the session, so a sibling tab is signed out on its next request, and the end is logged', async () => {
    const member = await memberAt(one, superadmin.headers, at('stopped'))
    const { token, grant } = await impersonate(superadmin.headers, member.id)
    await expectStatus(await send('/api/v1/me', { headers: memberApp(one, token, grant) }), 200)

    await expectStatus(await send('/api/v1/auth/client/sign-out', { body: {}, headers: memberApp(one, token) }), 200)

    await expectStatus(await send('/api/v1/me', { headers: memberApp(one, token, grant) }), 401)
    const [ended] = await harness.db
      .select()
      .from(schema.authEvents)
      .where(
        and(
          eq(schema.authEvents.actorUserId, superadmin.authUserId),
          eq(schema.authEvents.subjectUserId, member.authUserId!),
          eq(schema.authEvents.kind, 'impersonation_ended'),
        ),
      )
    assert.ok(ended, 'impersonation_ended was written')
  })

  test('a grant minted at one studio is refused at another', async () => {
    const member = await memberAt(one, superadmin.headers, at('cross-studio'))
    const { grant } = await impersonate(superadmin.headers, member.id)

    // The same person, a member at studio two, impersonated there too: same
    // subject, so only the grant's studio can tell the two apart.
    const atTwo = await memberAt(two, superadminTwo.headers, member.email)
    assert.equal(atTwo.authUserId, member.authUserId, 'one auth user, two rows')
    const there = await impersonate(superadminTwo.headers, atTwo.id)

    await expectStatus(
      await send('/api/v1/me', { headers: memberApp(two, there.token, grant) }),
      401,
      'impersonation_tenant_mismatch',
    )
  })

  test('a grant and an impersonation session only work together', async () => {
    const member = await memberAt(one, superadmin.headers, at('pairing'))
    const { token, grant } = await impersonate(superadmin.headers, member.id)

    // The impersonation session without its grant would pass as the member's own.
    await expectStatus(await send('/api/v1/me', { headers: memberApp(one, token) }), 401, 'impersonation_grant_mismatch')

    // The member's own session with a grant for them is not an impersonation.
    const own = await harness.signInAs('client', member.email, one)
    const ownToken = own.Authorization!.slice('Bearer '.length)
    await expectStatus(
      await send('/api/v1/me', { headers: memberApp(one, ownToken, grant) }),
      401,
      'impersonation_grant_mismatch',
    )
    await expectStatus(await send('/api/v1/me', { headers: memberApp(one, ownToken) }), 200)
  })

  test('a grant is scoped to one member: presented with another member\'s session it is refused', async () => {
    const target = await memberAt(one, superadmin.headers, at('target'))
    const bystander = await memberAt(one, superadmin.headers, at('bystander'))
    const { grant } = await impersonate(superadmin.headers, target.id)
    const other = await impersonate(superadmin.headers, bystander.id)

    await expectStatus(
      await send('/api/v1/me', { headers: memberApp(one, other.token, grant) }),
      401,
      'impersonation_subject_mismatch',
    )
  })

  test('the lookup is tenant-scoped: a superadmin cannot impersonate another studio\'s member', async () => {
    const member = await memberAt(two, superadminTwo.headers, at('elsewhere'))
    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${member.id}/impersonate`, { body: {}, headers: superadmin.headers }),
      404,
      'client_not_found',
    )
  })

  test('a member the studio has blocked cannot be impersonated', async () => {
    const member = await memberAt(one, superadmin.headers, at('blocked'))
    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${member.id}`, { method: 'DELETE', headers: superadmin.headers }),
      200,
    )
    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${member.id}/impersonate`, { body: {}, headers: superadmin.headers }),
      422,
      'client_blocked',
    )
  })

  test('an admin may impersonate too; an instructor may not', async () => {
    const member = await memberAt(one, superadmin.headers, at('admin-tries'))
    await impersonate(admin.headers, member.id)
    await expectStatus(
      await send(`/api/v1/portal/admin/clients/${member.id}/impersonate`, { body: {}, headers: instructor.headers }),
      403,
    )
  })
})
