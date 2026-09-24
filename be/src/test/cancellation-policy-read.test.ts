import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from './harness'

/**
 * The member app states a studio's cancellation rules before a member books and
 * when they cancel. It reads them from here, so what a member is told is the
 * row the cancel is judged by — not a number compiled into the frontend.
 */
describe('the studio cancellation policy, as a member reads it', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
  })

  after(async () => {
    if (!harness) return
    await harness.close()
  })

  const read = async (slug: string) => {
    const res = await harness.app.request('/api/v1/public/cancellation-policy', {
      headers: { 'X-Tenant-Slug': slug },
    })
    assert.equal(res.status, 200, await res.clone().text())
    return (await res.json()) as Record<string, unknown>
  }

  test('CXL-35 a member reads the window and cap their studio saved, not another studio’s', async () => {
    const { one, two } = harness.tenants
    const [prior] = await harness.db
      .select()
      .from(schema.globalPolicy)
      .where(eq(schema.globalPolicy.tenantId, one.id))
    assert.ok(prior)
    const twoBefore = await read(two.slug)

    try {
      await harness.db
        .update(schema.globalPolicy)
        .set({ classWindowHours: 48, ptWindowHours: 12, cancelCapCount: 5, cancelCapCycleDays: 14 })
        .where(eq(schema.globalPolicy.tenantId, one.id))

      assert.deepEqual(await read(one.slug), {
        class_window_hours: 48,
        pt_window_hours: 12,
        cancel_cap_count: 5,
        cancel_cap_cycle_days: 14,
      })
      assert.deepEqual(await read(two.slug), twoBefore, "one studio's policy is not another's")
    } finally {
      await harness.db
        .update(schema.globalPolicy)
        .set({
          classWindowHours: prior.classWindowHours,
          ptWindowHours: prior.ptWindowHours,
          cancelCapCount: prior.cancelCapCount,
          cancelCapCycleDays: prior.cancelCapCycleDays,
        })
        .where(eq(schema.globalPolicy.tenantId, one.id))
    }
  })
})
