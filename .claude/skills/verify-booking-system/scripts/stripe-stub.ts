/**
 * The e2e Stripe stub (e2e/src/stripe-stub.ts), as a long-lived process of its
 * own for `stack.mjs up`. A call the stub does not play is printed as an
 * `UNHANDLED` line, which `stack.mjs doctor` reports: the app asked Stripe for
 * something no verification run can answer.
 */
import { startStripeStub } from '../../../../e2e/src/stripe-stub'

async function main() {
  const stub = await startStripeStub()
  let reported = 0
  setInterval(() => {
    while (reported < stub.unhandled.length) console.log(`[stub] UNHANDLED ${stub.unhandled[reported++]}`)
  }, 1000)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
