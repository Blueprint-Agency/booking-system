# Testing

How this repo is tested, and how a test is tied to the behaviour it proves. The deploy gates
themselves are in `deployment.md` § Tests gate the backend deploy.

## Suites

| Suite | Where | Runs with |
|---|---|---|
| Backend unit + integration (real Postgres, two fixture Tenants, RLS live) | `be/src/**/*.test.ts` | `npm run check` in `be/` |
| Frontend units | `fe-client/src/**/*.test.ts`, `fe-portal/src/**/*.test.ts` | `npm run check` in each |
| Browser journeys (Playwright) | `e2e/journeys/*.spec.ts` | `npm test` in `e2e/` |
| Repo scripts | `scripts/*.test.mjs` | `node --test scripts/<name>.test.mjs` |

## Running the backend tests

**While working, run the files your change reaches:**

```sh
node .claude/hooks/backend-tests.mjs be src/services/bookings/cancel.ts   # lists them
cd be && npm run check -- <those files>
```

**Before a direct push to `staging` or `main`, run all of it:** `npm run check` in `be/`, about
seven minutes of tests on one machine (18 on a Windows laptop; CI slices it across jobs, § Shards in
CI). That is the run that predicts CI's (below). CI runs the whole suite on every PR, in the merge
queue and on every push.

**One test database per checkout.** In a new checkout or worktree, run `npm run test:db` in `be/`
once. It creates `reservetoday-test-<checkout folder>` on the local Postgres named by `be/.env`,
and fills in `TEST_DATABASE_URL` there if it is blank. The harness migrates and seeds that database
on first use. `npm run check` refuses to start without `TEST_DATABASE_URL`: the integration tests
would skip, and a green run would prove nothing. It also refuses one that will not accept a
connection, naming its host and port: otherwise every integration test is reported *cancelled*
under a `# fail 0` summary. The usual cause is another project's Postgres on the port `be/.env`
names (`docker ps` shows each container's). `npm run test:db -- --reset` drops and recreates
the database by hand. It refuses any database not named `reservetoday-test` or
`reservetoday-test-*`, and the development one (`POSTGRES_DB`).

**Matching CI locally.** A green full `npm run check` predicts a green CI `test` job, so the two
share everything that can be shared, and `be/scripts/check.mjs` refuses to run where they would not:

- **Node 22**, as `.nvmrc` pins it (`nvm use 22`), `engines` in `be/package.json` states it, and CI
  and `be/Dockerfile` run it. Another major accepts flags and behaves in ways 22 does not, so
  `npm run check` refuses to start on one.
- **One command.** CI's **Backend tests (serial, this shard)** step and the stop hook both run
  `npm run check` (`be/scripts/check.mjs`), adding only a reporter flag, or the files to run; CI
  also sets `SHARD=i/n` to run one slice of the file list per job (§ Shards in CI). A bare
  `npm run check` is the whole suite, as it always was.
- **One environment.** `be/src/test/environment.ts` sets the whole test environment before any file
  loads. The one value it reads from `be/.env` is `TEST_DATABASE_URL`; nothing else in `.env`
  reaches a test (`src/db/url.ts` loads no `.env` under `NODE_ENV=test`). Stripe, R2, the webhook
  secrets and `PLATFORM_ADMIN_EMAIL` are unset, so a run with real keys in `.env` still calls no
  real service. A test that needs one sets it with `withEnv`.
- **One time zone.** The same file sets `TZ=UTC`, CI's runners' zone, so a date formatted or a day
  boundary found in the process's own zone reads the same on a laptop in any zone.
- **An empty database.** A full run (no test files named) drops and recreates the checkout's test
  database before it starts, as CI's is new with every job, so no row an earlier run left can make
  it pass or fail. A run of named files keeps the database; CI (`CI=true`) never resets.
- **Commits that skip the disk.** CI's Postgres runs with `fsync` off. Locally the test database
  alone is set `synchronous_commit = off` (by `npm run test:db` and by the reset), so it commits
  as fast without touching the development database's durability.

What still differs is the OS and the machine's speed. On Windows or macOS a file path's case can
differ from an import and still resolve, where CI's Linux fails it, and a slower machine shows up as
timing flakiness; a flaky test gets fixed in the test. And a green local run predicts the `test`
job only: the deploy also waits on the schema `drift` check and the browser journeys on a stack
inside the runner (`deployment.md` § Browser journeys gate both deploys).

**What a run costs.** The harness (`be/src/test/harness.ts`) migrates, seeds and imports the app
once per process, and every later `startTestApp()` in that process gets the same app back. It holds
a Postgres advisory lock on the test database from its first `startTestApp()` to the end of the
process, so a second run on the same database waits for the first one. With a database per
checkout, only two runs in the same checkout ever wait on each other.

**One process for the whole suite.** `npm run check`, which CI and the stop hook also run, runs every file in
one process (`--experimental-test-isolation=none`, the spelling Node 22 and 23 both accept;
`--test-isolation` exists only from Node 23.6), so the app import and the database setup happen
once per run instead of once per file. `--import ./src/test/environment.ts` puts the test
environment in place before any file loads. In one process, every file's top level runs before
any test does, and a hook outside a `describe` hooks the whole run. So a backend test file must not:

- call `before`, `after`, `beforeEach` or `afterEach` outside a `describe`;
- set `process.env` at its top level. A file that needs its own value calls `withEnv` (`be/src/test/with-env.ts`)
  first in its `describe`. It sets the value in a `before` and puts the old one back in an `after`.

That works because the settings a test varies are read when the app uses them, not when their
module loads (`currentEnv` in `be/src/env.ts`): the platform-admin allowlist, the R2 bucket, public
host and keys, the statement descriptor prefix and the payment-credentials key. Anything else in
`env` is read once, at boot, and a test cannot change it.

## Shards in CI

The whole suite in one process took about seven and a half minutes in CI, and the advisory lock
means the files cannot run side by side on one database. So CI's `test-shard` job (`deploy-be.yml`)
is a matrix: six jobs, each with a Postgres service of its own, each running `npm run check` with
`SHARD=i/6`. `check.mjs` lists every file the default patterns match, sorts it, and shard `i` runs
every sixth file from the `i`-th — deterministic, so a file always lands in the same slice, and
checked: it refuses a shard outside `1..n`, and it asserts that the `n` slices together are the whole
list with no file in two of them, so a file cannot drop out of CI without a red run. A slice is still
serial, in one process, on its own empty database: the same run as `npm run check` on fewer files,
and the same rules for a test file apply. A slice must therefore not depend on a file in another
slice having run first; nothing in the suite does today, and a shard turning red where the whole run
is green is how such a dependency would show.

The `test` job needs every slice and is the one check `deploy`, branch protection and the merge queue
wait on, under the name `test` as before. Each slice fails on its own `# skipped 0` check, so nothing
skipped across the shards together. The count of shards is the one matrix list in `deploy-be.yml`;
`strategy.job-total` hands it to `check.mjs` as the denominator, so the list and the denominator
cannot disagree.

Locally, `SHARD=2/6 npm run check` runs one slice the way CI does, against the checkout's test
database (a full-run reset first, as any run of no named files). It is for reproducing a red shard;
the predictor of CI remains the whole serial `npm run check`.

## Authorization matrix

`be/src/test/authorization-matrix.test.ts` reads every `/api/v1/me`, `/api/v1/public` and
`/api/v1/platform` route from the app's own route table, and the portal's routes surface by surface as
each is brought under it (so far `/api/v1/portal/admin/receipts`, #389), and calls each one as
anonymous, a member of studio one, a member of studio two on studio one's hostname, an Admin of studio
one, an Instructor of studio one, a Platform administrator, and a caller naming no studio. On `/me`
and `/public` every caller calls from studio one's member app, on `/portal` from studio one's portal. Its `EXPECTATIONS` table says, per method and path
pattern, which callers the gate admits and the status and error code it answers each one it refuses.
A refused call must get exactly that answer and, together, the refused calls must change no row in any
Tenant-scoped table (`auth_events` and `audit_log` included). An admitted call must merely not be a
gate's refusal: what the route then does is the other tests' job.

**Adding a route under those prefixes means adding its line to `EXPECTATIONS`**; the test fails on a
route with none, and on an expectation whose route is gone. On `/platform` the gate answers
`404 not_found`, the same body as a missing row, so each platform call is shaped (a real studio's id, a
real import job's, a body the validator refuses) for the Platform administrator never to get
`not_found`: the refused callers' `not_found` on the same request is then the gate's.

## Time

A rule that turns on the current instant — a cancellation window, a package's expiry, a daily
job's hour — reads it from `be/src/lib/clock.ts`, never from `new Date()` or SQL `now()`. That
includes a deadline written for a rule to read later (an invitation's expiry, a former Slug's
redirect window, a Promo Code Hold). What stays on real time: record stamps (`updated_at`,
`archived_at`), cache and rate-limit timers, and the auth server's own session and verification
expiries. Production never sets that clock. A backend test holds it through the harness:

```ts
harness.clock.set(cutoff)      // the app now thinks it is exactly `cutoff`
harness.clock.advance(DAY)     // a day later
harness.clock.reset()          // back to the wall clock (`close()` does this too)
```

Scheduled jobs are fired the same way the scheduler fires them — tenant fan-out and each
Tenant's local hour included — through `scheduledJobs` in `be/src/jobs/index.ts`:
`await scheduledJobs.expirePackages()` is one tick at whatever instant the clock says.
`be/src/test/time-windows.test.ts` and `be/src/test/scheduled-jobs.test.ts` show both.

## Scenario Inventory

`test-scenarios.md` lists every acceptance scenario the specs promise, one row each, with a stable
ID (`CHK-03`). It answers "how far have we tested?". A test covers a row when **its name carries the
row's ID**.

**Check it:**

```sh
node scripts/check-scenarios.mjs
```

It prints covered/uncovered counts by role and by risk, with uncovered rows whose scenario starts
**Not built.** counted apart as "not built" (still `uncovered` in the table), and exits non-zero when a row marked
`covered` or `failing` names a test file that is gone or no longer has a test carrying the ID. It
also fails on a row it cannot read (bad ID, a value outside its list, an ID used twice, a table
header that is off), and on a row that names a test but is not marked `covered` or `failing`. The
`guardrails` job (`test-guardrails.yml`, called by `deploy-be.yml`) runs it on every pull request.

**Name a test with its ID.** Put the ID at the start of the `test(…)`, `it(…)` or `describe(…)`
name. One test may prove several rows; a `describe` carrying an ID covers it for the whole block.

```ts
test('CHK-03 an instructor checks a member in and the booking is attended', async () => { … })
test('CXL-04, CRD-02 cancelling outside the window returns the credit', async () => { … })
test.describe('PT-11 a PT request is declined', () => { … })
```

Only the name counts — an ID in a comment or an assertion does not.

**Add a row.**

1. Pick the area prefix from the list at the top of `test-scenarios.md`, and take the next unused
   number in that area. Never reuse or renumber an ID; a dropped scenario keeps its row as
   `wont-test` with the reason in the scenario cell.
2. Write the scenario as `**Given** … **When** … **Then** …`, using the terms in `be/CONTEXT.md`.
   One testable promise per row. No `|` inside a cell.
3. Fill `role`, `risk`, `level` and `status` from the lists at the top of the file. `level` is the
   lowest level that can prove it (most rows are `integration`).
4. When a test covers it, name the test with the ID, put its file path in "covered by"
   (`` `be/src/test/check-in.test.ts` ``, comma-separated for more than one), set `status` to
   `covered`, and run the script.

## Exploratory QA

Before a release, an agent can hunt for bugs the suites were never written for: it drives a real
browser through the app as one role and reports what it finds. It supplements the suites and gates
nothing: the prompt is the same every time, but a run's path and findings are not, so it cannot be a
check.

```
/exploratory-qa <member|instructor|admin|super> [local|staging]
```

It finds bugs and leaves the code alone. Its findings arrive as `needs-triage` GitHub issues, and
the promises it exercised that no Inventory row states arrive as proposed rows for a human to add.
How a run goes, and each role's charter, is in `.claude/skills/exploratory-qa/`. A `super` run needs
a Platform administrator account in `QA_SUPER_EMAIL` and `QA_SUPER_PASSWORD` in the environment of
the session that runs it, or it asks for one.
