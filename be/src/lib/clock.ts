/**
 * "Now", for every rule that turns on it.
 *
 * A cancellation window, a package's expiry, a daily job's hour: each is a
 * comparison against the current instant, and a rule that reads the wall clock
 * itself can only be tested at whatever time the suite happens to run. The
 * services that apply those rules ask here instead, so a test can stand the
 * whole app at one instant — exactly on a cutoff, a day after an expiry, at
 * 01:00 in one Tenant's zone and not another's — and drive it over HTTP.
 *
 * Production never sets it, so `now()` is `new Date()`.
 *
 * Imports nothing, like `./time`: a rule module can depend on it without
 * gaining a database or an env.
 */

const wallClock = () => new Date()

let source: () => Date = wallClock

/** The current instant. A fresh `Date` each call, so a caller may mutate it. */
export function now(): Date {
  return new Date(source().getTime())
}

/**
 * Replace the clock; `null` puts the wall clock back. The test harness's seam
 * (`TestApp.clock`) — nothing in the app calls it.
 */
export function setClock(next: (() => Date) | null): void {
  source = next ?? wallClock
}
