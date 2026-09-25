import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { startTestApp, integrationTestsEnabled, SKIP_REASON, type TestApp } from './harness'

/**
 * The super portal's studio list is the studios people run. The browser
 * journeys' throwaway `e2e-` studios live on staging for one run each and are
 * nobody's to manage, so the list leaves them out.
 */
describe('platform studio list', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let provision!: typeof import('../services/tenants/provision')
  let tenantsService!: typeof import('../services/tenants/tenants')
  let schema!: typeof import('../db/schema')

  before(async () => {
    harness = await startTestApp()
    // After the harness: these modules build a pool from the stubbed
    // environment at import time.
    provision = await import('../services/tenants/provision')
    tenantsService = await import('../services/tenants/tenants')
    schema = await import('../db/schema')
  })

  after(async () => {
    await harness?.close()
  })

  test('SUP-10 the list leaves out the browser journeys’ e2e- studios', async () => {
    const real = await provision.provisionTenant({ slug: `listed-${Date.now()}`, name: 'Listed' })
    // Written as the owner, as the e2e studio command writes it: the super
    // portal cannot create an `e2e-` slug at all.
    const [throwaway] = await harness.db
      .insert(schema.tenants)
      .values({ slug: `e2e-list${Date.now().toString(36)}`, name: 'E2E list' })
      .returning()

    const ids = new Set((await tenantsService.listTenants()).map(t => t.id))
    assert.ok(ids.has(real.tenant.id), 'the real studio is listed')
    assert.ok(!ids.has(throwaway!.id), 'the e2e- studio is not')
  })
})
