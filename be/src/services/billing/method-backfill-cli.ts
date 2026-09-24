/**
 * Fill in how each past payment was paid (#282) — a one-off, for payments taken
 * before the webhook started recording the method. Run where the database is:
 *
 *   docker compose run --rm -T booking-be npm run -s billing:backfill-methods
 *   docker compose run --rm -T booking-be npm run -s billing:backfill-methods -- <studio-slug>
 *
 * Every studio, or just the one named. Each payment is read on the provider
 * account it was taken on; one on an account the studio no longer supplies is
 * skipped and counted. Safe to run twice: it only reads payments still missing
 * a method.
 *
 * Runs as the application role, inside each studio's Tenant context, like any
 * request.
 */
async function main() {
  const [slug] = process.argv.slice(2)
  const { db, withTenant, closeDb } = await import('../../db')
  const { tenants } = await import('../../db/schema/tenancy')
  const { eq } = await import('drizzle-orm')
  const { backfillPaymentMethods } = await import('./payment-methods')

  try {
    const studios = await db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(slug ? eq(tenants.slug, slug) : undefined)
    if (slug && studios.length === 0) throw new Error(`no studio with slug ${slug}`)

    for (const studio of studios) {
      const result = await withTenant(studio.id, () => backfillPaymentMethods(studio.id))
      console.log(`[backfill-methods] ${studio.slug} ${JSON.stringify(result)}`)
    }
  } finally {
    await closeDb()
  }
}

main().then(
  () => process.exit(0),
  err => {
    console.error('[backfill-methods] failed:', err)
    process.exit(1)
  },
)
