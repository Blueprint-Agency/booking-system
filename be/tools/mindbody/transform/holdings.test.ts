import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { validateConfig } from './config'
import { mapStudio } from './mapper'
import { readReports } from './transform'

/**
 * What a member holds, where Visits Remaining does not say it plainly: a live
 * purchase the report left out is read off the register (Pricing Option
 * Expirations), and a place on a workshop or retreat is never a package, even
 * where the catalogue did not know to skip its option. From the outside:
 * fixture reports and config in, archive rows and preflight out.
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const REPORTS = path.join(FIXTURES, 'reports')
const TENANT = '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a'
const RICK = '100000002'

const config = () => validateConfig(JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')))

const plansOf = (archive: { rows: Record<string, Record<string, unknown>[]> }, clientId: string) =>
  archive.rows.client_packages!.filter(p => p.client_id === clientId && p.kind === 'unlimited')

test('a live plan Visits Remaining leaves out comes across from the register, running to its Mindbody expiry', async () => {
  const reports = await readReports(REPORTS)
  const withoutPlan = reports.holdings.filter(h => !(h.clientId === RICK && h.option === 'Unlimited 12'))
  const { archive, ids } = mapStudio({ ...reports, holdings: withoutPlan }, config(), TENANT)

  const plans = plansOf(archive, ids.clients![RICK]!)
  assert.equal(plans.length, 1)
  assert.equal(plans[0]!.expires_at, '2027-02-01T15:59:59.000Z')
  assert.equal(plans[0]!.duration_months, 12)
  assert.equal(plans[0]!.amount_paid_sgd, '1700.00')
})

test('a holding filed under a workshop category is a place, not a package, and is listed in the preflight', async () => {
  const reports = await readReports(REPORTS)
  const asRetreat = reports.holdings.map(h =>
    h.clientId === RICK && h.option === 'Unlimited 12' ? { ...h, serviceCategory: 'Handstand Workshop' } : h,
  )
  const { archive, ids, preflight } = mapStudio({ ...reports, holdings: asRetreat }, config(), TENANT)

  assert.equal(plansOf(archive, ids.clients![RICK]!).length, 0)
  const line = preflight.notMigrated.find(n => n.clientId === RICK && n.option === 'Unlimited 12')
  assert.match(line!.reason, /workshop or retreat \(Handstand Workshop\)/)
})
