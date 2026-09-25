import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { packArchive } from '../../../src/services/tenants/transfer-archive'
import { ConfigError, starterConfig, validateConfig } from './config'
import { constraintViolations } from './constraints'
import { reportFacts, staffFacts } from './facts'
import { figuresOf } from './figures'
import { fillConfigs, unmappedPaymentMethods, type StudioAnswers } from './fill'
import { mapStudio } from './mapper'
import { readPromotions, readSales, type SaleMethodRow } from './readers'
import { joinSales } from './sales'
import { readReports, verifyImport } from './transform'
import { dateOfIso } from './values'

/**
 * #284: every paid past Mindbody sale is a provider-less Purchase carrying its
 * Mindbody sale number and how it was paid (the Sales report, `readSaleMethods`),
 * mapped by the config's `paymentMethods` table. From the outside: fixture
 * reports and config in, archive rows, preflight and figures out.
 *
 * The fixture's Sales workbook is its own invented sales, none of them in Big
 * Spenders, so each test says how the fixture's past sales were paid.
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const REPORTS = path.join(FIXTURES, 'reports')
const TENANT = '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a'

/** The fixture with its past purchases, and a method table. */
const config = (paymentMethods: Record<string, string> = TABLE) => {
  const c = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as Record<string, any>
  c.history = { from: '2026-06-01', purchases: true }
  c.paymentMethods = paymentMethods
  return validateConfig(c)
}
const TABLE = { Cash: 'cash', 'Credit card (Visa-Keyed)': 'card', 'Misc. (PayNow QR)': 'paynow', 'Misc. (Bank)': 'bank_transfer' }

/**
 * How the fixture's sales in the window were paid. 7500 is Jane's pack; 7620
 * Rick's pack he returned; 7700 Kim's pack, paid two ways; 7610 Rick's June
 * pack; 7600 (his plan) is in no Sales row.
 */
const PAID: SaleMethodRow[] = [
  { saleId: '7500', methodLabel: 'Cash', amount: 250 },
  { saleId: '7620', methodLabel: 'Credit card (Visa-Keyed)', amount: 250 },
  { saleId: '7630', methodLabel: 'Credit card (Visa-Keyed)', amount: -250 },
  { saleId: '7700', methodLabel: 'Misc. (PayNow QR)', amount: 150 },
  { saleId: '7700', methodLabel: 'Cash', amount: 100 },
  { saleId: '7610', methodLabel: 'Misc. (Bank)', amount: 240 },
]

async function mapped(saleMethods: SaleMethodRow[] = PAID, c = config()) {
  const reports = await readReports(REPORTS)
  return mapStudio({ ...reports, saleMethods }, c, TENANT)
}

const purchaseOf = (archive: { rows: Record<string, Record<string, unknown>[]> }, saleId: string) =>
  archive.rows.purchases!.filter(p => p.source_sale_id === saleId)

test('a paid past sale is a Purchase with its sale number and mapped method, and its package links to it', async () => {
  const { archive, ids } = await mapped()
  const [purchase, ...more] = purchaseOf(archive, '7500')
  assert.equal(more.length, 0)
  assert.deepEqual(purchase, {
    id: purchase!.id,
    tenant_id: TENANT,
    client_id: ids.clients!['100000001'],
    kind: 'class_package',
    total_sgd: '250.00',
    // No payment row behind it: the money was taken in Mindbody.
    amount_paid_sgd: '0.00',
    status: 'paid',
    settled_at: '2026-06-30T16:00:00.000Z',
    refunded_at: null,
    created_at: '2026-06-30T16:00:00.000Z',
    source_sale_id: '7500',
    offline_method: 'cash',
    offline_method_label: 'Cash',
  })
  const pkg = archive.rows.client_packages!.filter(p => p.purchase_id === purchase!.id)
  assert.equal(pkg.length, 1, 'the package it bought links to it')
  assert.deepEqual([pkg[0]!.client_id, pkg[0]!.amount_paid_sgd, pkg[0]!.purchased_at], [ids.clients!['100000001'], '250.00', '2026-06-30T16:00:00.000Z'])
  assert.deepEqual(constraintViolations(archive), [])
})

test('every paid past package has its Purchase; a $0 one has none, and no Purchase is for nothing', async () => {
  const { archive } = await mapped()
  const past = archive.rows.client_packages!.filter(p => p.active === false && p.purchased_at! >= '2026-05-31')
  for (const p of past) {
    if (p.complimentary) assert.equal(p.purchase_id, null, 'a comp is no sale')
  }
  // Rick's $0 ClassPass, bought in the window, is a comp with no Purchase.
  assert.ok(past.some(p => p.complimentary === true && p.purchase_id === null))
  assert.ok(archive.rows.purchases!.every(p => Number(p.total_sgd) > 0))
  const linked = new Set(archive.rows.client_packages!.map(p => p.purchase_id).filter(Boolean))
  assert.equal(linked.size, archive.rows.purchases!.length, 'every Purchase is linked from the one package it bought')
  assert.equal(archive.rows.purchases!.length, 5)
})

test('a returned sale is still one refunded Purchase and one Refund, now carrying the method it was paid by', async () => {
  const { archive, expected } = await (async () => {
    const m = await mapped()
    return { ...m, expected: figuresOf(m.archive) }
  })()
  const refunded = archive.rows.purchases!.filter(p => p.status === 'refunded')
  assert.equal(refunded.length, 1)
  assert.deepEqual(
    [refunded[0]!.source_sale_id, refunded[0]!.amount_paid_sgd, refunded[0]!.refunded_at, refunded[0]!.offline_method, refunded[0]!.offline_method_label],
    ['7620', '0.00', '2026-07-02T16:00:00.000Z', 'card', 'Credit card (Visa-Keyed)'],
  )
  assert.deepEqual(Object.values(expected.refunds), [{ name: 'the refund to Rick Roe <rick.roe@example.test> on 2026-07-03', cents: 25000 }])
})

test('a sale Mindbody split across methods keeps every label, largest part first, as "other" — or as the one method both are', async () => {
  const { archive, preflight } = await mapped()
  const [split] = purchaseOf(archive, '7700')
  assert.deepEqual([split!.offline_method, split!.offline_method_label], ['other', 'Misc. (PayNow QR) + Cash'])
  assert.ok(
    preflight.schedule.includes(
      'history purchases: 1 past purchase(s) were paid more than one way: every Mindbody method is in the label, and the method is "other" unless they are all one method here',
    ),
    preflight.schedule.join(' | '),
  )

  // Two cards are still a card.
  const twoCards = PAID.filter(p => p.saleId !== '7700').concat(
    { saleId: '7700', methodLabel: 'Credit card (Visa-Keyed)', amount: 150 },
    { saleId: '7700', methodLabel: 'Credit card (Amex-Keyed)', amount: 100 },
  )
  const again = await mapped(twoCards, config({ ...TABLE, 'Credit card (Amex-Keyed)': 'card' }))
  const [cards] = purchaseOf(again.archive, '7700')
  assert.deepEqual([cards!.offline_method, cards!.offline_method_label], ['card', 'Credit card (Visa-Keyed) + Credit card (Amex-Keyed)'])
})

test('a Mindbody method the table does not map refuses the build, naming every one; labels are matched ignoring case and spacing', async () => {
  await assert.rejects(mapped(PAID, config({ cash: 'cash' })), (err: unknown) => {
    assert.ok(err instanceof ConfigError)
    assert.deepEqual(
      err.problems.map(p => p.match(/"([^"]+)"/)?.[1]),
      ['Credit card (Visa-Keyed)', 'Misc. (Bank)', 'Misc. (PayNow QR)'],
      'each unmapped label once, and not Cash, which "cash" maps',
    )
    assert.match(err.problems[0]!, /add it to the answers file's paymentMethods as one of cash, card, paynow, bank_transfer, other/)
    return true
  })
  // A method nothing coming across was paid by is nobody's business here.
  await assert.doesNotReject(mapped([...PAID, { saleId: '99999', methodLabel: 'Misc. (Gift Card)', amount: 50 }]))
  // An answers table that is not one of the platform's methods is refused by the config.
  assert.throws(() => config({ Cash: 'coins' }), ConfigError)
})

test('a paid past sale with no Sales row carries no method, and the preflight counts them; with no Sales report it says so', async () => {
  const { archive, preflight } = await mapped()
  assert.deepEqual(purchaseOf(archive, '7600').map(p => [p.offline_method, p.offline_method_label]), [[null, null]])
  assert.ok(preflight.schedule.includes('history purchases: 1 past purchase(s) have no payment in the Sales report, so carry no payment method'), preflight.schedule.join(' | '))

  const none = await mapped([])
  assert.ok(none.archive.rows.purchases!.every(p => p.offline_method === null))
  assert.ok(
    none.preflight.schedule.includes('history purchases: no Sales (Detail Accrual) report was downloaded, so the 5 past purchase(s) carry no payment method'),
    none.preflight.schedule.join(' | '),
  )
})

test('verify: Purchases by month and method, and a month whose method changed is named', async () => {
  const { archive } = await mapped()
  const expected = figuresOf(archive)
  assert.deepEqual(expected.purchasesByMonth, {
    '2026-06': { 'no method': 170000, 'bank_transfer (Misc. (Bank))': 24000 },
    '2026-07': { 'cash (Cash)': 25000, 'card (Credit card (Visa-Keyed))': 25000, 'other (Misc. (PayNow QR) + Cash)': 25000 },
  })
  assert.deepEqual(await verifyImport(expected, await packArchive(archive)), [])

  archive.rows.purchases!.find(p => p.source_sale_id === '7500')!.offline_method = 'card'
  const differences = await verifyImport(expected, await packArchive(archive))
  assert.deepEqual(differences, [
    '2026-07: purchases paid by card (Cash): expected 0.00, found 250.00',
    '2026-07: purchases paid by cash (Cash): expected 250.00, found 0.00',
  ])

  // An expected file written before methods were counted compares none of them.
  const { purchasesByMonth: _, ...older } = expected
  assert.deepEqual(await verifyImport(older, await packArchive(archive)), [])
})

test('Big Spenders sale numbers are read in full from the link, and Promotions still joins on the four digits it shows', () => {
  const html = `<table>
    <tr><td><a href="/app/clients/100000001/purchases">Doe, Jane</a></td><td>Sale Date</td><td>Description</td><td>Location</td><td>Quantity</td><td>Sales Total</td></tr>
    <tr><td><a href="adm_tlbx_voidedit.asp?saleno=12046">2046</a></td><td>7/1/2026</td><td>Class Pack - Bundle of 10</td><td>Main Hall</td><td>1</td><td>200.00</td></tr>
    <tr><td><a href="adm_tlbx_voidedit.asp?saleno=2046">2046</a></td><td>6/1/2025</td><td>Class Pack - Bundle of 20</td><td>Main Hall</td><td>1</td><td>450.00</td></tr>
  </table>`
  const sales = readSales(html)
  assert.deepEqual(sales.map(s => s.saleId), ['12046', '2046'])

  const promotions = readPromotions(`<table>
    <tr><td>Date</td><td>Sale ID</td><td>Promotion</td><td>Item</td><td>Discount</td><td>Total</td></tr>
    <tr><td>1/7/2026</td><td>2046</td><td>Summer</td><td>Class Pack - Bundle of 10</td><td>50.00</td><td>200.00</td></tr>
  </table>`)
  const joined = joinSales({ sales, optionSales: [], promotions, members: [] })
  assert.deepEqual(
    joined.sold.map(j => [j.sale.saleId, j.discount]),
    [
      ['2046', 0],
      ['12046', 50],
    ],
  )
})

test('fill copies the answers\' method table, and proposes a row for every label the Sales report shows that it leaves out', async () => {
  const reports = await readReports(REPORTS)
  const asOf = dateOfIso('2026-09-17')
  const facts = reportFacts(reports, asOf, { offSiteVenues: [] })
  // The fixture's Sales workbook: money taken by three labels; the $0 comp's says nothing.
  assert.deepEqual(facts.paymentMethods, { Cash: 'cash', 'Credit card (Test Card-Keyed)': 'card', 'Misc. (Test Wallet)': null })

  const answers = {
    studio: { displayName: 'Northwind Yoga', timezone: 'Asia/Singapore', ownerEmail: 'owner@northwind.test', admins: [] },
    locations: [],
    defaultLocation: 'location-1',
    rooms: [],
    offSiteVenues: [],
    roomlessCapacity: 20,
    notWorkshopCategories: 'classes',
    workshopsMigrate: false,
    staffOnboarding: 'active',
    catalogue: { sell: [], merge: [], add: [], accessPassLocations: [], defaults: { credits: 1, validityDays: 30, ptSessionType: '1on1', unlimitedMonths: 1 } },
    history: null,
    paymentMethods: { cash: 'cash', 'Misc. (Test Wallet)': 'paynow' },
    outputs: { local: { slug: 'northwind' } },
  } satisfies StudioAnswers
  const filled = fillConfigs(starterConfig(reports, '2026-09-17T02:00:00+08:00'), answers, facts, staffFacts(reports, asOf)).local!
  assert.deepEqual(filled.paymentMethods, answers.paymentMethods, 'the answers, as they are: a proposal never reaches the config')
  assert.deepEqual(unmappedPaymentMethods(answers, facts), { 'Credit card (Test Card-Keyed)': 'card' })
})
