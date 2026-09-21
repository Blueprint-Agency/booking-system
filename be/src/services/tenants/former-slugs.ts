/**
 * The Slugs Tenants used to answer on, while their old addresses still redirect.
 *
 * A rename (`./rename.ts`) moves a studio to a new Slug and keeps the old one
 * here for `REDIRECT_WINDOW_DAYS`. Inside that window the old Slug is two
 * things and only two:
 *
 *  - **a redirect target** — the public tenant-by-slug lookup answers it with
 *    the studio's *current* Slug, and the frontends' proxies send the visitor
 *    there, path and query kept;
 *  - **held** — no *other* Tenant may be created on it or renamed to it, so
 *    nobody can stand up on a studio's old address while its bookmarks, old
 *    emails and QR posters still point there. The studio it belongs to may take
 *    it back at any time — renaming straight back needs no wait — and doing so
 *    ends the hold, because the address is that studio's current Slug again.
 *
 * It is never a Tenant. `resolveTenantBySlug` reads `tenants.slug` only, so the
 * API's tenant resolution refuses a former Slug exactly as it refuses one that
 * never existed, and nothing authenticated ever runs on an old host.
 *
 * After the window it is released: the nightly job deletes the row, and a row
 * whose window has passed but that the job has not reached yet already counts
 * for nothing — it neither redirects nor holds.
 */
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import { db } from '../../db'
import { formerSlugs, tenants } from '../../db/schema/tenancy'
import type { TenantStatus } from '../../db/enums'
import { ConflictError } from '../../shared/errors'
import { normaliseSlug } from './slug'

/** How long an old address keeps redirecting, and stays out of anyone else's reach. */
export const REDIRECT_WINDOW_DAYS = 90

/** Why a well-formed slug cannot be had right now. */
export type SlugConflict = 'slug_taken' | 'slug_held'

/** Anything that can run a query: the pool, or a transaction on it. */
type Reader = Pick<typeof db, 'select'>
type Executor = Pick<typeof db, 'execute'>
type Deleter = Pick<typeof db, 'delete'>

/**
 * Serialise every write that claims a Slug — creating a studio, renaming one.
 *
 * `tenants.slug` is unique and `former_slugs.slug` is a primary key, but no
 * constraint spans the two tables, so "not a current Slug and not a held one"
 * is a read followed by a write. Two operators racing — one creating a studio
 * on a slug while another renames a studio away from it — could each pass the
 * read. A transaction-scoped advisory lock makes the pair atomic; it is only
 * ever taken on the super portal's write paths, which are rare and human-paced.
 */
async function lockSlugs(tx: Executor): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tenant-slugs'))`)
}

/**
 * Is this (already validated) slug someone's address right now?
 *
 * `slug_taken` when a Tenant answers on it, `slug_held` when it is a former
 * Slug still inside its redirect window. Null when it is free.
 *
 * `forTenantId` names the studio that wants it, when one does (a rename). A
 * studio's *own* former Slug is free to it: the hold exists to keep other
 * studios off an address whose bookmarks and posters still point at this one,
 * and handing the address back to the studio it points at is the one move that
 * cannot strand anybody. So a studio may be renamed straight back, with no
 * wait; another studio still may not take it until the window ends.
 */
export async function slugConflict(
  reader: Reader,
  slug: string,
  forTenantId?: string,
): Promise<SlugConflict | null> {
  const [current] = await reader
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1)
  if (current) return 'slug_taken'

  const [held] = await reader
    .select({ slug: formerSlugs.slug, renamedTenantId: formerSlugs.renamedTenantId })
    .from(formerSlugs)
    .where(and(eq(formerSlugs.slug, slug), gt(formerSlugs.redirectUntil, sql`now()`)))
    .limit(1)
  if (!held) return null
  return held.renamedTenantId === forTenantId ? null : 'slug_held'
}

/**
 * Claim a slug for a write — creating a studio on it, or renaming one to it.
 * Takes the lock, then refuses a slug that is taken or held; the caller writes
 * inside the same transaction. The one gate every slug-claiming write goes
 * through, so a new one cannot skip the lock.
 *
 * `forTenantId` is the renamed studio, which may reclaim its own former Slug —
 * see `slugConflict`. Creating a studio names none.
 */
export async function claimSlug(
  tx: Reader & Executor,
  slug: string,
  forTenantId?: string,
): Promise<void> {
  await lockSlugs(tx)
  const conflict = await slugConflict(tx, slug, forTenantId)
  if (conflict) throw new ConflictError(conflict, { slug })
}

/** Statuses whose old addresses still redirect — the same ones a Slug resolves for. */
const REDIRECTABLE: TenantStatus[] = ['active', 'suspended']

/**
 * Where a former Slug's visitors should go: the renamed studio's *current*
 * Slug, or null.
 *
 * Current rather than the Slug it was renamed to at the time, so a studio
 * renamed twice sends its first address straight to its latest one. Null for a
 * slug that was never a former one, one whose window has passed, and one whose
 * studio has since been archived — an archived studio's address must look like
 * one that never existed, whichever of its addresses is asked about.
 */
export async function redirectForFormerSlug(slug: string): Promise<string | null> {
  const normalised = normaliseSlug(slug)
  if (!normalised) return null

  const [row] = await db
    .select({ slug: tenants.slug })
    .from(formerSlugs)
    .innerJoin(tenants, eq(tenants.id, formerSlugs.renamedTenantId))
    .where(
      and(
        eq(formerSlugs.slug, normalised),
        gt(formerSlugs.redirectUntil, sql`now()`),
        inArray(tenants.status, REDIRECTABLE),
      ),
    )
    .limit(1)
  return row?.slug ?? null
}

/**
 * Drop expired rows for these slugs, so a slug that is free can be recorded
 * as a former Slug again later. Called inside the rename's transaction.
 */
export async function clearExpired(tx: Deleter, slugs: string[]): Promise<void> {
  await tx
    .delete(formerSlugs)
    .where(and(inArray(formerSlugs.slug, slugs), lte(formerSlugs.redirectUntil, sql`now()`)))
}

/**
 * Drop this studio's own former-Slug rows for these slugs, whatever their
 * window. Called inside a rename: the Slug the studio is moving back to stops
 * being a former one the moment it is current again, and a row left behind
 * would redirect the studio's live address to itself and collide with the
 * primary key the next time the studio moves away from it.
 */
export async function releaseOwn(tx: Deleter, tenantId: string, slugs: string[]): Promise<void> {
  await tx
    .delete(formerSlugs)
    .where(and(inArray(formerSlugs.slug, slugs), eq(formerSlugs.renamedTenantId, tenantId)))
}

/**
 * The nightly release: delete every former Slug whose redirect window has
 * ended. Platform-wide, so it runs outside any Tenant context — the table has
 * no `tenant_id` and no policy.
 */
export async function releaseExpiredFormerSlugs(): Promise<number> {
  const released = await db
    .delete(formerSlugs)
    .where(lte(formerSlugs.redirectUntil, sql`now()`))
    .returning({ slug: formerSlugs.slug })
  return released.length
}
