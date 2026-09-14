import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

/**
 * The two bootstrap seeds provision the Better Auth user (#112), and stay safe
 * to run on every deploy. The platform-admin seed writes nothing else (#116).
 */
describe('auth bootstrap seeds', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  const run = Date.now().toString(36)
  const SUPERADMIN = `seed-superadmin-${run}@auth.test`
  const OPERATOR = `seed-operator-${run}@auth.test`
  const saved = {
    superadmin: process.env.SUPERADMIN_EMAIL,
    platformAdmins: process.env.PLATFORM_ADMIN_EMAILS,
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    process.env.SUPERADMIN_EMAIL = SUPERADMIN
    process.env.PLATFORM_ADMIN_EMAILS = OPERATOR
  })

  after(async () => {
    process.env.SUPERADMIN_EMAIL = saved.superadmin
    process.env.PLATFORM_ADMIN_EMAILS = saved.platformAdmins
    if (!harness) return
    await harness.db.delete(schema.staffUsers).where(eq(schema.staffUsers.email, SUPERADMIN))
    await harness.db.delete(schema.staffAuthUsers).where(eq(schema.staffAuthUsers.email, SUPERADMIN))
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.close()
  })

  test('the superadmin seed creates the staff auth user and an active row linked to it, idempotently', async () => {
    const { seedSuperadmin } = await import('../db/seed/superadmin')
    const { TENANT_ONE_ID } = await import('../db/schema/tenancy')

    const stamped = async () => {
      const users = await harness.db
        .select()
        .from(schema.staffAuthUsers)
        .where(eq(schema.staffAuthUsers.email, SUPERADMIN))
      const rows = await harness.db
        .select({ authUserId: schema.staffUsers.authUserId, status: schema.staffUsers.status })
        .from(schema.staffUsers)
        .where(and(eq(schema.staffUsers.tenantId, TENANT_ONE_ID), eq(schema.staffUsers.email, SUPERADMIN)))
      return { users, rows }
    }

    await seedSuperadmin(harness.db)
    const first = await stamped()
    assert.equal(first.users.length, 1, 'one staff auth user')
    assert.equal(first.rows.length, 1, 'one staff_users row')
    assert.equal(first.rows[0]!.authUserId, first.users[0]!.id)
    // Active from the start: the operator's way in is "Forgot password" on the
    // account above, and a pending row would refuse them once they had one.
    assert.equal(first.rows[0]!.status, 'active')

    await seedSuperadmin(harness.db)
    const second = await stamped()
    assert.deepEqual(second.users.map(u => u.id), first.users.map(u => u.id), 'a re-run makes no second user')
    assert.equal(second.rows.length, 1)
    assert.equal(second.rows[0]!.authUserId, first.users[0]!.id)
    assert.equal(second.rows[0]!.status, 'active')
  })

  test('a re-run leaves an archived superadmin archived', async () => {
    const { seedSuperadmin } = await import('../db/seed/superadmin')
    const { TENANT_ONE_ID } = await import('../db/schema/tenancy')
    const row = and(eq(schema.staffUsers.tenantId, TENANT_ONE_ID), eq(schema.staffUsers.email, SUPERADMIN))

    await seedSuperadmin(harness.db)
    await harness.db.update(schema.staffUsers).set({ status: 'archived' }).where(row)
    await seedSuperadmin(harness.db)

    const [after] = await harness.db.select({ status: schema.staffUsers.status }).from(schema.staffUsers).where(row)
    assert.equal(after!.status, 'archived', 'a deploy does not undo an archive')
  })

  test('the platform-admin seed creates the platform auth user, idempotently', async () => {
    const { seedPlatformAdmins } = await import('../db/seed/platform-admin')
    const operators = () =>
      harness.db.select().from(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))

    await seedPlatformAdmins(harness.db)
    const [first, ...extra] = await operators()
    assert.ok(first, 'the operator exists in the platform pool')
    assert.equal(extra.length, 0)

    await seedPlatformAdmins(harness.db)
    assert.deepEqual((await operators()).map(u => u.id), [first.id])

    const inStaffPool = await harness.db
      .select()
      .from(schema.staffAuthUsers)
      .where(eq(schema.staffAuthUsers.email, OPERATOR))
    assert.equal(inStaffPool.length, 0, 'an operator is never provisioned into a studio pool')
  })
})
