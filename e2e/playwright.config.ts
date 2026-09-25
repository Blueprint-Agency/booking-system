import { defineConfig, devices, type ReporterDescription } from '@playwright/test'
import {
  isLocalStack,
  localStackPayments,
  localStackServers,
  localStudioCommand,
  stubbedStripeBrowser,
} from './src/local-stack'

/**
 * The browser journeys, against one of two stacks:
 *
 *  - Deployed (the default): staging in CI — the production gate (#145) — or
 *    any deployed stack by hand. `E2E_STUDIO_CMD` makes the studio there, and
 *    Stripe is Stripe's own test mode.
 *  - Local (`E2E_STACK=local`): every pull request (#207), the Playwright
 *    agents, and a developer. The backend and both frontends run on this
 *    machine, and Stripe is a stub — see src/local-stack.ts.
 *
 * Either way the studio's URLs come back from that backend's own
 * `FRONTEND_URLS`, so nothing here names a host.
 *
 * One worker. The journeys share one studio and a deployed backend, and a
 * gate that is fast but occasionally racing itself is worse than a slow one.
 */
const baseReporters: ReporterDescription[] = process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']]

// Read by global setup (src/studio.ts), which runs in this process — and the
// studio command it runs inherits this environment, so the studio is made
// selling on the stub's account (src/local-stack.ts).
if (isLocalStack) {
  process.env.E2E_STUDIO_CMD ??= localStudioCommand
  for (const [name, value] of Object.entries(localStackPayments)) process.env[name] ??= value
}

export default defineConfig({
  testDir: './journeys',
  // The agents' seed (journeys/seed.spec.ts) runs where the agents do — the
  // local stack — and leaves the staging gate the journeys it always had.
  testIgnore: isLocalStack ? undefined : 'seed.spec.ts',
  globalSetup: './src/global-setup.ts',
  webServer: isLocalStack ? localStackServers : undefined,
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
    ...(isLocalStack ? stubbedStripeBrowser : {}),
  },
})
