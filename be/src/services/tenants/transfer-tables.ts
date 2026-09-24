import { getTableName } from 'drizzle-orm'
import * as schema from '../../db/schema'

// Which of the tables carrying a `tenant_id` are a studio's rows, and so go into
// its archive. No database import, so the rule is testable without one.

/**
 * The `staff` and `client` pools' tables. A login is never part of a studio's
 * archive: its password hash, 2FA secret, sessions and verifications are
 * secrets, and a restore makes each person a fresh login instead (#229).
 *
 * Named, not inferred from the catalogue. Today these tables have no
 * `tenant_id` and the catalogue rule leaves them out anyway; once the pools are
 * per studio they will, and nothing but this list would keep them out.
 */
export const LOGIN_TABLES: readonly string[] = [
  schema.clientAuthUsers,
  schema.clientAuthAccounts,
  schema.clientAuthSessions,
  schema.clientAuthVerifications,
  schema.staffAuthUsers,
  schema.staffAuthAccounts,
  schema.staffAuthSessions,
  schema.staffAuthVerifications,
  schema.staffAuthTwoFactors,
].map(getTableName)

/**
 * `tenant_settings` has no place in the write order: it is read before any
 * Tenant context exists, so migration 0033 leaves it outside Row-Level
 * Security, and the archive carries it separately.
 *
 * `tenant_imports` is the platform's record of restoring this studio, not part
 * of the studio: exporting it would put one environment's job history into an
 * archive, and counting it would make every studio with an import in flight look
 * non-empty to that same import. It goes with the studio on delete by
 * `ON DELETE CASCADE` instead (migration 0073).
 */
const NOT_STUDIO_ROWS = new Set(['tenant_settings', 'tenant_imports', ...LOGIN_TABLES])

/** The studio's own tables, out of every table the catalogue says has a `tenant_id`. */
export function studioTables(withTenantId: readonly string[]): string[] {
  return withTenantId.filter(t => !NOT_STUDIO_ROWS.has(t))
}
