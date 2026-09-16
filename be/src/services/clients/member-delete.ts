import { eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { clientAuthUsers } from '../../db/schema/auth'
import { endClientSessionsAt } from '../auth/auth-users'
import { recordStaffAct } from '../auth/staff-acts'
import { getClientById } from './manage'
import { MEMBER_TABLES, eraseSteps } from './member-tables'

/**
 * Permanently delete a member at this studio, on their request (#144). Beside
 * blocking (`softDeleteClient`), which stays the reversible option.
 *
 * Every row `MEMBER_TABLES` finds for them goes, except the rows each table's
 * `erase` says to keep — the studio's accounts — which stay with the member's
 * identity removed. What is kept, and why, is `docs/md/member-data-retention.md`.
 *
 * **Their sign-in account goes only if no studio still has them.** One person
 * holds one `client_auth_users` row across every studio they have joined; this
 * studio deleting its record of them is not this studio deleting them from
 * another. Which studios that is, this studio's context cannot see, so the
 * question goes to `client_auth_user_is_member` (migration 0060), which answers
 * yes or no and nothing else.
 *
 * Runs inside the request's transaction, so a failure part-way deletes nothing.
 * Every statement names the Tenant as well as the member, as the export does:
 * Row-Level Security would scope it anyway, and a delete in the wrong studio is
 * not one to rest on the backstop alone.
 *
 * Logged as `member_deleted` with no subject: the act is on record, the member
 * it was about is not.
 */
export async function deleteMemberPermanently(input: {
  tenantId: string
  clientId: string
  actorStaffId: string
  from?: Headers
}): Promise<void> {
  const { tenantId } = input
  const member = await getClientById(tenantId, input.clientId)
  const key = { clientId: member.id, authUserId: member.authUserId, email: member.email }

  await endClientSessionsAt(db, tenantId, member.authUserId)

  // Backwards, so a row is dealt with before the row it references.
  for (const entry of [...MEMBER_TABLES].reverse()) {
    const table = sql.identifier(entry.table)
    for (const step of eraseSteps(entry)) {
      if ('delete' in step) {
        await db.execute(sql`DELETE FROM ${table} WHERE tenant_id = ${tenantId} AND ${step.delete(key)}`)
      } else {
        await db.execute(sql`UPDATE ${table} SET ${step.set} WHERE tenant_id = ${tenantId} AND ${step.where(key)}`)
      }
    }
  }

  const [elsewhere] = await db.execute<{ member: boolean }>(
    sql`SELECT public.client_auth_user_is_member(${member.authUserId}) AS member`,
  )
  // Their sessions and credentials at the auth server cascade with it. Which way
  // this went is not returned: it would tell this studio whether the person is a
  // member of another.
  if (!elsewhere?.member) await db.delete(clientAuthUsers).where(eq(clientAuthUsers.id, member.authUserId))

  await recordStaffAct({
    tenantId,
    actorStaffId: input.actorStaffId,
    kind: 'member_deleted',
    subjectUserId: null,
    from: input.from,
  })
}
