import { rmSync, writeFileSync } from 'node:fs'
import { isLocalStack } from './local-stack'
import { startStripeStub } from './stripe-stub'
import { createStudio, removeStudio, STUDIO_SLUG_FILE } from './studio'

/**
 * One studio per run, made before the first journey and removed after the last
 * — including when a journey fails, which is when leaving it behind is likeliest.
 * A job cancelled or timed out never gets here; the staging workflow tears the
 * studio down itself from `STUDIO_SLUG_FILE` (e2e.yml), and the backend's own
 * setup sweeps any e2e studio older than two hours besides.
 *
 * On the local stack, Stripe is played by this process for the whole run
 * (./stripe-stub.ts).
 */
export default async function globalSetup() {
  const stripe = isLocalStack ? await startStripeStub() : null
  const made = await createStudio()
  process.env.E2E_STUDIO = JSON.stringify(made)
  // For the workflow's own cleanup step, which runs even when the job is
  // cancelled or times out — when this process never reaches its teardown.
  writeFileSync(STUDIO_SLUG_FILE, made.slug)
  console.log(`[e2e] studio ${made.slug}: ${made.urls.client} · ${made.urls.portal}`)

  // The studio is made over SSH, so a runner that cannot reach the API over
  // HTTPS gets this far — and then every journey waits out its full timeout on
  // requests that never answer. Say so once, in seconds, instead.
  try {
    await assertApiReachable(made.urls.api)
  } catch (err) {
    await stripe?.close()
    try {
      removeStudio(made.slug)
      rmSync(STUDIO_SLUG_FILE, { force: true })
    } catch {
      // Left in STUDIO_SLUG_FILE for the workflow's cleanup step; the reason worth reading is `err`.
    }
    throw err
  }

  return async () => {
    await stripe?.close()
    if (process.env.E2E_KEEP_STUDIO === '1') {
      console.log(`[e2e] keeping ${made.slug} (E2E_KEEP_STUDIO=1)`)
    } else {
      // A teardown that fails must not turn passing journeys red and hold back a
      // deploy: the next run's setup sweeps any e2e studio older than two hours.
      try {
        removeStudio(made.slug)
        rmSync(STUDIO_SLUG_FILE, { force: true })
        console.log(`[e2e] removed ${made.slug}`)
      } catch (err) {
        console.warn(`::warning::[e2e] could not remove ${made.slug}; the next run sweeps it. ${String(err)}`)
      }
    }
    // Unlike a failed cleanup, this is a finding: the app made a Stripe call the
    // stub does not play, so a journey that passed may have passed around it.
    if (stripe?.unhandled.length) {
      throw new Error(
        `the Stripe stub was asked for calls it does not play — add them to e2e/src/stripe-stub.ts:\n  ${stripe.unhandled.join('\n  ')}`,
      )
    }
  }
}

/** The backend's `/health`, from this machine, as the browser will reach it. A few tries for a blip. */
async function assertApiReachable(api: string): Promise<void> {
  const health = new URL('/health', api).toString()
  let last = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(health, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) return
      last = `answered ${res.status}`
    } catch (err) {
      last = String(err)
    }
    await new Promise(r => setTimeout(r, 5_000))
  }
  throw new Error(`[e2e] this machine cannot reach the API at ${health} (${last}); no journey would get an answer from it`)
}
