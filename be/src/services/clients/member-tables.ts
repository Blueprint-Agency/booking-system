import { getTableName, sql, type SQL } from 'drizzle-orm'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'

/**
 * Where a member lives in the database: every Tenant-scoped table with a row
 * that names them, and the column that does the naming (#143).
 *
 * One list, because two features read it. Member export hands over what the
 * studio holds about someone; member deletion (#105) has to reach exactly the
 * same rows, and a table one knows about and the other does not is either a
 * leak or a member who was not really deleted.
 *
 * No database import, so the guard test that holds this list to the schema
 * runs without one.
 */

/** The member a row is matched against. */
export type MemberKey = {
  /** Their `clients.id` at this Tenant. */
  clientId: string
  /** Their `client_auth_users` id, which the sign-in log records. */
  authUserId: string
}

export type MemberTable = {
  table: string
  /**
   * The columns that name the member. Empty for a table reached only through
   * another one (`via`) — its rows are about the member, but name them nowhere.
   */
  columns: string[]
  /** The parent table this one is reached through, when `columns` is empty. */
  via?: string
  /** The rows in `table` that belong to the member. The caller adds the Tenant. */
  where: (member: MemberKey) => SQL
}

const byClientId = (table: string): MemberTable => ({
  table,
  columns: ['client_id'],
  where: m => sql`client_id = ${m.clientId}`,
})

export const MEMBER_TABLES: readonly MemberTable[] = [
  { table: 'clients', columns: ['id'], where: m => sql`id = ${m.clientId}` },
  byClientId('bookings'),
  byClientId('cancellations'),
  {
    table: 'check_ins',
    columns: [],
    via: 'bookings',
    where: m => sql`booking_id IN (SELECT id FROM bookings WHERE client_id = ${m.clientId})`,
  },
  byClientId('client_packages'),
  byClientId('manual_adjustments'),
  byClientId('stripe_payments'),
  byClientId('promo_code_redemptions'),
  byClientId('merch_orders'),
  byClientId('waiver_signatures'),
  {
    table: 'pt_requests',
    // The requester, or the member they named as their 2-on-1 partner.
    columns: ['client_id', 'co_client_id'],
    where: m => sql`(client_id = ${m.clientId} OR co_client_id = ${m.clientId})`,
  },
  {
    table: 'pt_request_slots',
    columns: [],
    via: 'pt_requests',
    where: m =>
      sql`pt_request_id IN (SELECT id FROM pt_requests WHERE client_id = ${m.clientId} OR co_client_id = ${m.clientId})`,
  },
  byClientId('pt_session_clients'),
  {
    table: 'pt_sessions',
    columns: [],
    via: 'pt_session_clients',
    where: m => sql`id IN (SELECT pt_session_id FROM pt_session_clients WHERE client_id = ${m.clientId})`,
  },
  byClientId('corporate_requests'),
  {
    table: 'email_log',
    // Holds a `clients.id` or a `staff_users.id`, told apart by the kind.
    columns: ['recipient_user_id'],
    where: m => sql`recipient_user_kind = 'client' AND recipient_user_id = ${m.clientId}`,
  },
  {
    table: 'inbox_items',
    // A notification about a member carries their id in its payload.
    columns: ['payload'],
    where: m => sql`payload->>'clientId' = ${m.clientId}`,
  },
  {
    table: 'audit_log',
    columns: ['target_id'],
    where: m => sql`target_table = 'clients' AND target_id = ${m.clientId}`,
  },
  {
    table: 'auth_events',
    // Their own sign-ins as actor; a staff act on their account as subject.
    columns: ['actor_user_id', 'subject_user_id'],
    where: m => sql`(actor_user_id = ${m.authUserId} OR subject_user_id = ${m.authUserId})`,
  },
]

/**
 * Columns that look like they name a member and are deliberately not how the
 * list finds one. Each says why, because "not in the list" otherwise reads as
 * "forgotten".
 */
export const UNEXPORTED_MEMBER_COLUMNS: readonly { table: string; column: string; why: string }[] = [
  {
    table: 'clients',
    column: 'referred_by_client_id',
    why: 'Names this member on the profile of the member they referred — that row is someone else’s.',
  },
  {
    table: 'pt_requests',
    column: 'co_client_name',
    why: 'Free text for a 2-on-1 partner who is not a member yet, so it cannot name one.',
  },
  {
    table: 'pt_requests',
    column: 'co_client_email',
    why: 'Free text for a 2-on-1 partner who is not a member yet, so it cannot name one.',
  },
  {
    table: 'corporate_sessions',
    column: 'client_name',
    why: 'The corporate client’s name as staff typed it, not a member.',
  },
]

/** A column name that reads as a member reference: `client_id`, `co_client_id`, `member_email`… */
const MEMBER_COLUMN_NAME = /(^|_)(client|member)_(id|email|name)$/

/** Tables a foreign key to which names a member: their studio record, or their sign-in account. */
const MEMBER_KEY_TABLES = new Set(['clients', 'client_auth_users'])

/**
 * Every column in `tables` that names a member — a foreign key to `clients` or
 * `client_auth_users`, or a name that says so — and is neither in `MEMBER_TABLES` nor set aside in
 * `UNEXPORTED_MEMBER_COLUMNS`. As `table.column`.
 */
export function unlistedMemberColumns(tables: PgTable[]): string[] {
  const accounted = new Set([
    ...MEMBER_TABLES.flatMap(t => t.columns.map(c => `${t.table}.${c}`)),
    ...UNEXPORTED_MEMBER_COLUMNS.map(c => `${c.table}.${c.column}`),
  ])

  const unlisted: string[] = []
  for (const table of tables) {
    const { name, columns, foreignKeys } = getTableConfig(table)
    // The auth pools are platform-wide, not a studio's; member deletion and
    // export are about what one studio holds.
    if (!columns.some(c => c.name === 'tenant_id')) continue
    const naming = new Set<string>()
    for (const fk of foreignKeys) {
      const ref = fk.reference()
      if (!MEMBER_KEY_TABLES.has(getTableName(ref.foreignTable))) continue
      for (const column of ref.columns) naming.add(column.name)
    }
    for (const column of columns) {
      if (MEMBER_COLUMN_NAME.test(column.name)) naming.add(column.name)
    }
    for (const column of naming) {
      if (!accounted.has(`${name}.${column}`)) unlisted.push(`${name}.${column}`)
    }
  }
  return unlisted
}
