import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import {
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * A studio admin manages every staff member, other admins included (#147).
 * Each test runs in a studio of its own, provisioned with no
 * staff, so "how many admins does this studio have" is the test's to state and
 * not whatever another suite left in the shared fixtures.
 */
describe('admins manage staff', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  let provision!: typeof import('../services/tenants/provision')
  let withTenant!: typeof import('../db')['withTenant']
  let staffService!: typeof import('../services/auth/staff-archive')

  const run = Date.now().toString(36)
  let studios = 0

  type Studio = { id: string; slug: string }
  type Role = 'admin' | 'instructor'
  type StaffFixture = { headers: Record<string, string>; id: string; authUserId: string; email: string }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    provision = await import('../services/tenants/provision')
    ;({ withTenant } = await import('../db'))
    staffService = await import('../services/auth/staff-archive')
  })

  after(async () => {
    await harness?.close()
  })

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
    if (error) assert.equal(parsed.error, error, body)
    return parsed
  }

  /** A studio of its own, created the way the super portal does. Its first
   *  admin is only invited — pending, not active — so it counts for nothing
   *  and every active staff member is one the test adds. */
  const freshStudio = async (): Promise<Studio> => {
    const slug = `staff-mgmt-${run}-${++studios}`
    const { tenant } = await provision.provisionTenant({ slug, name: 'Staff Management Studio', adminEmail: `owner@${slug}.test` })
    return { id: tenant.id, slug }
  }

  /** An active staff member of `studio` with `role`, signed in on its portal. */
  const staffAt = async (studio: Studio, name: string, role: Role): Promise<StaffFixture> => {
    const email = `${name}@${studio.slug}.test`
    const headers = await harness.signInAs('staff', email, studio)
    const [user] = await harness.db.select().from(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, email))
    const [row] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId: studio.id, email, name, role, status: 'active', authUserId: user!.id })
      .returning()
    return { headers, id: row!.id, authUserId: user!.id, email }
  }

  const staffRow = async (studio: Studio, id: string) => {
    const [row] = await harness.db
      .select()
      .from(schema.staffUsers)
      .where(and(eq(schema.staffUsers.tenantId, studio.id), eq(schema.staffUsers.id, id)))
    return row!
  }

  const staffPath = (id = '') => `/api/v1/portal/admin/staff${id ? `/${id}` : ''}`

  test('an admin invites an admin, and revokes and resends invitations', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')

    const invited = await expectStatus(
      await send(`${staffPath()}/invite`, { body: { email: `new-admin@${studio.slug}.test`, role: 'admin' }, headers: admin.headers }),
      201,
    )
    assert.equal(invited.role, 'admin')

    await expectStatus(
      await send(`${staffPath()}/invitations/${invited.id}/resend`, { body: {}, headers: admin.headers }),
      200,
    )
    const revoked = await expectStatus(
      await send(`${staffPath()}/invitations/${invited.id}/revoke`, { body: {}, headers: admin.headers }),
      200,
    )
    assert.equal(revoked.status, 'revoked')
  })

  test('an admin archives, unarchives, demotes, signs out and deletes another admin', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const peer = await staffAt(studio, 'peer', 'admin')

    const signedOut = await expectStatus(
      await send(`${staffPath(peer.id)}/sessions/revoke`, { body: {}, headers: admin.headers }),
      200,
    )
    assert.equal(signedOut.revoked, 1)
    await expectStatus(await send(staffPath(), { headers: peer.headers }), 401)

    const demoted = await expectStatus(
      await send(staffPath(peer.id), { method: 'PATCH', body: { role: 'instructor' }, headers: admin.headers }),
      200,
    )
    assert.equal(demoted.role, 'instructor')
    await expectStatus(
      await send(staffPath(peer.id), { method: 'PATCH', body: { role: 'admin' }, headers: admin.headers }),
      200,
    )

    const archived = await expectStatus(await send(`${staffPath(peer.id)}/archive`, { body: {}, headers: admin.headers }), 200)
    assert.equal(archived.status, 'archived')
    const unarchived = await expectStatus(
      await send(`${staffPath(peer.id)}/unarchive`, { body: {}, headers: admin.headers }),
      200,
    )
    assert.equal(unarchived.status, 'active')

    await expectStatus(await send(`${staffPath(peer.id)}/archive`, { body: {}, headers: admin.headers }), 200)
    await expectStatus(await send(staffPath(peer.id), { method: 'DELETE', headers: admin.headers }), 204)
    assert.ok((await staffRow(studio, peer.id)).deletedAt, 'the peer is soft-deleted')
  })

  test('an admin still cannot change their own role or archive themselves', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    await staffAt(studio, 'peer', 'admin')

    await expectStatus(
      await send(staffPath(admin.id), { method: 'PATCH', body: { role: 'instructor' }, headers: admin.headers }),
      403,
      'self_role_edit_forbidden',
    )
    await expectStatus(
      await send(`${staffPath(admin.id)}/archive`, { body: {}, headers: admin.headers }),
      403,
      'self_archive_forbidden',
    )
    assert.equal((await staffRow(studio, admin.id)).role, 'admin')
    assert.equal((await staffRow(studio, admin.id)).status, 'active')
  })

  test('an instructor gets 403 on every staff-management action', async () => {
    const studio = await freshStudio()
    const admin = await staffAt(studio, 'admin', 'admin')
    const instructor = await staffAt(studio, 'instructor', 'instructor')
    const invited = await expectStatus(
      await send(`${staffPath()}/invite`, { body: { email: `pending@${studio.slug}.test`, role: 'instructor' }, headers: admin.headers }),
      201,
    )

    const attempts: Array<[string, { method?: string; body?: unknown }]> = [
      [staffPath(), {}],
      [`${staffPath()}/invite`, { body: { email: `nope@${studio.slug}.test`, role: 'admin' } }],
      [`${staffPath()}/invitations/${invited.id}/revoke`, { body: {} }],
      [`${staffPath()}/invitations/${invited.id}/resend`, { body: {} }],
      [staffPath(admin.id), { method: 'PATCH', body: { role: 'instructor' } }],
      [`${staffPath(admin.id)}/archive`, { body: {} }],
      [`${staffPath(admin.id)}/unarchive`, { body: {} }],
      [`${staffPath(admin.id)}/sessions`, {}],
      [`${staffPath(admin.id)}/sessions/revoke`, { body: {} }],
      [`${staffPath(admin.id)}/resend-invitation`, { body: {} }],
      [staffPath(admin.id), { method: 'DELETE' }],
    ]
    for (const [path, init] of attempts) {
      const res = await send(path, { ...init, headers: instructor.headers })
      assert.equal(res.status, 403, `${init.method ?? (init.body === undefined ? 'GET' : 'POST')} ${path}: ${await res.text()}`)
    }
    assert.equal((await staffRow(studio, admin.id)).status, 'active')
  })

  // The guard, at the service. Over HTTP the actor is always an active admin
  // who cannot target themselves, so a lone admin is never reachable by one
  // request — only by two that race, which is the last test.
  test('the last active admin cannot be archived until a second admin is promoted', async () => {
    const studio = await freshStudio()
    const onlyAdmin = await staffAt(studio, 'only-admin', 'admin')
    const instructor = await staffAt(studio, 'instructor', 'instructor')
    const inStudio = <T>(fn: () => Promise<T>) => withTenant(studio.id, fn)

    await assert.rejects(
      inStudio(() => staffService.archiveStaff({ tenantId: studio.id, targetStaffId: onlyAdmin.id, actorStaffId: instructor.id })),
      (err: { code?: string; details?: { message?: string } }) => {
        assert.equal(err.code, 'cannot_archive_last_admin')
        assert.match(err.details?.message ?? '', /promote/i)
        return true
      },
    )
    assert.equal((await staffRow(studio, onlyAdmin.id)).status, 'active')

    // A second admin, then the same archive goes through.
    await inStudio(() =>
      staffService.updateStaffProfile({
        tenantId: studio.id,
        targetStaffId: instructor.id,
        actorStaffId: onlyAdmin.id,
        patch: { role: 'admin' },
      }),
    )
    const archived = await inStudio(() =>
      staffService.archiveStaff({ tenantId: studio.id, targetStaffId: onlyAdmin.id, actorStaffId: instructor.id }),
    )
    assert.equal(archived.status, 'archived')
  })

  test('demoting the last active admin is refused with the last-admin error, then allowed once there are two', async () => {
    const studio = await freshStudio()
    const onlyAdmin = await staffAt(studio, 'only-admin', 'admin')
    const archivedAdmin = await staffAt(studio, 'archived-admin', 'admin')
    const inStudio = <T>(fn: () => Promise<T>) => withTenant(studio.id, fn)
    await harness.db
      .update(schema.staffUsers)
      .set({ status: 'archived', archivedAt: new Date() })
      .where(eq(schema.staffUsers.id, archivedAdmin.id))

    // The actor is an archived admin: it passes the rank rule but does not
    // count, so the studio has exactly one active admin.
    const demote = () =>
      inStudio(() =>
        staffService.updateStaffProfile({
          tenantId: studio.id,
          targetStaffId: onlyAdmin.id,
          actorStaffId: archivedAdmin.id,
          patch: { role: 'instructor' },
        }),
      )
    await assert.rejects(demote(), (err: { code?: string }) => {
      assert.equal(err.code, 'cannot_demote_last_admin')
      return true
    })
    assert.equal((await staffRow(studio, onlyAdmin.id)).role, 'admin')

    await harness.db
      .update(schema.staffUsers)
      .set({ status: 'active', archivedAt: null })
      .where(eq(schema.staffUsers.id, archivedAdmin.id))
    assert.equal((await demote()).role, 'instructor')
  })

  test('two admins archiving each other at once cannot leave the studio with none', async () => {
    const studio = await freshStudio()
    const a = await staffAt(studio, 'a', 'admin')
    const b = await staffAt(studio, 'b', 'admin')
    const archive = (target: StaffFixture, actor: StaffFixture) =>
      withTenant(studio.id, () =>
        staffService.archiveStaff({ tenantId: studio.id, targetStaffId: target.id, actorStaffId: actor.id }),
      )

    const results = await Promise.allSettled([archive(a, b), archive(b, a)])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(results))
    const [refused] = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    assert.equal(refused!.reason.code, 'cannot_archive_last_admin')

    const active = [await staffRow(studio, a.id), await staffRow(studio, b.id)].filter(r => r.status === 'active')
    assert.equal(active.length, 1)
  })
})
