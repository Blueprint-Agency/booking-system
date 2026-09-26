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
 */
export function upgradeArchiveRows(rows: Readonly<Rows>): Rows {
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

  return out
}
