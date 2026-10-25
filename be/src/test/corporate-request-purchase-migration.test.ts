import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { inArray, sql } from 'drizzle-orm'
import { integrationTestsEnabled, SKIP_REASON, startTestApp, type TestApp } from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.corporate-purchase-migration.test`
const MIGRATION = path.resolve(process.cwd(), 'src/db/migrations/0137_corporate_requests_purchase_unique.sql')
const INDEX = 'corporate_requests_purchase_unique'

describe('migration 0137: one Corporate Request per Purchase', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  const seeded: string[] = []

  async function migrate() {
    for (const statement of readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint')) {
      await harness.db.execute(sql.raw(statement))
    }
  }

  async function studio(tenantId: string, slug: string) {
    const email = `desk-${slug}@${DOMAIN}`
    const [staff] = await harness.db
      .insert(schema.staffUsers)
      .values({ tenantId, email, name: 'Desk', role: 'admin', status: 'active', authUserId: randomUUID() })
      .returning({ id: schema.staffUsers.id })
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId, email: `member-${slug}@${DOMAIN}`, name: 'Mia', phone: '+6580000000', authUserId: randomUUID() })
      .returning({ id: schema.clients.id })
    const [pkg] = await harness.db
      .insert(schema.corporatePackages)
      .values({ tenantId, name: `Offsite ${run}`, priceSgd: '1500.00', createdByStaffId: staff!.id })
      .returning({ id: schema.corporatePackages.id })
    const [sale] = await harness.db
      .insert(schema.purchases)
      .values({ tenantId, clientId: client!.id, kind: 'corporate_package', totalSgd: '1500.00', amountPaidSgd: '1500.00', status: 'paid' })
      .returning({ id: schema.purchases.id })
    const request = async (
      status: 'pending' | 'scheduled' | 'attended' | 'cancelled',
      purchaseId: string | null,
      createdAt: string,
    ) => {
      const [row] = await harness.db
        .insert(schema.corporateRequests)
        .values({ tenantId, clientId: client!.id, corporatePackageId: pkg!.id, status, purchaseId, createdAt: new Date(createdAt) })
        .returning({ id: schema.corporateRequests.id })
      seeded.push(row!.id)
      return row!.id
    }
    return { purchaseId: sale!.id, request }
  }

  async function requests() {
    const rows = await harness.db
      .select({ id: schema.corporateRequests.id, status: schema.corporateRequests.status, purchaseId: schema.corporateRequests.purchaseId })
      .from(schema.corporateRequests)
      .where(inArray(schema.corporateRequests.id, seeded))
    return new Map(rows.map(r => [r.id, [r.status, r.purchaseId] as const]))
  }

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
  })

  after(async () => {
    if (!harness) return
    try {
      const ours = `%@${DOMAIN}`
      const clientIds = sql`SELECT id FROM clients WHERE email LIKE ${ours}`
      await harness.db.execute(sql`DELETE FROM corporate_requests WHERE client_id IN (${clientIds})`)
      await harness.db.execute(sql`DELETE FROM purchases WHERE client_id IN (${clientIds})`)
      await harness.db.execute(sql`DELETE FROM corporate_packages WHERE created_by_staff_id IN (SELECT id FROM staff_users WHERE email LIKE ${ours})`)
      await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${ours}`)
      await harness.db.execute(sql`DELETE FROM staff_users WHERE email LIKE ${ours}`)
      await migrate()
    } finally {
      await harness.close()
    }
  })

  test('CORP-19 each Purchase keeps the one request furthest along, the others keep their rows and status but no longer name it, requests with no Purchase are untouched, and a second run changes nothing', async () => {
    await harness.db.execute(sql.raw(`DROP INDEX IF EXISTS "${INDEX}"`))
    const { one, two } = harness.tenants
    const atOne = await studio(one.id, `one-${run}`)
    const atTwo = await studio(two.id, `two-${run}`)

    const cancelled = await atOne.request('cancelled', atOne.purchaseId, '2026-01-01T00:00:00Z')
    const pending = await atOne.request('pending', atOne.purchaseId, '2026-01-02T00:00:00Z')
    const attended = await atOne.request('attended', atOne.purchaseId, '2026-01-03T00:00:00Z')
    const older = await atTwo.request('pending', atTwo.purchaseId, '2026-01-01T00:00:00Z')
    const newer = await atTwo.request('pending', atTwo.purchaseId, '2026-01-02T00:00:00Z')
    const unpaid = await atOne.request('pending', null, '2026-01-01T00:00:00Z')
    const unpaidToo = await atOne.request('pending', null, '2026-01-02T00:00:00Z')

    await migrate()

    const expected = new Map([
      [cancelled, ['cancelled', null]],
      [pending, ['pending', null]],
      [attended, ['attended', atOne.purchaseId]],
      [older, ['pending', atTwo.purchaseId]],
      [newer, ['pending', null]],
      [unpaid, ['pending', null]],
      [unpaidToo, ['pending', null]],
    ])
    assert.deepEqual(await requests(), expected)

    const [index] = await harness.db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${INDEX}`,
    )
    assert.match(index?.indexdef ?? '', /^CREATE UNIQUE INDEX .* \(tenant_id, purchase_id\) WHERE \(purchase_id IS NOT NULL\)$/)

    await migrate()
    assert.deepEqual(await requests(), expected, 'a second run changes nothing')
  })
})
