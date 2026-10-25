import assert from 'node:assert/strict'
import { sql, type SQL } from 'drizzle-orm'
import type { TestApp } from './harness'

/** The transaction holding the row. The harness has one connection, so a call that reads the database mid-race reads through this. */
export type Holder = Parameters<Parameters<TestApp['db']['transaction']>[0]>[0]

/**
 * Make a race happen every run, not by luck of timing. Holds the row `lock`
 * selects in a transaction of its own, starts each call only once every call
 * before it shows in Postgres as queued behind that row (directly, or behind a
 * call queued before it), waits for the last the same way, then lets go.
 */
export async function inFlightTogether<T>(
  db: TestApp['db'],
  lock: SQL,
  calls: ((holder: Holder) => T | Promise<T>)[],
): Promise<T[]> {
  const pending = await db.transaction(async tx => {
    const held = await tx.execute(sql`${lock} FOR UPDATE`)
    assert.equal(held.length, 1, 'the row to hold exists')
    const [holder] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
    assert.ok(holder)
    const started: Promise<T>[] = []
    for (const call of calls) {
      let answered: T | null = null
      started.push(Promise.resolve(call(tx)).then(res => (answered = res)))
      const deadline = Date.now() + 10_000
      for (;;) {
        const [queue] = await tx.execute<{ n: number }>(sql`
          WITH RECURSIVE queue(pid) AS (
            SELECT pid FROM pg_locks WHERE NOT granted AND ${holder.pid}::int = ANY(pg_blocking_pids(pid))
            UNION
            SELECT l.pid FROM pg_locks l, queue q WHERE NOT l.granted AND q.pid = ANY(pg_blocking_pids(l.pid))
          )
          SELECT count(DISTINCT pid)::int AS n FROM queue`)
        if (queue!.n >= started.length) break
        assert.equal(answered, null, `call ${started.length} answered before it queued: ${JSON.stringify(answered)}`)
        assert.ok(Date.now() < deadline, `call ${started.length} never queued behind the held row`)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
    return started
  })
  return Promise.all(pending)
}
