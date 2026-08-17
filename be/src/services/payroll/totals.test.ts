import assert from 'node:assert'
import { summarizePayroll } from './totals'
import type { PayrollRow } from './list'

const at = (iso: string) => new Date(iso)

function row(p: Partial<PayrollRow> & { instructorId: string }): PayrollRow {
  return {
    kind: 'class',
    id: 'sess-1',
    instructorName: `Name-${p.instructorId}`,
    classTypeId: 'ct-1',
    label: 'Hatha',
    sessionType: null,
    startsAt: at('2026-06-01T02:00:00.000Z'),
    endsAt: at('2026-06-01T03:00:00.000Z'),
    instructorPaySgd: '50.00',
    locationId: 'loc-1',
    locationName: 'Breadtalk IHQ',
    ...p,
  }
}

// -- per-instructor sums -----------------------------------------------------
{
  const s = summarizePayroll([
    row({ instructorId: 'b', instructorName: 'Bala', instructorPaySgd: '50.00' }),
    row({ instructorId: 'a', instructorName: 'Anya', instructorPaySgd: '40.50' }),
    row({ instructorId: 'b', instructorName: 'Bala', instructorPaySgd: '25.25' }),
  ])
  assert.deepStrictEqual(s.totals, [
    { instructor_id: 'a', instructor_name: 'Anya', total_sgd: 40.5, session_count: 1 },
    { instructor_id: 'b', instructor_name: 'Bala', total_sgd: 75.25, session_count: 2 },
  ])
  assert.strictEqual(s.total_sgd, 115.75)
  assert.strictEqual(s.session_count, 3)
  assert.strictEqual(s.unpriced_count, 0)
}

// An instructor's own view is the same call scoped to them: their figures must
// equal the admin view's row for that instructor.
{
  const all = [
    row({ instructorId: 'a', instructorName: 'Anya', instructorPaySgd: '40.50' }),
    row({ instructorId: 'a', instructorName: 'Anya', instructorPaySgd: null }),
    row({ instructorId: 'b', instructorName: 'Bala', instructorPaySgd: '50.00' }),
  ]
  const admin = summarizePayroll(all)
  const mine = summarizePayroll(all.filter(r => r.instructorId === 'a'))
  const adminAnya = admin.totals.find(t => t.instructor_id === 'a')
  assert.deepStrictEqual(adminAnya, {
    instructor_id: 'a',
    instructor_name: 'Anya',
    total_sgd: mine.total_sgd,
    session_count: mine.session_count,
  })
  assert.strictEqual(mine.unpriced_count, 1)
}

// -- unpriced rows: counted, excluded from the total -------------------------
{
  const s = summarizePayroll([
    row({ instructorId: 'a', instructorName: 'Anya', instructorPaySgd: '30.00' }),
    row({ instructorId: 'a', instructorName: 'Anya', instructorPaySgd: null }),
    row({ instructorId: 'c', instructorName: 'Cara', instructorPaySgd: null }),
  ])
  assert.strictEqual(s.unpriced_count, 2)
  assert.strictEqual(s.total_sgd, 30)
  // unpriced still counts as a session, and is never read as a pay of zero
  assert.deepStrictEqual(s.totals, [
    { instructor_id: 'a', instructor_name: 'Anya', total_sgd: 30, session_count: 2 },
    { instructor_id: 'c', instructor_name: 'Cara', total_sgd: 0, session_count: 1 },
  ])
  // an unpriced row is serialized as null pay, not 0
  assert.deepStrictEqual(
    s.rows.map(r => r.instructor_pay_sgd),
    [30, null, null],
  )
}

// -- manual entries count like any other pay ---------------------------------
{
  const s = summarizePayroll([
    row({ instructorId: 'a', instructorName: 'Anya', instructorPaySgd: '100.00' }),
    row({
      instructorId: 'a',
      instructorName: 'Anya',
      kind: 'manual',
      id: 'man-1',
      label: 'Retreat bonus',
      classTypeId: null,
      instructorPaySgd: '20.10',
    }),
  ])
  assert.strictEqual(s.total_sgd, 120.1)
  assert.strictEqual(s.totals[0]?.session_count, 2)
}

// cents accumulation — floats must not leak into a money total
{
  const s = summarizePayroll([
    row({ instructorId: 'a', instructorPaySgd: '0.10' }),
    row({ instructorId: 'a', instructorPaySgd: '0.20' }),
  ])
  assert.strictEqual(s.total_sgd, 0.3)
}

// -- derived duration --------------------------------------------------------
{
  const s = summarizePayroll([
    row({
      instructorId: 'a',
      startsAt: at('2026-06-01T02:00:00.000Z'),
      endsAt: at('2026-06-01T03:15:00.000Z'),
    }),
  ])
  assert.strictEqual(s.rows[0]?.duration_minutes, 75)
  assert.strictEqual(s.rows[0]?.starts_at, '2026-06-01T02:00:00.000Z')
  assert.strictEqual(s.rows[0]?.ends_at, '2026-06-01T03:15:00.000Z')
}
{
  // a manual entry has no window — entry_date stands in for both ends
  const s = summarizePayroll([
    row({
      instructorId: 'a',
      kind: 'manual',
      startsAt: at('2026-06-01T02:00:00.000Z'),
      endsAt: at('2026-06-01T02:00:00.000Z'),
    }),
  ])
  assert.strictEqual(s.rows[0]?.duration_minutes, 0)
}

// -- ordering ----------------------------------------------------------------
{
  const s = summarizePayroll([
    row({ instructorId: 'a', id: 'mid', startsAt: at('2026-06-02T00:00:00.000Z') }),
    row({ instructorId: 'a', id: 'old', startsAt: at('2026-06-01T00:00:00.000Z') }),
    row({ instructorId: 'a', id: 'new', startsAt: at('2026-06-03T00:00:00.000Z') }),
  ])
  assert.deepStrictEqual(
    s.rows.map(r => r.id),
    ['new', 'mid', 'old'],
  )
}
{
  // totals are ordered by instructor name, not by first appearance
  const s = summarizePayroll([
    row({ instructorId: 'z', instructorName: 'Zoya' }),
    row({ instructorId: 'a', instructorName: 'Anya' }),
    row({ instructorId: 'm', instructorName: 'Meera' }),
  ])
  assert.deepStrictEqual(
    s.totals.map(t => t.instructor_name),
    ['Anya', 'Meera', 'Zoya'],
  )
}

console.log('payroll totals.test ok')
