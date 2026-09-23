import { defineConfig, devices, type ReporterDescription } from '@playwright/test'

/**
 * The three golden paths (#145), run against a deployed stack — staging in CI,
 * the local stack by hand. Which stack is decided by where `E2E_STUDIO_CMD`
 * makes the studio: its URLs come back from that backend's own
 * `FRONTEND_URLS`, so nothing here names a host.
 *
 * One worker. The journeys share one studio and a deployed backend, and a
 * gate that is fast but occasionally racing itself is worse than a slow one.
 */
const baseReporters: ReporterDescription[] = process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']]

export default defineConfig({
  testDir: './journeys',
  globalSetup: './src/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // No retries. The journeys change their studio as they go — a class created,
  // a credit spent — so a second attempt meets a different studio and fails
  // for that. A blip means re-running the workflow, which makes a fresh studio.
  retries: 0,
  // A stray `test.only` would quietly run one journey and pass the gate.
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // no-skips fails the run on any skipped journey, `--list` included.
  reporter: [...baseReporters, ['./src/no-skips-reporter.ts']],
  use: {
    ...devices['Desktop Chrome'],
    // The studio's zone (tenants.timezone defaults to Asia/Singapore), so a
    // time typed into the portal is the time the instructor reads back.
    timezoneId: 'Asia/Singapore',
    locale: 'en-SG',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
