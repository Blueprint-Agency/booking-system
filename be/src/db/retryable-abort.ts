/**
 * Did Postgres abort this transaction to break a deadlock (`40P01`) or a
 * serialization conflict (`40001`)?
 *
 * Neither says the work was wrong, only that it met another transaction at a
 * bad moment, so the same work run again from the start can go through
 * (`retryingTransaction` in `./index.ts`). Drizzle hangs the driver's error on
 * `.cause`, so the chain is walked as `isUniqueViolation` walks it.
 */
export function isRetryableAbort(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const cand = e as { code?: string; cause?: unknown }
    if (cand.code === '40P01' || cand.code === '40001') return true
    e = cand.cause
  }
  return false
}
