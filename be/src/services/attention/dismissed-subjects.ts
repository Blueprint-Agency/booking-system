import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import { attentionDismissals } from '../../db/schema/attention'

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
