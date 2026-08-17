import assert from 'node:assert'
import { financeCsv } from './list'
import { summarizeFinance } from './totals'
import type { MoneyEvent } from './events'

const at = (iso: string) => new Date(iso)

function ev(p: Partial<MoneyEvent> & { kind: MoneyEvent['kind'] }): MoneyEvent {
  return {
    id: 'x-1',
    occurredAt: at('2026-06-01T02:00:00.000Z'),
    label: 'Something',
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

const lines = (csv: string) => csv.split('\r\n')

// -- a label containing a comma cannot shift every later column --------------
{
  const csv = financeCsv(
    summarizeFinance([
      ev({
        kind: 'purchase',
        label: '10-Class Pack, 6 months — Tan, Wei Ming',
        listPriceSgd: '300.00',
        paidSgd: '270.00',
      }),
    ]),
  )
  const [header, row] = lines(csv)
  assert.strictEqual(header?.split(',').length, 11)
  assert.ok(row?.includes('"10-Class Pack, 6 months — Tan, Wei Ming"'))
  // The quoted field is one cell, so the row still has 11 columns' worth of commas
  // outside it — check the figures landed in the right places rather than counting.
  assert.ok(row?.endsWith('300,30,270,,,'), row)
}

// -- a quote in a label is doubled, not left to break the field --------------
{
  const csv = financeCsv(
    summarizeFinance([ev({ kind: 'merch', label: 'The "Grip" Mat', listPriceSgd: '45.00', paidSgd: '45.00' })]),
  )
  assert.ok(lines(csv)[1]?.includes('"The ""Grip"" Mat"'), lines(csv)[1])
}

// -- Unattributed is spelled out, never left blank ---------------------------
// A blank Location cell reads as "we forgot"; the whole point of the bucket is
// that the gap is stated.
{
  const csv = financeCsv(
    summarizeFinance([
      ev({ kind: 'purchase', listPriceSgd: '100.00', paidSgd: '100.00' }),
      ev({
        kind: 'purchase',
        id: 'y',
        listPriceSgd: '100.00',
        paidSgd: '100.00',
        locationId: 'loc-1',
        locationName: 'Outram Park',
      }),
    ]),
  )
  const body = lines(csv).slice(1)
  assert.ok(body.some(l => l.includes('Unattributed')))
  assert.ok(body.some(l => l.includes('Outram Park')))
}

// -- the export is exactly the rows it was given, in the same order ----------
{
  const summary = summarizeFinance([
    ev({ kind: 'purchase', id: 'a', occurredAt: at('2026-06-01T00:00:00.000Z'), listPriceSgd: '1.00', paidSgd: '1.00' }),
    ev({ kind: 'purchase', id: 'b', occurredAt: at('2026-06-20T00:00:00.000Z'), listPriceSgd: '1.00', paidSgd: '1.00' }),
  ])
  const body = lines(financeCsv(summary)).slice(1)
  assert.strictEqual(body.length, summary.rows.length)
  assert.ok(body[0]?.startsWith('2026-06-20'), 'newest first, same as the table')
}

// -- an empty period still exports its header --------------------------------
{
  const csv = financeCsv(summarizeFinance([]))
  assert.strictEqual(lines(csv).length, 1)
}

console.log('finance/csv.test.ts ok')
