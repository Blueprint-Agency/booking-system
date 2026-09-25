import { isLocalStack } from './local-stack'
import { startStripeStub } from './stripe-stub'
import { createStudio, removeStudio } from './studio'

/**
 * One studio per run, made before the first journey and removed after the last
 * — including when a journey fails, which is when leaving it behind is likeliest.
 * The backend's own setup also sweeps any e2e studio older than two hours, for
 * the run that was killed before it got here.
 *
 * On the local stack, Stripe is played by this process for the whole run
 * (./stripe-stub.ts).
 */
export default async function globalSetup() {
  const stripe = isLocalStack ? await startStripeStub() : null
  const made = await createStudio()
  process.env.E2E_STUDIO = JSON.stringify(made)
  console.log(`[e2e] studio ${made.slug}: ${made.urls.client} · ${made.urls.portal}`)

  return async () => {
    await stripe?.close()
    if (process.env.E2E_KEEP_STUDIO === '1') {
      console.log(`[e2e] keeping ${made.slug} (E2E_KEEP_STUDIO=1)`)
    } else {
      // A teardown that fails must not turn passing journeys red and hold back a
      // deploy: the next run's setup sweeps any e2e studio older than two hours.
      try {
        removeStudio(made.slug)
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
