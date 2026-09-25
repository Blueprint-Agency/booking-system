import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import {
  harnessAppLoads,
  integrationTestsEnabled,
  SKIP_REASON,
  startTestApp,
  type TestApp,
} from './harness'

/**
 * The harness sets up once per process: migrate, seed and the app import are
 * paid by the first `startTestApp`, and every later one (the next test file,
 * when the suite runs in one process) gets the same app back. What belongs to a
 * file stays its own: its logs, and a clock back on the wall.
 */
describe('the test harness', { skip: integrationTestsEnabled ? false : SKIP_REASON }, () => {
  let first!: TestApp
  let second!: TestApp

  before(async () => {
    first = await startTestApp()
    second = await startTestApp()
  })

  after(async () => {
    await second?.close()
    await first?.close()
  })

  test('a second start hands back the same app, imported once', () => {
    assert.equal(second.app, first.app)
    assert.equal(second.db, first.db)
    assert.equal(harnessAppLoads(), 1)
  })

  test('each start collects its own log lines, and a closed one collects none', async () => {
    // Through the module, so each call reads the logger the harness points at now.
    const logging = await import('../shared/logger')
    const LINE = 'harness.test: a line'
    const logged = (t: TestApp) => t.logs.lines().filter(l => l.msg === LINE)
    first.logs.clear()
    second.logs.clear()

    logging.logger.info(LINE)
    assert.equal(logged(second).length, 1, 'the latest start collects the line')
    assert.equal(logged(first).length, 0, 'an earlier start does not')

    const third = await startTestApp()
    await third.close()
    logging.logger.info(LINE)
    assert.equal(logged(third).length, 0, 'a closed start collects nothing')
  })

  test('a start puts the clock back on the wall', async () => {
    first.clock.set(new Date('2001-01-01T00:00:00Z'))
    const again = await startTestApp()
    try {
      assert.ok(Math.abs(again.clock.now().getTime() - Date.now()) < 60_000)
    } finally {
      await again.close()
    }
  })
})
