import './url'
import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema'
import { reportError } from '../shared/logger'

/**
 * The app connects as `booking_app`, NOT as the owner in `DATABASE_URL`.
 *
 * Migrations and seeds still run as the owner (src/db/migrate.ts), because they
 * have to create tables and write across tenants. Everything the server does at
 * runtime goes through this pool, and the difference is the entire reason the
 * Row-Level Security policies in migration 0033 are enforceable: the owner —
 * and any superuser — bypasses them.
 *
 * Required, with no fall back to `DATABASE_URL`. A fallback is exactly the bug
 * this guards against: the app would keep working, every test would pass, and
 * isolation would be nothing but a comment.
 */
const url = process.env.DATABASE_APP_URL
// Invariant: boot-time configuration — the process does not start without it.
if (!url) throw new Error('DATABASE_APP_URL is required')

const client = postgres(url)
const pool = drizzle(client, { schema })

type Db = PostgresJsDatabase<typeof schema>
/** Work to run once the transaction a scope opened has committed. */
type AfterCommitWork = () => Promise<unknown> | unknown
type TenantScope = { tenantId: string; tx: Db; afterCommit: AfterCommitWork[] }

const scope = new AsyncLocalStorage<TenantScope>()

/**
 * Run `fn` with a Tenant context the database can see.
 *
 * Opens one transaction, writes `app.tenant_id` into it, and makes that
 * transaction the `db` every query inside `fn` reaches. The policies in 0033
 * read the setting back, so a query that forgets its `WHERE tenant_id = ?`
 * returns this tenant's rows rather than everybody's.
 *
 * **Transaction-local, via the third argument to `set_config`.** Session scope
 * would survive the connection's return to the pool and be inherited by whoever
 * picked it up next — which on a busy server means one studio's request reading
 * another studio's data, the precise failure the policies exist to prevent.
 * `src/test/rls.test.ts` pins that down.
 *
 * The cost is that a request holds a pooled connection for its whole life,
 * including any Stripe or mail call inside it. That is the price of a database
 * that can refuse a cross-tenant read; if it starts to bite, the fix is to move
 * the external call out of the request path, not to widen the context. Mail
 * already is: it goes through `afterCommit`, which runs once this transaction
 * has committed.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: () => Promise<T>,
  options: { isolation?: 'repeatable read' } = {},
): Promise<T> {
  const work: AfterCommitWork[] = []
  const result = await pool.transaction(async tx => {
    // Before anything else, because Postgres refuses SET TRANSACTION once the
    // transaction has run a query — and `set_config` below is a query.
    //
    // The default is READ COMMITTED, where every statement takes its own
    // snapshot. That is right for a request, which reads a little and writes a
    // little, and wrong for anything that reads many tables and expects them to
    // agree: a row inserted between two of the reads is in one and not the
    // other. `exportTenant` is that case, and a studio archive whose bookings
    // reference a member the archive does not contain only fails on the day it
    // is restored.
    if (options.isolation === 'repeatable read') {
      await tx.execute(sql`set transaction isolation level repeatable read`)
    }
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
    return scope.run({ tenantId, tx: tx as unknown as Db, afterCommit: work }, fn)
  })
  // Committed. A transaction that threw never reaches here, so its work is
  // dropped with it.
  await runAfterCommit(tenantId, work)
  return result
}

/**
 * Run `work` once the transaction this code runs in has committed: an email
 * announcing a booking, never anything the write itself depends on.
 *
 * A studio request is ONE transaction (middleware/tenant.ts opens it), so a
 * service's own `db.transaction` is only a savepoint inside it. Work done when
 * that savepoint returns still happens before COMMIT: it holds the request's
 * row locks across a mail provider's call, and a database error on its path
 * aborts the request's transaction under a write the route already answered.
 * Registered here, it waits for the outermost `withTenant` — the request's, a
 * scheduled job's per-Tenant step, a webhook delivery's — to commit.
 *
 * - Dropped if that transaction rolls back, or if the savepoint (`db.transaction`)
 *   it was registered in does.
 * - Run in the order registered, each in a Tenant context and transaction of its
 *   own, so it reads and writes as the code that registered it could, and one
 *   piece's database error cannot undo another's.
 * - A failure is reported and goes no further: the write is committed, and the
 *   caller's result — a request's response — is already decided.
 *
 * The outermost `withTenant` awaits the work before it returns, so a request
 * answers once its emails are handed over — after the transaction, not inside it.
 *
 * Outside any Tenant context there is no transaction to wait for, and that is
 * a wiring bug, so it throws.
 */
export function afterCommit(work: AfterCommitWork): void {
  const store = scope.getStore()
  // Invariant: only code running inside `withTenant` registers after-commit work.
  if (!store) throw new Error('afterCommit called outside a Tenant context')
  store.afterCommit.push(work)
}

async function runAfterCommit(tenantId: string, work: readonly AfterCommitWork[]): Promise<void> {
  for (const run of work) {
    try {
      await withTenant(tenantId, async () => {
        await run()
      })
    } catch (err) {
      reportError(err, 'after-commit work failed', { scope: 'after-commit', tenantId })
    }
  }
}

/** The Tenant whose context is currently open, or null outside `withTenant`. */
export function currentTenantId(): string | null {
  return scope.getStore()?.tenantId ?? null
}

/**
 * The database handle every service imports.
 *
 * Inside `withTenant` it *is* that transaction, so services keep writing plain
 * `db.select(...)` and get the Tenant context for free — there is no second
 * handle to remember to use, and therefore no way to forget it. Outside one it
 * is the bare pool, which reaches only the two tables RLS does not cover —
 * `tenants` and `tenant_settings`, read during slug resolution before any tenant
 * is known — and returns nothing anywhere else.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, property, _receiver) {
    const store = scope.getStore()
    // A savepoint that rolls back takes the after-commit work registered
    // inside it along (see `afterCommit`).
    if (property === 'transaction' && store) return savepoint(store)
    const active: any = store?.tx ?? pool
    const value = Reflect.get(active, property, active)
    return typeof value === 'function' ? value.bind(active) : value
  },
})

/** `db.transaction` inside a Tenant context: a savepoint whose rollback drops its after-commit work. */
function savepoint(store: TenantScope): Db['transaction'] {
  return (async (fn: Parameters<Db['transaction']>[0], config?: Parameters<Db['transaction']>[1]) => {
    const mark = store.afterCommit.length
    try {
      return await store.tx.transaction(fn, config)
    } catch (err) {
      store.afterCommit.length = mark
      throw err
    }
  }) as Db['transaction']
}

/** Close the Postgres connection pool — called during graceful shutdown. */
export const closeDb = () => client.end({ timeout: 5 })
