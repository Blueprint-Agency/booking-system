import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeFinance } from './totals'
import { financeCsv } from './csv'
import type { MoneyEvent } from './events'

/**
 * The Finance rules the Scenario Inventory states at `unit` level, each proved
 * against `summarizeFinance` — the one function every figure on the page comes
 * out of (spec-finance §Testing Decisions). Figures are checked to the cent.
 */

const at = (iso: string) => new Date(iso)

function ev(p: Partial<MoneyEvent> & { kind: MoneyEvent['kind'] }): MoneyEvent {
  return {
    id: 'row-1',
    occurredAt: at('2026-06-10T02:00:00.000Z'),
    type: 'credit',
    variant: null,
    party: null,
    locationId: null,
    locationName: null,
    listPriceSgd: null,
    paidSgd: null,
    promoCode: null,
    refunded: false,
    complimentary: false,
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

const purchase = (list: string, paid: string, p: Partial<MoneyEvent> = {}) =>
  ev({ kind: 'purchase', type: 'credit', party: 'Mia', listPriceSgd: list, paidSgd: paid, ...p })

const refund = (amount: string, p: Partial<MoneyEvent> = {}) =>
  ev({ kind: 'refund', type: 'refund', party: 'Mia', paidSgd: `-${amount}`, refunded: true, ...p })

const pay = (instructorId: string, name: string, amount: string | null, p: Partial<MoneyEvent> = {}) =>
  ev({
    kind: 'instructor_pay',
    type: 'class',
    payKind: 'class',
    instructorId,
    instructorName: name,
    paySgd: amount,
    endsAt: at('2026-06-10T03:00:00.000Z'),
    ...p,
  })

const manual = (instructorId: string, name: string, amount: string, p: Partial<MoneyEvent> = {}) =>
  ev({ kind: 'manual', type: 'manual', payKind: 'manual', instructorId, instructorName: name, paySgd: amount, ...p })

test('FIN-03 Net is Gross minus discounts minus Refunds minus Instructor Pay over a mixed set', () => {
  const s = summarizeFinance([
    purchase('180.00', '150.00'),
    purchase('100.00', '100.00'),
    ev({ kind: 'workshop_ticket', type: 'workshop', listPriceSgd: '90.00', paidSgd: '81.00' }),
    refund('60.00'),
    pay('i-1', 'Anya', '45.50'),
    pay('i-2', 'Ben', null),
    manual('i-1', 'Anya', '20.25'),
  ])
  assert.deepEqual(s.totals, {
    gross_sgd: 370,
    discounts_sgd: 39,
    refunds_sgd: 60,
    instructor_pay_sgd: 65.75,
    net_sgd: 205.25,
  })
  const t = s.totals
  assert.equal(t.net_sgd, t.gross_sgd - t.discounts_sgd - t.refunds_sgd - t.instructor_pay_sgd)
})

test('FIN-04 a Refund in the period reduces Net by the full refunded amount', () => {
  const sales = [purchase('250.00', '250.00'), purchase('80.00', '72.50')]
  const without = summarizeFinance(sales)
  const withRefund = summarizeFinance([...sales, refund('72.50')])
  assert.equal(without.totals.net_sgd, 322.5)
  assert.equal(withRefund.totals.refunds_sgd, 72.5, 'the tile states the magnitude')
  assert.equal(withRefund.totals.net_sgd, 250)
  assert.equal(withRefund.totals.gross_sgd, without.totals.gross_sgd, 'the sale stays in Gross')
  const row = withRefund.rows.find(r => r.kind === 'refund')
  assert.equal(row?.paid_sgd, -72.5, 'the row reads as money leaving')
})

test('FIN-07 a purchase below its List Price shows List Price, amount paid and the difference as discount', () => {
  const s = summarizeFinance([purchase('180.00', '149.90')])
  const [row] = s.rows
  assert.equal(row?.list_price_sgd, 180)
  assert.equal(row?.paid_sgd, 149.9)
  assert.equal(row?.discount_sgd, 30.1)
  assert.equal(s.totals.discounts_sgd, 30.1)
})

test('FIN-08 a stacked Promotion and Promo Code discounts List Price minus amount paid, not the Redemption figure', () => {
  // 200.00 list; a 20% Promotion takes it to 160.00 and the member's code takes
  // 10.00 more. The Redemption would say 10.00 — the code's part only.
  const s = summarizeFinance([purchase('200.00', '150.00', { promoCode: 'TENOFF' })])
  const [row] = s.rows
  assert.equal(row?.discount_sgd, 50)
  assert.equal(row?.promo_code, 'TENOFF')
  assert.equal(s.totals.discounts_sgd, 50)
  assert.equal(s.totals.net_sgd, 150)
})

test('FIN-10 the discounts tile totals List Price minus amount paid across the discounted purchases', () => {
  const s = summarizeFinance([
    purchase('120.00', '99.90'),
    purchase('80.00', '80.00'),
    purchase('45.50', '40.25'),
    ev({ kind: 'workshop_ticket', type: 'workshop', listPriceSgd: '60.00', paidSgd: '54.00' }),
  ])
  // 20.10 + 0 + 5.25 + 6.00
  assert.equal(s.totals.discounts_sgd, 31.35)
  assert.equal(s.totals.gross_sgd, 305.5)
})

test('FIN-15 a corporate sale reports List Price equal to amount paid and no discount', () => {
  const s = summarizeFinance([
    ev({ kind: 'corporate', type: 'corporate', party: 'Acme HR', listPriceSgd: '1200.00', paidSgd: '1200.00' }),
  ])
  const [row] = s.rows
  assert.equal(row?.list_price_sgd, 1200)
  assert.equal(row?.paid_sgd, 1200)
  assert.equal(row?.discount_sgd, 0)
  assert.equal(s.totals.discounts_sgd, 0)
  assert.equal(s.totals.gross_sgd, 1200)
})

test('FIN-20 the per-instructor breakdown totals each instructor and sums to the Instructor Pay tile', () => {
  const s = summarizeFinance([
    pay('i-1', 'Anya', '50.00'),
    pay('i-1', 'Anya', '12.35', { id: 'row-2' }),
    pay('i-2', 'Ben', '30.10'),
    pay('i-2', 'Ben', null, { id: 'row-3' }),
    manual('i-3', 'Cleo', '7.05'),
  ])
  assert.deepEqual(
    s.instructor_totals.map(t => [t.instructor_id, t.total_sgd, t.session_count]),
    [
      ['i-1', 62.35, 2],
      ['i-2', 30.1, 1],
      ['i-3', 7.05, 1],
    ],
  )
  const cents = s.instructor_totals.reduce((sum, t) => sum + Math.round(t.total_sgd * 100), 0)
  assert.equal(cents / 100, s.totals.instructor_pay_sgd)
  assert.equal(s.totals.instructor_pay_sgd, 99.5)
})

test('FIN-21 an Unpriced session is left out of the pay total and raises the Unpriced count by one', () => {
  const priced = [pay('i-1', 'Anya', '40.00'), manual('i-1', 'Anya', '5.00')]
  const before = summarizeFinance(priced)
  const after = summarizeFinance([...priced, pay('i-1', 'Anya', null, { id: 'row-9' })])
  assert.equal(before.unpriced_count, 0)
  assert.equal(after.unpriced_count, 1)
  assert.equal(after.totals.instructor_pay_sgd, 45)
  assert.equal(after.totals.net_sgd, before.totals.net_sgd)
  const row = after.rows.find(r => r.id === 'row-9')
  assert.equal(row?.unpriced, true)
  assert.equal(row?.pay_sgd, null, 'Unpriced is null, never zero')
  assert.equal(after.instructor_totals[0]?.session_count, 2, 'nor is it one of the instructor’s paid sessions')
})

test('FIN-23 a Manual Entry with no session counts as money out and is never Unpriced', () => {
  const s = summarizeFinance([manual('i-1', 'Anya', '0.00'), manual('i-1', 'Anya', '33.30', { id: 'row-2' })])
  assert.equal(s.unpriced_count, 0)
  assert.ok(s.rows.every(r => r.unpriced === false))
  assert.equal(s.totals.instructor_pay_sgd, 33.3)
  assert.equal(s.totals.net_sgd, -33.3)
  assert.equal(s.instructor_totals[0]?.session_count, 2)
})

test('FIN-27 amounts like 0.10 and 0.20 repeated many times total exactly, because accumulation is in cents', () => {
  const events: MoneyEvent[] = []
  for (let i = 0; i < 1000; i++) {
    events.push(pay('i-1', 'Anya', '0.10', { id: `a-${i}` }))
    events.push(pay('i-1', 'Anya', '0.20', { id: `b-${i}` }))
    events.push(purchase('0.30', '0.10', { id: `c-${i}` }))
  }
  // Floating point would not: 0.1 + 0.2 added up a thousand times drifts.
  let float = 0
  for (let i = 0; i < 1000; i++) float += 0.1 + 0.2
  assert.notEqual(float, 300)

  const s = summarizeFinance(events)
  assert.equal(s.totals.instructor_pay_sgd, 300)
  assert.equal(s.instructor_totals[0]?.total_sgd, 300)
  assert.equal(s.totals.gross_sgd, 300)
  assert.equal(s.totals.discounts_sgd, 200)
  assert.equal(s.totals.net_sgd, -200)
})

test('FIN-28 rows come back newest first, by date and time', () => {
  const s = summarizeFinance([
    purchase('10.00', '10.00', { id: 'mid', occurredAt: at('2026-06-10T09:30:00.000Z') }),
    pay('i-1', 'Anya', '5.00', { id: 'oldest', occurredAt: at('2026-06-01T01:00:00.000Z') }),
    refund('10.00', { id: 'newest', occurredAt: at('2026-06-20T00:00:00.000Z') }),
    manual('i-1', 'Anya', '1.00', { id: 'same-day-earlier', occurredAt: at('2026-06-10T09:29:00.000Z') }),
  ])
  assert.deepEqual(
    s.rows.map(r => r.id),
    ['newest', 'mid', 'same-day-earlier', 'oldest'],
  )
})

test('FIN-43 an Unattributed row exports its Location as Unattributed, not blank', () => {
  const s = summarizeFinance([
    purchase('50.00', '50.00', { party: 'Mia', occurredAt: at('2026-06-10T02:00:00.000Z') }),
    pay('i-1', 'Anya', '20.00', {
      locationId: 'loc-1',
      locationName: 'Riverside',
      occurredAt: at('2026-06-09T02:00:00.000Z'),
    }),
  ])
  const [header, unattributed, located] = financeCsv(s).split('\r\n')
  const column = header!.split(',').indexOf('location')
  assert.equal(unattributed!.split(',')[column], 'Unattributed')
  assert.equal(located!.split(',')[column], 'Riverside')
})

test('FIN-44 purchase, Add-On, workshop ticket, corporate sale and Refund rows are marked immutable; pay rows are not', () => {
  const s = summarizeFinance([
    purchase('10.00', '10.00', { id: 'purchase' }),
    ev({ kind: 'addon', type: 'addon', id: 'addon', listPriceSgd: '5.00', paidSgd: '5.00' }),
    ev({ kind: 'workshop_ticket', type: 'workshop', id: 'ticket', listPriceSgd: '9.00', paidSgd: '9.00' }),
    ev({ kind: 'corporate', type: 'corporate', id: 'corporate', listPriceSgd: '9.00', paidSgd: '9.00' }),
    ev({ kind: 'merch', type: 'merch', id: 'merch', listPriceSgd: '9.00', paidSgd: '9.00' }),
    refund('10.00', { id: 'refund' }),
    pay('i-1', 'Anya', '5.00', { id: 'pay' }),
    manual('i-1', 'Anya', '5.00', { id: 'manual' }),
  ])
  const editable = Object.fromEntries(s.rows.map(r => [r.id, r.editable]))
  assert.deepEqual(editable, {
    purchase: false,
    addon: false,
    ticket: false,
    corporate: false,
    merch: false,
    refund: false,
    pay: true,
    manual: true,
  })
})
