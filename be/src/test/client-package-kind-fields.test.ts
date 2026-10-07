import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, isNull, sql } from 'drizzle-orm'
import postgres from 'postgres'
import {
  appRoleUrl,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  TEST_DATABASE_URL,
  type TestApp,
} from './harness'

const run = Date.now().toString(36)
const DOMAIN = `${run}.client-package-kind-fields.test`

/**
 * A Client Package's own shape, held by the database rather than by whichever
 * service writes it (spec-pre-launch-batch §1; `client_packages_kind_fields`).
 * Only an Unlimited Plan carries a Home Location and a frozen Duration in
 * months; every other kind carries neither.
 *
 * Every write here goes straight to Postgres as the app role the server
 * connects as, inside a Tenant context, with no service in front of it, so a
 * refusal is the constraint's and nothing else's. Each refusal sits beside a
 * row of the same kind the database accepts, so it is the one field that
 * differs that the database refused, not Row-Level Security or a missing column.
 */
describe('client package kind fields in the database', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let harness!: TestApp
  let schema!: typeof import('../db/schema')
  /** One connection as the app role, never the owner: the owner skips RLS. */
  let app!: postgres.Sql
  let tenantId!: string
  let clientId!: string
  let locationId!: string

  type Fields = {
    kind: 'credit_bundle' | 'unlimited' | 'trial' | 'pt'
    locationId?: string | null
    durationMonths?: number | null
    validityDays?: number | null
  }

  /** Writes one Client Package as the app does: one transaction, Tenant set in it. */
  function write(f: Fields) {
    return app.begin(async tx => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO client_packages
          (tenant_id, client_id, kind, location_id, duration_months, validity_days, credits_or_sessions_remaining, amount_paid_sgd, list_price_sgd)
        VALUES
          (${tenantId}, ${clientId}, ${f.kind}, ${f.locationId ?? null}, ${f.durationMonths ?? null},
           ${f.validityDays ?? null}, ${f.kind === 'unlimited' ? null : 5}, '120.00', '120.00')
        RETURNING id`
      return row!.id
    })
  }

  async function refused(f: Fields) {
    await assert.rejects(write(f), (err: { code?: string; constraint_name?: string }) => {
      assert.equal(err.code, '23514', `a check violation, not ${err.code}: ${String(err)}`)
      assert.equal(err.constraint_name, 'client_packages_kind_fields')
      return true
    })
  }

  const held = () =>
    harness.db
      .select({
        kind: schema.clientPackages.kind,
        locationId: schema.clientPackages.locationId,
        durationMonths: schema.clientPackages.durationMonths,
        validityDays: schema.clientPackages.validityDays,
      })
      .from(schema.clientPackages)
      .where(eq(schema.clientPackages.clientId, clientId))

  before(async () => {
    harness = await startTestApp()
    schema = await import('../db/schema')
    app = postgres(appRoleUrl(TEST_DATABASE_URL!), { max: 1 })
    tenantId = harness.tenants.one.id
    const [location] = await harness.db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(and(eq(schema.locations.tenantId, tenantId), isNull(schema.locations.deletedAt)))
      .limit(1)
    locationId = location!.id
    const [client] = await harness.db
      .insert(schema.clients)
      .values({ tenantId, authUserId: `kind-fields-${run}`, email: `mia@${DOMAIN}`, name: 'Mia', phone: '+6580000000' })
      .returning({ id: schema.clients.id })
    clientId = client!.id
  })

  after(async () => {
    try {
      if (harness) {
        const ours = sql`SELECT id FROM clients WHERE email LIKE ${`%@${DOMAIN}`}`
        await harness.db.execute(sql`DELETE FROM client_packages WHERE client_id IN (${ours})`)
        await harness.db.execute(sql`DELETE FROM clients WHERE email LIKE ${`%@${DOMAIN}`}`)
      }
    } finally {
      await app?.end({ timeout: 5 })
      await harness?.close()
    }
  })

  test('LOC-14 an Unlimited Plan written without a Home Location or without a frozen duration_months is refused by the database', async () => {
    await refused({ kind: 'unlimited', locationId: null, durationMonths: 3 })
    await refused({ kind: 'unlimited', locationId, durationMonths: null })
    await refused({ kind: 'unlimited', locationId: null, durationMonths: null })
    assert.deepEqual(await held(), [], 'no refused plan was written')

    // The same plan with both is a row the database keeps.
    await write({ kind: 'unlimited', locationId, durationMonths: 3 })
    assert.deepEqual(await held(), [{ kind: 'unlimited', locationId, durationMonths: 3, validityDays: null }])
  })

  test('LOC-15 a package that is not unlimited written with a location_id or a duration_months is refused by the database', async () => {
    const before = await held()
    for (const kind of ['credit_bundle', 'trial', 'pt'] as const) {
      await refused({ kind, validityDays: 30, locationId })
      await refused({ kind, validityDays: 30, durationMonths: 3 })
      await refused({ kind, validityDays: 30, locationId, durationMonths: 3 })
    }
    assert.deepEqual(await held(), before, 'no refused package was written')

    // Each kind with neither is a row the database keeps.
    for (const kind of ['credit_bundle', 'trial', 'pt'] as const) await write({ kind, validityDays: 30 })
    const kept = (await held()).filter(p => p.kind !== 'unlimited')
    assert.deepEqual(
      kept.map(p => [p.kind, p.locationId, p.durationMonths, p.validityDays]).sort(),
      [
        ['credit_bundle', null, null, 30],
        ['pt', null, null, 30],
        ['trial', null, null, 30],
      ],
    )
  })
})
