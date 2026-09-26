# Test guardrails

Agents write a lot of the tests here, and the cheapest way for any author to turn a red suite
green is to weaken the test. These guardrails make that loud. The rule they back up is in
`CLAUDE.md` § Testing: **tests verify behaviour — never special-case inputs, never weaken a test to
make it pass.**

| Guardrail | Where | What it stops |
|---|---|---|
| No skipped tests | backend `test` job (deploy-be.yml); `e2e/src/no-skips-reporter.ts` | A skip passing as a pass |
| No lost tests | backend `test` job; `test-guardrails.yml` | A PR with fewer tests than its base branch |
| Coverage report | backend `test` job → run summary | Untested code going unseen (report only, no % gate) |
| Scenario Inventory traces | `scripts/check-scenarios.mjs` in `test-guardrails.yml` | A row still marked covered after its test was renamed or deleted (`testing.md`) |

All of them run in CI, where a reviewer already reads the diff: every PR runs every suite
(`deploy-be.yml`, `e2e-local.yml`, `test-guardrails.yml`), so sessions don't run them on stop.
There is no local hook: an edit to a committed test is a normal diff for review, and a test
removed on purpose is allowed with the `tests-removed` label (below).

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

- **Backend:** the `test` job fails unless the TAP summary reads `# skipped 0`.
- **Journeys:** the Playwright config adds `no-skips-reporter`, which fails any run with a
  `test.skip` / `test.fixme` / `describe.skip` journey, or one that calls `test.skip()` as it runs.
  `test-guardrails.yml` lists the journeys on every PR (`playwright test --list`, no stack needed),
  so a static skip fails the PR; a runtime skip fails the PR's own run in `e2e-local.yml` and the
  staging run in `e2e.yml`. In CI,
  `forbidOnly` also fails a stray `test.only`.

A journey that is genuinely broken is a bug to file, not a test to skip.

## No lost tests

A pull request may not have fewer tests than the branch it merges into.

- **Backend** (`test` job, deploy-be.yml): every green `staging`/`main` run records its test count
  in an Actions cache keyed by the git tree of `be/`. A PR compares its own count with the one recorded
  for its base (the merge commit's first parent). No record — the base run has not finished, or
  the cache expired — is a warning, not a failure; re-run the base branch's BE Deploy to record one.
- **Journeys** (`test-guardrails.yml`): the PR lists its journeys and its base's, and compares.

Removing tests on purpose (a feature was deleted): add the `tests-removed` label to the PR and
re-run the failed job. The label is read when the job runs, so a re-run sees it.

## Coverage report

The backend `test` job runs the suite with Node's built-in coverage (`--experimental-test-coverage`,
lcov reporter — no dependency) and `scripts/coverage-summary.mjs` writes a table of lines, branches
and functions per `src/services/<feature>/` folder (and per other top-level `src/` folder) to the
run's summary page — open the backend check from the PR. A file no test ever imports is not listed
at all (Node only measures what it loads). It is a report: there is deliberately no
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
