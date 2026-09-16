import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

/**
 * The platform-admin bootstrap seed provisions the Better Auth user (#112),
 * stays safe to run on every deploy, and writes nothing else (#116).
 */
describe('auth bootstrap seeds', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  const run = Date.now().toString(36)
  const OPERATOR = `seed-operator-${run}@auth.test`
  const saved = {
    platformAdmins: process.env.PLATFORM_ADMIN_EMAIL,
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    process.env.PLATFORM_ADMIN_EMAIL = OPERATOR
  })

  after(async () => {
    process.env.PLATFORM_ADMIN_EMAIL = saved.platformAdmins
    if (!harness) return
    await harness.db.delete(schema.platformAuthUsers).where(eq(schema.platformAuthUsers.email, OPERATOR))
    await harness.close()
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
