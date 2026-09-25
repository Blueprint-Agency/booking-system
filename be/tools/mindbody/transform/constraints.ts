import type { TenantArchive } from '../../../src/services/tenants/transfer-shape'

/**
 * The database's CHECK constraints on every table the archive writes, as the
 * transform can test them before a zip ever reaches the import.
 *
 * An import is all or nothing, and a row the database refuses fails it at the
 * very end, after minutes of work, with one row's worth of explanation. So the
 * transform checks every row against the same rules first and refuses to write
 * the zip, naming every broken rule and how many rows break it.
 *
 * Kept in step with the schema by `import.test.ts` (beside this file), which
 * reads the live constraint list and fails on any CHECK this file does not name.
 * A column the row leaves out takes its database default, so a missing number
 * passes; a missing reference is NULL.
 */

type Row = Record<string, unknown>
type Rule = (r: Row) => boolean

const isNull = (v: unknown) => v === null || v === undefined
const set = (v: unknown) => !isNull(v)
/** A number test that passes where the row leaves the column to its default. */
const num = (v: unknown, test: (n: number) => boolean) => v === undefined || (v !== null && test(Number(v)))
const time = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN)
const after = (later: unknown, earlier: unknown) => !(time(later) <= time(earlier))
const capacity = (r: Row) =>
  (r.capacity_online === undefined ? 0 : Number(r.capacity_online)) +
    (r.capacity_waitlist === undefined ? 0 : Number(r.capacity_waitlist)) +
    (r.capacity_buffer === undefined ? 0 : Number(r.capacity_buffer)) >
  0

export const CHECKS: Record<string, Record<string, Rule>> = {
  client_packages: {
    client_packages_non_negative_balance: r => isNull(r.credits_or_sessions_remaining) || Number(r.credits_or_sessions_remaining) >= 0,
    client_packages_kind_fields: r =>
      r.kind === 'unlimited'
        ? set(r.location_id) && set(r.duration_months) && isNull(r.validity_days) && isNull(r.bound_instructor_id)
        : isNull(r.location_id) &&
          isNull(r.duration_months) &&
          set(r.validity_days) &&
          isNull(r.cross_location_paid_sgd) &&
          (r.kind === 'pt' || isNull(r.bound_instructor_id)),
    client_packages_complimentary_free: r => !r.complimentary || (Number(r.amount_paid_sgd) === 0 && isNull(r.purchase_id)),
  },
  class_packages: {
    class_packages_kind_fields: r =>
      (r.kind === 'credit_bundle' || r.kind === 'trial')
        ? set(r.credits) && set(r.validity_days) && isNull(r.duration_months)
        : r.kind === 'unlimited' && isNull(r.credits) && isNull(r.validity_days) && set(r.duration_months),
  },
  pt_packages: {
    pt_packages_validity_days_positive: r => num(r.validity_days, n => n > 0),
  },
  classes: {
    classes_ends_after_starts: r => after(r.ends_at, r.starts_at),
    classes_capacity_online_non_negative: r => num(r.capacity_online, n => n >= 0),
    classes_capacity_waitlist_non_negative: r => num(r.capacity_waitlist, n => n >= 0),
    classes_capacity_buffer_non_negative: r => num(r.capacity_buffer, n => n >= 0),
    classes_capacity_sum_positive: capacity,
    classes_credit_non_negative: r => num(r.credit_cost, n => n >= 0),
  },
  pt_sessions: {
    pt_sessions_ends_after_starts: r => after(r.ends_at, r.starts_at),
    pt_sessions_capacity_online_non_negative: r => num(r.capacity_online, n => n >= 0),
    pt_sessions_capacity_waitlist_non_negative: r => num(r.capacity_waitlist, n => n >= 0),
    pt_sessions_capacity_buffer_non_negative: r => num(r.capacity_buffer, n => n >= 0),
    pt_sessions_capacity_sum_positive: capacity,
  },
  class_series: {
    class_series_capacity_non_negative: r =>
      num(r.capacity_online, n => n >= 0) && num(r.capacity_waitlist, n => n >= 0) && num(r.capacity_buffer, n => n >= 0),
    class_series_capacity_sum_positive: capacity,
    class_series_credit_non_negative: r => num(r.credit_cost, n => n >= 0),
    class_series_ends_after_starts: r => String(r.end_time) > String(r.start_time),
    class_series_last_not_before_first: r => isNull(r.last_date) || String(r.last_date) >= String(r.first_date),
    class_series_weekday_range: r => num(r.weekday, n => n >= 1 && n <= 7),
  },
  bookings: {
    bookings_kind_class_fk: r => r.kind !== 'class' || (set(r.class_id) && isNull(r.workshop_id) && isNull(r.pt_session_id)),
    bookings_kind_pt_fk: r => r.kind !== 'pt' || (set(r.pt_session_id) && isNull(r.class_id) && isNull(r.workshop_id)),
    bookings_kind_workshop_fk: r =>
      r.kind !== 'workshop' || (set(r.workshop_id) && set(r.workshop_tier_id) && isNull(r.class_id) && isNull(r.pt_session_id)),
    bookings_kind_money: r =>
      r.kind === 'workshop'
        ? set(r.list_price_sgd) && set(r.amount_paid_sgd)
        : isNull(r.list_price_sgd) && isNull(r.amount_paid_sgd),
  },
  rooms: {
    rooms_capacity_positive: r => num(r.capacity, n => n > 0),
  },
  waitlist_entries: {
    waitlist_entries_promoted_booking: r => (r.status === 'promoted') === set(r.booking_id),
  },
  workshop_days: {
    workshop_days_ends_after_starts: r => after(r.ends_at, r.starts_at),
    workshop_days_capacity_online_non_negative: r => num(r.capacity_online, n => n >= 0),
    workshop_days_capacity_waitlist_non_negative: r => num(r.capacity_waitlist, n => n >= 0),
    workshop_days_capacity_buffer_non_negative: r => num(r.capacity_buffer, n => n >= 0),
    workshop_days_capacity_sum_positive: capacity,
  },
  global_policy: {
    global_policy_cross_location_rate_non_negative: r => num(r.cross_location_rate_sgd, n => n >= 0),
    global_policy_leave_caps_min_1: r => num(r.study_leave_cap, n => n >= 1),
    global_policy_check_in_window_non_negative: r => num(r.check_in_opens_minutes_before, n => n >= 0),
  },
}

/** Every rule the archive breaks, as `table.constraint: n row(s) (first id …)`. Empty when it would import. */
export function constraintViolations(archive: Pick<TenantArchive, 'rows'>): string[] {
  const out: string[] = []
  for (const [table, rules] of Object.entries(CHECKS)) {
    const rows = archive.rows[table] ?? []
    for (const [name, rule] of Object.entries(rules)) {
      const broken = rows.filter(r => !rule(r))
      if (broken.length > 0) out.push(`${table}.${name}: ${broken.length} row(s) (first id ${String(broken[0]!.id ?? '?')})`)
    }
  }
  return out
}
