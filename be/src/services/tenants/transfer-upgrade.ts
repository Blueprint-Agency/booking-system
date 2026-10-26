/**
 * Bring an archive written by an older schema up to the current one, before
 * `importTenant` writes it. Exports are `SELECT *`, so an archive carries the
 * column names of the day it was taken.
 *
 * Pure, and kept out of `transfer.ts` for the reason `transfer-shape.ts` is:
 * importing that module builds a database pool.
 *
 * Named moves only, like `RETIRED_COLUMNS` beside the importer: a column the
 * archive has and the table lacks for any other reason is still an error.
 */

type Rows = Record<string, Record<string, unknown>[]>

const ASSIGNED_DAYS = ['annual_leave_days', 'medical_leave_days', 'study_leave_days'] as const

/**
 * Migration 0091 (#315): leave belongs to a staff member. `leave_requests` and
 * `leave_pools` renamed `instructor_id` to `staff_user_id` — the same value,
 * since an instructor's key is its staff user id — and the Assigned Days moved
 * from `instructors` onto `staff_users`, where 0089 gave everyone else 14/14/7.
 *
 * `archived.tenantName` is the studio's name as the archive's manifest records
 * it, for a step that names the studio as its migration did.
 */
export function upgradeArchiveRows(rows: Readonly<Rows>, archived: { tenantName?: string } = {}): Rows {
  const out: Rows = { ...rows }

  for (const table of ['leave_requests', 'leave_pools']) {
    const tableRows = rows[table]
    if (!tableRows?.some(r => 'instructor_id' in r)) continue
    out[table] = tableRows.map(({ instructor_id, ...rest }) =>
      instructor_id === undefined ? rest : { ...rest, staff_user_id: instructor_id },
    )
  }

  const instructors = rows.instructors
  if (instructors?.some(r => ASSIGNED_DAYS.some(c => c in r))) {
    const days = new Map<unknown, Record<string, unknown>>()
    out.instructors = instructors.map(row => {
      const kept = { ...row }
      const moved: Record<string, unknown> = {}
      for (const c of ASSIGNED_DAYS) {
        if (c in kept) {
          moved[c] = kept[c]
          delete kept[c]
        }
      }
      days.set(row.staff_user_id, moved)
      return kept
    })
    if (rows.staff_users) {
      out.staff_users = rows.staff_users.map(row => ({ ...row, ...days.get(row.id) }))
    }
  }

  // Migration `instructor_photos_to_staff`: a Profile picture is the staff
  // member's own, on `staff_users`. A staff row with no picture column
  // predates it, and the instructor's photo becomes their picture. The photo
  // stays where it was on `instructors` too, a column nothing reads.
  const photos = new Map((rows.instructors ?? []).flatMap(r => (r.photo_r2_key ? [[r.staff_user_id, r.photo_r2_key]] : [])))
  if (photos.size > 0 && out.staff_users) {
    out.staff_users = out.staff_users.map(row =>
      'photo_r2_key' in row || !photos.has(row.id) ? row : { ...row, photo_r2_key: photos.get(row.id) },
    )
  }

  // Migration 0115 (#398): the Legal name became the Business name, and a
  // studio named as 0115 named it: its Legal name, else its display name, else
  // the studio's name as the archive recorded it (`tenants.name`). A Receipt's
  // copy is renamed as it is.
  const settings = rows.tenant_settings
  if (settings?.some(r => 'receipt_legal_name' in r)) {
    const named = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)
    out.tenant_settings = settings.map(({ receipt_legal_name, ...rest }) => {
      if ('business_name' in rest) return rest
      const business = named(receipt_legal_name) ?? named(rest.display_name) ?? named(archived.tenantName)
      return business ? { ...rest, business_name: business } : rest
    })
  }
  const receipts = rows.receipts
  if (receipts?.some(r => 'seller_legal_name' in r)) {
    out.receipts = receipts.map(({ seller_legal_name, ...rest }) =>
      seller_legal_name === undefined ? rest : { ...rest, seller_business_name: seller_legal_name },
    )
  }

  return out
}
