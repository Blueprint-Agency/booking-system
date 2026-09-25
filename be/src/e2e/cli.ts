import { assertMayRunE2eStudio } from './guard'

/**
 * The browser journeys' studio, from a shell (#145). Run where the database is
 * — on bpvps2, inside the staging stack:
 *
 *   docker compose run --rm -T booking-be npm run -s e2e:studio -- setup
 *   docker compose run --rm -T booking-be npm run -s e2e:studio -- teardown e2e-…
 *   docker compose run --rm -T booking-be npm run -s e2e:studio -- sweep
 *
 * `setup` sweeps studios older than two hours first — a run that was killed
 * never reached its teardown — then prints the new studio as one line,
 * `E2E_STUDIO={…}`, among whatever the app logs. The e2e package reads that line.
 *
 * Runs as the owner (`DATABASE_URL`), like a seed. Refuses production.
 *
 * The studio sells on its own payment account when `E2E_STRIPE_SECRET_KEY` is
 * set — a test-mode key, set up exactly as the super portal would: its webhook
 * endpoint created on the account, both secrets sealed with this environment's
 * `PAYMENT_CREDENTIALS_KEY`. Unset, it takes no online payments (#293), and a
 * journey that pays is refused at checkout.
 */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000

async function main() {
  assertMayRunE2eStudio(process.env.APP_ENV)
  // Before anything reads the environment: the null mail transport is where the
  // members' sign-in codes are read back from, and nothing this run does should
  // reach a real inbox.
  process.env.NODE_ENV = 'test'

  const [command, slug] = process.argv.slice(2)
  const { env } = await import('../env')
  assertMayRunE2eStudio(env.APP_ENV)

  const { drizzle } = await import('drizzle-orm/postgres-js')
  const postgres = (await import('postgres')).default
  const schema = await import('../db/schema')
  const { closeDb } = await import('../db')
  const studio = await import('./studio')

  const owner = postgres(env.DATABASE_URL, { max: 1 })
  const db = drizzle(owner, { schema })
  try {
    if (command === 'setup') {
      const swept = await studio.removeStaleE2eStudios({ db, olderThanMs: STALE_AFTER_MS })
      if (swept.length) console.error(`[e2e] swept stale studios: ${swept.join(', ')}`)
      const { default: app } = await import('../app')
      const secretKey = process.env.E2E_STRIPE_SECRET_KEY?.trim()
      const payments = secretKey ? { secretKey } : undefined
      const made = await studio.createE2eStudio({ app, db, payments })
      console.log(`E2E_STUDIO=${JSON.stringify(made)}`)
    } else if (command === 'teardown' && slug) {
      const removed = await studio.removeE2eStudio({ db, slug })
      console.log(`E2E_REMOVED=${JSON.stringify({ slug, removed })}`)
    } else if (command === 'sweep') {
      const swept = await studio.removeStaleE2eStudios({ db, olderThanMs: STALE_AFTER_MS })
      console.log(`E2E_SWEPT=${JSON.stringify(swept)}`)
    } else {
      throw new Error('usage: e2e:studio setup | teardown <e2e-slug> | sweep')
    }
  } finally {
    await owner.end({ timeout: 5 })
    await closeDb()
  }
}

main().then(
  () => process.exit(0),
  err => {
    console.error('[e2e] failed:', err)
    process.exit(1)
  },
)
