import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { validateConfig } from './config'
import { foldLocationVariants } from './fill'
import { mapStudio } from './mapper'
import { readReports } from './transform'

/**
 * A plan or pack Mindbody sold once per Location — `Unlimited 12` and
 * `Unlimited 12 - <Location>` — is one package here, where the member picks the
 * Location when they buy. `fill` folds the copies into one catalogue entry, and
 * each member's plan, live or past, keeps the Location the option they bought
 * names. From the outside: fixture reports and config in, archive rows out.
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const REPORTS = path.join(FIXTURES, 'reports')
const TENANT = '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a'
const RICK = '100000002'
const LABELLED = 'Unlimited 12 - Riverside'

const LOCATIONS = [
  { key: 'location-1', name: 'Main Hall', mindbodyNames: [] },
  { key: 'location-2', name: 'Riverside', mindbodyNames: ['Riverside Studio'] },
]
const entry = (name: string, kind: string) => ({ name, mindbodyNames: [name], migrate: null, kind })

/** The fixture config, its Unlimited 12 folded with the copy sold for the second Location. */
const config = (history = false) => {
  const c = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as Record<string, any>
  c.catalogue.find((e: { name: string }) => e.name === 'Unlimited 12').mindbodyNames.push(LABELLED)
  if (history) {
    c.history = { from: '2026-01-01', purchases: true }
    c.paymentMethods = { Cash: 'cash', 'Credit card (Visa-Keyed)': 'card', 'Misc. (PayNow QR)': 'paynow', 'Misc. (Bank)': 'bank_transfer' }
  }
  return validateConfig(c)
}

const plansOf = (archive: { rows: Record<string, Record<string, unknown>[]> }, clientId: string) =>
  archive.rows.client_packages!.filter(p => p.client_id === clientId && p.kind === 'unlimited')

test('fill folds each copy sold for a Location into the unlabelled entry of the same kind, spacing aside', () => {
  const catalogue = [
    entry('Unlimited 6', 'unlimited'),
    entry('Unlimited 6 - Riverside', 'unlimited'),
    entry('Promo: Unlimited 6 +1', 'unlimited'),
    entry('Promo: Unlimited 6+1 - Riverside', 'unlimited'),
    entry('Walk-In', 'credit_bundle'),
    entry('Walk-In - Riverside', 'credit_bundle'),
  ]
  const folded = foldLocationVariants(catalogue, LOCATIONS)

  assert.deepEqual(
    catalogue.map(e => [e.name, e.mindbodyNames]),
    [
      ['Unlimited 6', ['Unlimited 6', 'Unlimited 6 - Riverside']],
      ['Promo: Unlimited 6 +1', ['Promo: Unlimited 6 +1', 'Promo: Unlimited 6+1 - Riverside']],
      ['Walk-In', ['Walk-In', 'Walk-In - Riverside']],
    ],
  )
  assert.deepEqual(folded.map(f => f.into), ['Promo: Unlimited 6 +1', 'Unlimited 6', 'Walk-In'])
})

test('fill leaves an access pass, a copy with nothing to fold into, and one of another kind as they are', () => {
  const catalogue = [
    entry('Riverside Studio Access', 'access_pass'),
    entry('Studio Access', 'access_pass'),
    entry('Unlimited 9 - Riverside', 'unlimited'),
    entry('Walk-In', 'credit_bundle'),
    entry('Walk-In - Riverside', 'unlimited'),
  ]
  assert.deepEqual(foldLocationVariants(catalogue, LOCATIONS), [])
  assert.equal(catalogue.length, 5)
})

test('a live plan bought as the copy for a Location is homed there, whatever the reports say of the member', async () => {
  const reports = await readReports(REPORTS)
  // Bought as the copy: Visits Remaining and the register both name it so.
  const holdings = reports.holdings.map(h => (h.clientId === RICK && h.option === 'Unlimited 12' ? { ...h, option: LABELLED } : h))
  const optionSales = reports.optionSales.map(s => (s.option === 'Unlimited 12' ? { ...s, option: LABELLED } : s))
  const { archive, ids } = mapStudio({ ...reports, holdings, optionSales }, config(), TENANT)

  const plans = plansOf(archive, ids.clients![RICK]!)
  assert.equal(plans.length, 1)
  assert.equal(plans[0]!.location_id, ids.locations!['location-2'])
  assert.equal(plans[0]!.source_class_package_id, ids.class_packages!['Unlimited 12'])
})

test('a live plan bought unlabelled, in a catalogue entry with a copy for a Location, is homed at the default', async () => {
  const reports = await readReports(REPORTS)
  const { archive, ids } = mapStudio(reports, config(), TENANT)

  const plans = plansOf(archive, ids.clients![RICK]!)
  assert.equal(plans.length, 1)
  assert.equal(plans[0]!.location_id, ids.locations!['location-1'])
})

test('a member holding the plan at both Locations keeps two plans, one at each, of the one package', async () => {
  const reports = await readReports(REPORTS)
  const plan = reports.holdings.find(h => h.clientId === RICK && h.option === 'Unlimited 12')!
  const holdings = [...reports.holdings, { ...plan, option: LABELLED }]
  const { archive, ids } = mapStudio({ ...reports, holdings }, config(), TENANT)

  const plans = plansOf(archive, ids.clients![RICK]!)
  assert.deepEqual(plans.map(p => p.location_id).sort(), [ids.locations!['location-1'], ids.locations!['location-2']].sort())
  assert.ok(plans.every(p => p.source_class_package_id === ids.class_packages!['Unlimited 12']))
  assert.equal(new Set(plans.map(p => p.id)).size, 2)
})

test('a past plan bought as the copy for a Location is homed there, not where the sale was rung up', async () => {
  const reports = await readReports(REPORTS)
  const plan = reports.sales.find(s => s.description === 'Unlimited 12')
  assert.ok(plan, 'the fixture sells Unlimited 12')
  const past = { ...plan!, saleId: '7999', description: LABELLED, location: 'Main Hall', soldAt: { ...plan!.soldAt, year: 2026, month: 3, day: 2 } }
  const { archive, ids } = mapStudio({ ...reports, sales: [...reports.sales, past] }, config(true), TENANT)

  const row = archive.rows.client_packages!.find(p => String(p.id) === ids.client_packages![`past/${RICK}/2026-03-02/Unlimited 12`])
  assert.ok(row, 'the past plan came across')
  assert.equal(row!.location_id, ids.locations!['location-2'])
})
