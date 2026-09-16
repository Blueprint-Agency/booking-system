import { createStudio, removeStudio } from './studio'

/**
 * One studio per run, made before the first journey and removed after the last
 * — including when a journey fails, which is when leaving it behind is likeliest.
 * The backend's own setup also sweeps any e2e studio older than two hours, for
 * the run that was killed before it got here.
 */
export default async function globalSetup() {
  const made = createStudio()
  process.env.E2E_STUDIO = JSON.stringify(made)
  console.log(`[e2e] studio ${made.slug}: ${made.urls.client} · ${made.urls.portal}`)

  return async () => {
    if (process.env.E2E_KEEP_STUDIO === '1') {
      console.log(`[e2e] keeping ${made.slug} (E2E_KEEP_STUDIO=1)`)
      return
    }
    // A teardown that fails must not turn passing journeys red and hold back a
    // deploy: the next run's setup sweeps any e2e studio older than two hours.
    try {
      removeStudio(made.slug)
      console.log(`[e2e] removed ${made.slug}`)
    } catch (err) {
      console.warn(`::warning::[e2e] could not remove ${made.slug}; the next run sweeps it. ${String(err)}`)
    }
  }
}
