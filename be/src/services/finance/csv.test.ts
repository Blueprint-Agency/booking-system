import assert from 'node:assert'
import { financeCsv as financeCsvIn } from './csv'
import { summarizeFinance, type FinanceSummary } from './totals'
import type { MoneyEvent } from './events'

/** The studio these Singapore-dated cases are written for. */
const financeCsv = (summary: FinanceSummary) => financeCsvIn(summary, 'Asia/Singapore')

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

const lines = (csv: string) => csv.split('\r\n')

// -- a variant containing a comma cannot shift every later column ------------
{
  const csv = financeCsv(
    summarizeFinance([
      ev({
        kind: 'purchase',
        variant: '10-Class Pack, 6 months',
        party: 'Tan, Wei Ming',
        listPriceSgd: '300.00',
        paidSgd: '270.00',
      }),
    ]),
  )
  const [header, row] = lines(csv)
  assert.strictEqual(header?.split(',').length, 14)
  assert.ok(row?.includes('"10-Class Pack, 6 months"'))
  assert.ok(row?.includes('"Tan, Wei Ming"'))
  // The quoted fields are one cell each, so the figures still land in the right
  // places — check those rather than counting commas.
  assert.ok(row?.endsWith('300,Unattributed,30,,270,,,,'), row)
}

// -- a quote in a variant is doubled, not left to break the field ------------
{
  const csv = financeCsv(
    summarizeFinance([ev({ kind: 'merch', type: 'merch', variant: 'The "Grip" Mat', listPriceSgd: '45.00', paidSgd: '45.00' })]),
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
        locationName: 'Parkside Studio',
      }),
    ]),
  )
  const body = lines(csv).slice(1)
  assert.ok(body.some(l => l.includes('Unattributed')))
  assert.ok(body.some(l => l.includes('Parkside Studio')))
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

// -- date and time are on the studio's own clock ------------------------------
{
  // 00:30 on 12 August in Sydney is 22:30 on the 11th in Singapore
  const summary = summarizeFinance([
    ev({ kind: 'purchase', occurredAt: at('2026-08-11T14:30:00.000Z'), listPriceSgd: '1.00', paidSgd: '1.00' }),
  ])
  assert.ok(lines(financeCsvIn(summary, 'Australia/Sydney'))[1]?.startsWith('2026-08-12,00:30,'))
  assert.ok(lines(financeCsvIn(summary, 'Asia/Singapore'))[1]?.startsWith('2026-08-11,22:30,'))
}

console.log('finance/csv.test.ts ok')
