import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '../../db'
import { attentionDismissals } from '../../db/schema/attention'

/**
 * "This row's id has not been dismissed", as SQL, so a count and a list can both
 * leave dismissed items out without loading the dismissals: `subjectId` is the
 * column the kind's subject id is taken from (the purchase, the booking).
 */
export function notDismissed(tenantId: string, kind: string, subjectId: AnyPgColumn): SQL {
  return sql`not exists (
    select 1 from ${attentionDismissals}
    where ${attentionDismissals.tenantId} = ${tenantId}
      and ${attentionDismissals.kind} = ${kind}
      and ${attentionDismissals.subjectId} = ${subjectId}
  )`
}

/**
 * The subject ids of `kind` the studio has dismissed (#482): what a dismissable
 * kind's provider leaves out of its count and its list. Kept apart from
 * `dismissals.ts` so a provider can import it without a cycle through the registry.
 */
export async function dismissedSubjects(tenantId: string, kind: string): Promise<Set<string>> {
  const rows = await db
    .select({ subjectId: attentionDismissals.subjectId })
    .from(attentionDismissals)
    .where(and(eq(attentionDismissals.tenantId, tenantId), eq(attentionDismissals.kind, kind)))
  return new Set(rows.map(r => r.subjectId))
}
