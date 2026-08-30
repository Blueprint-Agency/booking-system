import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../schema'
import { TENANT_ONE_ID } from '../schema/tenancy'

/**
 * Claim every unclaimed row for tenant #1.
 *
 * Migration 0027 backfills what exists *at migration time*, but `db:seed` runs
 * after `db:migrate` on every deploy and each seeder writes an explicit column
 * list that knows nothing about tenancy — so a fresh database, or a newly added
 * email template or class package, would land with `tenant_id IS NULL` and the
 * future `NOT NULL` contract migration would have nothing to stand on.
 *
 * While the platform is still single-tenant this is simply true: anything a
 * seeder writes belongs to Yoga Sadhana. The step disappears when the seeds
 * become per-tenant provisioning data (Phase 1 of the multi-tenancy plan).
 *
 * The table list comes from `information_schema` rather than a hardcoded list
 * of 53 names, so it cannot drift from the schema.
 */
export async function claimSeededRowsForTenantOne(db: PostgresJsDatabase<typeof schema>) {
  const targets = await db.execute<{ table_name: string }>(sql`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'tenant_settings'
    ORDER BY c.table_name
  `)

  for (const { table_name } of targets) {
    await db.execute(
      sql`UPDATE ${sql.identifier(table_name)} SET tenant_id = ${TENANT_ONE_ID}::uuid WHERE tenant_id IS NULL`,
    )
  }
}
