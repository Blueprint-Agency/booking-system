import assert from 'node:assert'
import { summarizeFinance } from './totals'
import type { MoneyEvent } from './events'

const at = (iso: string) => new Date(iso)

function ev(p: Partial<MoneyEvent> & { kind: MoneyEvent['kind'] }): MoneyEvent {
  return {
    id: 'x-1',
    occurredAt: at('2026-06-01T02:00:00.000Z'),
    type: 'credit',
    variant: 'Something',
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

const purchase = (p: Partial<MoneyEvent> = {}) =>
  ev({ kind: 'purchase', listPriceSgd: '100.00', paidSgd: '100.00', ...p })

const pay = (p: Partial<MoneyEvent> = {}) =>
  ev({
    kind: 'instructor_pay',
    instructorId: 'i-1',
    instructorName: 'Anya',
    paySgd: '50.00',
    endsAt: at('2026-06-01T03:00:00.000Z'),
    ...p,
  })

// -- a discounted purchase reports discount as List Price minus amount paid ---
{
  const s = summarizeFinance([purchase({ listPriceSgd: '180.00', paidSgd: '150.00' })])
  assert.strictEqual(s.totals.gross_sgd, 180)
  assert.strictEqual(s.totals.discounts_sgd, 30)
  assert.strictEqual(s.totals.net_sgd, 150)
}

// -- a comp grant at $0 is a 100% discount, not an absence --------------------
// list_price_sgd is NOT NULL on every purchase precisely so this row exists.
{
  const s = summarizeFinance([purchase({ listPriceSgd: '120.00', paidSgd: '0.00' })])
  assert.strictEqual(s.totals.gross_sgd, 120)
  assert.strictEqual(s.totals.discounts_sgd, 120)
  assert.strictEqual(s.totals.net_sgd, 0)
}

// -- a corporate sale reports no discount ------------------------------------
{
  const s = summarizeFinance([
    ev({ kind: 'corporate', listPriceSgd: '900.00', paidSgd: '900.00' }),
  ])
  assert.strictEqual(s.totals.discounts_sgd, 0)
  assert.strictEqual(s.rows[0]?.discount_sgd, 0)
}

// -- a Merch Order is money in, with no discount ever -------------------------
{
  const s = summarizeFinance([ev({ kind: 'merch', listPriceSgd: '45.00', paidSgd: '45.00' })])
  assert.strictEqual(s.totals.gross_sgd, 45)
  assert.strictEqual(s.totals.discounts_sgd, 0)
  assert.strictEqual(s.totals.net_sgd, 45)
}

// -- a free Merch item is an order too, and reads as given away ---------------
// It never reaches the payment provider, so there is no payment row behind it —
// the order is the only record, and it must not vanish from the month.
{
  const s = summarizeFinance([ev({ kind: 'merch', listPriceSgd: '0.00', paidSgd: '0.00' })])
  assert.strictEqual(s.rows.length, 1)
  assert.strictEqual(s.totals.gross_sgd, 0)
  assert.strictEqual(s.totals.net_sgd, 0)
}

// -- a Merch Order carries no Location, so it lands in Unattributed -----------
{
  const s = summarizeFinance([ev({ kind: 'merch', listPriceSgd: '45.00', paidSgd: '45.00' })])
  assert.strictEqual(s.rows[0]?.unattributed, true)
  assert.strictEqual(s.rows[0]?.editable, false, 'merch is a payment record, not ours to restate')
}

// -- a refunded Merch Order keeps its row and nets to zero -------------------
{
  const s = summarizeFinance([
    ev({ kind: 'merch', id: 'm-1', listPriceSgd: '45.00', paidSgd: '45.00', refunded: true }),
    ev({ kind: 'refund', id: 'm-1', paidSgd: '-45.00' }),
  ])
  assert.strictEqual(s.totals.gross_sgd, 45)
  assert.strictEqual(s.totals.refunds_sgd, 45)
  assert.strictEqual(s.totals.net_sgd, 0)
  assert.strictEqual(s.rows.find(r => r.kind === 'merch')?.refunded, true)
}

// -- a Refund subtracts from Net and leaves the original purchase in the set --
{
  const s = summarizeFinance([
    purchase({ id: 'p-1', listPriceSgd: '100.00', paidSgd: '100.00', refunded: true }),
    ev({
      kind: 'refund',
      id: 'p-1',
      paidSgd: '-100.00',
      occurredAt: at('2026-06-09T02:00:00.000Z'),
    }),
  ])
  assert.strictEqual(s.totals.gross_sgd, 100, 'the purchase still happened')
  assert.strictEqual(s.totals.refunds_sgd, 100, 'reported as a positive magnitude')
  assert.strictEqual(s.totals.net_sgd, 0)
  assert.strictEqual(s.rows.length, 2, 'the original row is tagged, never removed')
  assert.strictEqual(s.rows.find(r => r.kind === 'purchase')?.refunded, true)
}

// -- a Refund does not count as a discount -----------------------------------
// A refunded purchase paid in full has no money off; only Refunds does move.
{
  const s = summarizeFinance([
    purchase({ listPriceSgd: '100.00', paidSgd: '100.00', refunded: true }),
    ev({ kind: 'refund', paidSgd: '-100.00' }),
  ])
  assert.strictEqual(s.totals.discounts_sgd, 0)
}

// -- a refunded sale still counts in Gross for the month it happened in ------
// Regression: the corporate query once filtered to status 'succeeded', but the
// refund webhook flips the status — so the sale vanished from Gross while its
// negative Refund row stayed, understating Net by twice the amount.
{
  const s = summarizeFinance([
    ev({ kind: 'corporate', id: 'c-1', listPriceSgd: '500.00', paidSgd: '500.00', refunded: true }),
    ev({
      kind: 'refund',
      id: 'c-1',
      paidSgd: '-500.00',
      occurredAt: at('2026-06-20T00:00:00.000Z'),
    }),
  ])
  assert.strictEqual(s.totals.gross_sgd, 500)
  assert.strictEqual(s.totals.refunds_sgd, 500)
  assert.strictEqual(s.totals.net_sgd, 0, 'not -500')
}

// -- an Unpriced session is excluded from the total and counted --------------
{
  const s = summarizeFinance([pay({ paySgd: '50.00' }), pay({ id: 'x-2', paySgd: null })])
  assert.strictEqual(s.totals.instructor_pay_sgd, 50, 'Unpriced is not pay of zero')
  assert.strictEqual(s.unpriced_count, 1)
}

// -- Unpriced does not flatter Net -------------------------------------------
{
  const priced = summarizeFinance([purchase(), pay({ paySgd: '50.00' })])
  const unpriced = summarizeFinance([purchase(), pay({ paySgd: null })])
  assert.strictEqual(priced.totals.net_sgd, 50)
  assert.strictEqual(unpriced.totals.net_sgd, 100)
  assert.strictEqual(unpriced.unpriced_count, 1, 'so the screen can say Net is incomplete')
}

// -- a Manual Entry totals exactly like Instructor Pay ------------------------
{
  const s = summarizeFinance([
    ev({ kind: 'manual', instructorId: 'i-1', instructorName: 'Anya', paySgd: '80.00' }),
  ])
  assert.strictEqual(s.totals.instructor_pay_sgd, 80)
  assert.strictEqual(s.unpriced_count, 0, 'a Manual Entry IS its amount — never Unpriced')
}

// -- money accumulates in cents ----------------------------------------------
{
  const s = summarizeFinance([
    pay({ id: 'a', paySgd: '0.10' }),
    pay({ id: 'b', paySgd: '0.20' }),
  ])
  assert.strictEqual(s.totals.instructor_pay_sgd, 0.3)
}

// -- the five tiles satisfy the stated relationship over a mixed set ----------
{
  const s = summarizeFinance([
    purchase({ id: 'p-1', listPriceSgd: '200.00', paidSgd: '160.00' }),
    ev({ kind: 'addon', id: 'p-1', listPriceSgd: '40.00', paidSgd: '40.00' }),
    ev({ kind: 'workshop_ticket', id: 'w-1', listPriceSgd: '90.00', paidSgd: '90.00' }),
    ev({ kind: 'corporate', id: 'c-1', listPriceSgd: '500.00', paidSgd: '500.00' }),
    ev({ kind: 'refund', id: 'w-1', paidSgd: '-90.00' }),
    pay({ paySgd: '120.00' }),
    ev({ kind: 'manual', instructorId: 'i-2', instructorName: 'Bala', paySgd: '30.00' }),
  ])
  const t = s.totals
  assert.strictEqual(t.gross_sgd, 830)
  assert.strictEqual(t.discounts_sgd, 40)
  assert.strictEqual(t.refunds_sgd, 90)
  assert.strictEqual(t.instructor_pay_sgd, 150)
  assert.strictEqual(t.net_sgd, 830 - 40 - 90 - 150)
}

// -- per-instructor pay breakdown, by name -----------------------------------
{
  const s = summarizeFinance([
    pay({ id: 'a', instructorId: 'b', instructorName: 'Bala', paySgd: '50.00' }),
    pay({ id: 'b', instructorId: 'a', instructorName: 'Anya', paySgd: '40.50' }),
    pay({ id: 'c', instructorId: 'b', instructorName: 'Bala', paySgd: '25.25' }),
    // A purchase has no instructor and must not create a phantom row.
    purchase(),
  ])
  assert.deepStrictEqual(s.instructor_totals, [
    { instructor_id: 'a', instructor_name: 'Anya', total_sgd: 40.5, session_count: 1 },
    { instructor_id: 'b', instructor_name: 'Bala', total_sgd: 75.25, session_count: 2 },
  ])
}

// -- rows come back newest first ---------------------------------------------
{
  const s = summarizeFinance([
    purchase({ id: 'old', occurredAt: at('2026-06-01T00:00:00.000Z') }),
    purchase({ id: 'new', occurredAt: at('2026-06-30T00:00:00.000Z') }),
    purchase({ id: 'mid', occurredAt: at('2026-06-15T00:00:00.000Z') }),
  ])
  assert.deepStrictEqual(s.rows.map(r => r.id), ['new', 'mid', 'old'])
}

// -- mutability is carried on the row, never re-derived by a frontend ---------
{
  const s = summarizeFinance([
    purchase({ id: 'p' }),
    ev({ kind: 'refund', id: 'r', paidSgd: '-10.00' }),
    pay({ id: 'pay' }),
    ev({ kind: 'manual', id: 'm', instructorId: 'i-1', paySgd: '5.00' }),
  ])
  const editable = Object.fromEntries(s.rows.map(r => [r.id, r.editable]))
  assert.deepStrictEqual(editable, { p: false, r: false, pay: true, m: true })
}

// -- an Unattributed row says so, rather than carrying a null a screen must guess at
{
  const s = summarizeFinance([
    purchase({ id: 'a', locationId: 'loc-1', locationName: 'Outram Park' }),
    purchase({ id: 'b' }),
  ])
  assert.strictEqual(s.rows.find(r => r.id === 'a')!.location_name, 'Outram Park')
  assert.strictEqual(s.rows.find(r => r.id === 'b')!.location_name, null)
  assert.strictEqual(s.rows.find(r => r.id === 'b')!.unattributed, true)
}

// -- an empty period reports zeroes, not nulls -------------------------------
{
  const s = summarizeFinance([])
  assert.deepStrictEqual(s.totals, {
    gross_sgd: 0,
    discounts_sgd: 0,
    refunds_sgd: 0,
    instructor_pay_sgd: 0,
    net_sgd: 0,
  })
  assert.deepStrictEqual(s.rows, [])
  assert.deepStrictEqual(s.instructor_totals, [])
  assert.strictEqual(s.unpriced_count, 0)
}

console.log('finance/totals.test.ts ok')
