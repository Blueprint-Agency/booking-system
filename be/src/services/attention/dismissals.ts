import { db } from '../../db'
import { attentionDismissals } from '../../db/schema/attention'
import { auditLog } from '../../db/schema/ledger'
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { contextFor, type AttentionCaller } from './index'
import { providers } from './registry'

/**
 * Dismissals (#476, #482): the studio's decision that a dismissable Attention
 * item needs nothing done. It hides the item for every admin, is recorded once
 * per item, and is audited under the admin's name.
 */

/**
 * Dismiss one item. `403` for a caller who is not an admin; `422
 * not_dismissable` for a kind that is not (the route has already refused a kind
 * the registry does not hold, as an invalid request); `404` when the
 * item is not open now (never was, resolved, or already dismissed).
 */
export async function dismissItem(
  caller: AttentionCaller,
  input: { kind: string; subjectId: string },
): Promise<void> {
  if (caller.role !== 'admin') throw new ForbiddenError('forbidden_role')
  const provider = providers.find(p => p.kind === input.kind)
  if (!provider || !provider.dismissable || !provider.isOpen) throw new AppError(422, 'not_dismissable')

  const ctx = await contextFor(caller)
  if (!provider.appliesTo(ctx) || !(await provider.isOpen(ctx, input.subjectId))) throw new NotFoundError('not_found')

  const inserted = await db
    .insert(attentionDismissals)
    .values({
      tenantId: caller.tenantId,
      kind: provider.kind,
      subjectId: input.subjectId,
      dismissedByStaffId: caller.staffId,
    })
    .onConflictDoNothing()
    .returning({ id: attentionDismissals.id })
  // Dismissed a moment ago by someone else: no longer open.
  if (inserted.length === 0) throw new NotFoundError('not_found')

  await db.insert(auditLog).values({
    tenantId: caller.tenantId,
    actorStaffId: caller.staffId,
    actorType: 'staff',
    action: 'attention.dismissed',
    targetTable: 'attention_dismissals',
    targetId: input.subjectId,
    payload: { kind: provider.kind, subject_id: input.subjectId },
  })
}
