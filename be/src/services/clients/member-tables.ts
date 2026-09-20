import { getTableName, sql, type SQL } from 'drizzle-orm'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'

/**
 * Where a member lives in the database: every Tenant-scoped table with a row
 * that names them, and the column that does the naming (#143).
 *
 * One list, because two features read it. Member export hands over what the
 * studio holds about someone; member deletion (#144) has to reach exactly the
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
  /** Their email at this Tenant, which mail sent before they had an account records. */
  email: string
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
  /**
   * What permanently deleting the member does to this table (#144), step by
   * step. Left out, the rows `where` finds are deleted — the safe direction, so
   * a table added to the list keeps nothing unless it says why.
   *
   * Deletion walks the list **backwards**, so a table listed after the one it
   * references is dealt with first — `check_ins` before `bookings`, everything
   * before `clients`.
   */
  erase?: readonly EraseStep[]
}

export type EraseStep =
  /** The rows go. */
  | { delete: (member: MemberKey) => SQL }
  /**
   * The rows stay, with the columns that name the member cleared. `keptBecause`
   * is the retention rule for them, which `docs/md/member-data-retention.md`
   * writes out.
   */
  | { keptBecause: string; set: SQL; where: (member: MemberKey) => SQL }

/** The steps deletion takes on `entry`, its default filled in. */
export const eraseSteps = (entry: MemberTable): readonly EraseStep[] => entry.erase ?? [{ delete: entry.where }]

const clientIdIs = (m: MemberKey) => sql`client_id = ${m.clientId}`

const byClientId = (table: string, erase?: readonly EraseStep[]): MemberTable => ({
  table,
  columns: ['client_id'],
  where: clientIdIs,
  erase,
})

const ACCOUNTS =
  'The studio’s accounts: what was sold, for how much, and what was refunded. The member’s identity is removed.'

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
  // The purchase itself — list price, amount paid, the Cross-Location Add-On. No
  // longer anyone's, so no longer active either.
  byClientId('client_packages', [{ keptBecause: ACCOUNTS, set: sql`client_id = NULL, active = false`, where: clientIdIs }]),
  // Credit movements with a staff member's free-text reason: no money, and the
  // reason may well name the member.
  byClientId('manual_adjustments'),
  // What was bought, what it cost and how much of it was paid (#91). It is the
  // sale itself, so it is kept for the same reason every other accounts row is —
  // including one still open, whose money the studio is holding and may yet have
  // to return. The metadata is dropped with the member: it carries the ids the
  // webhook granted from, and one of them is theirs.
  byClientId('purchases', [
    { keptBecause: ACCOUNTS, set: sql`client_id = NULL, metadata = '{}'::jsonb`, where: clientIdIs },
  ]),
  // The booking the payment was for is deleted; the receipt link opens a page
  // that shows who paid. The payment intent stays, which is how the studio
  // matches this row to the payment provider's own record.
  byClientId('stripe_payments', [
    { keptBecause: ACCOUNTS, set: sql`client_id = NULL, booking_id = NULL, receipt_url = NULL`, where: clientIdIs },
  ]),
  // Who the member is at the payment provider, and so the cards they kept
  // (#185). **Deleted, not emptied** — the one row in this neighbourhood that
  // is, and deliberately: a payment is the studio's accounts, but this is the
  // member's identity at a third party, which is precisely what permanent
  // deletion is for. Emptying it would also orphan the id, leaving their cards
  // on file at the provider with nothing left pointing at them to clean up.
  //
  // Deleting the row does not by itself delete the Customer. `member-delete.ts`
  // reads these rows first and asks the provider to forget each one — a network
  // call, which is why it cannot be an `erase` step here.
  byClientId('payment_customers'),
  // The money a Promo Code took off, and a use of that code's limit.
  byClientId('promo_code_redemptions', [{ keptBecause: ACCOUNTS, set: sql`client_id = NULL`, where: clientIdIs }]),
  byClientId('merch_orders', [{ keptBecause: ACCOUNTS, set: sql`client_id = NULL`, where: clientIdIs }]),
  byClientId('waiver_signatures'),
  {
    table: 'pt_requests',
    // The requester, or the member they named as their 2-on-1 partner.
    columns: ['client_id', 'co_client_id'],
    where: m => sql`(client_id = ${m.clientId} OR co_client_id = ${m.clientId})`,
    erase: [
      {
        keptBecause: 'Another member’s request, which named this member as their partner. It is theirs; only the naming goes.',
        set: sql`co_client_id = NULL`,
        where: m => sql`co_client_id = ${m.clientId}`,
      },
      { delete: clientIdIs },
    ],
  },
  {
    table: 'pt_request_slots',
    columns: [],
    via: 'pt_requests',
    where: m =>
      sql`pt_request_id IN (SELECT id FROM pt_requests WHERE client_id = ${m.clientId} OR co_client_id = ${m.clientId})`,
    // Only the member's own requests' slots; a partner's request keeps its own.
    erase: [{ delete: m => sql`pt_request_id IN (SELECT id FROM pt_requests WHERE client_id = ${m.clientId})` }],
  },
  byClientId('pt_session_clients'),
  {
    table: 'pt_sessions',
    columns: [],
    via: 'pt_session_clients',
    where: m => sql`id IN (SELECT pt_session_id FROM pt_session_clients WHERE client_id = ${m.clientId})`,
    // The member leaves the session through `pt_session_clients`. The session is
    // the instructor's — their pay is on it — and a 2-on-1 partner's.
    erase: [
      {
        keptBecause: 'The instructor’s session, which their pay and any partner’s booking hang off. Only the link to the member’s request goes.',
        set: sql`pt_request_id = NULL`,
        where: m => sql`pt_request_id IN (SELECT id FROM pt_requests WHERE client_id = ${m.clientId})`,
      },
    ],
  },
  byClientId('corporate_requests'),
  {
    table: 'email_log',
    // Holds a `clients.id` or a `staff_users.id`, told apart by the kind. Mail
    // sent before a member id was known — a sign-in code — has only the address.
    columns: ['recipient_user_id', 'recipient_email'],
    where: m =>
      sql`recipient_user_kind = 'client' AND (recipient_user_id = ${m.clientId} OR lower(recipient_email) = lower(${m.email}))`,
  },
  {
    table: 'inbox_items',
    // A notification about a member carries their id in its payload.
    columns: ['payload'],
    where: m => sql`payload->>'clientId' = ${m.clientId}`,
  },
  {
    table: 'audit_log',
    // A staff action on their profile targets it; one on their packages or
    // bookings targets those, but its path runs through `/clients/:id`; one taken
    // while impersonating them records them in the payload.
    columns: ['target_id', 'action', 'payload'],
    where: m =>
      sql`((target_table = 'clients' AND target_id = ${m.clientId}) OR strpos(action, ${m.clientId}) > 0 OR payload->>'impersonatedClientId' = ${m.clientId})`,
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
