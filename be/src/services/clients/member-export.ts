import { sql } from 'drizzle-orm'
import { db } from '../../db'
import { NotFoundError } from '../../shared/errors'
import { recordStaffAct } from '../auth/staff-acts'
import { loadTenantById } from '../tenants/tenants'
import { ARCHIVE_VERSION, type MemberArchive } from '../tenants/transfer-shape'
import { getClientById } from './manage'
import { MEMBER_TABLES } from './member-tables'

/**
 * Everything this studio holds about one member, to answer their access
 * request (#143) — and the act of taking it, logged as the acting staff
 * member's.
 *
 * Soft-deleted members are included: a request can arrive after a studio has
 * removed someone, and what it holds about them has not gone anywhere.
 *
 * Every read names the Tenant as well as the member. Row-Level Security would
 * scope it anyway; this is the one export where a row from the wrong studio is
 * a disclosure to a third party, so it does not rest on the backstop alone.
 */
export async function exportMember(input: {
  tenantId: string
  clientId: string
  actorStaffId: string
  from?: Headers
}): Promise<MemberArchive> {
  const { tenantId, clientId } = input
  const member = await getClientById(tenantId, clientId)
  const tenant = await loadTenantById(tenantId)
  if (!tenant) throw new NotFoundError('tenant_not_found')

  const key = { clientId: member.id, authUserId: member.authUserId }
  const rows: MemberArchive['rows'] = {}
  const counts: Record<string, number> = {}
  for (const entry of MEMBER_TABLES) {
    const found = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${sql.identifier(entry.table)} WHERE tenant_id = ${tenantId} AND ${entry.where(key)}`,
    )
    rows[entry.table] = [...found]
    counts[entry.table] = found.length
  }

  await recordStaffAct({
    tenantId,
    actorStaffId: input.actorStaffId,
    kind: 'member_data_exported',
    subjectUserId: member.authUserId,
    from: input.from,
  })

  return {
    manifest: {
      version: ARCHIVE_VERSION,
      kind: 'member',
      exportedAt: new Date().toISOString(),
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      member: { id: member.id, name: member.name, email: member.email },
      tables: MEMBER_TABLES.map(t => t.table),
      counts,
    },
    rows,
  }
}
