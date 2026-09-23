# Research — getting every feature tested with AI agents (agentic QA)

_Researched 2026-09-23. Question: "What's the best way to get all features tested without doing it by hand when AI coding? Should the agent click through every scenario in a browser? Is there a framework for feature testing / QA?"_

## 1. TL;DR

- **Don't make "agent clicks through everything" your test suite.** Use the agent's browser to **explore and write** tests, then run those **deterministic** tests in CI. Playwright ships exactly this workflow: a planner agent writes a Markdown test plan, a generator turns it into `.spec.ts` files, a healer repairs broken ones ([Playwright Test Agents](https://playwright.dev/docs/test-agents)). An agent clicking through the app every time costs tokens, gives different results from run to run, and can't gate a deploy.
- **Anthropic's core advice is "give Claude a check it can run"**: tests, a build, a screenshot. Without one, "you become the verification loop" ([Claude Code best practices](https://code.claude.com/docs/en/best-practices)). Agent browser sessions (Claude in Chrome, `/verify`) are for confirming a change **ad hoc**. They don't replace a suite.
- **This repo is further along than it feels.** The backend has **97 test files and about 684 test cases**. 43 files use a real two-tenant Postgres harness (`be/src/test/harness.ts`), and they gate the backend deploy. There are **3 Playwright golden-path journeys** on staging that gate production. What's weak: **the frontends have no component or page tests**, **about half the admin/instructor/member API surfaces have no HTTP-level test**, nothing **maps spec scenarios to tests**, and **nothing measures coverage**.
- **The right shape for this stack is the "testing trophy" / "mostly integration"** ([Kent C. Dodds](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)). You already have the key piece: `app.request()` against a real Postgres. Put most new tests there. Keep browser E2E to roughly 15–30 critical journeys.
- **The framework to use is a scenario inventory**: acceptance criteria, each with an ID, extracted from `prd.md`, `fe-client-features.md` and `admin-restructure.md`, and mapped to the tests that cover them. Gherkin/BDD (playwright-bdd) is optional. It helps if non-developers will read the scenarios. Plain `test('AC-CHK-03 …')` names plus a traceability table do the same job with less tooling.
- **Guard against AI-written tests that prove nothing.** Anthropic and Kent Beck both document agents **deleting or weakening tests, or hard-coding values, to go green** ([Anthropic prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), [Kent Beck](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes)). Mitigations: protect test files with hooks, have a separate reviewer subagent, track coverage, and spot-check with mutation testing.
- **Recommended order:** (1) scenario inventory → (2) fill backend HTTP integration gaps → (3) add ~15–30 Playwright journeys with Playwright's planner/generator agents, run on a **local stack in PR CI** → (4) coverage + test-protection hooks → (5) keep agent browser exploration as a periodic, ad-hoc "exploratory QA" pass that **files issues and new test cases** instead of being the gate.

---

## 2. Where this repo stands today

### Runners, scripts and CI

| App | Runner | Script | CI job |
|---|---|---|---|
| `be/` | Node built-in `node:test` via `tsx` (not vitest/jest) | `npm run check` = `node --import tsx --test "src/**/*.test.ts"` (`be/package.json`) | `test` job in `.github/workflows/deploy-be.yml`: `postgres:16` service, serial (`--test-concurrency=1`), **fails if any test skips**. `deploy` has `needs: [changes, test, drift, e2e]` |
| `fe-client/` | `node --test` | `npm run check` (`fe-client/package.json`) | `fe-client` job in `deploy-be.yml`. A **signal only**: Vercel deploys without waiting (see `docs/md/deployment.md`) |
| `fe-portal/` | `node --import tsx --test` | `npm run check` (`fe-portal/package.json`) | `fe-portal` job in `deploy-be.yml`. Signal only |
| `e2e/` | `@playwright/test` 1.63.0, 1 worker, 0 retries, Chromium, `Asia/Singapore` tz (`e2e/playwright.config.ts`) | `npm test` | `.github/workflows/e2e.yml`. Runs **only** as a gate before a `main` (production) backend deploy, or by hand. Runs against **staging** in a throwaway `e2e-<run>` studio made and swept by `be/src/e2e/` |
| `cdn/` | none | none | none |

Other checks: schema drift job (`drift`), error-code catalogue parity (`scripts/check-error-codes.mjs`), Node-version parity with `be/Dockerfile`. No coverage tooling (no `--experimental-test-coverage`, c8, istanbul). No mutation testing. No component-test library (no Testing Library / Vitest / Jest in either frontend).

### Test inventory

| App | Level | Files | Notes |
|---|---|---|---|
| be | **Unit** (pure service/lib functions) | ~54 | `services/{billing,packages,finance,payroll,schedule,tenants,pt-sessions,leave,…}/*.test.ts`, `lib/*.test.ts`, `mindbody/*.test.ts`. Money math, validity, promotions, occupancy, series dates, slug rules, CSV, etc. |
| be | **Integration, real Postgres** (`startTestApp` harness, two tenants `northwind`/`acme`, `booking_app` non-owner role so **RLS is live**) | 43 | Almost all in `be/src/test/`. Includes `isolation.test.ts` (42 cases), `isolation-sessions.test.ts`, `rls.test.ts`, `rls-coverage.test.ts`, `booking-lifecycle.test.ts`, `better-auth.test.ts`, `impersonation.test.ts`, `tenant-{provisioning,delete,term,resolution,import-jobs}.test.ts`, `member-*`, `staff-*`, `payment-credentials.test.ts`, `resend-webhook.test.ts`, `transfer.test.ts`, `foreign-key-indexes.test.ts` |
| be | ↳ of which **HTTP/route-level** (`app.request()`) | ~33 | Real Hono app in-process with real Better Auth sign-in (`signInAs`) |
| be | **Stripe** | 4 use `be/src/test/stripe-fake.ts` | An in-process fake installed at the `lib/stripe.ts` seam, which records which account each call hit. Covers checkout-session, webhook verification, provider calls, refund on member delete. No `stripe listen`/`stripe trigger` replay |
| fe-client | Unit (`src/lib/*`) | 9 | Host→tenant parsing, auth redirect, API request, security headers, telemetry redaction. **0 component/page tests** |
| fe-portal | Unit (`src/lib/*`) | 19 | Schedule/slot/series/finance/payroll helpers, staff role, super-portal. **0 component/page tests** |
| e2e | **Browser E2E** (Playwright, real Stripe test-mode hosted Checkout, card `4242…`) | 3 | `e2e/journeys/buy-and-book.spec.ts`, `schedule-a-class.spec.ts`, `cancel-and-refund.spec.ts` |

Approx. total backend test cases: **684** (`it(`/`test(` at line start).

### Biggest gaps against the spec docs

API prefixes referenced by at least one HTTP-level backend test (grep of `/api/v1/...` in `*.test.ts`). Well covered: `portal/admin/clients` (30 refs), `portal/admin/staff` (25), `platform/tenants` (17), `public/*` catalogue, `me/bookings`, auth flows. **No HTTP-level test found** (some may be covered one layer down at service level):

- Admin (`be/src/routes/portal/admin/`): `check-in`, `pt-sessions`, `corporate-{packages,requests,sessions}`, `notifications` (template editor, `admin-restructure.md` §16), `waiver` (§17), `inbox` (§13), `policy` (§4 cancellation policy), `promo-codes`, `merch`, `marketing`, `rooms`, `leave`, `class-packages`/`pt-packages`, `feature-flags`, `purchases`.
- Instructor (`routes/portal/instructor/`): only `schedule` is hit. `check-in`, `roster`, `pt-requests`, `payroll`, `leave`, `profile` are not.
- Member (`routes/client/`): `waiver`, `referral`, `invoices`, `purchases` not hit over HTTP.
- **PT request lifecycle** (`admin-restructure.md` §9, `docs/md/pt-session-lifecycle.md`): no integration test mentions PT requests.
- **Frontends**: no test renders any page. Error/empty states, role-gated nav, and forms (`fe-client-features.md` §1–8, `admin-restructure.md` §1–20) are verified only by the 3 journeys and by hand.
- **E2E breadth**: 3 journeys vs. about 40 client routes/sections and about 20 admin sections. E2E runs only right before production, **not on PRs**, and only against staging.
- **No scenario → test traceability.** Nobody can answer "how far have we tested", which is the user's actual complaint.
- **Time-dependent rules** (cancellation windows, package validity, reminders via `node-cron`) are tested at unit level. No end-to-end "advance the clock" test.

Strengths worth keeping: the two-tenant harness really does catch a missing `WHERE tenant_id` (the RLS backstop is live because tests connect as `booking_app`). The CI gate fails on skipped tests. The E2E studio is disposable and isolated per run. Journeys use role/label locators, as Playwright's own best practices recommend.

---

## 3. Recommended approach for this repo

### Is "give the agent a browser and let it click through everything" good practice?

**As the regression suite: no. As an exploration and authoring tool: yes.**

- Anthropic's guidance: the check has to return **pass/fail the agent can read**. The deterministic options are tests, a Stop hook, or a verifier subagent. A browser screenshot is listed as one kind of check, and `/verify` is something "you" run after the check passes ([best practices](https://code.claude.com/docs/en/best-practices), [skills: /run, /verify](https://code.claude.com/docs/en/skills)).
- Anthropic's long-running-agent harness post found Claude "mostly did well at verifying features end-to-end once explicitly prompted to use browser automation tools", but notes "Claude can't see browser-native alert modals through the Puppeteer MCP" and a "tendency to mark a feature as complete without proper testing" ([Anthropic Engineering, 2025-11-26](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)). Agent clicking is useful, but it has blind spots and can over-claim.
- Playwright's own design is explore → generate → heal. The output is `specs/*.md` plans and `tests/*.spec.ts` that run in the normal runner ([Playwright Test Agents](https://playwright.dev/docs/test-agents)).
- Browser-agent vendors address cost by **caching and replaying** actions without the LLM. Stagehand replays cached steps "with no LLM calls, no token cost" ([Stagehand caching](https://docs.stagehand.dev/v3/best-practices/caching)). That concedes the point: a repeatable run should not reason from scratch each time.
- Playwright MCP says MCP is for "exploratory automation, self-healing tests, or long-running autonomous workflows". Coding agents should prefer the more token-efficient **Playwright CLI + skills** ([playwright-mcp README](https://github.com/microsoft/playwright-mcp), [Playwright CLI](https://playwright.dev/docs/getting-started-cli)).

### Ordered plan

**Step 1: Scenario inventory, the "framework" (1–2 days, agent-drafted, human-reviewed).**
Have Claude read `prd.md` §6 (user journeys), `fe-client-features.md`, `admin-restructure.md`, `class-booking-lifecycle.md`, `pt-session-lifecycle.md`, `spec-finance.md`, `spec-credit-ledger-payroll.md` and the `spec-instructor-leave*.md` files. It writes one `docs/md/test-scenarios.md` table: `ID | area | role | scenario (Given/When/Then) | risk (money/tenancy/data-loss/UX) | level (unit/integration/e2e) | covered by (file:test) | status`. Use a subagent per spec doc and a fresh-context reviewer to catch missing scenarios ([best practices: subagents, adversarial review](https://code.claude.com/docs/en/best-practices)). Seed the "covered by" column by grepping existing test names. **This table is your answer to "how far have we tested".** Anthropic's harness post uses the same idea: a feature list where the agent may only flip a `passes` field ([Anthropic Engineering](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)).

**Step 2: Fill the backend integration gaps first (biggest ROI).**
Use the existing harness (`be/src/test/harness.ts`: `startTestApp`, `signInAs`, two tenants). For every uncovered route group in §2, add `app.request()` tests. Each one should cover the happy path, the role refusals (member vs instructor vs admin), the cross-tenant refusal, and the key business rules from the spec. This is the "mostly integration" layer. It's fast, deterministic and already in the deploy gate. Hono's documented way to test is exactly `app.request()` ([Hono testing](https://hono.dev/docs/guides/testing)). Priority order by risk: PT requests → check-in → cancellation policy/refunds → workshops → waivers → notifications templates → corporate → payroll/leave → promo/merch/referral/inbox. Put the scenario ID in the test name.
- Time rules: inject a clock into services (or keep `node-cron` jobs callable) and test "window passes → credit not refunded" at integration level. Stripe **test clocks** exist, but only for Billing/subscription objects ([Stripe test clocks](https://docs.stripe.com/billing/testing/test-clocks)). They're relevant only if you use Stripe subscriptions.
- Stripe: keep the in-process fake for logic. Add a local/manual check that the real webhook path accepts real signed events: `stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe` + `stripe trigger checkout.session.completed` ([Stripe webhooks: test locally](https://docs.stripe.com/webhooks#test-webhook)).
- Testcontainers is **not needed**. CI already uses a `postgres:16` service container and locally `docker compose`. Only consider `@testcontainers/postgresql` if you want per-worker databases to un-serialize the suite ([Testcontainers Postgres](https://node.testcontainers.org/modules/postgresql/)).

**Step 3: Grow browser E2E to ~15–30 critical journeys, generated by agents, run deterministically.**
- In `e2e/`, run `npx playwright init-agents --loop=claude` ([Playwright Test Agents](https://playwright.dev/docs/test-agents)). Write a **seed test** that uses the existing `studio()` fixture / `E2E_STUDIO_CMD` setup. Let the planner explore one area per session (e.g. "admin check-in", "member PT request") and write `specs/<area>.md`. Review the plan (5 minutes of human time), then let the generator write specs. Regenerate agent definitions when Playwright is upgraded (Playwright docs say so).
- Pick journeys by risk: every money path, every role's core loop (admin runs a day, instructor checks in, member books/cancels/waitlists), tenant signup via super portal, and one per critical error state. Everything else belongs in step 2. "Push your tests as far down the test pyramid as you can" ([Practical Test Pyramid, Ham Vocke](https://martinfowler.com/articles/practical-test-pyramid.html)).
- **Run a local-stack E2E job on PRs** (backend + both Next builds + Postgres in the runner, `E2E_STUDIO_CMD` pointed at the local backend, which `e2e/playwright.config.ts` already allows). Stub Stripe's hosted page on PR runs. Keep the existing real-Stripe staging run as the production gate. Playwright advises "Only test what you control" and mocking third parties ([Playwright best practices](https://playwright.dev/docs/best-practices)). Next.js recommends E2E over unit tests for async Server Components ([Next.js testing](https://nextjs.org/docs/app/guides/testing)), which supports this layer being your frontend coverage.
- Sign-in shortcut: you already mint sessions via `e2e:studio`. Better Auth also has a `testUtils` plugin (`getCookies()` → `context.addCookies`, `captureOTP`), to be used from a **test-only** auth instance ([Better Auth test utils](https://better-auth.com/docs/plugins/test-utils)).

**Step 4: Frontend unit/component tests, selectively.**
Only where logic lives in client components (checkout form states, schedule grid, capacity fields). Next.js documents Vitest/Jest for this ([Next.js testing](https://nextjs.org/docs/app/guides/testing)). Don't chase component coverage. The journeys + backend integration tests carry most of the confidence.

**Step 5: Measure, protect, and loop the agent.**
- Coverage: `node --test --experimental-test-coverage --test-reporter=lcov` needs no new dependency (still "Experimental") ([Node test coverage](https://nodejs.org/api/test.html#collecting-code-coverage)). Report per `services/*` folder. Use it to find untested code, **not** as a target number.
- Protection: a `PreToolUse` hook that blocks edits to existing `*.test.ts`/`*.spec.ts` unless the task says so, and a `Stop` hook that runs the affected suite. Exit 2 blocks and feeds the error back to Claude ([Claude Code hooks](https://code.claude.com/docs/en/hooks)).
- CI agent (optional): `anthropics/claude-code-action` on PRs to review "does this PR add/adjust tests for the scenarios it touches?" ([Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions)).
- **Ad-hoc agent browser QA** (Claude in Chrome / Playwright CLI / agent-browser): before a release, run an exploratory session per role against a local or staging studio. Tell it: find bugs, don't fix them, and output (a) issues in GitHub with `needs-triage`, and (b) new rows for `test-scenarios.md`. This is where the "agent clicks through everything" idea earns its keep.

**What runs where**

| Where | What |
|---|---|
| Every PR (CI) | backend unit + integration (existing gate), frontend `check`, **new**: local-stack Playwright journeys (Stripe stubbed), coverage report |
| Before prod deploy (CI) | existing staging journeys with real Stripe test mode (`e2e.yml`) |
| Agent, per task | write failing test → implement → run suite (Stop hook) → `/verify` in browser for UI changes |
| Agent, periodic | Playwright planner/generator to add journeys; exploratory browser QA that files issues; Stryker spot-check on money/credit services |

---

## 4. Tool comparison

| Tool | What it is | Deterministic in CI? | Best role here |
|---|---|---|---|
| **Playwright Test** (`@playwright/test`) | Test runner + browser automation (already in `e2e/`) | Yes | The E2E suite itself |
| **Playwright Test Agents** (`npx playwright init-agents --loop=claude`) | Planner/generator/healer agent definitions for Claude Code, VS Code, Codex, OpenCode. Output is Markdown plans + `.spec.ts` ([docs](https://playwright.dev/docs/test-agents)) | Output is. Agents aren't | **Author and heal E2E tests.** Watch the healer: it may **skip** a test "if the healer believes that functionality is broken" |
| **Playwright MCP** ([repo](https://github.com/microsoft/playwright-mcp)) | MCP server, accessibility-tree snapshots, "no vision models needed" | No | Long exploratory/self-healing loops |
| **Playwright CLI** ([docs](https://playwright.dev/docs/getting-started-cli), [repo](https://github.com/microsoft/playwright-cli)) | CLI + skills for coding agents. More token-efficient than MCP (per the MCP README) | No | Default browser tool for Claude Code sessions |
| **Claude in Chrome** ([docs](https://code.claude.com/docs/en/chrome)) | Extension. Visible Chrome, shares your login, reads console, records GIFs. Needs a Pro/Max/Team/Enterprise login | No | Ad-hoc `/verify`, debugging, demo GIFs |
| **agent-browser** ([vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)) | Vercel Labs native Rust CLI with `@e1`-style snapshot refs. No test-generation/CI features documented | No | Alternative to Playwright CLI for exploration |
| **Stagehand** ([caching](https://docs.stagehand.dev/v3/best-practices/caching)) | Browserbase SDK mixing code + natural-language steps, with action caching | Partly (when cached) | Not needed. Playwright already covers it |
| **Browser Use** ([repo](https://github.com/browser-use/browser-use)) | Open-source Python/TS browser agent + hosted cloud | No | Not needed for QA of your own app |
| **playwright-bdd** ([repo](https://github.com/vitalets/playwright-bdd)) | Gherkin `.feature` → Playwright tests on the Playwright runner | Yes | Only if non-devs will author/read scenarios |
| **Spec Kit** ([github/spec-kit](https://github.com/github/spec-kit)) / **Kiro specs** ([docs](https://kiro.dev/docs/specs/)) | Spec-driven dev: requirements (Kiro uses EARS acceptance criteria) → design → tasks | n/a | Borrow the idea (acceptance criteria with IDs). You already have rich specs, so no need to adopt the tool |
| **node:test coverage** ([docs](https://nodejs.org/api/test.html#collecting-code-coverage)) | Built-in V8 coverage, lcov reporter | Yes | Coverage without new deps |
| **StrykerJS** ([docs](https://stryker-mutator.io/docs/stryker-js/introduction/)) | Mutation testing: are tests actually able to fail? | Yes (slow) | Spot-check AI-written tests on `services/billing`, `packages`, `payroll`. **Unverified:** support for `node:test` isn't listed (Vitest/Jest/Mocha/Tap/Jasmine/Karma/Cucumber are), so a runner switch or a command-runner setup may be needed |
| **Testcontainers** ([Postgres module](https://node.testcontainers.org/modules/postgresql/)) | Throwaway DB containers from test code | Yes | Optional, only to parallelise the serial suite |
| **Stripe CLI** ([webhooks](https://docs.stripe.com/webhooks#test-webhook)) | `stripe listen --forward-to`, `stripe trigger` | Semi (needs network + test account) | Manual/staging check of the real webhook path |

---

## 5. Pitfalls and guardrails

| Pitfall | Source | Guardrail for this repo |
|---|---|---|
| Agent deletes/edits/weakens tests to go green | "It is unacceptable to remove or edit tests…" ([Anthropic harness post](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)). Kent Beck's warning sign: "the genie was cheating, for example by disabling or deleting tests" ([Kent Beck, 2025-06-25](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes)) | `PreToolUse` hook blocking edits to existing test files. CI step that fails when the test count drops (you already fail on skips). Review test diffs separately from code diffs |
| Hard-coding / special-casing for the test inputs | "Do not hard-code values or create solutions that only work for specific test inputs… Tests are there to verify correctness, not to define the solution" ([Anthropic prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)) | Put that sentence in the testing skill/CLAUDE.md. Use two tenants and varied fixtures, never one magic value |
| Tests that assert the implementation, not behaviour | Playwright: "avoid relying on implementation details" ([best practices](https://playwright.dev/docs/best-practices)). Kent C. Dodds: tests should "resemble the way your software is used" ([trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)) | Write tests from the scenario table (spec), not from the code. Anthropic's writer/reviewer split: "have one Claude write tests, then another write code to pass them" ([best practices](https://code.claude.com/docs/en/best-practices)) |
| Mocking everything | Claude Code docs example prompt: "…avoid mocks" ([best practices](https://code.claude.com/docs/en/best-practices)) | Default to the real-Postgres harness. Only fake true third parties (Stripe via `stripe-fake.ts`, Resend via `NODE_ENV=test`) |
| Agent claims "done" without testing | "tendency to mark a feature as complete without proper testing" ([Anthropic harness post](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)) | Stop hook runs the suite. Ask for **evidence** (command + output), as the best-practices page recommends |
| Healer "fixes" a test by skipping it | Healer output can be "a skipped test if the healer believes that functionality is broken" ([Playwright Test Agents](https://playwright.dev/docs/test-agents)) | Keep the existing "skips fail CI" rule and extend it to `e2e/`. A healer skip becomes a bug ticket |
| Flaky E2E from shared state / third parties | Playwright: isolate tests. "Only test what you control" ([best practices](https://playwright.dev/docs/best-practices)) | Per-run studio (already done). Stub Stripe on PR runs. Keep real Stripe only in the staging gate. Role/label locators (already used) |
| Agent browser blind spots | Can't see native `alert()` modals via Puppeteer MCP ([Anthropic harness post](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)). Claude in Chrome pauses on login/CAPTCHA and JS dialogs block it ([Chrome docs](https://code.claude.com/docs/en/chrome)) | Avoid native dialogs in UI. Treat exploratory agent passes as a supplement |
| Coverage-as-target gaming | (general practice) | Report coverage, don't gate on a %. Use Stryker spot checks on money logic to test the tests |
| Reviewer over-reporting → over-engineering | "A reviewer prompted to find gaps will usually report some, even when the work is sound" ([best practices](https://code.claude.com/docs/en/best-practices)) | Tell the reviewer to flag only correctness/spec gaps |

---

## 6. Sources

- Claude Code best practices: https://code.claude.com/docs/en/best-practices
- Claude Code skills (`/run`, `/verify`, `/run-skill-generator`): https://code.claude.com/docs/en/skills
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code with Chrome: https://code.claude.com/docs/en/chrome
- Claude Code GitHub Actions: https://code.claude.com/docs/en/github-actions
- Anthropic prompting best practices ("Avoid focusing on passing tests and hardcoding"): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Anthropic Engineering, "Effective harnesses for long-running agents" (2025-11-26): https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Playwright Test Agents: https://playwright.dev/docs/test-agents
- Playwright best practices: https://playwright.dev/docs/best-practices
- Playwright CLI for coding agents: https://playwright.dev/docs/getting-started-cli · https://github.com/microsoft/playwright-cli
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- Vercel Labs agent-browser: https://github.com/vercel-labs/agent-browser
- Stagehand caching: https://docs.stagehand.dev/v3/best-practices/caching
- Browser Use: https://github.com/browser-use/browser-use
- Kent C. Dodds, testing trophy: https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
- Ham Vocke, The Practical Test Pyramid: https://martinfowler.com/articles/practical-test-pyramid.html
- Next.js testing: https://nextjs.org/docs/app/guides/testing
- Hono testing: https://hono.dev/docs/guides/testing
- Better Auth test utils: https://better-auth.com/docs/plugins/test-utils
- Testcontainers Postgres (Node): https://node.testcontainers.org/modules/postgresql/
- Stripe webhooks / local testing: https://docs.stripe.com/webhooks#test-webhook
- Stripe test clocks: https://docs.stripe.com/billing/testing/test-clocks
- Node.js test runner coverage: https://nodejs.org/api/test.html#collecting-code-coverage
- StrykerJS: https://stryker-mutator.io/docs/stryker-js/introduction/
- playwright-bdd: https://github.com/vitalets/playwright-bdd
- GitHub Spec Kit: https://github.com/github/spec-kit
- Kiro specs: https://kiro.dev/docs/specs/
- Kent Beck, "Augmented Coding: Beyond the Vibes" (2025-06-25): https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes

_Unverified / caveats: StrykerJS `node:test` support. Exact Playwright version that introduced `init-agents` (the docs page lists the VS Code 1.105 requirement, not a Playwright version). Repo test counts are grep-based approximations (file and `it(`/`test(` counts), and "no HTTP-level test" means no `/api/v1/<prefix>` string in any test file, so some of those routes may be covered at service level._
