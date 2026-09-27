/**
 * Subscribe each studio's webhook endpoint to every event the handler acts on
 * — a one-off, for endpoints created before `checkout.session.async_payment_succeeded`
 * joined the list, without which a checkout paid by a method that settles late
 * is never granted. Run where the database is:
 *
 *   docker compose run --rm -T booking-be npm run -s billing:sync-webhook-events
 *   docker compose run --rm -T booking-be npm run -s billing:sync-webhook-events -- <studio-slug>
 *
 * Every studio, or just the one named. The endpoint and its signing secret are
 * kept; only its event list grows. Safe to run twice.
 */
export {}

async function main() {
  const [slug] = process.argv.slice(2)
  const { db, closeDb } = await import('../../db')
  const { tenants } = await import('../../db/schema/tenancy')
  const { eq } = await import('drizzle-orm')
  const { syncWebhookEvents } = await import('./provider-onboarding')

  let failed = 0
  try {
    const studios = await db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(slug ? eq(tenants.slug, slug) : undefined)
    if (slug && studios.length === 0) throw new Error(`no studio with slug ${slug}`)

    for (const studio of studios) {
      try {
        const result = await syncWebhookEvents(studio.id)
        console.log(`[sync-webhook-events] ${studio.slug} ${JSON.stringify(result)}`)
      } catch (err) {
        failed += 1
        console.error(`[sync-webhook-events] ${studio.slug} failed:`, err)
      }
    }
  } finally {
    await closeDb()
  }
  if (failed > 0) throw new Error(`${failed} studio(s) not updated`)
}

main().then(
  () => process.exit(0),
  err => {
    console.error('[sync-webhook-events] failed:', err)
    process.exit(1)
  },
)
