import path from 'node:path'
import type { PlaywrightTestConfig } from '@playwright/test'
import { STRIPE_HOST_RULES, STRIPE_STUB_API_URL } from './stripe-stub'

/**
 * `E2E_STACK=local`: the journeys against this machine rather than a deployed
 * stack — the pull-request job (#207), the Playwright agents, and a developer.
 *
 * The backend and the production builds of both frontends are started here
 * (the frontends reused, off CI, if they are already up), the studio is made by the local
 * backend's own `e2e:studio`, and Stripe is the stub in `./stripe-stub.ts`. The
 * database is whatever the backend's environment names: the CI job's Postgres
 * service, or `be/.env` locally.
 *
 * Unset, nothing here applies, and the run is the staging gate exactly as
 * before: `E2E_STUDIO_CMD` names the deployed stack, and Stripe is Stripe.
 */
export const isLocalStack = process.env.E2E_STACK === 'local'

const repo = path.resolve(__dirname, '../..')
const app = (dir: string) => `npm --prefix "${path.join(repo, dir)}"`

/** The local backend's studio command — see ./studio.ts. */
export const localStudioCommand = `${app('be')} run -s e2e:studio --`

export const localStackServers: NonNullable<PlaywrightTestConfig['webServer']> = [
  {
    name: 'backend',
    command: `${app('be')} run start`,
    url: 'http://localhost:4000/health',
    env: {
      // Mail goes nowhere (the null transport), as it does under the backend's own tests.
      NODE_ENV: 'test',
      STRIPE_API_URL: STRIPE_STUB_API_URL,
      // Any key: only the stub reads it, and it reads nothing.
      STRIPE_SECRET_KEY: 'sk_test_stripe_stub',
    },
    // Never someone else's: a backend already on :4000 (`make dev`) reaches
    // real Stripe, and a checkout through it fails in the stub for reasons
    // nobody can see. Stop it, and let this one start.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
  },
  {
    name: 'member app',
    command: `${app('fe-client')} run start`,
    // The bare host names no studio, so there is no page to wait for — only the port.
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  {
    name: 'staff portal',
    command: `${app('fe-portal')} run start`,
    port: 3001,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
]

/** The browser, with every Stripe host answered by the stub's checkout page. */
export const stubbedStripeBrowser: PlaywrightTestConfig['use'] = {
  // The stub's certificate is made per run and signed by nobody.
  ignoreHTTPSErrors: true,
  launchOptions: { args: [`--host-resolver-rules=${STRIPE_HOST_RULES}`] },
}
