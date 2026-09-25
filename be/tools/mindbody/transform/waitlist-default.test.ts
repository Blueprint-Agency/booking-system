import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { starterConfig, validateConfig } from './config'
import { mapStudio } from './mapper'
import { readReports } from './transform'

/**
 * Decision 21 is never open (#311): every class has a waitlist, and its length,
 * from 0, is a figure staff type in the portal. A config that names no figure
 * transforms with the switch on and every class still to come at 0.
 */

const FIXTURES = path.join(__dirname, 'fixtures')
const TENANT = '0b8e4a52-6d0f-4c1e-9a57-3f2d1c0b9e8a'

test('with no waitlist figure named, the switch is on and every class and series starts at 0', async () => {
  const reports = await readReports(path.join(FIXTURES, 'reports'))
  assert.deepEqual(starterConfig(reports).waitlist, { enabled: true, capacity: 0, classTypes: {} })

  const config = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8')) as Record<string, any>
  delete config.waitlist
  const settled = validateConfig(config)
  assert.deepEqual(settled.waitlist, { enabled: true, capacity: 0, classTypes: {} })

  const { archive } = mapStudio({ ...reports, waitlists: [] }, settled, TENANT)
  assert.ok(archive.rows.classes!.length > 0 && archive.rows.classes!.every(c => c.capacity_waitlist === 0))
  assert.ok(archive.rows.class_series!.every(s => s.capacity_waitlist === 0))
  assert.equal(archive.rows.feature_flags![0]!.enabled, true)
})
