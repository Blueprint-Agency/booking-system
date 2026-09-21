/**
 * A studio's Term: the stretch of time it has paid for.
 *
 * Two calendar dates on the `tenants` row, both on the studio's own clock
 * (`tenants.timezone`):
 *
 *  - **start** — the first day of the Term. Defaults to the day the studio was
 *    provisioned; the operator may move it.
 *  - **end** — the first day the studio is *no longer* paid for: start plus the
 *    duration the operator picked (3, 6 or 12 months). Stored rather than the
 *    duration, because the end is what every check reads and the duration is
 *    only how the operator arrived at it. Null means no end has been set — an
 *    open-ended Term, which is what every studio that predates Terms has.
 *
 * **A studio whose Term has ended counts as suspended the moment it ends**, on
 * every read of its status that decides anything (`effectiveStatus`), without
 * waiting for anything to write it. The sweep (`suspendEndedTerms`, every 15
 * minutes) then makes that true of the row too, so the super portal's list and
 * every other plain read of `status` agree — but nothing depends on the sweep
 * having run, so there is no gap between ticks.
 *
 * **Reactivating a studio whose Term has ended is refused** (`tenant_term_ended`)
 * until the Term is extended: otherwise the next request would find it suspended
 * again, and the next sweep would write that down. Extending does not reactivate
 * by itself — a studio suspended for another reason looks the same from here.
 *
 * The calendar arithmetic is in `./term-dates.ts`, which needs no database.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../../db'
import { tenants } from '../../db/schema/tenancy'
import type { TenantRow } from '../../db/schema/tenancy'
import { NotFoundError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { termEndDate, type TermMonths } from './term-dates'
import { forgetCachedTenants } from './tenants'

export {
  effectiveStatus,
  isIsoDate,
  localDate,
  TERM_MONTHS,
  termEndDate,
  termEnded,
  todayFor,
  type TermMonths,
} from './term-dates'

/**
 * Set a studio's Term: a start date and a duration, from which the end is
 * computed and stored. Returns the updated row.
 */
export async function setTenantTerm(
  id: string,
  input: { startDate: string; months: TermMonths },
): Promise<TenantRow> {
  const endDate = termEndDate(input.startDate, input.months)
  const [row] = await db
    .update(tenants)
    .set({ termStartDate: input.startDate, termEndDate: endDate, updatedAt: new Date() })
    .where(eq(tenants.id, id))
    .returning()
  forgetCachedTenants()
  if (!row) throw new NotFoundError('not_found')
  return row
}

/**
 * The sweep: write `suspended` onto every active studio whose Term has ended.
 *
 * Platform-wide and outside any Tenant context — `tenants` carries no policy —
 * and decided in SQL on each studio's own clock, so one statement covers every
 * zone.
 */
export async function suspendEndedTerms(): Promise<Array<{ id: string; slug: string }>> {
  const suspended = await db
    .update(tenants)
    .set({ status: 'suspended', updatedAt: new Date() })
    .where(
      and(
        eq(tenants.status, 'active'),
        isNotNull(tenants.termEndDate),
        sql`(now() AT TIME ZONE ${tenants.timezone})::date >= ${tenants.termEndDate}`,
      ),
    )
    .returning({ id: tenants.id, slug: tenants.slug, termEndDate: tenants.termEndDate })

  if (suspended.length > 0) {
    forgetCachedTenants()
    for (const row of suspended) {
      logger.warn(
        { tenantId: row.id, termEndDate: row.termEndDate },
        'platform: tenant suspended at the end of its term',
      )
    }
  }
  return suspended.map(({ id, slug }) => ({ id, slug }))
}
