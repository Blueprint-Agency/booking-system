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

## Time

A rule that turns on the current instant — a cancellation window, a package's expiry, a daily
job's hour — reads it from `be/src/lib/clock.ts`, never from `new Date()`. Production never sets
that clock. A backend test holds it through the harness:

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

It prints covered/uncovered counts by role and by risk, and exits non-zero when a row marked
`covered` or `failing` names a test file that is gone or no longer has a test carrying the ID. It
also fails on a row it cannot read (bad ID, a value outside its list, an ID used twice, a table
header that is off), and on a row that names a test but is not marked `covered` or `failing`. The
Test Guardrails workflow (`test-guardrails.yml`) runs it on every pull request.

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
