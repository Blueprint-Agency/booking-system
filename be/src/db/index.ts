import './url'
import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema'

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
if (!url) throw new Error('DATABASE_APP_URL is required')

const client = postgres(url)
const pool = drizzle(client, { schema })

type Db = PostgresJsDatabase<typeof schema>
type TenantScope = { tenantId: string; tx: Db }

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
 * including any Stripe or Clerk call inside it. That is the price of a database
 * that can refuse a cross-tenant read; if it starts to bite, the fix is to move
 * the external call out of the request path, not to widen the context.
 */
export async function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return pool.transaction(async tx => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
    return scope.run({ tenantId, tx: tx as unknown as Db }, fn)
  })
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
    const active: any = scope.getStore()?.tx ?? pool
    const value = Reflect.get(active, property, active)
    return typeof value === 'function' ? value.bind(active) : value
  },
})

/** Close the Postgres connection pool — called during graceful shutdown. */
export const closeDb = () => client.end({ timeout: 5 })
