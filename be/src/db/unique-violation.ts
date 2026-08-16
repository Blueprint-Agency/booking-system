/**
 * Did this write lose a race for a unique index?
 *
 * Drizzle wraps the driver error, so the Postgres `23505` sits on `.cause`
 * rather than on the error we catch, and the wrapper's `message` carries the
 * query text rather than the constraint name. Reading `err.code` or
 * `err.message` directly misses every collision and leaks the raw query to the
 * caller as a 500. Walk `.cause` instead.
 *
 * Pass `constraint` when a service maps one specific index to one domain rule —
 * a table usually has more than one, and the wrong 409 is its own bug. The field
 * is postgres.js's `constraint_name`; node-pg would spell it `constraint`.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const cand = e as { code?: string; constraint_name?: string; cause?: unknown }
    if (cand.code === '23505') return !constraint || cand.constraint_name === constraint
    e = cand.cause
  }
  return false
}
