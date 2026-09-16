import { and, eq } from 'drizzle-orm'
import { db } from '../../db'
import type { AuthEventKind } from '../../db/enums'
import { staffUsers } from '../../db/schema/identity'
import { recordAuthEvent } from './auth-events'
import { requestAddress } from './better-auth'

/** What a staff member can do to someone else's account from their detail view (#119, #143, #144). */
export type StaffActKind = Extract<
  AuthEventKind,
  | 'sessions_revoked'
  | 'user_blocked'
  | 'user_unblocked'
  | 'invitation_resent'
  | 'member_data_exported'
  | 'member_deleted'
>

/**
 * Log a staff member's act on someone else's account, at the Tenant whose
 * context is open.
 *
 * Filed under `staff`, the acting staff member's auth user as actor and the
 * person acted on as subject — the shape an impersonation's rows already have
 * (#118). The subject is a `client` pool user when the target is a member.
 *
 * `from` is the acting staff member's request, whose address and user agent the
 * row records. An actor whose row cannot be read is logged with no actor rather
 * than refused: the act has already happened, and `audit_log` names their
 * `staff_users` row regardless.
 */
export async function recordStaffAct(input: {
  tenantId: string
  actorStaffId: string
  kind: StaffActKind
  subjectUserId: string | null
  from?: Headers
}): Promise<void> {
  const [actor] = await db
    .select({ authUserId: staffUsers.authUserId })
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, input.tenantId), eq(staffUsers.id, input.actorStaffId)))
    .limit(1)
  const address = input.from ? await requestAddress(input.from) : { ip: null, userAgent: null }
  await recordAuthEvent({
    pool: 'staff',
    kind: input.kind,
    actorUserId: actor?.authUserId ?? null,
    subjectUserId: input.subjectUserId,
    ...address,
  })
}
