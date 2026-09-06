import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'

import {
  TEST_DATABASE_URL,
  SKIP_REASON,
  integrationTestsEnabled,
  startTestApp,
  type TestApp,
} from './harness'
import { ensureTenantIsolation } from '../db/roles'

/**
 * Every Tenant-scoped table is policed, including ones nobody has written yet.
 *
 * The gap this closes is not a missing policy on any particular table — it is
 * that the two halves of a new table's security arrive by different routes.
 * `GRANT … ON ALL TABLES` and `ALTER DEFAULT PRIVILEGES` reach a new table on
 * the next deploy **automatically**; its Row-Level Security policy arrived only
 * if the migration author wrote four lines nobody checks.
 *
 * Migration 0033 looped over the tables that existed the day it ran and has not
 * run since. So the failure mode was: add a Tenant-scoped table, get full DML
 * for the app role and no policy, and ship a table readable across every studio.
 * Nothing announces it — an absent policy refuses nothing, so every existing
 * test still passes. That is precisely the shape of defect that needs a test,
 * because review is what already missed it.
 */

let harness: TestApp

before(async () => {
  if (!integrationTestsEnabled) return
  harness = await startTestApp()
})

after(async () => {
  await harness?.close()
})

const options = { skip: integrationTestsEnabled ? false : SKIP_REASON }

/**
 * A short-lived owner connection.
 *
 * `lock_timeout` matters: every statement here takes ACCESS EXCLUSIVE, and the
 * app's pool is live in the same process. Without it, contention is a hung test
 * run rather than a failing assertion — and a suite that hangs is one people
 * stop running.
 */
async function asOwner<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const owner = postgres(TEST_DATABASE_URL!, { max: 1 })
  try {
    await owner.unsafe(`SET lock_timeout = '10s'`)
    await owner.unsafe(`SET statement_timeout = '30s'`)
    // `DROP POLICY IF EXISTS` on a table that has never had one is a NOTICE, and
    // the probe tables below are exactly that case. Silenced here rather than in
    // `ensureTenantIsolation`, where the same notice on a real deploy would be
    // worth reading.
    await owner.unsafe(`SET client_min_messages = warning`)
    return await fn(owner)
  } finally {
    await owner.end({ timeout: 5 })
  }
}

test('every table with a tenant_id has RLS enabled, forced, and a policy', options, async () => {
  // Read from `pg_class` and `pg_policies`, never from a list in this file: a
  // hardcoded expectation is the thing that goes stale the moment someone adds
  // a table, which is the exact event this test exists to catch.
  const unprotected = await harness.db.execute<{ table_name: string }>(sql`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname <> 'tenant_settings'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
      )
      AND (c.relrowsecurity IS NOT TRUE
        OR c.relforcerowsecurity IS NOT TRUE
        OR NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public'
            AND p.tablename = c.relname
            AND p.policyname = 'tenant_isolation'))
    ORDER BY c.relname
  `)

  assert.deepEqual(
    unprotected.map(r => r.table_name),
    [],
    'these tables carry a tenant_id and are not policed — the app role could read them across every studio',
  )
})

test('the sweep reaches the whole schema but tenant_settings', options, async () => {
  const scoped = await harness.db.execute<{ table_name: string }>(sql`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
    ORDER BY table_name
  `)
  const names = scoped.map(r => r.table_name)

  assert.ok(names.length > 40, `expected the whole schema, saw ${names.length} tenant-scoped tables`)
  // Excluded on purpose, and the reason is load-bearing: slug resolution reads
  // this table *before* any Tenant context exists, so a policy keyed on that
  // context could only refuse the request that establishes it. Column grants
  // stand in — see `ensureAppRole`.
  assert.ok(names.includes('tenant_settings'), 'tenant_settings is tenant-scoped')
})

test('a Tenant-scoped table added later is policed by the next deploy', options, async () => {
  // The property that actually matters, and the one migration 0033 could not
  // have: a table that did not exist when the policy loop ran. Rather than
  // mutating a real table — which fights the live app pool for locks — this
  // creates its own, which is also a truer model of the failure: someone adds a
  // table, and the question is what the deploy does about it.
  const probe = `rls_probe_${Date.now().toString(36)}`

  await asOwner(async owner => {
    try {
      await owner.unsafe(`
        CREATE TABLE ${probe} (
          tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
          id uuid PRIMARY KEY DEFAULT gen_random_uuid()
        )
      `)

      // Exactly the state a forgetful migration leaves behind.
      const [before] = await owner<{ enabled: boolean; policies: number }[]>`
        SELECT c.relrowsecurity AS enabled,
               (SELECT count(*)::int FROM pg_policies p
                 WHERE p.schemaname = 'public' AND p.tablename = ${probe}) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ${probe}
      `
      assert.equal(before!.enabled, false, 'a new table starts with no row security')
      assert.equal(before!.policies, 0, 'and no policy — this is the gap')

      const policed = await ensureTenantIsolation(owner)
      assert.ok(policed.includes(probe), 'the sweep must pick up a table it has never seen')

      const [after_] = await owner<{ enabled: boolean; forced: boolean; policies: number }[]>`
        SELECT c.relrowsecurity AS enabled,
               c.relforcerowsecurity AS forced,
               (SELECT count(*)::int FROM pg_policies p
                 WHERE p.schemaname = 'public' AND p.tablename = ${probe}
                   AND p.policyname = 'tenant_isolation') AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ${probe}
      `
      assert.equal(after_!.enabled, true, 'row security must be enabled')
      // Without FORCE the owner bypasses its own policy, which is how a control
      // becomes decoration without anything appearing to be wrong.
      assert.equal(after_!.forced, true, 'row security must be forced')
      assert.equal(after_!.policies, 1, 'the isolation policy must exist')

      // Idempotent: a second pass on a healthy table changes nothing and throws
      // nothing, which is what lets this sit in every deploy.
      const again = await ensureTenantIsolation(owner)
      assert.ok(again.includes(probe))
    } finally {
      await owner.unsafe(`DROP TABLE IF EXISTS ${probe}`)
    }
  })
})

test('the policy the sweep writes actually refuses another tenant', options, async () => {
  // Enabling RLS proves the switch is on; this proves the switch is wired to
  // something. A policy whose predicate were wrong would satisfy every
  // catalogue assertion above and isolate nothing.
  const probe = `rls_probe_${Date.now().toString(36)}x`
  const { one, two } = harness.tenants

  await asOwner(async owner => {
    try {
      await owner.unsafe(`
        CREATE TABLE ${probe} (
          tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
          id uuid PRIMARY KEY DEFAULT gen_random_uuid()
        )
      `)
      await ensureTenantIsolation(owner)
      await owner.unsafe(`GRANT SELECT, INSERT ON ${probe} TO booking_app`)
      await owner.unsafe(
        `INSERT INTO ${probe} (tenant_id) VALUES ('${one.id}'), ('${two.id}')`,
      )

      // As the app role, inside one tenant's context, exactly as `withTenant` does.
      const appUrl = TEST_DATABASE_URL!.replace(/\/\/[^@]+@/, `//booking_app:booking_app_test@`)
      const app = postgres(appUrl, { max: 1 })
      try {
        await app.unsafe(`SET statement_timeout = '30s'`)
        const seen = await app.unsafe(
          `SELECT set_config('app.tenant_id', '${one.id}', false);
           SELECT tenant_id::text AS tenant_id FROM ${probe}`,
        )
        const rows = (Array.isArray(seen) ? seen.flat() : []) as { tenant_id?: string }[]
        const tenants = rows.filter(r => r.tenant_id).map(r => r.tenant_id)

        assert.deepEqual(tenants, [one.id], 'one tenant in context, one tenant of rows')
      } finally {
        await app.end({ timeout: 5 })
      }
    } finally {
      await owner.unsafe(`DROP TABLE IF EXISTS ${probe}`)
    }
  })
})
