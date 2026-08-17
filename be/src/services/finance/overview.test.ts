import assert from 'node:assert'
import { salesByCategory, previousWindow } from './overview'
import { summarizeFinance } from './totals'
import type { MoneyEvent } from './events'

const at = (iso: string) => new Date(iso)

function ev(p: Partial<MoneyEvent> & { kind: MoneyEvent['kind']; type: MoneyEvent['type'] }): MoneyEvent {
  return {
    id: 'x-1',
    occurredAt: at('2026-06-01T02:00:00.000Z'),
    variant: null,
    party: null,
    locationId: null,
    locationName: null,
    listPriceSgd: null,
    paidSgd: null,
    promoCode: null,
    refunded: false,
    instructorId: null,
    instructorName: null,
    paySgd: null,
    payKind: null,
    classTypeId: null,
    endsAt: null,
    sessionType: null,
    ...p,
  }
}

const of = (rows: ReturnType<typeof salesByCategory>, c: string) =>
  rows.find(r => r.category === c)!

// -- every class-shaped product lands in one bucket ---------------------------
// Credit, Unlimited, Trial and the Add-On are four products and one question.
{
  const rows = salesByCategory(
    summarizeFinance([
      ev({ kind: 'purchase', type: 'credit', listPriceSgd: '300.00', paidSgd: '270.00' }),
      ev({ kind: 'purchase', type: 'unlimited', id: 'b', listPriceSgd: '200.00', paidSgd: '200.00' }),
      ev({ kind: 'purchase', type: 'trial', id: 'c', listPriceSgd: '30.00', paidSgd: '0.00' }),
      ev({ kind: 'addon', type: 'addon', id: 'd', listPriceSgd: '50.00', paidSgd: '50.00' }),
    ]).rows,
  )
  assert.strictEqual(of(rows, 'classes').gross_sgd, 580)
  assert.strictEqual(of(rows, 'classes').collected_sgd, 520)
  assert.strictEqual(of(rows, 'classes').count, 4)
}

// -- the breakdown sums to the Gross tile -------------------------------------
// The whole reason it is regrouped from the same rows rather than re-queried.
{
  const summary = summarizeFinance([
    ev({ kind: 'purchase', type: 'credit', listPriceSgd: '300.00', paidSgd: '270.00' }),
    ev({ kind: 'workshop_ticket', type: 'workshop', id: 'w', listPriceSgd: '80.00', paidSgd: '80.00' }),
    ev({ kind: 'merch', type: 'merch', id: 'm', listPriceSgd: '45.00', paidSgd: '45.00' }),
    ev({ kind: 'corporate', type: 'corporate', id: 'k', listPriceSgd: '900.00', paidSgd: '900.00' }),
  ])
  const rows = salesByCategory(summary.rows)
  const summed = rows.reduce((n, r) => n + r.gross_sgd, 0)
  assert.strictEqual(summed, summary.totals.gross_sgd)
}

// -- paying an instructor for a workshop is not selling a workshop ------------
// Both rows carry type 'workshop'; only one of them is money coming in.
{
  const rows = salesByCategory(
    summarizeFinance([
      ev({ kind: 'workshop_ticket', type: 'workshop', listPriceSgd: '80.00', paidSgd: '80.00' }),
      ev({
        kind: 'instructor_pay',
        type: 'workshop',
        id: 'p',
        instructorId: 'i-1',
        instructorName: 'Mei',
        paySgd: '200.00',
        payKind: 'workshop',
      }),
    ]).rows,
  )
  assert.strictEqual(of(rows, 'workshops').count, 1)
  assert.strictEqual(of(rows, 'workshops').gross_sgd, 80)
}

// -- a category with no sales reports zero, it does not vanish ----------------
// A missing row reads as "we don't track that"; a zero reads as "nothing sold".
{
  const rows = salesByCategory(summarizeFinance([]).rows)
  assert.strictEqual(rows.length, 5)
  assert.ok(rows.every(r => r.gross_sgd === 0 && r.count === 0))
}

// -- the trend window is the same length, immediately before ------------------
{
  const w = previousWindow(at('2026-06-15T00:00:00Z'), at('2026-06-30T00:00:00Z'))
  assert.strictEqual(w?.from.toISOString(), '2026-05-31T00:00:00.000Z')
  assert.strictEqual(w?.to.toISOString(), '2026-06-15T00:00:00.000Z')
  // All time has no length to step back by, so there is nothing to compare to.
  assert.strictEqual(previousWindow(undefined, at('2026-06-30T00:00:00Z')), null)
}

// -- the two windows meet, they do not overlap --------------------------------
// The previous window ends exactly where the current one starts. Both windows
// are read half-open, so a class on the seam belongs to one of them; counting it
// in both would inflate `previous` and flatten every trend it feeds.
{
  const from = at('2026-06-15T00:00:00Z')
  const w = previousWindow(from, at('2026-06-30T00:00:00Z'))!
  assert.strictEqual(w.to.getTime(), from.getTime())
  assert.ok(w.from.getTime() < w.to.getTime())
}

console.log('finance/overview.test.ts ok')
