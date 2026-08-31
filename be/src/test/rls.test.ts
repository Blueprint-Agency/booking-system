import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { eq, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { Hono } from 'hono'
import {
  startTestApp,
  appRoleUrl,
  integrationTestsEnabled,
  SKIP_REASON,
  TEST_DATABASE_URL,
  type TestApp,
} from './harness'
import { APP_ROLE } from '../db/roles'

/**
 * The safety net itself.
 *
 * isolation.test.ts asks whether the application remembers to filter. This file
 * asks the harder question: what happens when it forgets. Every assertion here
 * is about the database refusing something the code did not — which is the only
 * kind of isolation that survives the next feature.
 *
 * Two things make these tests meaningful rather than decorative, and both are
 * asserted rather than assumed:
 *
 *   1. The app connects as `booking_app`, which is neither a superuser nor the
 *      owner of these tables. Postgres exempts both from Row-Level Security, so
 *      pointing the app at `DATABASE_URL` would make every policy a no-op —
 *      while every test in this file still passed, if they did not check.
 *   2. The Tenant context is transaction-local. Session scope would ride a
 *      pooled connection into the next request.
 */
describe('row-level security', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  /** A pinned single connection as the app role, so "the same pooled
   *  connection" is a fact about the test rather than a hope. */
  let pinned!: postgres.Sql
  let oneId!: string
  let twoId!: string

  const TENANT_SETTING = sql`current_setting('app.tenant_id', true)`

  /** One member and one superadmin in each studio — the least a "can one studio
   *  see the other's people?" question needs to be answerable at all. Written on
   *  the owner connection, which is the only thing here allowed to write across
   *  tenants, and removed again in `after`. */
  const PROBE = 'rls-probe'
  const staffOf: Record<string, string> = {}
  const clientOf: Record<string, string> = {}

  before(async () => {
    harness = await startTestApp()
    oneId = harness.tenants.one.id
    twoId = harness.tenants.two.id
    pinned = postgres(appRoleUrl(TEST_DATABASE_URL!), { max: 1 })

    const { clients, staffUsers } = await import('../db/schema/identity')
    for (const [label, tenantId] of [['one', oneId], ['two', twoId]] as const) {
      const [staff] = await harness.db
        .insert(staffUsers)
        .values({
          tenantId,
          email: `${PROBE}-staff-${label}@example.test`,
          name: `${PROBE} staff ${label}`,
          role: 'superadmin',
          status: 'active',
        })
        .returning({ id: staffUsers.id })
      const [client] = await harness.db
        .insert(clients)
        .values({
          tenantId,
          clerkUserId: `${PROBE}-client-${label}`,
          email: `${PROBE}-client-${label}@example.test`,
          name: `${PROBE} member ${label}`,
          phone: '+6580000000',
        })
        .returning({ id: clients.id })
      staffOf[tenantId] = staff!.id
      clientOf[tenantId] = client!.id
    }
  })

  after(async () => {
    if (harness) {
      const { clients, staffUsers } = await import('../db/schema/identity')
      const { like } = await import('drizzle-orm')
      await harness.db.delete(clients).where(like(clients.email, `${PROBE}-%`))
      await harness.db.delete(staffUsers).where(like(staffUsers.email, `${PROBE}-%`))
    }
    await pinned?.end({ timeout: 5 })
    await harness?.close()
  })

  // ── the role, which is what makes the rest of this file mean anything ─────

  test('the app connects as a role that Postgres does not exempt from policies', async () => {
    const [role] = await pinned<{ name: string; superuser: boolean; bypassrls: boolean }[]>`
      SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypassrls
      FROM pg_roles WHERE rolname = current_user
    `
    assert.equal(role?.name, APP_ROLE, 'the app must not connect as the owner in DATABASE_URL')
    assert.equal(role?.superuser, false, 'a superuser bypasses RLS unconditionally')
    assert.equal(role?.bypassrls, false, 'BYPASSRLS would make every policy decoration')

    // Nor may it own the tables: an owner is exempt unless the table is FORCEd,
    // and relying on FORCE alone leaves one `ALTER TABLE` between here and no
    // isolation at all.
    const owned = await pinned<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relowner = current_user::regrole::oid
    `
    assert.deepEqual(owned, [], 'the app role must own none of the tenant tables')
  })

  test('every tenant-scoped table has RLS enabled AND forced', async () => {
    const slack = await harness.db.execute<{ table_name: string }>(sql`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col
        ON col.table_schema = n.nspname AND col.table_name = c.relname
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND col.column_name = 'tenant_id'
        AND c.relname <> 'tenant_settings'
        AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)
      ORDER BY 1
    `)
    assert.deepEqual([...slack], [], 'these tables carry tenant_id but no enforced policy')
  })

  test('the one table without a policy is closed by column privileges instead', async () => {
    // `tenant_settings` cannot carry a policy keyed on the Tenant context: slug
    // resolution reads it to ESTABLISH that context. So the app role is granted
    // the branding columns a studio publishes and nothing else — the mail-from
    // identity and the waiver text are not readable at all, across any tenant.
    const branding = await pinned`select tenant_id, display_name, theme from tenant_settings limit 1`
    assert.ok(branding.length >= 1, 'the branding a studio publishes must stay readable')

    for (const column of ['mail_from_email', 'mail_from_name', 'mail_reply_to', 'waiver_text']) {
      await assert.rejects(
        () => pinned.unsafe(`select ${column} from tenant_settings limit 1`),
        (err: { message?: string }) => /permission denied/i.test(err.message ?? ''),
        `${column} is not display data and must not be readable by the app role`,
      )
    }
  })

  // ── transaction scope ────────────────────────────────────────────────────

  test('the tenant context does not survive into a later transaction', async () => {
    // Both transactions run on the SAME backend — `max: 1` guarantees it, and
    // the pid is asserted so a future pool change cannot quietly make this test
    // pass for the wrong reason.
    const first = await pinned.begin(async tx => {
      await tx`select set_config('app.tenant_id', ${oneId}, true)`
      const [row] = await tx<{ pid: number; setting: string | null }[]>`
        select pg_backend_pid() as pid, current_setting('app.tenant_id', true) as setting
      `
      return row!
    })
    assert.equal(first.setting, oneId)

    const second = await pinned.begin(async tx => {
      const [row] = await tx<{ pid: number; setting: string | null }[]>`
        select pg_backend_pid() as pid, current_setting('app.tenant_id', true) as setting
      `
      return row!
    })
    assert.equal(second.pid, first.pid, 'the two transactions must share a connection')
    assert.ok(
      second.setting === null || second.setting === '',
      `the previous tenant leaked into the next transaction on the same connection: ${second.setting}`,
    )
  })

  test('with no context set, a tenant table answers with nothing at all', async () => {
    const rows = await pinned`select id from clients limit 5`
    assert.equal(rows.length, 0, 'a query with no tenant context must see no rows, not all rows')
  })

  // ── the net: a query that forgets to filter ───────────────────────────────

  test('a query with the tenant filter removed still cannot see across tenants', async () => {
    const { withTenant, db } = await import('../db')
    const { clients } = await import('../db/schema/identity')

    // Deliberately no `where`. This is the bug the whole ticket is about: a
    // developer writes a list query and forgets the tenant. Under the policies
    // it is not a leak, it is a narrower answer.
    const seenByTenantOne = await withTenant(oneId, () =>
      db.select({ id: clients.id, tenantId: clients.tenantId }).from(clients),
    )
    const seenByTenantTwo = await withTenant(twoId, () =>
      db.select({ id: clients.id, tenantId: clients.tenantId }).from(clients),
    )

    assert.ok(seenByTenantOne.length > 0, 'tenant #1 must still see its own members')
    assert.ok(seenByTenantTwo.length > 0, 'tenant #2 must still see its own members')
    assert.ok(
      seenByTenantOne.every(r => r.tenantId === oneId),
      "an unfiltered read returned another tenant's rows",
    )
    assert.ok(
      seenByTenantTwo.every(r => r.tenantId === twoId),
      "an unfiltered read returned another tenant's rows",
    )

    // …and the same unfiltered query on the OWNER connection sees both. That is
    // what makes the assertions above a real result: revert the app to
    // DATABASE_URL and this is the answer it would get, so the test fails.
    const seenByOwner = await harness.db.select({ tenantId: clients.tenantId }).from(clients)
    const tenantsVisibleToOwner = new Set(seenByOwner.map(r => r.tenantId))
    assert.ok(
      tenantsVisibleToOwner.has(oneId) && tenantsVisibleToOwner.has(twoId),
      'the fixture must hold members in both tenants for this test to prove anything',
    )
  })

  test("a write cannot file a row under another tenant", async () => {
    const { withTenant, db } = await import('../db')
    const { classTypes } = await import('../db/schema/catalog')

    // The policy's WITH CHECK half. Naming another tenant explicitly is the
    // clearest form of the mistake — a copied id, a stale variable — and it is
    // refused rather than accepted.
    await assert.rejects(
      () =>
        withTenant(oneId, () =>
          db.insert(classTypes).values({ tenantId: twoId, name: 'Smuggled' }).returning(),
        ),
      (err: { cause?: { message?: string } }) =>
        /row-level security/i.test(err.cause?.message ?? ''),
    )

    const leftovers = await harness.db
      .select({ id: classTypes.id })
      .from(classTypes)
      .where(eq(classTypes.name, 'Smuggled'))
    assert.equal(leftovers.length, 0)
  })

  // ── the audit log ────────────────────────────────────────────────────────

  test('the audit log is written and read inside one tenant only', async () => {
    const { withTenant, db } = await import('../db')
    const { auditLog } = await import('../db/schema/ledger')

    const targetId = '00000000-0000-0000-0000-0000000000aa'
    const entry = {
      actorStaffId: staffOf[oneId]!,
      actorType: 'staff' as const,
      action: 'GET /rls-probe',
      targetTable: 'rls_probe',
      targetId,
    }

    try {
      await withTenant(oneId, () => db.insert(auditLog).values({ tenantId: oneId, ...entry }))

      // The trail a studio is most entitled to have to itself: the other tenant
      // sees none of it, even reading the whole table.
      const seenByTwo = await withTenant(twoId, () =>
        db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.targetTable, 'rls_probe')),
      )
      assert.equal(seenByTwo.length, 0, "one studio read another studio's audit trail")

      const seenByOne = await withTenant(oneId, () =>
        db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.targetTable, 'rls_probe')),
      )
      assert.equal(seenByOne.length, 1)

      // And an entry cannot be filed against a studio you are not in.
      await assert.rejects(
        () =>
          withTenant(twoId, () => db.insert(auditLog).values({ tenantId: oneId, ...entry })),
        (err: { cause?: { message?: string } }) =>
          /row-level security/i.test(err.cause?.message ?? ''),
      )
    } finally {
      await harness.db.delete(auditLog).where(eq(auditLog.targetTable, 'rls_probe'))
    }
  })

  // ── impersonation ────────────────────────────────────────────────────────

  test('an impersonation grant is only good in the tenant it was minted in', async () => {
    const { signGrant, verifyGrant } = await import('../lib/impersonation-grant')

    const grant = verifyGrant(
      signGrant({
        clientClerkUserId: 'user_probe',
        superadminStaffId: '00000000-0000-0000-0000-0000000000bb',
        tenantId: oneId,
      }),
    )
    assert.equal(grant?.tid, oneId, 'the grant must carry the tenant it was minted in')

    // A grant with no tenant claim at all — a token minted before the claim
    // existed, or one hand-rolled — is not "tenant-less", it is invalid.
    const jwt = (await import('jsonwebtoken')).default
    const untenanted = jwt.sign(
      { sub: 'user_probe', sas: '00000000-0000-0000-0000-0000000000bb', jti: 'j' },
      process.env.IMPERSONATION_SECRET!,
      { algorithm: 'HS256', expiresIn: 60 },
    )
    assert.equal(verifyGrant(untenanted), null)
  })

  test("a superadmin cannot impersonate another studio's staff", async () => {
    const { resolveTenant, TENANT_SLUG_HEADER } = await import('../middleware/tenant')
    const { impersonate } = await import('../middleware/impersonate')

    const superadmin = { id: staffOf[oneId]! }
    const ownColleague = superadmin
    const outsider = { id: staffOf[twoId]! }

    // The middleware pair as a route sees it: tenant resolution, then a stand-in
    // for the Clerk middleware that puts the caller's own row on the context.
    const app = new Hono()
    app.use('*', resolveTenant)
    app.use('*', async (c, next) => {
      c.set('staffRow', { id: superadmin.id, role: 'superadmin' } as never)
      await next()
    })
    app.use('*', impersonate)
    app.get('/probe', c => c.json({ actingAs: c.get('actingAs') ?? null }))

    const asOwn = await app.request('/probe', {
      headers: { [TENANT_SLUG_HEADER]: harness.tenants.one.slug, 'x-impersonate-staff-id': ownColleague.id },
    })
    assert.equal(asOwn.status, 200)
    assert.equal(((await asOwn.json()) as { actingAs: string }).actingAs, ownColleague.id)

    const acrossTenants = await app.request('/probe', {
      headers: { [TENANT_SLUG_HEADER]: harness.tenants.one.slug, 'x-impersonate-staff-id': outsider.id },
    })
    assert.equal(acrossTenants.status, 403, "impersonation crossed the tenant boundary")

    // A malformed id is refused the same way — not a 500 from a failed uuid cast.
    const malformed = await app.request('/probe', {
      headers: { [TENANT_SLUG_HEADER]: harness.tenants.one.slug, 'x-impersonate-staff-id': 'not-a-uuid' },
    })
    assert.equal(malformed.status, 403)
  })

  test('minting a client impersonation stops at the studio boundary', async () => {
    const { mintClientImpersonation } = await import('../services/impersonation/mint')
    const { withTenant } = await import('../db')
    const outsider = { id: clientOf[twoId]! }

    await assert.rejects(
      () =>
        withTenant(oneId, () =>
          mintClientImpersonation({
            tenantId: oneId,
            clientId: outsider.id,
            superadminStaffId: '00000000-0000-0000-0000-0000000000bb',
          }),
        ),
      (err: { message?: string }) => err.message === 'client_not_found',
    )
  })

  // A read of the setting itself, kept last: it documents the exact expression
  // the policies use, so a future change to either has one place to disagree.
  test('the policies read the setting the database layer writes', async () => {
    const { withTenant, db } = await import('../db')
    const [row] = await withTenant(twoId, () =>
      db.execute<{ setting: string | null }>(sql`select ${TENANT_SETTING} as setting`),
    )
    assert.equal(row?.setting, twoId)
  })
})
