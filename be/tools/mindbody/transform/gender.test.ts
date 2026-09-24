import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { transformMindbody } from './transform'

/**
 * A Member's gender (#281): Retention Management is the one report that holds
 * it, and only for members with a membership. Where it has F or M the Member
 * comes across female or male; everyone else comes across with none, never a
 * default. The preflight counts how many came across with one.
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const TENANT = '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a'

test('members: gender from Retention Management where Mindbody has one, none where it does not, counted in the preflight', async () => {
  const config = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as unknown
  const { archive, ids, preflight, preflightText } = await transformMindbody({
    reportsDir: path.join(FIXTURES, 'reports'),
    config,
    tenantId: TENANT,
  })
  const gender = (barcode: string) => archive.rows.clients!.find(r => r.id === ids.clients![barcode])!.gender

  assert.equal(gender('100000001'), 'female')
  assert.equal(gender('100000002'), 'male')
  assert.equal(gender('100000005'), 'female')
  assert.equal(gender('100000003'), null, 'a "-" in the Gender column is no gender, not a default')
  assert.equal(gender('AB123456'), null, 'a member Retention Management does not list has none')

  const withGender = archive.rows.clients!.filter(r => r.gender !== null).length
  assert.equal(withGender, 3)
  assert.equal(preflight.membersWithGender, withGender)
  assert.match(preflightText, /## Members imported with a gender \(3 of 8\)/)
})
