/**
 * Issue Receipts for the sales made before Receipts existed (#394) — a
 * one-off, run once per environment after the Receipts migrations. Run where
 * the database is:
 *
 *   docker compose run --rm -T booking-be npm run -s receipts:backfill
 *   docker compose run --rm -T booking-be npm run -s receipts:backfill -- <studio-slug>
 *
 * Every studio, or just the one named. Sends no email. Safe to run twice: a
 * Purchase that has a Receipt is skipped, so a second run issues nothing.
 *
 * Runs as the application role, inside each studio's Tenant context, like any
 * request: one transaction per studio, so a studio is backfilled whole or not
 * at all.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BackfillResult } from './backfill'

/**
 * The CLI's work, without its exit: every studio, or the one `slug` names.
 * Leaves the database connection open, for a caller that goes on using it.
 */
export async function backfillReceipts(slug?: string): Promise<Array<{ slug: string } & BackfillResult>> {
  // Lazily, as the billing CLIs do: `db` reads the environment at load.
  const { db, withTenant } = await import('../../db')
  const { tenants } = await import('../../db/schema/tenancy')
  const { asc, eq } = await import('drizzle-orm')
  const { backfillStudioReceipts } = await import('./backfill')

  const studios = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(slug ? eq(tenants.slug, slug) : undefined)
    .orderBy(asc(tenants.slug))
  if (slug && studios.length === 0) throw new Error(`no studio with slug ${slug}`)

  const results: Array<{ slug: string } & BackfillResult> = []
  for (const studio of studios) {
    const result = await withTenant(studio.id, () => backfillStudioReceipts(studio.id))
    results.push({ slug: studio.slug, ...result })
  }
  return results
}

async function main() {
  const [slug] = process.argv.slice(2)
  const { closeDb } = await import('../../db')
  try {
    for (const result of await backfillReceipts(slug)) {
      const { slug: studio, ...counts } = result
      console.log(`[backfill-receipts] ${studio} ${JSON.stringify(counts)}`)
    }
  } finally {
    await closeDb()
  }
}

// Run as a script, not when imported (the tests call `backfillReceipts`).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    err => {
      console.error('[backfill-receipts] failed:', err)
      process.exit(1)
    },
  )
}
