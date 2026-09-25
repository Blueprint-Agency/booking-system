# Browser journeys

The Playwright journeys in `e2e/journeys/` run in two places, from the same files:

| Run | Where | Stack | Stripe | Workflow |
|---|---|---|---|---|
| **Every pull request** (#207), and **staging gate** | the CI runner | Postgres service, backend, production builds of both frontends — all in the runner | a stub (`e2e/src/stripe-stub.ts`) | `e2e-local.yml`, called by `deploy-be.yml` on a PR and before a `staging` deploy |
| **Production gate** (#145) | staging | the deployed staging stack | Stripe's own test mode | `e2e.yml`, called by `deploy-be.yml` before a `main` deploy |

The in-runner run is the early warning on a PR and gates the staging deploy, so a push straight to
`staging` cannot reach `main` without a journey having run on it. The staging run still decides
whether production is deployed.

Both make a throwaway `e2e-…` studio for the run and delete it afterwards (`be/src/e2e/studio.ts`).
On staging that studio is removed three ways: Playwright's global teardown, pass or fail; the
workflow's `if: always()` step, for a job cancelled or timed out; and the next run's setup, which
sweeps any `e2e-` studio older than two hours. The super portal's studio list never shows them.

## The local stack

`E2E_STACK=local` tells `e2e/playwright.config.ts` to start the backend and both frontends
itself (`e2e/src/local-stack.ts`), play Stripe from the test process, and make the studio with the
local backend's `e2e:studio` command. Unset, the run targets a deployed stack through
`E2E_STUDIO_CMD`, exactly as the staging gate always has.

On your machine:

1. `make build` (the frontends' production builds) and a migrated database (`make init` or `make migrate`).
2. Nothing on port 4000. The journeys start their own backend, pointed at the stub; a `make dev`
   backend reaches real Stripe, so the run refuses to share the port with one. Frontends already
   on 3000/3001 are reused.
3. `npm --prefix e2e ci`, then from `e2e/`:

```sh
E2E_STACK=local npx playwright test                 # bash
$env:E2E_STACK='local'; npx playwright test         # PowerShell
```

The backend reads `be/.env`, with `NODE_ENV=test` (mail goes nowhere) and the Stripe stub
overriding it.

## The Stripe stub

- The backend's Stripe client is pointed at it by `STRIPE_API_URL` (`be/src/lib/stripe-endpoint.ts`;
  production refuses the variable at boot). It plays a Customer, a Checkout session, the session
  read back, and the payment intent's receipt.
- The browser still goes to `https://checkout.stripe.com/…`; Chromium's resolver sends every
  Stripe host to the stub's page, which asks for a card as Stripe's does. So a journey pays the
  same way on both runs.
- Stripe's test cards mean what they mean on Stripe: `4242 4242 4242 4242` pays,
  `4000 0000 0000 0002` is declined, anything else is not a card.
- A call it does not play is answered 404 and **fails the run** at teardown, naming the call. Add
  it to the stub rather than working round it.

## Adding a journey with the agents

Playwright's planner, generator and healer are Claude Code subagents in `.claude/agents/`, and
their browser runs through the `playwright-test` MCP server in the root `.mcp.json` — on the local
stack, from `e2e/`'s own Playwright. Open Claude Code at the repo root (approve the server the
first time), with `e2e/` installed and the local stack buildable as above.

Every agent session starts from the **seed**, `e2e/journeys/seed.spec.ts`: global setup makes the
run's studio, and the seed opens its member app and prints its portal URL and staff logins.

1. **Plan** — one area per session. Ask the `playwright-test-planner` for a plan of one area
   (say "member waitlist"), saved as `e2e/specs/<area>.md`. Read it. Cut anything that does not
   need a browser: it belongs in the backend HTTP tests (`docs/md/testing.md`).
2. **Generate** — give the `playwright-test-generator` the reviewed plan. It drives the browser
   step by step and writes one journey per scenario into `e2e/journeys/`. Before committing:
   - Name each test with its Scenario Inventory ID (`test('WL-03 …')`) and update the Inventory row.
   - Replace every value it recorded from this run — the studio's URLs, an address, a password —
     with `studio()` and the sign-in helpers in `e2e/src/studio.ts`. The next run's studio has
     different ones.
   - Role and label locators (`getByRole`, `getByLabel`), not CSS.
   - A journey that needs something the studio lacks (a member with an expired plan, a full class)
     gets it from `be/src/e2e/studio.ts`, with the `Studio` type in `e2e/src/studio.ts` to match.
3. **Heal** — the `playwright-test-healer` runs and repairs failing journeys. It may fix a
   locator or a wait. It must not skip: its default for a journey it cannot fix is
   `test.fixme()`, and a skipped journey fails CI (`e2e/src/no-skips-reporter.ts`). A journey that
   fails because the feature is broken is a bug to file, not a test to change. Committed journeys
   are also protected by the test guardrail hook — a human lists one in `.claude/test-edits.allow`
   before an agent may edit it (`docs/md/test-guardrails.md`).

Then run the whole suite on the local stack, as above, and open the PR; `e2e-local.yml` runs it again.

## After upgrading Playwright

The agent definitions name the MCP tools of the Playwright that generated them. After every
`@playwright/test` bump in `e2e/package.json`, regenerate them and commit the diff:

```sh
npm --prefix e2e ci
npm --prefix e2e run agents
```

`e2e/scripts/init-agents.mjs` runs Playwright's `init-agents --loop=claude` at the repo root, then
rewrites the `playwright-test` server in `.mcp.json` to run `e2e/`'s Playwright against
`e2e/playwright.config.ts` on the local stack (Playwright's own entry is `cmd /c npx` on Windows and
knows nothing of `e2e/`). It keeps the seed and any other servers.
