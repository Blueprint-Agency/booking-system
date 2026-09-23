/**
 * Deleting a studio from the platform — every row it owns, then the studio.
 *
 * The one irreversible act in the super portal, so it is fenced three ways:
 *
 *  - **Only a studio that is already closed.** It must be `suspended` (or
 *    `archived`) first. Suspension is the reversible step that proves nobody is
 *    working in it; deletion is the step after, never instead.
 *  - **Only by name.** The caller repeats the studio's current Slug, so a
 *    delete aimed at the wrong row is refused rather than carried out.
 *  - **All or nothing.** Every row goes in one transaction; a failure part-way
 *    deletes nothing.
 *
 * **What goes.** Every table with a `tenant_id` column — read from the catalogue
 * by `tenantTableOrder`, the same rule Row-Level Security and the studio archive
 * use, so a table added later is included without anyone remembering this file.
 * That includes the studio's `auth_events` rows and its payment-provider
 * credentials. Then its logins — the `staff` and `client` pools' rows, which are
 * this studio's own (#231) and never part of its archive, so not in that order:
 * sessions, credentials, second factors and verifications, then the users. A
 * member or staff member of another studio has a login there, which is another
 * row. Then `tenant_settings`, then the `tenants` row itself, which takes with it
 * by `ON DELETE CASCADE` its former Slugs. Last, after the commit, the studio's
 * uploads under its own object-storage folder.
 *
 * **What does not.** Anything outside this database and that folder: objects
 * uploaded before keys carried a tenant prefix, the studio's Customers and cards
 * at its payment provider, mail already sent. And the platform's own sign-in
 * audit rows, which were never the studio's.
 *
 * **As the application role, inside the studio's own context.** No bypass: the
 * deletes run in `withTenant`, so Row-Level Security confines each one to this
 * studio exactly as it confines a request — each also names the Tenant, so the
 * backstop is not the only thing standing between this and another studio.
 * `tenants` and `tenant_settings` carry no policy and are deleted by id.
 *
 * Not written to the studio's own `audit_log`, which is deleted with it. The
 * route's log line — who, which studio, how many rows — is the record.
 */
import { eq, getTableName, sql } from 'drizzle-orm'
import { currentTenantId, db, withTenant } from '../../db'
import {
  clientAuthAccounts,
  clientAuthSessions,
  clientAuthUsers,
  clientAuthVerifications,
  staffAuthAccounts,
  staffAuthSessions,
  staffAuthTwoFactors,
  staffAuthUsers,
  staffAuthVerifications,
} from '../../db/schema/auth'
import { tenantImports, tenants, tenantSettings } from '../../db/schema/tenancy'
import { deleteObjectsUnder, R2_BUCKET } from '../../lib/r2'
import { tenantKey } from '../../lib/object-key'
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { forgetCachedTenants } from './tenants'
import { tenantTableOrder } from './transfer'

/** The statuses a studio may be deleted from. Never `active`. */
const DELETABLE = new Set(['suspended', 'archived'])

export interface DeleteTenantInput {
  tenantId: string
  /** The studio's current Slug, typed by the operator as confirmation. */
  confirmSlug: string
}

export interface DeletedTenant {
  id: string
  slug: string
  /** Rows deleted, per table, `tenant_settings` and the login tables included. */
  tables: Record<string, number>
  rows: number
  /** The studio's logins removed, per pool. */
  accounts: { client: number; staff: number }
  /** Uploads removed from object storage; null when storage is not configured
   *  here, or the removal failed (logged, and the rows are gone regardless). */
  objects: number | null
}

export async function deleteTenant(input: DeleteTenantInput): Promise<DeletedTenant> {
  // Same refusal as provisioning and renaming: this opens its own Tenant
  // context, which inside another one would be a savepoint whose setting
  // outlives it.
  const openTenant = currentTenantId()
  if (openTenant) {
    throw new Error(`deleteTenant must not run inside a Tenant context (open: ${openTenant})`)
  }

  // Read before the transaction for the cheap refusals; re-read under a lock
  // inside it, so a studio reactivated in between is not deleted.
  const [before] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1)
  if (!before) throw new NotFoundError('not_found')
  if (input.confirmSlug.trim().toLowerCase() !== before.slug) {
    throw new BadRequestError('confirmation_mismatch')
  }
  if (!DELETABLE.has(before.status)) throw new ConflictError('tenant_not_suspended')

  const { order, deferred } = await tenantTableOrder()
  const tables: Record<string, number> = {}
  const accounts = { client: 0, staff: 0 }
  const id = before.id

  await withTenant(id, async () => {
    const [locked] = await db.select().from(tenants).where(eq(tenants.id, id)).for('update').limit(1)
    if (!locked) throw new NotFoundError('not_found')
    if (!DELETABLE.has(locked.status)) throw new ConflictError('tenant_not_suspended')

    // References no ordering can satisfy (a table pointing at itself, or a
    // cycle) are cleared first, so the children-first deletes below never
    // meet a row still pointed at by one that goes later.
    for (const [table, columns] of Object.entries(deferred)) {
      await db.execute(sql`
        UPDATE ${sql.identifier(table)}
        SET ${sql.join(columns.map(c => sql`${sql.identifier(c)} = NULL`), sql`, `)}
        WHERE tenant_id = ${id}
      `)
    }

    // Children first: the reverse of the order an archive is written back in.
    for (const table of [...order].reverse()) {
      const gone = await db.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${id} RETURNING 1`,
      )
      tables[table] = gone.length
    }

    const settings = await db
      .delete(tenantSettings)
      .where(eq(tenantSettings.tenantId, id))
      .returning({ tenantId: tenantSettings.tenantId })
    tables.tenant_settings = settings.length

    // Its import jobs: not studio data, so not in `order`, and they would go by
    // cascade anyway (migration 0073) — deleted by name so the count is reported.
    const importJobs = await db
      .delete(tenantImports)
      .where(eq(tenantImports.tenantId, id))
      .returning({ id: tenantImports.id })
    tables.tenant_imports = importJobs.length

    // Its logins, before the `tenants` row their `tenant_id` restricts: what
    // hangs off a user first, then the users. The users are also `accounts`.
    for (const pool of ['client', 'staff'] as const) {
      const { users, hangingOff } = LOGINS[pool]
      for (const table of [...hangingOff, users]) {
        const gone = await db.execute(sql`DELETE FROM ${table} WHERE tenant_id = ${id} RETURNING 1`)
        tables[getTableName(table)] = gone.length
        if (table === users) accounts[pool] = gone.length
      }
    }

    // Former Slugs and payment credentials cascade.
    await db.delete(tenants).where(eq(tenants.id, id))
  })

  forgetCachedTenants()

  return {
    id,
    slug: before.slug,
    tables,
    rows: Object.values(tables).reduce((a, b) => a + b, 0),
    accounts,
    objects: await purgeObjects(id),
  }
}

/** Each studio pool's login tables: its users, and what hangs off a user. */
const LOGINS = {
  client: {
    users: clientAuthUsers,
    hangingOff: [clientAuthSessions, clientAuthAccounts, clientAuthVerifications],
  },
  staff: {
    users: staffAuthUsers,
    hangingOff: [staffAuthSessions, staffAuthAccounts, staffAuthTwoFactors, staffAuthVerifications],
  },
}

/**
 * The studio's folder in object storage, after the rows are gone.
 *
 * After the commit, because a bucket cannot roll back: files deleted for a
 * transaction that then failed would leave a studio pointing at nothing. The
 * other order's failure is milder — orphaned files under a folder named by an id
 * that no longer exists — so a failure here is logged, not thrown.
 */
async function purgeObjects(tenantId: string): Promise<number | null> {
  if (!R2_BUCKET) return null
  try {
    return await deleteObjectsUnder(tenantKey(tenantId, ''))
  } catch (err) {
    logger.error({ err, tenantId }, 'platform: deleted tenant’s uploads were not removed')
    return null
  }
}
