# Test guardrails

Agents write a lot of the tests here, and the cheapest way for any author to turn a red suite
green is to weaken the test. These guardrails make that loud. The rule they back up is in
`CLAUDE.md` § Testing: **tests verify behaviour — never special-case inputs, never weaken a test to
make it pass.**

| Guardrail | Where | What it stops |
|---|---|---|
| No skipped tests | `be/scripts/check.mjs` and the backend `test` job (deploy-be.yml); `e2e/src/no-skips-reporter.ts` | A skip passing as a pass |
| Scenario Inventory traces | `scripts/check-scenarios.mjs` in `test-guardrails.yml` | A row still marked covered after its test was renamed or deleted (`testing.md`) |
| Coverage report | nightly `be-coverage.yml` → run summary | Untested code going unseen (report only, no % gate) |

The gates run in CI, where a reviewer already reads the diff: every PR, the merge queue and every
push run every suite (`deploy-be.yml`, `e2e-local.yml`, `test-guardrails.yml`), so sessions don't
run them on stop. Each check is stateless: it looks at the commit in front of it, never at a count or
a result another run left. An edit to a committed test, a deletion included, is a normal diff for
review.

## Before a push

No git hook runs on a push. Before a direct push to `staging` or `main`, run the full backend suite
yourself: `npm run check` in `be/` (~6 minutes in CI, longer on a laptop) is what predicts CI's
`test` job (`testing.md` § Matching CI locally). A pull request needs nothing local: CI runs every
suite on it.

## Running tests locally

CI runs every suite on every PR, so a session doesn't have to run the whole backend suite before it
stops. When checking a change locally, run just the tests it reaches:

```sh
node .claude/hooks/backend-tests.mjs be src/services/bookings/cancel.ts   # lists them
cd be && npm run check -- <those files>
```

`backend-tests.mjs` picks a changed test itself, every test that imports the change (through any
chain of imports), and every test that calls the URL of a route the chain reaches. It does not follow
imports through `app.ts`, the harness or a routes `index.ts`, since through those everything reaches
everything.

**One test database per worktree.** Two runs on one database fail each other ("tuple concurrently
updated"). Each checkout's `be/.env` points `TEST_DATABASE_URL` at its own database (e.g.
`reservetoday-test-staging-7`), so worktrees never wait on each other. `npm run test:db` in `be/`
creates it and fills in `TEST_DATABASE_URL`; the harness migrates it on first use, and holds a
Postgres advisory lock on it for the whole run. See `testing.md` § Running the backend tests.

## No skipped tests

- **Backend:** `npm run check` refuses to start without `TEST_DATABASE_URL`, so the integration
  tests cannot skip themselves for want of a database, and the `test` job fails unless the TAP
  summary reads `# skipped 0`.
- **Journeys:** the Playwright config adds `no-skips-reporter`, which fails any run with a
  `test.skip` / `test.fixme` / `describe.skip` journey, or one that calls `test.skip()` as it runs.
  `test-guardrails.yml` lists the journeys on every PR (`playwright test --list`, no stack needed),
  so a static skip fails the PR; a runtime skip fails the PR's own run in `e2e-local.yml` and the
  staging run in `e2e.yml`. In CI,
  `forbidOnly` also fails a stray `test.only`.

A journey that is genuinely broken is a bug to file, not a test to skip.

## Deleted tests

No check counts tests. A deleted test shows in the diff like any other deletion, and review is
where it is caught. A count compared against the base branch needed a record of every base run,
kept in a cache that expired, and it degraded to a warning whenever that record was missing.

## Coverage report

`be-coverage.yml` runs the backend suite nightly (03:00 UTC, on `staging`) and on demand (Run
workflow, on any branch) with Node's built-in coverage (`--experimental-test-coverage`, lcov
reporter — no dependency), and `scripts/coverage-summary.mjs` writes a table of lines, branches and
functions per `src/services/<feature>/` folder (and per other top-level `src/` folder) to the run's
summary page. It stays out of the `test` job every push waits on. A file no test ever imports is not
listed at all (Node only measures what it loads). It is a report: there is deliberately no
percentage to hit, because a number to hit is a reason to write tests that assert nothing.

Locally:

```sh
cd be
npm run check -- --experimental-test-coverage \
  --test-coverage-include='src/**' --test-coverage-exclude='src/**/*.test.ts' --test-coverage-exclude='src/test/**' \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=lcov --test-reporter-destination=lcov.info
node ../scripts/coverage-summary.mjs lcov.info
```
